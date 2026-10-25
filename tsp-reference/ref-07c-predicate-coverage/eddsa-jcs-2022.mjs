// Minimal eddsa-jcs-2022 (W3C vc-di-eddsa §3.3): JCS-canonicalize the
// unsecured document and the proof options, hash each with SHA-256,
// concatenate, sign/verify with Ed25519. proofValue is 'z' + base58btc.
//
// The proof config is hashed WITHOUT the document's @context: vc-di-eddsa
// §3.3.5 (Proof Configuration, eddsa-jcs-2022) never sets it, unlike the
// rdfc-2022 variant. Verified against dtg-credentials 0.7.0 in ref-07e.
//
// JCS here is RFC 8785 restricted to what these documents contain: objects
// with string keys (sorted by UTF-16 code units), arrays, strings, booleans,
// null, and integers — for which JSON.stringify already emits the RFC 8785
// number form. No floats appear in any fixture.

import { ed25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { base58 } from '@scure/base'

export function jcs(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isInteger(value)) throw new Error('JCS subset: no floats')
    if (value === undefined) throw new Error('JCS: undefined is not serializable')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(jcs).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${jcs(value[k])}`).join(',')}}`
}

const utf8 = (s) => new TextEncoder().encode(s)

function hashData(document, proofOptions) {
  const { proof: _drop, ...unsecured } = document
  const config = { ...proofOptions }
  delete config.proofValue
  // NO @context here. vc-di-eddsa's Proof Configuration algorithm for
  // eddsa-jcs-2022 has five steps and none of them touches @context — that
  // step exists only in eddsa-rdfc-2022. An earlier version of this file
  // attached it, which made our signatures mutually unverifiable with
  // dtg-credentials 0.7.0; ref-07e act 1 is the probe that found it, and the
  // crate was right. See ref-07e's README.
  const proofHash = sha256(utf8(jcs(config)))
  const docHash = sha256(utf8(jcs(unsecured)))
  const data = new Uint8Array(proofHash.length + docHash.length)
  data.set(proofHash, 0)
  data.set(docHash, proofHash.length)
  return data
}

export function signCredential(document, proofOptions, privateKeySeed) {
  const signature = ed25519.sign(hashData(document, proofOptions), privateKeySeed)
  return { ...proofOptions, proofValue: 'z' + base58.encode(signature) }
}

export function verifyCredential(document, publicKey) {
  const proof = document.proof
  if (proof?.type !== 'DataIntegrityProof' || proof?.cryptosuite !== 'eddsa-jcs-2022')
    return { verified: false, reason: 'not an eddsa-jcs-2022 DataIntegrityProof' }
  if (!proof.proofValue?.startsWith('z')) return { verified: false, reason: 'proofValue is not base58btc multibase' }
  const signature = base58.decode(proof.proofValue.slice(1))
  const verified = ed25519.verify(signature, hashData(document, proof), publicKey)
  return { verified, reason: verified ? undefined : 'signature mismatch' }
}
