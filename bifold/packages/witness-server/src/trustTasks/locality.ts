/**
 * Locality — co-presence evidence riding the witness ceremony's Trust Tasks.
 *
 * Design under test: docs/plans/locality-plan.md §5 (the mechanism), §7.1
 * (the VWC assertion shape), §7.3 (verification), §9.2 (residuals).
 * Proven with no radios in tsp-reference/ref-06p-locality-binding and over a
 * real BLE pair in ref-06p2/ref-06p3/ref-06p4 — this module is the same
 * algebra, wired to real device keys instead of a fixture registry.
 *
 * One departure from the reference ladder, deliberate: the ladder signed
 * transcripts with Ed25519 (reusing the corpus's one crypto primitive
 * everywhere, per its own stated convention). The REAL device signs the
 * transcript with the same EC-P256 key it already uses for VRC hardware
 * attestation (docs/HARDWARE_ATTESTATION_FLOW.md) — Secure Enclave and
 * StrongBox both speak P-256, not Ed25519. So this module verifies P-256
 * ECDSA (via @noble/curves, the same library documentProof.ts already uses
 * for Ed25519, just the NIST curve export instead of the Edwards one).
 *
 * DELIBERATE DUPLICATE of @bifold/core's forthcoming
 * src/modules/trust-tasks/locality.ts (wallet side, §10.3 item 9/10),
 * following documentProof.ts's existing core⇄witness sharing pattern —
 * importing @bifold/core here would drag React Native into a Node service.
 */

import { createHash, hkdfSync } from 'node:crypto'
import { p256 } from '@noble/curves/nist.js'

import { jcsCanonicalize } from './documentProof'

// ------------------------------------------------------------- the namespace

/** Reverse-DNS of atl.seas.harvard.edu — the ext namespace root (plan §6). */
export const LOCALITY_EXT_NAMESPACE = 'edu.harvard.seas.atl.keyring'

// -------------------------------------------------------------- the EID (§5.3)

const EID_SALT = 'keyring-locality-eid-v1'
const EID_BYTES = 12
/** "KRL1" — the fixed prefix that survives 128-bit-service-UUID formatting on iOS. */
export const EID_UUID_PREFIX = '4b524c31'

/**
 * The rendezvous EID: HKDF-SHA256(ikm = challenge, salt = EID_SALT,
 * info = taskDigestMultibase(sessionDoc), L = 12 bytes) — locates a device;
 * proves nothing on its own (plan §5.3).
 */
export function deriveEid(challenge: string, sessionTaskDigestMultibase: string): string {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(challenge, 'utf8'),
      Buffer.from(EID_SALT, 'utf8'),
      Buffer.from(sessionTaskDigestMultibase, 'utf8'),
      EID_BYTES
    )
  ).toString('hex')
}

/** The EID as the 128-bit service UUID the device advertises. */
export function serviceUuidFromEid(eidHex: string): string {
  const hex = EID_UUID_PREFIX + eidHex
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// ------------------------------------------------------ the transcript (§5.3-5.4)

export type LocalityMethod = 'ble-challenge-response/0.1' | 'nfc-kiosk/0.1'
export type HardwareAttestationState = 'verified' | 'present-unverified' | 'absent'

export interface LocalityTranscript {
  method: LocalityMethod
  taskDigestMultibase: string
  challenge: string
  sensorNonce: string
  sensorDid: string
  /** Base64, raw EC-P256 point — the device's hardware-attestation public key. */
  devicePublicKey: string
  /** Base64url, the P-256 ECDSA signature over `bindingFor(this)`. */
  signature: string
  hardwareAttestation: HardwareAttestationState
}

/**
 * The five-value binding both directions commit to (plan §5.4): context
 * string, session task digest, challenge, sensor nonce, sensor DID. JCS'd
 * so signer and verifier agree on the exact bytes.
 */
export function bindingFor(t: {
  taskDigestMultibase: string
  challenge: string
  sensorNonce: string
  sensorDid: string
}): Uint8Array {
  return new TextEncoder().encode(
    jcsCanonicalize({
      context: 'keyring-locality-v1',
      taskDigestMultibase: t.taskDigestMultibase,
      challenge: t.challenge,
      sensorNonce: t.sensorNonce,
      sensorDid: t.sensorDid,
    })
  )
}

export type TranscriptVerdict = { ok: true } | { ok: false; reason: string }

/**
 * §7.3 step 5: recompute the binding and verify the device's P-256
 * signature over it. `expected` is what the WITNESS itself issued/observed
 * (its own challenge, its own sensor nonce, its own sensorDid) — never
 * trust the transcript's own copies of these over the witness's.
 */
export function verifyTranscript(
  transcript: LocalityTranscript,
  expected: { taskDigestMultibase: string; challenge: string; sensorNonce: string; sensorDid: string }
): TranscriptVerdict {
  if (transcript.taskDigestMultibase !== expected.taskDigestMultibase) return { ok: false, reason: 'taskDigestMismatch' }
  if (transcript.challenge !== expected.challenge) return { ok: false, reason: 'challengeMismatch' }
  if (transcript.sensorNonce !== expected.sensorNonce) return { ok: false, reason: 'sensorNonceMismatch' }
  if (transcript.sensorDid !== expected.sensorDid) return { ok: false, reason: 'sensorMismatch' }
  let publicKeyBytes: Uint8Array
  try {
    publicKeyBytes = Buffer.from(transcript.devicePublicKey, 'base64')
  } catch {
    return { ok: false, reason: 'malformedPublicKey' }
  }
  let signatureBytes: Uint8Array
  try {
    signatureBytes = Buffer.from(transcript.signature, 'base64url')
  } catch {
    return { ok: false, reason: 'malformedSignature' }
  }
  const message = bindingFor(transcript)
  const digest = createHash('sha256').update(message).digest()
  let valid: boolean
  try {
    valid = p256.verify(signatureBytes, digest, publicKeyBytes)
  } catch {
    valid = false
  }
  if (!valid) return { ok: false, reason: 'transcriptSignatureInvalid' }
  return { ok: true }
}

/**
 * §7.1 rule 3 / §7.3 step 6, tier 3: does the key that answered on the radio
 * match the key that signed the observed VRC's hardware attestation
 * evidence? Base64 raw-point comparison — both are already-verified public
 * keys at this point, so this is a match check, not a second signature
 * verification.
 */
export function transcriptKeyMatchesVrcSigner(transcript: LocalityTranscript, vrcEvidencePublicKeyBase64: string | undefined): boolean {
  if (!vrcEvidencePublicKeyBase64) return false
  return transcript.devicePublicKey === vrcEvidencePublicKeyBase64
}

// -------------------------------------------------------------- residuals (§9.2)

const RESIDUALS_BY_METHOD: Record<LocalityMethod, string[]> = {
  'ble-challenge-response/0.1': ['rf-relay'],
  'nfc-kiosk/0.1': [],
}

/** Derived from the method the verifier reads — never carried as a disclosable member (§7.1 rule 6). */
export function residualsFor(method: LocalityMethod | 'none'): string[] {
  return method === 'none' ? [] : RESIDUALS_BY_METHOD[method] ?? ['unknownMethod']
}

// --------------------------------------------------- the witness observation

export type LocalityDeclineReason = 'declinedByHolder' | 'windowLost'

export interface LocalityObservation {
  method: LocalityMethod | 'none'
  sensorDid: string
  venueClaim?: string
  observedAt: string
  windowSeconds?: number
  confirmed: boolean
  reason?: LocalityDeclineReason
  /** Present only when confirmed — kept on the artifact side, never the credential (§7.1 rule 3). */
  deviceKeyId?: string
  transcriptDigestMultibase?: string
  corroboration?: { rttMs: number; rssiDbm?: number; rttBoundMs: number }
}

/** §5.4: the digest over the full transcript (including its own signature), matching ref-06p's convention. */
export function transcriptDigestMultibase(transcript: LocalityTranscript): string {
  const canonical = new TextEncoder().encode(jcsCanonicalize(transcript))
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`
}

// -------------------------------------------------------- the VWC assertion (§7.1)

export interface LocalityAssertion {
  localityConfirmed: boolean
  localityMethod: LocalityMethod | 'none'
  localityReason?: LocalityDeclineReason
  localityTopology?: 'witness-anchored'
  localitySensor?: string
  localityVenue?: string
  localityObservedAt?: string
  localityWindowSeconds?: number
  localityKeyMatchesCredentialSigner?: boolean
  localityHardwareAttestation?: HardwareAttestationState
  localityEvidenceCommitment?: string
  localityRttMs?: number
  localityRssiDbm?: number
  localityRttBoundMs?: number
}

/**
 * Build the flat locality* members (plan §7.1) from an observation. Flat —
 * no nested object — because bbs-2023 discloses at the RDF-quad level and a
 * nested object is a blank node whose path must be revealed to disclose
 * anything under it. `localityConfirmed: false` is emitted with a reason,
 * never omitted (rule 5) — omission means "this witness does not do
 * locality at all", a THIRD, distinct state this function's caller controls
 * by not calling it (§10.2 item 5's "absent only when policy is off").
 */
export function assertionFromObservation(
  observation: LocalityObservation,
  keyMatchesCredentialSigner: boolean | undefined,
  hardwareAttestation: HardwareAttestationState | undefined
): LocalityAssertion {
  if (!observation.confirmed) {
    return {
      localityConfirmed: false,
      localityMethod: 'none',
      localityReason: observation.reason ?? 'declinedByHolder',
    }
  }
  return {
    localityConfirmed: true,
    localityMethod: observation.method,
    localityTopology: 'witness-anchored',
    localitySensor: observation.sensorDid,
    localityVenue: observation.venueClaim,
    localityObservedAt: observation.observedAt,
    localityWindowSeconds: observation.windowSeconds,
    localityKeyMatchesCredentialSigner: keyMatchesCredentialSigner,
    localityHardwareAttestation: hardwareAttestation,
    localityEvidenceCommitment: observation.transcriptDigestMultibase,
    localityRttMs: observation.corroboration?.rttMs,
    localityRssiDbm: observation.corroboration?.rssiDbm,
    localityRttBoundMs: observation.corroboration?.rttBoundMs,
  }
}
