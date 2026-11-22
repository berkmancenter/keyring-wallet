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

import { createHash, createPublicKey, hkdfSync } from 'node:crypto'
import { p256 } from '@noble/curves/nist.js'

import { jcsCanonicalize } from '@bifold/trust-tasks'

import { looksLikeAppAttestAssertion, parseAppAttestAssertion, verifyAppAttestAssertion } from './appAttest'

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
  /**
   * Base64 — the device's hardware-attestation public key, in whatever
   * encoding that platform's `getHardwarePublicKey()` already returns: a
   * raw 65-byte EC point on iOS, SPKI-wrapped DER on Android (see
   * `BiometricSignatureVerifier.ts`'s "platform asymmetries" note). NOT a
   * raw point on both platforms — `transcriptKeyMatchesVrcSigner`'s plain
   * `===` below only holds because both sides of that comparison come from
   * the SAME platform's own convention, not because this is normalized.
   */
  devicePublicKey: string
  /**
   * Base64url. On Android, a DER P-256 ECDSA signature directly over
   * `bindingFor(this)`. On iOS, a CBOR App Attest assertion wrapping a
   * signature over `SHA256(authenticatorData ‖ SHA256(bindingFor(this)))` —
   * iOS cannot produce the Android shape with an App Attest key, and using a
   * different key would break `transcriptKeyMatchesVrcSigner`. `appAttest.ts`
   * explains the whole asymmetry; `verifyTranscript` tells the two apart from
   * the first byte, so this stays one field and the wire format is unchanged.
   */
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

/**
 * `detail` is operator-facing only — a narrower cause for the server log when
 * `reason` has been deliberately collapsed (see `verifyTranscript`). Nothing
 * that reaches a VWC ever reads it.
 */
export type TranscriptVerdict = { ok: true } | { ok: false; reason: string; detail?: string }

export interface VerifyTranscriptOptions {
  /**
   * `"<teamId>.<bundleId>"` of the wallet app. When set, an iOS assertion
   * must have been produced by THAT app, not merely by some App Attest key
   * on some device. Unset today at the only call site — the witness has no
   * configured notion of which wallet build it is talking to, and inventing
   * one would refuse legitimate wallets (TestFlight, a dev build, a fork)
   * rather than catch an attacker who, per `appAttest.ts`, still has to
   * produce a signature over the witness's own fresh challenge.
   */
  iosAppId?: string
  /** Highest App Attest counter already seen for this device key, if tracked. */
  lastSignCount?: number
}

/**
 * `devicePublicKey` is whatever THIS PLATFORM's `getHardwarePublicKey()`
 * already returns (see the `LocalityTranscript.devicePublicKey` doc above)
 * — a raw 65-byte point on iOS, SPKI-wrapped DER on Android. `@noble/curves`'s
 * `p256.verify()` needs a raw point either way, so detect and unwrap SPKI
 * here rather than assuming one platform's shape. Verified against a real
 * on-device capture (2026-08-21): a naive byte-length-91 pass-through to
 * `p256.verify()` doesn't throw, it just silently fails verification.
 */
function rawPointFromDevicePublicKey(bytes: Uint8Array): Uint8Array {
  // Already a raw point (iOS: uncompressed 65 bytes; also accepted compressed
  // 33 bytes, which @noble/curves' verify() decompresses natively — only
  // Android's SPKI-DER (91 bytes for P-256) needs unwrapping below.
  if (bytes.length === 65 && bytes[0] === 0x04) return bytes
  if (bytes.length === 33 && (bytes[0] === 0x02 || bytes[0] === 0x03)) return bytes
  const key = createPublicKey({ key: Buffer.from(bytes), format: 'der', type: 'spki' })
  const jwk = key.export({ format: 'jwk' }) as { x: string; y: string }
  return Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')])
}

/**
 * §7.3 step 5: recompute the binding and verify the device's P-256
 * signature over it. `expected` is what the WITNESS itself issued/observed
 * (its own challenge, its own sensor nonce, its own sensorDid) — never
 * trust the transcript's own copies of these over the witness's.
 *
 * Two real bugs found and fixed here via a live on-device capture
 * (2026-08-21), not caught by the reference ladder's Ed25519 stand-in or
 * this file's own noble-signed unit tests: (1) `devicePublicKey`'s SPKI
 * wrapping on Android, above; (2) Android's `java.security.Signature`
 * produces DER-encoded, non-canonical ("high-S") ECDSA signatures —
 * `@noble/curves` defaults to rejecting those (`lowS` strict mode) and to
 * expecting a raw compact signature, not DER. Both must be told explicitly.
 * See docs/plans/locality-plan/2026-08-21-bam.md for the full trail,
 * including why a naive fix attempt (pre-hashing manually, matching the
 * verify call this replaced) silently failed rather than throwing.
 */
export function verifyTranscript(
  transcript: LocalityTranscript,
  expected: { taskDigestMultibase: string; challenge: string; sensorNonce: string; sensorDid: string },
  options: VerifyTranscriptOptions = {}
): TranscriptVerdict {
  if (transcript.taskDigestMultibase !== expected.taskDigestMultibase) return { ok: false, reason: 'taskDigestMismatch' }
  if (transcript.challenge !== expected.challenge) return { ok: false, reason: 'challengeMismatch' }
  if (transcript.sensorNonce !== expected.sensorNonce) return { ok: false, reason: 'sensorNonceMismatch' }
  if (transcript.sensorDid !== expected.sensorDid) return { ok: false, reason: 'sensorMismatch' }
  let publicKeyBytes: Uint8Array
  try {
    publicKeyBytes = rawPointFromDevicePublicKey(Buffer.from(transcript.devicePublicKey, 'base64'))
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

  // iOS: a CBOR App Attest assertion, not a bare DER signature. Sniffed from
  // the first byte rather than flagged on the wire (see
  // `looksLikeAppAttestAssertion`), so Android transcripts reach the
  // original path below byte-identically to before this branch existed.
  if (looksLikeAppAttestAssertion(signatureBytes)) {
    const assertion = parseAppAttestAssertion(signatureBytes)
    if (!assertion) return { ok: false, reason: 'malformedAppAttestAssertion' }
    const verdict = verifyAppAttestAssertion(assertion, message, publicKeyBytes, {
      appId: options.iosAppId,
      lastSignCount: options.lastSignCount,
    })
    // Collapsed to the same reason the Android path uses, deliberately: this
    // value reaches the ceremony's decline reasons and, through them, the
    // VWC, and "which platform failed how" is not something a verifier of
    // the credential should be able to read off a failure. The specific
    // reason stays available to operators through the returned detail below.
    if (!verdict.ok) return { ok: false, reason: 'transcriptSignatureInvalid', detail: verdict.reason }
    return { ok: true }
  }

  let valid: boolean
  try {
    valid = p256.verify(signatureBytes, message, publicKeyBytes, { format: 'der', prehash: true, lowS: false })
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
