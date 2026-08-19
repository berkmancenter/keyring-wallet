/**
 * Document proofs and digests for Trust Task documents — milestone 2,
 * second slice (the `issue` leg).
 *
 * Two primitives, both anchored on RFC 8785 (JCS) canonicalization:
 *
 *  - `digestMultibase(value)` — the framework's `DigestMultibase` encoding: a
 *    multibase(base58btc) multihash(sha-256) over the JCS form. Multihash and
 *    multibase are REQUIRED by the framework schema (a bare hex digest is
 *    non-conforming); base58btc is its RECOMMENDED base.
 *
 *  - `signDocumentProof(agent, document, controllerDid)` — a
 *    DataIntegrityProof / eddsa-jcs-2022 proof over the document, signed with
 *    the controller DID's Ed25519 key through Credo's KMS (the same key path
 *    legacy VC issuance signs with). `vrc/relationships/issue` declares the
 *    request proof REQUIRED, and the framework's consume pipeline rejects a
 *    proofless document for such a spec regardless of proof policy — so the
 *    producer side must sign from this slice on. The verify side stays on the
 *    module's `acceptUnverified` placeholder until milestone 3 wires the
 *    eddsa-jcs-2022 verifier; these proofs are real, so nothing re-ships then.
 *
 * eddsa-jcs-2022 hashing follows W3C DI: the signed input is
 * sha256(JCS(proof config)) || sha256(JCS(document without proof)).
 *
 * @module trust-tasks/documentProof
 */

import type { Agent } from '@credo-ts/core'
import { Kms, MultiBaseEncoder, MultiHashEncoder, TypedArrayEncoder, getPublicJwkFromVerificationMethod } from '@credo-ts/core'
import { sha256 } from '@noble/hashes/sha2.js'
import canonicalize from 'canonicalize'

/** RFC 8785 canonical form. Throws on values JCS cannot represent (undefined toplevel). */
export function jcsCanonicalize(value: unknown): string {
  const canonical = canonicalize(value)
  if (canonical === undefined) {
    throw new Error('value has no RFC 8785 canonical form')
  }
  return canonical
}

/**
 * The framework's `DigestMultibase` over a JSON value:
 * multibase(base58btc, multihash(sha-256, JCS(value))).
 */
export function digestMultibase(value: unknown): string {
  const canonical = new TextEncoder().encode(jcsCanonicalize(value))
  return MultiBaseEncoder.encode(MultiHashEncoder.encode(canonical, 'sha-256'), 'base58btc')
}

/**
 * Attach a DataIntegrityProof (eddsa-jcs-2022) to a Trust Task document,
 * signing as `controllerDid` — for our use, the sender's relationship DID
 * (did:peer:0…), whose single Ed25519 key the wallet's KMS holds.
 *
 * Returns a NEW document object; the input is not mutated.
 */
export async function signDocumentProof(
  agent: Agent,
  document: Record<string, unknown>,
  controllerDid: string
): Promise<Record<string, unknown>> {
  const didDocument = await agent.dids.resolveDidDocument(controllerDid)
  const verificationMethod = didDocument.verificationMethod?.[0]
  if (!verificationMethod) {
    throw new Error(`no verification method on ${controllerDid}`)
  }

  // The KMS key id is not derivable from the JWK alone: it lives in the
  // DidRecord's key mapping, with the pre-0.6 fingerprint id as fallback —
  // the same resolution credo's own W3cJsonLdCredentialService.signCredential
  // performs (getPublicJwkFromVerificationMethod in that service).
  const publicJwk = getPublicJwkFromVerificationMethod(verificationMethod)
  const relativeKeyId = verificationMethod.id.startsWith(controllerDid)
    ? verificationMethod.id.slice(controllerDid.length)
    : verificationMethod.id
  const [didRecord] = await agent.dids.getCreatedDids({ did: controllerDid })
  publicJwk.keyId =
    didRecord?.keys?.find(({ didDocumentRelativeKeyId }) => didDocumentRelativeKeyId === relativeKeyId)?.kmsKeyId ??
    publicJwk.legacyKeyId
  const proofConfig: Record<string, unknown> = {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-2022',
    created: new Date().toISOString(),
    verificationMethod: verificationMethod.id,
    proofPurpose: 'assertionMethod',
  }

  const configHash = sha256(new TextEncoder().encode(jcsCanonicalize(proofConfig)))
  const documentHash = sha256(new TextEncoder().encode(jcsCanonicalize(document)))
  const signedInput = new Uint8Array(configHash.length + documentHash.length)
  signedInput.set(configHash, 0)
  signedInput.set(documentHash, configHash.length)

  const kms = agent.dependencyManager.resolve(Kms.KeyManagementApi)
  const { signature } = await kms.sign({
    keyId: publicJwk.keyId,
    data: signedInput,
    algorithm: 'EdDSA',
  })

  return {
    ...document,
    proof: { ...proofConfig, proofValue: `z${TypedArrayEncoder.toBase58(signature)}` },
  }
}
