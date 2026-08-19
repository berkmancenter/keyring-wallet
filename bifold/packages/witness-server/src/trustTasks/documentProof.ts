/**
 * Document proofs and digests for Trust Task documents — witness-server copy.
 *
 * DELIBERATE DUPLICATE of @bifold/core's
 * src/modules/trust-tasks/documentProof.ts, following this package's existing
 * core⇄witness sharing pattern (the DI suite is duplicated the same way):
 * importing @bifold/core would drag React Native into a Node service. Keep
 * the two in sync; promoting both into @bifold/vrc-shared is recorded debt.
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
import { ed25519 } from '@noble/curves/ed25519.js'
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

/**
 * Verify a document's eddsa-jcs-2022 proof against an EXPECTED controller —
 * for our profile, the sender's relationship DID as established by the
 * accepted proposal. The framework's ProofVerifier contract leaves the
 * attribution semantics to the consumer; ours is that the proof's
 * verification method MUST belong to that expected controller, so a valid
 * signature under some *other* key still fails. did:peer:0 resolves locally
 * (the DID encodes the key), so verification needs no network.
 *
 * Returns false rather than throwing — the framework maps a false verdict to
 * `proofInvalid`.
 */
export async function verifyDocumentProof(
  agent: Agent,
  document: Record<string, unknown>,
  expectedController: string
): Promise<boolean> {
  try {
    const { proof, ...unsecured } = document
    if (!proof || typeof proof !== 'object') return false
    const p = proof as Record<string, unknown>
    if (p.type !== 'DataIntegrityProof' || p.cryptosuite !== 'eddsa-jcs-2022') return false
    if (p.proofPurpose !== 'assertionMethod') return false
    const verificationMethodId = String(p.verificationMethod ?? '')
    if (!verificationMethodId.startsWith(`${expectedController}#`)) return false
    const proofValue = String(p.proofValue ?? '')
    if (!proofValue.startsWith('z')) return false

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { proofValue: _omitted, ...proofConfig } = p
    const configHash = sha256(new TextEncoder().encode(jcsCanonicalize(proofConfig)))
    const documentHash = sha256(new TextEncoder().encode(jcsCanonicalize(unsecured)))
    const signedInput = new Uint8Array(configHash.length + documentHash.length)
    signedInput.set(configHash, 0)
    signedInput.set(documentHash, configHash.length)

    const didDocument = await agent.dids.resolveDidDocument(expectedController)
    const verificationMethod =
      didDocument.verificationMethod?.find((m) => m.id === verificationMethodId) ??
      didDocument.verificationMethod?.[0]
    if (!verificationMethod) return false
    const publicJwk = getPublicJwkFromVerificationMethod(verificationMethod)
    const publicKeyBytes = (publicJwk.publicKey as { publicKey: Uint8Array }).publicKey

    return ed25519.verify(TypedArrayEncoder.fromBase58(proofValue.slice(1)), signedInput, publicKeyBytes)
  } catch {
    return false
  }
}
