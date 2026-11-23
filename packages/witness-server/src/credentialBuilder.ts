/**
 * Pure VWC-building / verification logic, extracted from WitnessService.ts
 * (2026-09-29, capture-harness task) so it can be imported WITHOUT dragging
 * in WitnessService.ts's server/CLI-only dependency tree (LLMService →
 * langchain, BleLocalityProvider → node-ble, NobleLocalityProvider/
 * ReportingGraph → three/ws, etc.).
 *
 * Nothing in this file imports anything heavier than @credo-ts/core, node's
 * `crypto`, and the other @bifold/* workspace packages already used
 * elsewhere for the same purpose (vrc-contexts, vrc-shared, trust-tasks,
 * dtg-vocab) — none of which pull in a CLI-shaped dependency tree.
 *
 * WitnessService.ts re-exports everything here for backward compatibility —
 * every existing `from './WitnessService'` import (including
 * __tests__/unit/WitnessService.test.ts) keeps working unchanged.
 *
 * This is what `bifold/packages/vrc-reference/__tests__/integration/
 * captureWitnessedEdgeVsc.test.ts` imports to produce a REAL `vsc`-shaped
 * capture — see that file and tsp-reference/ref-07-dtg-edge-semantics for
 * where the fixture it produces is consumed.
 */

import { utils } from '@credo-ts/core'
import { createHash } from 'crypto'

import {
  jcsCanonicalize,
  CREDENTIALS_V2_CONTEXT_URL,
  WITNESSED_EXCHANGE_CONTEXT_URL,
  ED25519_2018_SUITE_CONTEXT_URL,
} from '@bifold/vrc-contexts'
import { getMirroredJsonLdProofOptions } from '@bifold/vrc-shared'
import { taskDigestMultibase } from '@bifold/trust-tasks'
import { DTG_PREDICATE_WITNESSED } from '@bifold/dtg-vocab'

import type { LocalityEvidence } from './LocalityService'
import type { LocalityAssertion } from './trustTasks/locality'

/**
 * Default expiration time for VWC credentials (in days)
 * Set via W3C VC v1 `expirationDate` field
 */
const DEFAULT_CREDENTIAL_EXPIRATION_DAYS = 7
const DEFAULT_CREDENTIAL_EXPIRATION_MS = DEFAULT_CREDENTIAL_EXPIRATION_DAYS * 24 * 60 * 60 * 1000

// ============================================
// Pure verification / VWC-building logic
// (exported so unit tests exercise the real implementation — see
// __tests__/unit/WitnessService.test.ts)
// ============================================

// Wallets backdate issuance by up to 5 minutes to tolerate clock skew
// between devices, so the freshness window must be that allowance plus
// a real freshness margin.
export const CLOCK_SKEW_ALLOWANCE_MS = 5 * 60 * 1000
export const FRESHNESS_MARGIN_MS = 5 * 60 * 1000
export const FRESHNESS_WINDOW_MS = CLOCK_SKEW_ALLOWANCE_MS + FRESHNESS_MARGIN_MS

export type VrcFreshnessResult = { fresh: true; ageMs: number } | { fresh: false; error: string }

/**
 * Freshness check used by handlePresentationSubmission (Step 5): the VRC's
 * timestamp must be within FRESHNESS_WINDOW_MS of the witness's clock, in
 * either direction. VCDM 2.0 VRCs carry validFrom; 1.1 VRCs carry issuanceDate.
 */
export function checkVrcFreshness(
  vrcJson: { validFrom?: string; issuanceDate?: string },
  now: Date = new Date()
): VrcFreshnessResult {
  const issuanceDate = new Date(vrcJson.validFrom || vrcJson.issuanceDate || '')
  if (Number.isNaN(issuanceDate.getTime())) {
    return { fresh: false, error: 'Credential has no parseable validFrom/issuanceDate' }
  }
  const ageMs = Math.abs(now.getTime() - issuanceDate.getTime())
  if (ageMs > FRESHNESS_WINDOW_MS) {
    return { fresh: false, error: 'Credential issuance date is not fresh (>10 minutes old)' }
  }
  return { fresh: true, ageMs }
}

/**
 * SHA-256 digest of the VRC over its JCS (RFC 8785) canonical form, so any
 * implementation can recompute the same digest from the same JSON data
 * regardless of key order or serializer.
 *
 * VSC migration (docs/plans/vsc-migration-plan.md §6 V4): the plan's own
 * text says this function "is deleted, and replaced by taskDigestMultibase"
 * — true for the eventual, fully cut-over end state, but NOT while the
 * `WITNESS_CREDENTIAL_SHAPE=wd02|vsc` flag exists. `wd02` shape must stay
 * byte-for-byte what it always was (that IS the flag's whole safety
 * property), which means this exact legacy algorithm — sha256:hex, over the
 * PROOFED VRC — has to stay available for that branch. `vsc` shape uses
 * `taskDigestMultibase` instead, which is a genuinely different digest of a
 * genuinely different document, not a re-encoding (plan §3.1's third
 * break). Deleting this function is the right call once `wd02` shape itself
 * is retired, not before.
 */
export function computeVrcDigest(vrcJson: unknown): string {
  return 'sha256:' + createHash('sha256').update(jcsCanonicalize(vrcJson)).digest('hex')
}

export interface WitnessCredentialBuildContext {
  issuerDid: string
  witnessName: string
  sessionId: string
  verificationMethod: string
  eventName?: string
  /** The LEGACY basic-message ceremony's nested evidence shape — untouched; that path is standing down for v4 pairs. */
  localityEvidence?: LocalityEvidence
  /**
   * The Trust Tasks ceremony's locality assertion (locality-plan.md §7.1) —
   * flat `locality*` members, never nested (bbs-2023 discloses at the
   * RDF-quad level; a nested object is a blank node whose path must be
   * revealed to disclose anything under it). Absent entirely when the
   * witness's locality policy is `off` — that absence IS the third,
   * explicit state (§7.1 rule 5), not something this function infers.
   */
  localityAssertion?: LocalityAssertion
  /**
   * VSC migration (docs/plans/vsc-migration-plan.md §6 V4): which wire shape
   * to emit. Defaults to `'wd02'` when omitted, so every existing call site
   * that doesn't pass this keeps its exact current behavior.
   */
  shape?: 'wd02' | 'vsc'
}

/**
 * Build the (unsigned) VWC JSON for an observed presentation.
 *
 * Mirrors the observed VRC's data model: a VC 2.0 VRC gets a VC 2.0 VWC,
 * a legacy 1.1 VRC gets a 1.1 VWC — so the holder's wallet can always
 * validate the pair with the same code path it used for the VRC. The
 * PROOF FAMILY is mirrored the same way (see the offer site): a DI VRC
 * gets a DI VWC, whose @context needs no suite URL at all (credentials/v2
 * already defines the DataIntegrityProof terms).
 */
export function buildWitnessCredentialJson(
  observedPresentation: any,
  buildContext: WitnessCredentialBuildContext
): any {
  const {
    issuerDid,
    // VSC migration (plan §6 V4): `issuer` becomes a bare string in BOTH
    // shapes (both WD02 and WD 0.4.0 require a string; ref-07e found
    // Keyring emitting `{id, name}` as a real divergence against
    // `dtg-credentials` 0.7.0), which left no spec-conforming home for the
    // witness's display name on `issuer` itself. Restored as
    // `credentialSubject.witnessName` instead — a distinct term, hoisted as
    // a sibling of `witnessContext` (see the `vsc` branch below), sanctioned
    // by cred-spec's §Predicate Profiles point 5 ("a verifier MUST ignore
    // additional members a profile does not define"). Emitted in both
    // shapes: this is a second, independent addition to `wd02`'s otherwise
    // byte-for-byte pre-migration output, same footing as the `issuer` fix
    // above — a real bug fix (a witness name with nowhere spec-conforming to
    // live was a real product regression), not part of the shape choice.
    witnessName,
    sessionId,
    verificationMethod,
    eventName,
    localityEvidence,
    localityAssertion,
    shape = 'wd02',
  } = buildContext

  const vwcId = `urn:uuid:${utils.uuid()}`

  const credentials = observedPresentation.verifiableCredential || []
  const vrcJson = credentials[0]

  if (!vrcJson) {
    throw new Error('No VRC found in presentation')
  }

  const hasHardwareAttestationEvidence = Array.isArray(vrcJson.evidence) && vrcJson.evidence.length > 0

  const vrcIssuer = typeof vrcJson.issuer === 'string' ? vrcJson.issuer : vrcJson.issuer?.id || 'unknown'

  // Backdate validFrom, exactly as the wallet already does when it builds a VRC
  // ("Backdate issuance to tolerate clock skew between issuer and holder
  // devices — the holder rejects credentials whose issuanceDate is in its
  // future", vrc-manager.buildVrcCredential). The witness never got the same
  // treatment, and it is the one issuer whose credential is verified within a
  // second of being signed, so it is the most exposed:
  //   "The current date time (…54.965Z) is before validFrom (…55.261Z)"
  // — a 296 ms miss observed on device 2026-08-30. The holder's
  // outcome-evidence self-check then failed and it withheld its witness-share,
  // so the peer never received a VWC about them and their contact showed no
  // witness badge. It presented as intermittent and platform-specific; it was
  // neither, just clock skew.
  //
  // Safe: the credential attests an exchange that has already happened, and
  // validUntil still runs from now. CLOCK_SKEW_ALLOWANCE_MS is the same
  // allowance the freshness window above is already built around.
  const issuedTimestamp = new Date(Date.now() - CLOCK_SKEW_ALLOWANCE_MS).toISOString()
  const expirationTimestamp = new Date(Date.now() + DEFAULT_CREDENTIAL_EXPIRATION_MS).toISOString()

  if (shape === 'vsc') {
    // VSC migration (plan §6 V4). D1: type is StatementCredential, no other
    // concrete DTGCredential subtype. D2: predicate is the real dtg:witnessed
    // IRI (@bifold/dtg-vocab). D3: object.digestMultibase, computed over the
    // VRC EXCLUDING its own top-level proof (taskDigestMultibase) — a
    // different digest of a different document than wd02's `digest`, not a
    // re-encoding of it (plan §3.1's third break). §3.5: witnessContext keeps
    // only the profile's three members (event, sessionId, method);
    // hardwareAttestationIncluded/localityVerification/locality* become
    // siblings of witnessContext, inside credentialSubject, under the
    // Keyring namespace @bifold/vrc-contexts already defines for them.
    //
    // VSC is inherently a VC 2.0 / WD 0.4.0 concept, so this branch always
    // emits VC 2.0 form regardless of the observed VRC's version — there is
    // no "legacy 1.1 VSC".
    //
    // KNOWN GAP, not closed here: D7 wants the credential's own @context to
    // include the real spec context IRI (@bifold/dtg-vocab's DTG_CONTEXT_URL,
    // https://registry.trustoverip.org/dtg/context/v1). This package has no
    // document-loader entry mapping that URL to a document yet — V2
    // (@bifold/vrc-contexts) added the new terms to the EXISTING
    // WITNESSED_EXCHANGE_CONTEXT_URL/DOCUMENT instead, which resolves
    // correctly for our own verifier but does not literally match the spec's
    // context IRI. Closing this is a V2 follow-up (map DTG_CONTEXT_URL to a
    // document matching the real cred-spec context), not something this V4
    // pass changes, since it was out of this task's scope (vrc-contexts).
    const vrcUsesDi = getMirroredJsonLdProofOptions(vrcJson.proof).proofType === 'DataIntegrityProof'

    const witnessContext: Record<string, any> = {
      sessionId,
      method: verificationMethod,
    }
    if (eventName) {
      witnessContext.event = eventName
    }

    return {
      '@context': vrcUsesDi
        ? [CREDENTIALS_V2_CONTEXT_URL, WITNESSED_EXCHANGE_CONTEXT_URL]
        : [CREDENTIALS_V2_CONTEXT_URL, WITNESSED_EXCHANGE_CONTEXT_URL, ED25519_2018_SUITE_CONTEXT_URL],
      id: vwcId,
      type: ['VerifiableCredential', 'DTGCredential', 'StatementCredential'],
      issuer: issuerDid,
      // issuerScope (cred-spec #68, merged 2026-09-28, REQUIRED on every DTG
      // credential): the dtg:witnessed profile's own stated minimum is
      // 'directed' -- the spec's worked examples use 'public' for witness
      // services generally ("a party that must be findable"), but that
      // asserts a deployment fact (this witness's DID is broadly, not just
      // narrowly, findable) this plan does not verify. 'directed' is the
      // safe, always-conforming floor (plan §9 Q8 -- not decided here).
      issuerScope: 'directed',
      validFrom: issuedTimestamp,
      validUntil: expirationTimestamp,
      credentialSubject: {
        id: vrcIssuer,
        predicate: DTG_PREDICATE_WITNESSED,
        object: {
          digestMultibase: taskDigestMultibase(vrcJson),
        },
        witnessContext,
        witnessName,
        hardwareAttestationIncluded: hasHardwareAttestationEvidence,
        ...(localityEvidence ? { localityVerification: localityEvidence } : {}),
        ...(localityAssertion ?? {}),
      },
    }
  }

  // wd02 (default): byte-for-byte the pre-migration shape, MINUS the issuer
  // fix above and the credentialSubject.witnessName addition below, both of
  // which apply unconditionally (plan §6 V4) since they are independent bug
  // fixes, not part of the shape choice.
  const digest = computeVrcDigest(vrcJson)

  // Build witnessContext according to spec (event, sessionId, method - no domain/timestamp)
  const witnessContext: Record<string, any> = {
    sessionId,
    method: verificationMethod,
    // Flag indicating whether the VRC included hardware attestation evidence
    // This does NOT mean the evidence was verified by the witness
    // It means the participant's device performed hardware-backed authentication
    hardwareAttestationIncluded: hasHardwareAttestationEvidence,
  }

  // Only include event if configured
  if (eventName) {
    witnessContext.event = eventName
  }

  // Include locality verification evidence if available
  if (localityEvidence) {
    witnessContext.localityVerification = localityEvidence
  }

  // Trust Tasks ceremony: flat locality* members, spread directly into
  // witnessContext (never nested — see WitnessCredentialBuildContext).
  if (localityAssertion) {
    Object.assign(witnessContext, localityAssertion)
  }

  const vrcContexts: unknown[] = Array.isArray(vrcJson['@context']) ? vrcJson['@context'] : [vrcJson['@context']]
  const vrcIsVc20 = vrcContexts[0] === CREDENTIALS_V2_CONTEXT_URL
  const vrcUsesDi = getMirroredJsonLdProofOptions(vrcJson.proof).proofType === 'DataIntegrityProof'

  if (vrcIsVc20) {
    // On the 2018 path the Ed25519 suite context must be present at build
    // time (the v2 base context doesn't define the suite terms), or the
    // signed VWC won't match the offer/request in credo's holder-side
    // equality check.
    return {
      '@context': vrcUsesDi
        ? [CREDENTIALS_V2_CONTEXT_URL, WITNESSED_EXCHANGE_CONTEXT_URL]
        : [CREDENTIALS_V2_CONTEXT_URL, WITNESSED_EXCHANGE_CONTEXT_URL, ED25519_2018_SUITE_CONTEXT_URL],
      id: vwcId,
      type: ['VerifiableCredential', 'DTGCredential', 'WitnessCredential'],
      issuer: issuerDid,
      validFrom: issuedTimestamp,
      validUntil: expirationTimestamp,
      credentialSubject: {
        id: vrcIssuer,
        digest: digest,
        witnessContext,
        witnessName,
      },
    }
  }

  return {
    '@context': ['https://www.w3.org/2018/credentials/v1', WITNESSED_EXCHANGE_CONTEXT_URL],
    id: vwcId,
    type: ['VerifiableCredential', 'DTGCredential', 'WitnessCredential'],
    issuer: issuerDid,
    issuanceDate: issuedTimestamp,
    // W3C VC v1 expirationDate and validUntil - set to current time + 7 days
    expirationDate: expirationTimestamp,
    validUntil: expirationTimestamp,
    credentialSubject: {
      id: vrcIssuer,
      digest: digest,
      witnessContext,
      witnessName,
    },
  }
}

/**
 * The observed VRC's hardware-attestation public key, if it carries one —
 * for locality's §7.3 step-6 key-match check (does the key that answered on
 * the radio match the key that signed this VRC?). Duck-typed rather than
 * importing `@bifold/core`'s evidence types (that would drag React Native
 * into this Node service, the same reason documentProof.ts/locality.ts are
 * duplicated here rather than imported).
 */
export function extractVrcHardwareAttestationPublicKey(presentation: Record<string, unknown>): string | undefined {
  const credentials = (presentation as { verifiableCredential?: unknown[] }).verifiableCredential ?? []
  const vrcJson = credentials[0] as { evidence?: unknown[] } | undefined
  const evidence = Array.isArray(vrcJson?.evidence) ? vrcJson?.evidence : []
  for (const entry of evidence ?? []) {
    const publicKey = (entry as { hardwareBinding?: { publicKey?: string } } | undefined)?.hardwareBinding?.publicKey
    if (typeof publicKey === 'string' && publicKey.length > 0) return publicKey
  }
  return undefined
}
