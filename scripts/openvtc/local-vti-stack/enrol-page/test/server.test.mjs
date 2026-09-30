import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { start, parseEnvFile, loadConfig } from '../server.mjs'
import { enrolmentCode } from '../code.mjs'
import { b64url, base58btcEncode, base58btcDecode, linkToOffer, ed25519KeyFromPeer2 } from '../lib.mjs'

const VTA = 'did:webvh:QmTest:example.org'
let tmp, app, base, clock

function makeStub(name, exitCode) {
  const argvFile = path.join(tmp, `${name}.argv`)
  const envFile = path.join(tmp, `${name}.env`)
  const bin = path.join(tmp, name)
  writeFileSync(
    bin,
    `#!/bin/sh\n: > "${argvFile}"\nfor a in "$@"; do printf '%s\\n' "$a" >> "${argvFile}"; done\n` +
      `printf '%s' "$PNM_HOME" > "${envFile}"\n` +
      (exitCode ? `echo "Error: 409 Conflict: already exists" >&2\nexit ${exitCode}\n` : 'exit 0\n'),
  )
  chmodSync(bin, 0o755)
  return { bin, argvFile, envFile }
}

function makeIdentity() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url')
  const mb = 'z' + base58btcEncode(Buffer.concat([Buffer.from([0xed, 0x01]), raw]))
  const svc = b64url(Buffer.from(JSON.stringify({ t: 'dm', s: 'https://example.org' })))
  const did = `did:peer:2.E${mb}.V${mb}.S${svc}`
  return { did, privateKey, kid: `${did}#key-2` }
}

function jws(id, { header = {}, payload = {}, key = id.privateKey } = {}) {
  const h = b64url(Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: id.kid, typ: 'JWT', ...header })))
  const p = b64url(Buffer.from(JSON.stringify(payload)))
  const sig = sign(null, Buffer.from(`${h}.${p}`, 'ascii'), key)
  return `${h}.${p}.${b64url(sig)}`
}

function proofFor(id, offer, over = {}) {
  const now = clock.t
  return jws(id, { payload: { iss: id.did, aud: offer.url, nonce: offer.n, iat: now, exp: now + 120, ...over } })
}

async function api(method, p, body) {
  const r = await fetch(p.startsWith('http') ? p : base + p, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

const newOffer = async () => (await api('POST', '/api/offers')).body

before(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'enrol-page-'))
  clock = { t: 1_800_000_000 }
  app = await start({ port: 0, vtaDid: VTA, label: 'Test agent', offerTtl: 300, now: () => clock.t, pnmHome: '/tmp/pnm-home-test' }, '127.0.0.1')
  base = `http://127.0.0.1:${app.server.address().port}`
  app.config.publicUrl = base
})
after(() => {
  app.server.close()
  rmSync(tmp, { recursive: true, force: true })
})
beforeEach(() => {
  clock.t = 1_800_000_000
})

test('base58btc round-trip and did:peer:2 key extraction', () => {
  const bytes = Uint8Array.from([0, 0, 1, 2, 255, 7])
  assert.deepEqual(base58btcDecode(base58btcEncode(bytes)), bytes)
  assert.equal(base58btcEncode(Buffer.from('hello world')), 'StV1DL6CwTryKyV')
  const id = makeIdentity()
  assert.equal(ed25519KeyFromPeer2(id.did).length, 32)
  assert.throws(() => ed25519KeyFromPeer2('did:peer:2.Ez6Mkabc'), /exactly one V/)
})

test('parseEnvFile handles export and quotes', () => {
  const env = parseEnvFile('# c\nexport ALICE_VTA_DID="did:webvh:a:b"\nB=\'x y\'\nC=plain\n')
  assert.deepEqual(env, { ALICE_VTA_DID: 'did:webvh:a:b', B: 'x y', C: 'plain' })
  const dir = mkdtempSync(path.join(os.tmpdir(), 'enrol-stack-'))
  writeFileSync(path.join(dir, 'stack.env'), "export ALICE_VTA_DID='did:webvh:q:host'\n")
  const cfg = loadConfig({ HOME: '/nowhere', STACK_DIR: dir, ENROL_PORT: '9999' })
  assert.equal(cfg.vtaDid, 'did:webvh:q:host')
  assert.equal(cfg.publicUrl, 'http://localhost:9999')
  assert.equal(cfg.offerTtl, 300)
  rmSync(dir, { recursive: true, force: true })
})

test('offer shape, key order, and link round-trip', async () => {
  const { offer, link, qrSvg } = await newOffer()
  assert.deepEqual(Object.keys(offer), ['v', 't', 'vta', 'label', 'url', 'n', 'exp'])
  assert.equal(offer.v, 1)
  assert.equal(offer.t, 'vta-enrol')
  assert.equal(offer.vta, VTA)
  assert.equal(offer.label, 'Test agent')
  assert.match(offer.n, /^[A-Za-z0-9_-]{22}$/)
  assert.equal(offer.url, `${base}/api/offers/${offer.n}`)
  assert.equal(offer.exp, clock.t + 300)
  assert.ok(link.startsWith('keyring://vta/enrol?o='))
  assert.ok(!link.includes('='.repeat(2)) && !link.slice(22).includes('='), 'no base64 padding')
  assert.deepEqual(linkToOffer(link), offer)
  assert.equal(link, 'keyring://vta/enrol?o=' + b64url(Buffer.from(JSON.stringify(offer), 'utf8')))
  assert.match(qrSvg, /^<svg/)
  const st = await api('GET', `${offer.url}/status`)
  assert.deepEqual(st, { status: 200, body: { state: 'open' } })
  const full = await api('GET', `/api/offers/${offer.n}`)
  assert.equal(full.body.link, link)
})

test('GET / serves the page with test ids', async () => {
  const r = await fetch(base + '/')
  const html = await r.text()
  assert.equal(r.status, 200)
  for (const id of ['add-phone', 'qr', 'link', 'copy-link', 'code', 'grant', 'refuse', 'state']) assert.ok(html.includes(`data-testid="${id}"`), id)
  assert.match(html, /<code[^>]*data-testid="link"/)
})

test('submit happy path → 202 with matching code, then single use (409)', async () => {
  const { offer } = await newOffer()
  const id = makeIdentity()
  const r = await api('POST', `${offer.url}/submit`, { did: id.did, proof: proofFor(id, offer) })
  assert.equal(r.status, 202)
  assert.deepEqual(r.body, { state: 'submitted', code: enrolmentCode(offer.n, id.did) })
  const st = await api('GET', `${offer.url}/status`)
  assert.deepEqual(st.body, { state: 'submitted', code: r.body.code })
  const again = await api('POST', `${offer.url}/submit`, { did: id.did, proof: proofFor(id, offer) })
  assert.equal(again.status, 409)
})

test('unknown offer → 404', async () => {
  const r = await api('POST', '/api/offers/nope/submit', { did: 'x', proof: 'y' })
  assert.equal(r.status, 404)
  assert.equal((await api('GET', '/api/offers/nope/status')).status, 404)
})

test('proof checks → 400 / 401', async () => {
  const { offer } = await newOffer()
  const id = makeIdentity()
  const other = makeIdentity()
  const cases = [
    ['wrong aud', { did: id.did, proof: proofFor(id, offer, { aud: 'http://evil/api/offers/' + offer.n }) }, 400, 'bad_aud'],
    ['wrong nonce', { did: id.did, proof: proofFor(id, offer, { nonce: 'BBBBBBBBBBBBBBBBBBBBBB' }) }, 400, 'bad_nonce'],
    ['iss != did', { did: id.did, proof: proofFor(id, offer, { iss: other.did }) }, 400, 'did_mismatch'],
    ['kid != iss', { did: id.did, proof: jws(id, { header: { kid: `${other.did}#key-1` }, payload: { iss: id.did, aud: offer.url, nonce: offer.n, iat: clock.t, exp: clock.t + 60 } }) }, 400, 'did_mismatch'],
    ['alg', { did: id.did, proof: jws(id, { header: { alg: 'ES256' }, payload: { iss: id.did, aud: offer.url, nonce: offer.n, iat: clock.t, exp: clock.t + 60 } }) }, 400, 'bad_alg'],
    ['proof exp past', { did: id.did, proof: proofFor(id, offer, { exp: clock.t - 1 }) }, 400, 'proof_expired'],
    ['not a JWS', { did: id.did, proof: 'abc' }, 400, 'bad_proof'],
    ['missing fields', { did: id.did }, 400, 'bad_request'],
    // signed by `other`'s key but claiming `id`'s DID everywhere
    ['bad signature', { did: id.did, proof: jws(id, { key: other.privateKey, payload: { iss: id.did, aud: offer.url, nonce: offer.n, iat: clock.t, exp: clock.t + 60 } }) }, 401, 'bad_signature'],
  ]
  for (const [name, body, status, code] of cases) {
    const r = await api('POST', `${offer.url}/submit`, body)
    assert.equal(r.status, status, `${name}: ${JSON.stringify(r.body)}`)
    assert.equal(r.body.code, code, name)
    assert.equal(typeof r.body.error, 'string')
  }
  // Two V elements → 400 (DID mentioned consistently, so only the V rule trips)
  const mb = id.did.split('.').find((p) => p.startsWith('V'))
  const twoV = `did:peer:2.${mb}.${mb}`
  const twoVid = { ...id, did: twoV, kid: `${twoV}#key-1` }
  const r2 = await api('POST', `${offer.url}/submit`, { did: twoV, proof: proofFor(twoVid, offer) })
  assert.equal(r2.status, 400)
  assert.equal(r2.body.code, 'bad_did')
  // Failed attempts do not consume the offer.
  assert.equal((await api('GET', `${offer.url}/status`)).body.state, 'open')
  const ok = await api('POST', `${offer.url}/submit`, { did: id.did, proof: proofFor(id, offer) })
  assert.equal(ok.status, 202)
})

test('expired offer → 410 and status "expired"', async () => {
  const { offer } = await newOffer()
  const id = makeIdentity()
  clock.t = offer.exp + 1
  const r = await api('POST', `${offer.url}/submit`, { did: id.did, proof: proofFor(id, offer) })
  assert.equal(r.status, 410)
  assert.equal((await api('GET', `${offer.url}/status`)).body.state, 'expired')
})

test('submitted offer expires lazily; granted one stays granted', async () => {
  const stub = makeStub('pnm-ok2', 0)
  app.config.pnmBin = stub.bin
  const a = (await newOffer()).offer
  const b = (await newOffer()).offer
  const id = makeIdentity()
  await api('POST', `${a.url}/submit`, { did: id.did, proof: proofFor(id, a) })
  await api('POST', `${b.url}/submit`, { did: id.did, proof: proofFor(id, b) })
  assert.equal((await api('POST', `/api/offers/${b.n}/grant`)).status, 200)
  clock.t = a.exp + 1
  assert.equal((await api('GET', `${a.url}/status`)).body.state, 'expired')
  assert.equal((await api('POST', `/api/offers/${a.n}/grant`)).status, 410)
  assert.equal((await api('GET', `${b.url}/status`)).body.state, 'granted')
})

test('grant runs pnm with exact argv and PNM_HOME; then 409 on repeat', async () => {
  const stub = makeStub('pnm-ok', 0)
  app.config.pnmBin = stub.bin
  const { offer } = await newOffer()
  assert.equal((await api('POST', `/api/offers/${offer.n}/grant`)).status, 409, 'cannot grant an open offer')
  const id = makeIdentity()
  await api('POST', `${offer.url}/submit`, { did: id.did, proof: proofFor(id, offer) })
  const r = await api('POST', `/api/offers/${offer.n}/grant`)
  assert.equal(r.status, 200)
  assert.equal(r.body.state, 'granted')
  const argv = readFileSync(stub.argvFile, 'utf8').trimEnd().split('\n')
  assert.deepEqual(argv, ['--vta', 'alice', 'acl', 'create', '--did', id.did, '--role', 'admin', '--expires', '1h', '--label', 'keyring-phone'])
  assert.equal(readFileSync(stub.envFile, 'utf8'), '/tmp/pnm-home-test')
  assert.equal((await api('GET', `${offer.url}/status`)).body.state, 'granted')
  assert.equal((await api('POST', `/api/offers/${offer.n}/grant`)).status, 409)
  assert.equal((await api('POST', `/api/offers/${offer.n}/refuse`)).status, 409)
})

test('failing pnm → 502 with stderr tail, state stays submitted', async () => {
  const stub = makeStub('pnm-fail', 1)
  app.config.pnmBin = stub.bin
  const { offer } = await newOffer()
  const id = makeIdentity()
  await api('POST', `${offer.url}/submit`, { did: id.did, proof: proofFor(id, offer) })
  const r = await api('POST', `/api/offers/${offer.n}/grant`)
  assert.equal(r.status, 502)
  assert.match(r.body.error, /already exists/)
  const st = await api('GET', `${offer.url}/status`)
  assert.equal(st.body.state, 'submitted')
  assert.equal(st.body.code, enrolmentCode(offer.n, id.did))
})

test('non-peer DID refused at grant (400), pnm never runs', async () => {
  const stub = makeStub('pnm-never', 0)
  app.config.pnmBin = stub.bin
  const { offer } = await newOffer()
  const rec = app.offers.get(offer.n)
  Object.assign(rec, { state: 'submitted', did: 'did:key:z6Mk; rm -rf /', code: 'XXXX-XXXX' })
  const r = await api('POST', `/api/offers/${offer.n}/grant`)
  assert.equal(r.status, 400)
  assert.ok(!existsSync(stub.argvFile))
  assert.equal(app.offers.get(offer.n).state, 'submitted')
})

test('refuse flow from open and from submitted', async () => {
  const a = (await newOffer()).offer
  const r = await api('POST', `/api/offers/${a.n}/refuse`)
  assert.equal(r.status, 200)
  assert.equal(r.body.state, 'refused')
  assert.equal((await api('GET', `${a.url}/status`)).body.state, 'refused')
  const id = makeIdentity()
  assert.equal((await api('POST', `${a.url}/submit`, { did: id.did, proof: proofFor(id, a) })).status, 409)

  const b = (await newOffer()).offer
  await api('POST', `${b.url}/submit`, { did: id.did, proof: proofFor(id, b) })
  assert.equal((await api('POST', `/api/offers/${b.n}/refuse`)).status, 200)
  assert.equal((await api('POST', `/api/offers/${b.n}/grant`)).status, 409)
})
