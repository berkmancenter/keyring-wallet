// Generates the did:webs artifacts for the K0 test kit's State root (k0-utah-v2/kel-roy.cesr), laid out exactly as a
// host serves them: webs-k0-root/<host>/<path…>/<AID>/{keri.cesr,did.json}. Deterministic: the same KEL gives the same
// bytes. Its JWK conversion is written here independently of ../../webs/document.ts (straight from @noble/curves), so
// the committed did.json is a second derivation the resolver's own is checked against, not a copy of it.
//
// Run from packages/core:  node src/modules/sedi/__tests__/fixtures/webs-k0-root.gen.mjs
// Then `git diff --exit-code` on webs-k0-root/ must be clean unless kel-roy.cesr changed.
/* eslint-disable no-console -- a run-once generator, run with node */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { p256 } from '@noble/curves/nist.js'

const HOST = 'example.org' // placeholder: the real host is Alberto's choice, and only the DID's host label changes
const PATH = ['keyring-demo-state']
const here = path.dirname(fileURLToPath(import.meta.url))
const kel = fs.readFileSync(path.join(here, 'k0-utah-v2', 'kel-roy.cesr'))
const text = kel.toString('latin1')

// The current keys: the last establishment event's "k" (icp or rot). Bodies are found by their version strings.
let keys
let aid
for (let at = text.indexOf('{"v":"'); at >= 0; at = text.indexOf('{"v":"', at + 1)) {
  const size = [...text.slice(at + 20, at + 24)].reduce(
    (n, c) => n * 64 + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(c),
    0
  )
  const body = JSON.parse(text.slice(at, at + size))
  aid = body.i
  if (body.t === 'icp' || body.t === 'rot') keys = body.k
}

const b64url = (b) => Buffer.from(b).toString('base64url')
const jwk = (k) => {
  if (!k.startsWith('1AAJ') && !k.startsWith('1AAI')) throw new Error(`generator handles P-256 only, got ${k}`)
  const raw = Buffer.from('AAAA' + k.slice(4), 'base64url').subarray(3) // 4-char code: zero its bits, drop 3 lead bytes
  const xy = p256.Point.fromBytes(raw).toBytes(false)
  return { kid: k, kty: 'EC', crv: 'P-256', x: b64url(xy.slice(1, 33)), y: b64url(xy.slice(33, 65)) }
}

const websDid = ['did:webs', HOST, ...PATH, aid].join(':')
const subject = ['did:web', HOST, ...PATH, aid].join(':')
const doc = {
  id: subject,
  verificationMethod: keys.map((k) => ({ id: `#${k}`, type: 'JsonWebKey', controller: subject, publicKeyJwk: jwk(k) })),
  service: [],
  alsoKnownAs: [websDid, `did:keri:${aid}`],
}
const out = path.join(here, 'webs-k0-root', HOST, ...PATH, aid)
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, 'keri.cesr'), kel)
fs.writeFileSync(path.join(out, 'did.json'), JSON.stringify(doc, null, 2) + '\n')
console.log(websDid)
