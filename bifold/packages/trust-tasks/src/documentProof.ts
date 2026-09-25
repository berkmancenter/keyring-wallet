/**
 * Document proofs and digests for Trust Task documents — SHARED by the
 * wallet (@bifold/core) and the witness-server, promoted here from two
 * deliberate duplicates (2026-08-20): one implementation, both sides agree
 * on every digest by construction.
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

import type { Agent, VerificationMethod } from '@credo-ts/core'
import {
  Kms,
  MultiBaseEncoder,
  MultiHashEncoder,
  TypedArrayEncoder,
  getPublicJwkFromVerificationMethod,
} from '@credo-ts/core'
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
 * The framework's §4.9.3 TASK DIGEST of a Trust Task document: the
 * DigestMultibase computed over the document EXCLUDING its top-level `proof`
 * member — well-defined for unproofed documents and identical across proofed
 * and unproofed forms of the same document (cred-spec, Trust Task Context
 * Binding).
 */
export function taskDigestMultibase(document: Record<string, unknown>): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { proof: _proof, ...unproofed } = document
  return digestMultibase(unproofed)
}

/**
 * Digest equality per the spec: compared as DECODED multihash bytes, never as
 * encoded strings — `z` and `u` encodings of one digest are different strings
 * (cred-spec Outcome Interpretability; framework §4.9.3).
 */
export function digestBytesEqual(a: string, b: string): boolean {
  try {
    const bytesA = MultiBaseEncoder.decode(a).data
    const bytesB = MultiBaseEncoder.decode(b).data
    if (bytesA.length !== bytesB.length) return false
    let diff = 0
    for (let i = 0; i < bytesA.length; i++) diff |= bytesA[i] ^ bytesB[i]
    return diff === 0
  } catch {
    return false
  }
}

/**
 * Attach a DataIntegrityProof (eddsa-jcs-2022) to a Trust Task document,
 * signing as `controllerDid` — for our use, the sender's relationship DID
 * (did:peer:0…), whose single Ed25519 key the wallet's KMS holds.
 *
 * Returns a NEW document object; the input is not mutated.
 */
/**
 * The DID document's first signing-capable verification method. did:peer:0
 * documents list it under `verificationMethod`; did:peer:4 documents (credo's
 * connection DIDs) EMBED it in `authentication`/`assertionMethod` instead —
 * reading only `verificationMethod` finds nothing there.
 */
function firstSigningVerificationMethod(didDocument: {
  verificationMethod?: unknown[]
  authentication?: unknown[]
  assertionMethod?: unknown[]
}): VerificationMethod | undefined {
  const embedded = (arr?: unknown[]) => (arr ?? []).find((entry) => typeof entry === 'object' && entry !== null)
  return (embedded(didDocument.verificationMethod) ??
    embedded(didDocument.assertionMethod) ??
    embedded(didDocument.authentication)) as VerificationMethod | undefined
}

/**
 * The verification relationship a proof is made for. `assertionMethod` is the
 * default and what every document proof here has always used. `authentication`
 * is for a holder proving control to a verifier — an eligibility presentation
 * (dtgwg-trust-tasks-tf `specs/vetting/request/0.1/spec.md:109`, "`proof` is a
 * Data Integrity proof by `holder`, with `proofPurpose` `authentication`";
 * payload.schema.json:216-220 makes the purpose a const), as vta-sdk
 * `vetting/eligibility.rs:43` `ELIGIBILITY_PROOF_PURPOSE` signs it.
 */
export type ProofPurpose = 'assertionMethod' | 'authentication'

type RelationshipDocument = {
  id?: string
  verificationMethod?: VerificationMethod[]
  authentication?: unknown[]
  assertionMethod?: unknown[]
}

/**
 * The verification method `verificationMethodId` names, when — and only when —
 * the DID document lists it under `relationship`, by reference or embedded.
 * Ids compare as credo's `DidDocument.matchKeyId` does: relative to the
 * document's own id, so `#key-0` and `<did>#key-0` are the same key.
 */
export function verificationMethodInRelationship(
  didDocument: RelationshipDocument,
  relationship: ProofPurpose,
  verificationMethodId: string
): VerificationMethod | undefined {
  const docId = didDocument.id ?? ''
  const relative = (id: string) => (docId && id.startsWith(docId) ? id.slice(docId.length) : id)
  const wanted = relative(verificationMethodId)
  for (const entry of didDocument[relationship] ?? []) {
    if (typeof entry === 'string') {
      if (relative(entry) !== wanted) continue
      return didDocument.verificationMethod?.find((m) => relative(m.id) === wanted)
    }
    const embedded = entry as VerificationMethod | null
    if (embedded && typeof embedded.id === 'string' && relative(embedded.id) === wanted) return embedded
  }
  return undefined
}

export async function signDocumentProof(
  agent: Agent,
  document: Record<string, unknown>,
  controllerDid: string,
  options: {
    /**
     * The KMS key to sign with, when the controller is not a DID this wallet
     * created — a VTA-minted persona whose signing key was borrowed into the
     * KMS for the session. Without it the key is looked up on the DidRecord.
     */
    kmsKeyId?: string
    /** The verification method to name in the proof; defaults to the first signing one. */
    verificationMethodId?: string
    /**
     * `assertionMethod` (default) or `authentication`. For `authentication`
     * the key MUST be listed under the signer's `authentication` relationship:
     * a proof naming a key the holder never authorised for it is refused by a
     * conforming verifier, so it is refused here, before anything is sent.
     */
    proofPurpose?: ProofPurpose
  } = {}
): Promise<Record<string, unknown>> {
  const proofPurpose = options.proofPurpose ?? 'assertionMethod'
  const { verificationMethod, publicJwk } = await resolveSigningKey(agent, controllerDid, options)
  const proofConfig: Record<string, unknown> = {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-2022',
    created: new Date().toISOString(),
    verificationMethod: verificationMethod.id,
    proofPurpose,
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
 * The verification method a DID signs with here, and the KMS key behind it.
 * The KMS key id is not derivable from the JWK alone: it lives in the
 * DidRecord's key mapping, with the pre-0.6 fingerprint id as fallback — the
 * same resolution credo's own W3cJsonLdCredentialService.signCredential
 * performs (getPublicJwkFromVerificationMethod in that service).
 */
async function resolveSigningKey(
  agent: Agent,
  controllerDid: string,
  options: { kmsKeyId?: string; verificationMethodId?: string; proofPurpose?: ProofPurpose }
) {
  const didDocument = await agent.dids.resolveDidDocument(controllerDid)
  let verificationMethod: VerificationMethod | undefined
  if (options.proofPurpose === 'authentication') {
    // Only a key the holder lists under `authentication` may sign for it. A
    // persona minted by the VTA lists its signing key `#key-0` under both
    // `authentication` and `assertionMethod` (vta-service
    // `operations/did_webvh/document.rs:318-361`; the did-host-* templates,
    // vta-sdk `templates/did-host-didcomm.json:37-38`, do the same), so this
    // finds it; a DID that does not is refused rather than signed for.
    const authentication = (didDocument as unknown as RelationshipDocument).authentication ?? []
    const firstAuthentication = authentication[0]
    const wanted =
      options.verificationMethodId ??
      (typeof firstAuthentication === 'string'
        ? firstAuthentication
        : (firstAuthentication as VerificationMethod | undefined)?.id)
    verificationMethod = wanted
      ? verificationMethodInRelationship(didDocument as unknown as RelationshipDocument, 'authentication', wanted)
      : undefined
    if (!verificationMethod) {
      throw new Error(
        `${controllerDid}: ${wanted ?? 'no key'} is not listed under the DID's authentication relationship`
      )
    }
  } else {
    verificationMethod = options.verificationMethodId
      ? (didDocument.dereferenceKey(options.verificationMethodId, ['assertionMethod', 'authentication']) ??
        firstSigningVerificationMethod(didDocument as never))
      : firstSigningVerificationMethod(didDocument as never)
  }
  if (!verificationMethod) {
    throw new Error(`no verification method on ${controllerDid}`)
  }
  const publicJwk = getPublicJwkFromVerificationMethod(verificationMethod)
  const relativeKeyId = verificationMethod.id.startsWith(controllerDid)
    ? verificationMethod.id.slice(controllerDid.length)
    : verificationMethod.id
  if (options.kmsKeyId) {
    publicJwk.keyId = options.kmsKeyId
  } else {
    const [didRecord] = await agent.dids.getCreatedDids({ did: controllerDid })
    publicJwk.keyId =
      didRecord?.keys?.find(({ didDocumentRelativeKeyId }) => didDocumentRelativeKeyId === relativeKeyId)?.kmsKeyId ??
      publicJwk.legacyKeyId
  }
  return { verificationMethod, publicJwk }
}

/**
 * A compact EdDSA JWS signed by a DID this agent holds — the form a VTA takes
 * a proof of possession in (the `linkProof` of `acl/swap-key/0.1`, a VP-JWT)
 * and the form an enrolment page takes a device's key in. The header's `kid`
 * is the verification method's full id, so a verifier resolves the same key.
 */
export async function signCompactJws(
  agent: Agent,
  controllerDid: string,
  payload: Record<string, unknown>,
  options: { kmsKeyId?: string; verificationMethodId?: string; typ?: string } = {}
): Promise<string> {
  const { verificationMethod, publicJwk } = await resolveSigningKey(agent, controllerDid, options)
  const kid = verificationMethod.id.startsWith('#') ? `${controllerDid}${verificationMethod.id}` : verificationMethod.id
  const encode = (value: unknown) => TypedArrayEncoder.toBase64Url(new TextEncoder().encode(JSON.stringify(value)))
  const signingInput = `${encode({ alg: 'EdDSA', kid, typ: options.typ ?? 'JWT' })}.${encode(payload)}`
  const kms = agent.dependencyManager.resolve(Kms.KeyManagementApi)
  const { signature } = await kms.sign({
    keyId: publicJwk.keyId,
    data: new TextEncoder().encode(signingInput),
    algorithm: 'EdDSA',
  })
  return `${signingInput}.${TypedArrayEncoder.toBase64Url(signature)}`
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
  expectedController: string,
  options: {
    /**
     * The purpose the proof must be made for. Omitted, it is `assertionMethod`
     * and verification is exactly what it has always been. Given, the proof's
     * `proofPurpose` must be it AND the verification method must be listed
     * under that relationship in the controller's DID document — the check
     * the spec asks of an eligibility presentation ("The `proof` verifies
     * under an `authentication` key of `holder`", specs/vetting/request/0.1
     * spec.md:113).
     */
    proofPurpose?: ProofPurpose
  } = {}
): Promise<boolean> {
  const { proof, ...unsecured } = document
  if (!proof || typeof proof !== 'object') return false
  if (!Array.isArray(proof))
    return verifyOneProof(agent, proof as Record<string, unknown>, unsecured, expectedController, options.proofPurpose)

  // A PROOF SET (Data Integrity §2.1.2): several independent proofs, each over
  // the document without any of them. vtc-service signs its status lists this
  // way — eddsa-jcs-2022 beside a post-quantum mldsa44-jcs-2024 — and reading
  // `proof` as one object found no proofValue and called a genuine list
  // unsigned. Every proof in a suite we implement must verify, and at least one
  // must be present: a failing one means the document was altered after it was
  // signed, whatever its siblings say. A suite we do not implement is neither
  // trusted nor held against the document; it is simply not ours to judge.
  const ours = proof.filter(
    (p): p is Record<string, unknown> =>
      !!p && typeof p === 'object' && (p as Record<string, unknown>).cryptosuite === 'eddsa-jcs-2022'
  )
  if (ours.length === 0) return false
  for (const p of ours) {
    if (!(await verifyOneProof(agent, p, unsecured, expectedController, options.proofPurpose))) return false
  }
  return true
}

async function verifyOneProof(
  agent: Agent,
  p: Record<string, unknown>,
  unsecured: Record<string, unknown>,
  expectedController: string,
  requiredPurpose?: ProofPurpose
): Promise<boolean> {
  try {
    if (p.type !== 'DataIntegrityProof' || p.cryptosuite !== 'eddsa-jcs-2022') return false
    if (p.proofPurpose !== (requiredPurpose ?? 'assertionMethod')) return false
    const verificationMethodId = String(p.verificationMethod ?? '')
    // The id must belong to the expected controller. did:peer:0 ids are
    // absolute under the DID; did:peer:4 documents may carry RELATIVE ids
    // (#key-N) and appear in long or short form (same 4zQm… hash base), so
    // accept those shapes too — the key still comes from resolving
    // expectedController, which is what binds the proof to the controller.
    const controllerBase = expectedController.replace(/^(did:peer:4[^:]+).*$/, '$1')
    const idBelongsToController =
      verificationMethodId.startsWith('#') ||
      verificationMethodId.startsWith(`${expectedController}#`) ||
      (controllerBase !== expectedController && verificationMethodId.startsWith(`${controllerBase}#`))
    if (!idBelongsToController) return false
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
    const fragment = verificationMethodId.includes('#')
      ? verificationMethodId.slice(verificationMethodId.indexOf('#'))
      : ''
    // An explicit purpose binds the key to that relationship: no fallback to
    // "the first signing key", which could sign for a purpose it was never
    // listed under.
    const verificationMethod = requiredPurpose
      ? verificationMethodInRelationship(
          didDocument as unknown as RelationshipDocument,
          requiredPurpose,
          verificationMethodId.startsWith('#') ? `${expectedController}${verificationMethodId}` : verificationMethodId
        )
      : (didDocument.verificationMethod?.find(
          (m) => m.id === verificationMethodId || (fragment && m.id.endsWith(fragment))
        ) ?? firstSigningVerificationMethod(didDocument as never))
    if (!verificationMethod) return false
    const publicJwk = getPublicJwkFromVerificationMethod(verificationMethod)
    const publicKeyBytes = (publicJwk.publicKey as { publicKey: Uint8Array }).publicKey

    return ed25519.verify(TypedArrayEncoder.fromBase58(proofValue.slice(1)), signedInput, publicKeyBytes)
  } catch {
    return false
  }
}
