// eddsa-jcs-2022 over Trust Task documents, plus the framework's task digest.
//
// Proof: vc-di-eddsa §3.3 — JCS the proof configuration (WITHOUT the document's
// @context; that step exists only in eddsa-rdfc-2022) and the unsecured document,
// SHA-256 each, sign proofHash || docHash. Verified against dtg-credentials 0.7.0
// in ref-07e (commit b8dd46c).
//
// Task digest: Trust Tasks framework 0.5.0, "Binding a Citation to the Document It
// Names" — multibase(multihash(SHA-256(JCS(document without top-level proof)))).
import { ed25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { base58 } from '@scure/base'

export const jcs = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(jcs).join(',')}]`
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${jcs(v[k])}`).join(',')}}`
}
const utf8 = (s) => new TextEncoder().encode(s)

export const didKey = (pub) => 'did:key:z' + base58.encode(new Uint8Array([0xed, 0x01, ...pub]))
export const pubFromDidKey = (did) => base58.decode(did.replace('did:key:', '').split('#')[0].slice(1)).slice(2)

export function party(seedByte) {
  const seed = new Uint8Array(32).fill(seedByte)
  const pub = ed25519.getPublicKey(seed)
  return { seed, did: didKey(pub) }
}

function hashData(doc, proofOptions) {
  const { proof: _p, ...unsecured } = doc
  const config = { ...proofOptions }
  delete config.proofValue
  const a = sha256(utf8(jcs(config)))
  const b = sha256(utf8(jcs(unsecured)))
  const out = new Uint8Array(64)
  out.set(a, 0)
  out.set(b, 32)
  return out
}

export function sign(doc, signer) {
  const options = {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-2022',
    created: '2026-09-15T00:00:00Z',
    verificationMethod: `${signer.did}#${signer.did.slice(8)}`,
    proofPurpose: 'assertionMethod',
  }
  const sig = ed25519.sign(hashData(doc, options), signer.seed)
  return { ...doc, proof: { ...options, proofValue: 'z' + base58.encode(sig) } }
}

/** Verifies a document's proof under the key of the DID its verificationMethod names. */
export function verifyProof(doc) {
  const p = doc.proof
  if (!p || p.cryptosuite !== 'eddsa-jcs-2022') return { ok: false, signer: null }
  const signer = p.verificationMethod.split('#')[0]
  const ok = ed25519.verify(base58.decode(p.proofValue.slice(1)), hashData(doc, p), pubFromDidKey(signer))
  return { ok, signer }
}

export function taskDigest(doc) {
  const { proof: _p, ...content } = doc
  return 'z' + base58.encode(new Uint8Array([0x12, 0x20, ...sha256(utf8(jcs(content)))]))
}
export const digestEqual = (a, b) => {
  try {
    const x = base58.decode(a.slice(1))
    const y = base58.decode(b.slice(1))
    return x.length === y.length && x.every((v, i) => v === y[i])
  } catch {
    return false
  }
}
