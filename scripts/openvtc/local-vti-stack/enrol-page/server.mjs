#!/usr/bin/env node
// Lab-only enrolment page + API: an admin links a phone to a local VTA by QR.
// No login by design — bind it to a lab network only. See README.md.
import http from 'node:http'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { enrolmentCode } from './code.mjs'
import { PEER2_RE, ProofError, b64url, buildOffer, offerToLink, verifySubmission } from './lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../../../..')
const INDEX_HTML = path.join(HERE, 'public', 'index.html')

/** Parse KEY=VALUE lines (optional `export `, optional quotes). */
export function parseEnvFile(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}

export function loadConfig(env = process.env) {
  const home = env.HOME || os.homedir()
  const port = Number(env.ENROL_PORT ?? 8190)
  const stackDir = env.STACK_DIR || path.join(home, 'vti-stack')
  let vtaDid = env.ENROL_VTA_DID
  let vtaDidSource = 'ENROL_VTA_DID'
  if (!vtaDid) {
    vtaDidSource = path.join(stackDir, 'stack.env')
    try {
      vtaDid = parseEnvFile(readFileSync(vtaDidSource, 'utf8')).ALICE_VTA_DID
    } catch {
      /* reported below */
    }
    if (!vtaDid) vtaDidSource = 'unset'
  }
  return {
    port,
    publicUrl: (env.ENROL_PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
    vtaDid: vtaDid || '',
    vtaDidSource,
    label: env.ENROL_LABEL || 'Keyring lab agent (alice)',
    offerTtl: Number(env.OFFER_TTL ?? 300),
    pnmBin: env.PNM_BIN || path.join(home, 'Documents/vti-main/target/debug/pnm'),
    pnmHome: env.PNM_HOME || path.join(home, 'vti-stack/pnm-alice'),
    vtaSlug: env.VTA_SLUG || 'alice',
    now: () => Math.floor(Date.now() / 1000),
  }
}

let qrcode
function qrSvg(link) {
  qrcode ??= createRequire(path.join(REPO_ROOT, 'package.json'))('qrcode')
  return qrcode.toString(link, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 })
}

function send(res, status, body) {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(data)
}

function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new ProofError(413, 'body too large', 'too_large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new ProofError(400, 'body is not JSON', 'bad_json'))
      }
    })
    req.on('error', reject)
  })
}

function runGrant(cfg, did) {
  const args = ['--vta', cfg.vtaSlug, 'acl', 'create', '--did', did, '--role', 'admin', '--expires', '1h', '--label', 'keyring-phone']
  return new Promise((resolve) => {
    // execFile, no shell: the DID is passed as a single argv element.
    execFile(cfg.pnmBin, args, { env: { ...process.env, PNM_HOME: cfg.pnmHome }, timeout: 60_000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr || err?.message || '') })
    })
  })
}

const tail = (s, n = 800) => (s.length > n ? '…' + s.slice(-n) : s).trim()

/** Build the HTTP server. `overrides` patch the loaded config (tests inject `now`, pnmBin, …). */
export function createEnrolServer(overrides = {}) {
  const cfg = { ...loadConfig(), ...overrides }
  const offers = new Map() // n -> { offer, link, state, did?, code?, error? }

  const refresh = (rec) => {
    if ((rec.state === 'open' || rec.state === 'submitted') && cfg.now() > rec.offer.exp) rec.state = 'expired'
    return rec
  }
  const view = (rec) => {
    const v = { offer: rec.offer, link: rec.link, state: rec.state }
    if (rec.did) v.did = rec.did
    if (rec.code) v.code = rec.code
    if (rec.error) v.error = rec.error
    return v
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x')
    const p = url.pathname
    const m = req.method

    if (m === 'GET' && (p === '/' || p === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      return res.end(readFileSync(INDEX_HTML))
    }
    if (m === 'GET' && p === '/health') return send(res, 200, { ok: true })

    if (p === '/api/offers' && m === 'POST') {
      if (!cfg.vtaDid) return send(res, 500, { error: 'no VTA DID configured (ENROL_VTA_DID or ALICE_VTA_DID in stack.env)' })
      const nonce = b64url(randomBytes(16))
      const offer = buildOffer({ vta: cfg.vtaDid, label: cfg.label, publicUrl: cfg.publicUrl, nonce, exp: cfg.now() + cfg.offerTtl })
      const link = offerToLink(offer)
      offers.set(nonce, { offer, link, state: 'open' })
      return send(res, 201, { offer, link, qrSvg: await qrSvg(link) })
    }

    const mm = p.match(/^\/api\/offers\/([A-Za-z0-9_-]+)(?:\/(submit|status|grant|refuse))?$/)
    if (!mm) return send(res, 404, { error: 'not found' })
    const rec = offers.get(mm[1])
    const action = mm[2]
    if (!rec) return send(res, 404, { error: 'offer unknown', code: 'unknown_offer' })

    if (!action && m === 'GET') return send(res, 200, view(refresh(rec)))

    if (action === 'status' && m === 'GET') {
      refresh(rec)
      const s = { state: rec.state }
      if (rec.code) s.code = rec.code
      if (rec.error) s.error = rec.error
      return send(res, 200, s)
    }

    if (action === 'submit' && m === 'POST') {
      const body = await readJson(req).catch((e) => e)
      if (refresh(rec).state === 'expired') return send(res, 410, { error: 'offer expired', code: 'expired' })
      if (rec.state !== 'open') return send(res, 409, { error: `offer already ${rec.state}`, code: 'not_open' })
      if (body instanceof Error) throw body
      verifySubmission(body, rec.offer, cfg.now())
      rec.state = 'submitted'
      rec.did = body.did
      rec.code = enrolmentCode(rec.offer.n, body.did)
      return send(res, 202, { state: 'submitted', code: rec.code })
    }

    if (action === 'grant' && m === 'POST') {
      if (refresh(rec).state === 'expired') return send(res, 410, { error: 'offer expired', code: 'expired' })
      if (rec.state !== 'submitted') return send(res, 409, { error: `cannot grant from state ${rec.state}`, code: 'not_submitted' })
      if (!PEER2_RE.test(rec.did)) return send(res, 400, { error: 'only did:peer:2 DIDs can be granted', code: 'bad_did' })
      if (rec.granting) return send(res, 409, { error: 'grant already in flight', code: 'in_flight' })
      rec.granting = true
      try {
        const r = await runGrant(cfg, rec.did)
        if (!r.ok) {
          rec.error = tail(r.stderr || r.stdout) || `pnm exited ${r.code}`
          return send(res, 502, { error: rec.error, code: 'grant_failed' })
        }
        rec.state = 'granted'
        delete rec.error
        return send(res, 200, view(rec))
      } finally {
        rec.granting = false
      }
    }

    if (action === 'refuse' && m === 'POST') {
      refresh(rec)
      if (rec.state !== 'open' && rec.state !== 'submitted') return send(res, 409, { error: `cannot refuse from state ${rec.state}`, code: 'not_refusable' })
      rec.state = 'refused'
      return send(res, 200, view(rec))
    }

    return send(res, 405, { error: 'method not allowed' })
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (e instanceof ProofError) return send(res, e.status, e.code ? { error: e.message, code: e.code } : { error: e.message })
      console.error(e)
      if (!res.headersSent) send(res, 500, { error: 'internal error' })
    })
  })
  return { server, offers, config: cfg }
}

/** Create and listen; resolves once bound. */
export function start(overrides = {}, host = '0.0.0.0') {
  const app = createEnrolServer(overrides)
  return new Promise((resolve) => app.server.listen(app.config.port, host, () => resolve(app)))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await start()
  const { config: c } = app
  console.log(`enrol page listening on 0.0.0.0:${app.server.address().port}`)
  console.log(`  open        ${c.publicUrl}/`)
  console.log(`  VTA DID     ${c.vtaDid || '(none!)'}  [from ${c.vtaDidSource}]`)
  console.log(`  grant via   PNM_HOME=${c.pnmHome} ${c.pnmBin} --vta ${c.vtaSlug} acl create ...`)
  console.log(`  offer TTL   ${c.offerTtl}s   (no login — lab only)`)
}
