/**
 * The pieces of trigger-link sign-in (`auth/oob`) a wallet needs, shared by
 * the ref-22+ rungs: Trust Task envelopes, the HTTPS binding, verifying a
 * party's eddsa-jcs-2022 proof against its resolved DID document, and
 * selecting services by type.
 *
 * Signing reuses ref-20's di-proof.mjs, which mirrors
 * @bifold/trust-tasks/src/documentProof.ts byte for byte.
 */
import { randomUUID } from 'node:crypto'
import { ed25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import canonicalize from 'canonicalize'
import { resolveDID } from 'didwebvh-ts'

export { generateDidKeyHolder, signDocument, base58encode } from '../ref-20-local-vetting/di-proof.mjs'

export const OOB = {
  request: 'https://trusttasks.org/spec/auth/oob/request/0.1',
  claim: 'https://trusttasks.org/spec/auth/oob/claim/0.1',
  identify: 'https://trusttasks.org/spec/auth/oob/identify/0.1',
  prove: 'https://trusttasks.org/spec/auth/oob/prove/0.1',
  grant: 'https://trusttasks.org/spec/auth/oob/grant/0.1',
  respond: 'https://trusttasks.org/spec/auth/oob/respond/0.1',
  redeem: 'https://trusttasks.org/spec/auth/oob/redeem/0.1',
  cancel: 'https://trusttasks.org/spec/auth/oob/cancel/0.1',
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
export function base58decode(text) {
  const bytes = [0]
  for (const ch of text) {
    let carry = B58.indexOf(ch)
    if (carry < 0) throw new Error(`not base58: ${ch}`)
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58
      bytes[i] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }
  for (const ch of text) {
    if (ch === '1') bytes.push(0)
    else break
  }
  return new Uint8Array(bytes.reverse())
}

/** A Trust Task envelope, as the portal and the plugin build one: second-precision `issuedAt`. */
export function envelope(type, payload, issuer, recipient, extra = {}) {
  return {
    id: `urn:uuid:${randomUUID()}`,
    type,
    issuer,
    recipient,
    issuedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    ...extra,
    payload,
  }
}

/**
 * POST a signed document to `<TrustTaskHTTPS base>/trust-tasks` (HTTPS binding 0.2 §6).
 * Returns `{ ok, status, doc }`; a `trust-task-error` document is `ok: false`.
 */
export async function postTask(base, doc, { timeoutMs = 40_000, origin } = {}) {
  const url = base.replace(/\/+$/, '') + '/trust-tasks'
  const res = await fetch(url, {
    method: 'POST',
    // Only the browser's documents carry an Origin: the VTC accepts
    // auth/oob/request only from its portal's origin. A wallet sends none.
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify(doc),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const body = await res.json().catch(() => null)
  const isError = !res.ok || String(body?.type ?? '').includes('/trust-task-error/')
  return { ok: !isError, status: res.status, doc: body }
}

/** Resolve a did:webvh with its log verified (Ed25519), as Keyring's resolver does. */
export async function resolveWebvh(did) {
  const verifier = { verify: async (sig, msg, pub) => ed25519.verify(sig, msg, pub) }
  const r = await resolveDID(did, { verifier })
  if (!r.doc?.id) throw new Error(`could not resolve ${did}: ${JSON.stringify(r.meta).slice(0, 200)}`)
  return r.doc
}

/** First service of `type`, in document order (VTI-LNK-053: by type, never by id). */
export function serviceOfType(didDoc, type) {
  const s = (didDoc.service ?? []).find((x) => x.type === type)
  if (!s) return undefined
  return typeof s.serviceEndpoint === 'string' ? s.serviceEndpoint : s.serviceEndpoint?.uri
}

function ed25519KeyOf(didDoc, vmId) {
  const vm = (didDoc.verificationMethod ?? []).find((m) => m.id === vmId || didDoc.id + m.id === vmId)
  if (!vm?.publicKeyMultibase?.startsWith('z')) return undefined
  const raw = base58decode(vm.publicKeyMultibase.slice(1))
  return raw.length === 34 && raw[0] === 0xed && raw[1] === 0x01 ? raw.slice(2) : undefined
}

/**
 * Verify an eddsa-jcs-2022 proof by `didDoc`'s subject for `purpose`: the key
 * must be listed under that relationship. Returns a reason string on failure.
 */
export function verifyProof(doc, didDoc, purpose) {
  const proof = doc?.proof
  if (!proof) return 'no proof'
  if (proof.cryptosuite !== 'eddsa-jcs-2022') return `cryptosuite ${proof.cryptosuite}`
  if (proof.proofPurpose !== purpose) return `proofPurpose ${proof.proofPurpose}, expected ${purpose}`
  const listed = (didDoc[purpose] ?? []).map((r) => (typeof r === 'string' ? r : r.id))
  const vmId = proof.verificationMethod
  if (!listed.some((r) => r === vmId || didDoc.id + r === vmId)) return `${vmId} is not under ${purpose}`
  const publicKey = ed25519KeyOf(didDoc, vmId)
  if (!publicKey) return `no Ed25519 key for ${vmId}`
  const { proofValue, ...config } = proof
  const { proof: _p, ...unsigned } = doc
  const configHash = sha256(new TextEncoder().encode(canonicalize(config)))
  const docHash = sha256(new TextEncoder().encode(canonicalize(unsigned)))
  const input = new Uint8Array(64)
  input.set(configHash, 0)
  input.set(docHash, 32)
  return ed25519.verify(base58decode(proofValue.slice(1)), input, publicKey) ? undefined : 'signature does not verify'
}

/** A did:key's own DID document, enough for verifyProof. */
export function didKeyDocument(did) {
  const mb = did.slice('did:key:'.length)
  const vm = `${did}#${mb}`
  return {
    id: did,
    verificationMethod: [{ id: vm, type: 'Multikey', controller: did, publicKeyMultibase: mb }],
    authentication: [vm],
    assertionMethod: [vm],
  }
}
