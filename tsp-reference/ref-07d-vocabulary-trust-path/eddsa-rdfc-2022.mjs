// Minimal eddsa-rdfc-2022 (W3C vc-di-eddsa §3.2): RDF-canonicalize the
// unsecured document and the proof configuration with RDFC-1.0 (URDNA2015),
// hash each with SHA-256, concatenate proofHash || docHash, sign/verify with
// Ed25519. proofValue is 'z' + base58btc.
//
// This is the suite half of the rung's point: unlike eddsa-jcs-2022, the
// transformation runs JSON-LD expansion first, so a member whose term is not
// defined in any @context contributes NO QUADS and is therefore not covered
// by the signature. `safe` toggles JSON-LD safe mode, which turns a dropped
// term into a thrown error instead of silence.

import { ed25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { base58 } from '@scure/base'
import jsonld from 'jsonld'

const utf8 = (s) => new TextEncoder().encode(s)

export async function canonize(doc, { documentLoader, safe = false }) {
  return jsonld.canonize(doc, {
    algorithm: 'URDNA2015',
    format: 'application/n-quads',
    documentLoader,
    safe,
  })
}

async function hashData(document, proofOptions, opts) {
  const { proof: _drop, ...unsecured } = document
  const config = { ...proofOptions }
  delete config.proofValue
  if (document['@context']) config['@context'] = document['@context']
  const proofHash = sha256(utf8(await canonize(config, opts)))
  const docHash = sha256(utf8(await canonize(unsecured, opts)))
  const data = new Uint8Array(proofHash.length + docHash.length)
  data.set(proofHash, 0)
  data.set(docHash, proofHash.length)
  return data
}

export async function signCredential(document, proofOptions, privateKeySeed, opts) {
  const signature = ed25519.sign(await hashData(document, proofOptions, opts), privateKeySeed)
  return { ...proofOptions, proofValue: 'z' + base58.encode(signature) }
}

export async function verifyCredential(document, publicKey, opts) {
  const proof = document.proof
  if (proof?.type !== 'DataIntegrityProof' || proof?.cryptosuite !== 'eddsa-rdfc-2022')
    return { verified: false, reason: 'not an eddsa-rdfc-2022 DataIntegrityProof' }
  if (!proof.proofValue?.startsWith('z')) return { verified: false, reason: 'proofValue is not base58btc multibase' }
  const signature = base58.decode(proof.proofValue.slice(1))
  const verified = ed25519.verify(signature, await hashData(document, proof, opts), publicKey)
  return { verified, reason: verified ? undefined : 'signature mismatch' }
}
