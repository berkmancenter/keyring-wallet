// Small, dependency-free helpers for the enrolment exchange.
import { createPublicKey, verify } from 'node:crypto'

export const b64url = (buf) => Buffer.from(buf).toString('base64url')
export const fromB64url = (s) => Buffer.from(s, 'base64url')

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

export function base58btcEncode(bytes) {
  bytes = Uint8Array.from(bytes)
  let zeros = 0
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  let out = ''
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out
    n /= 58n
  }
  return '1'.repeat(zeros) + out
}

export function base58btcDecode(str) {
  let zeros = 0
  while (zeros < str.length && str[zeros] === '1') zeros++
  let n = 0n
  for (const c of str) {
    const v = B58.indexOf(c)
    if (v < 0) throw new Error(`invalid base58 character '${c}'`)
    n = n * 58n + BigInt(v)
  }
  const tail = []
  while (n > 0n) {
    tail.unshift(Number(n & 0xffn))
    n >>= 8n
  }
  return Uint8Array.from([...new Array(zeros).fill(0), ...tail])
}

// ---- offer / link ----

export const LINK_PREFIX = 'keyring://vta/enrol?o='

export function buildOffer({ vta, label, publicUrl, nonce, exp }) {
  // Key order is part of the protocol: v, t, vta, label, url, n, exp.
  return { v: 1, t: 'vta-enrol', vta, label, url: `${publicUrl}/api/offers/${nonce}`, n: nonce, exp }
}

export const offerToLink = (offer) => LINK_PREFIX + b64url(Buffer.from(JSON.stringify(offer), 'utf8'))

export function linkToOffer(link) {
  if (!link.startsWith(LINK_PREFIX)) throw new Error('not a keyring enrol link')
  return JSON.parse(fromB64url(link.slice(LINK_PREFIX.length)).toString('utf8'))
}

// ---- did:peer:2 ----

export const PEER2_RE = /^did:peer:2\.[A-Za-z0-9._-]+$/

/** Ed25519 public key (32 bytes) of the single 'V' (authentication) element. */
export function ed25519KeyFromPeer2(did) {
  if (typeof did !== 'string' || !did.startsWith('did:peer:2.')) throw new Error('not a did:peer:2')
  const parts = did.slice('did:peer:2.'.length).split('.')
  const v = parts.filter((p) => p.startsWith('V'))
  if (v.length !== 1) throw new Error(`expected exactly one V (authentication) key, found ${v.length}`)
  const mb = v[0].slice(1)
  if (!mb.startsWith('z')) throw new Error('authentication key is not base58btc multibase')
  const bytes = base58btcDecode(mb.slice(1))
  if (bytes.length !== 34 || bytes[0] !== 0xed || bytes[1] !== 0x01) throw new Error('authentication key is not a 32-byte Ed25519 key')
  return Buffer.from(bytes.slice(2))
}

// ---- proof ----

export class ProofError extends Error {
  constructor(status, message, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Check the submit body against an offer; throws ProofError(400|401). */
export function verifySubmission(body, offer, nowSecs) {
  const bad = (msg, code) => new ProofError(400, msg, code)
  if (!body || typeof body.did !== 'string' || typeof body.proof !== 'string') throw bad('body must be {did, proof}', 'bad_request')
  const segs = body.proof.split('.')
  if (segs.length !== 3) throw bad('proof is not a compact JWS', 'bad_proof')
  let header, payload
  try {
    header = JSON.parse(fromB64url(segs[0]).toString('utf8'))
    payload = JSON.parse(fromB64url(segs[1]).toString('utf8'))
  } catch {
    throw bad('proof header/payload is not JSON', 'bad_proof')
  }
  if (header.alg !== 'EdDSA') throw bad('alg must be EdDSA', 'bad_alg')
  const kidDid = typeof header.kid === 'string' ? header.kid.split('#')[0] : undefined
  if (kidDid !== payload.iss || payload.iss !== body.did) throw bad('kid, iss and did must name the same DID', 'did_mismatch')
  if (payload.aud !== offer.url) throw bad('aud does not match this offer', 'bad_aud')
  if (payload.nonce !== offer.n) throw bad('nonce does not match this offer', 'bad_nonce')
  if (typeof payload.exp !== 'number' || payload.exp < nowSecs) throw bad('proof expired', 'proof_expired')
  let raw
  try {
    raw = ed25519KeyFromPeer2(body.did)
  } catch (e) {
    throw bad(e.message, 'bad_did')
  }
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b64url(raw) }, format: 'jwk' })
  let ok = false
  try {
    ok = verify(null, Buffer.from(`${segs[0]}.${segs[1]}`, 'ascii'), key, fromB64url(segs[2]))
  } catch {
    ok = false
  }
  if (!ok) throw new ProofError(401, 'signature does not verify', 'bad_signature')
}
