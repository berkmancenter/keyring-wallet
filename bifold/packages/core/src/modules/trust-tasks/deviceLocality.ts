/**
 * Locality — the device (wallet) side of co-presence evidence.
 *
 * DELIBERATE DUPLICATE of witness-server's
 * `src/trustTasks/locality.ts` primitives (EID/transcript shapes, the
 * digest), following documentProof.ts's existing core⇄witness sharing
 * pattern — the witness-server copy runs under plain Node; this one needs
 * to run on Hermes (RN), which is why it isn't imported directly. Keep the
 * two in sync.
 *
 * `DeviceLocalityProvider` is the port `runWitnessSession`
 * (./witnessCeremony.ts) calls through — mirroring the witness's own
 * `TaskLocalityProvider`/`BleLocalityProvider` split, for the same reason:
 * the protocol/ext wiring (locality-plan.md §10.3 item 10) can be built and
 * tested now, against `NullDeviceLocalityProvider`, with the real native
 * BLE peripheral (item 9 — advertise, serve the GATT characteristic, sign
 * with the existing hardware-attestation key) slotting in later as a second
 * implementation of this same interface, without touching the ceremony
 * wiring again.
 */

// node:crypto is not available on Hermes/RN — this file needs to run on
// device, unlike witness-server's copy which runs under plain Node. Same
// primitives documentProof.ts already uses on this side: @noble/hashes for
// SHA-256, the `canonicalize` package (not a hand-rolled JCS) for RFC 8785.
import { sha256 } from '@noble/hashes/sha2.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import canonicalize from 'canonicalize'

function jcsCanonicalize(value: unknown): string {
  const canonical = canonicalize(value)
  if (canonical === undefined) throw new Error('value has no RFC 8785 canonical form')
  return canonical
}
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export const LOCALITY_EXT_NAMESPACE = 'edu.harvard.seas.atl.keyring'

// -------------------------------------------------------------- the EID (§5.3)
// Byte-for-byte mirror of witness-server's trustTasks/locality.ts — the two
// sides must derive the identical EID/service UUID independently, or the
// witness's sensor never recognizes what the device advertises. Cross-
// checked against that module's real output in
// __tests__/unit/deviceLocality.test.ts, not just eyeballed for agreement.

const EID_SALT = 'keyring-locality-eid-v1'
const EID_BYTES = 12
/** "KRL1" — the fixed prefix that survives 128-bit-service-UUID formatting on iOS. */
export const EID_UUID_PREFIX = '4b524c31'
/** The one GATT characteristic (write nonce, then read transcript) the device's peripheral role serves. */
export const LOCALITY_CHARACTERISTIC_UUID = '4b524c32-0000-1000-8000-2a2b3c4d5e6f'
/** Versioned per plan §5.4 — bump this, not the shape, if the binding ever needs to change. */
export const LOCALITY_BINDING_CONTEXT = 'keyring-locality-v1'

/**
 * The rendezvous EID: HKDF-SHA256(ikm = challenge, salt = EID_SALT,
 * info = taskDigestMultibase(sessionDoc), L = 12 bytes) — locates a device;
 * proves nothing on its own (plan §5.3).
 */
export function deriveEid(challenge: string, sessionTaskDigestMultibase: string): string {
  const enc = new TextEncoder()
  return toHex(hkdf(sha256, enc.encode(challenge), enc.encode(EID_SALT), enc.encode(sessionTaskDigestMultibase), EID_BYTES))
}

/** The EID as the 128-bit service UUID the device advertises. */
export function serviceUuidFromEid(eidHex: string): string {
  const hex = EID_UUID_PREFIX + eidHex
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export type LocalityMethod = 'ble-challenge-response/0.1' | 'nfc-kiosk/0.1'
export type HardwareAttestationState = 'verified' | 'present-unverified' | 'absent'

export interface LocalityTranscript {
  method: LocalityMethod
  taskDigestMultibase: string
  challenge: string
  sensorNonce: string
  sensorDid: string
  /** Base64, raw EC-P256 point — the SAME hardware-attestation key that signs VRC evidence. */
  devicePublicKey: string
  /** Base64url, the P-256 ECDSA signature over the five-value binding. */
  signature: string
  hardwareAttestation: HardwareAttestationState
}

/** The sensor directive carried in `witness/session#response`'s `ext` (plan §6 table row 2). */
export interface LocalitySensorDirective {
  policy: 'offered' | 'required'
  method: LocalityMethod
  sensorDid: string
  windowSeconds: number
}

export interface DeviceLocalityProvider {
  readonly name: string
  /**
   * Advertise the EID derived from {challenge, taskDigestMultibase}, serve
   * the GATT characteristic, and sign the transcript with the hardware-
   * attestation key once the sensor connects and writes its nonce.
   * Resolves `null` if the ceremony window elapsed with no connection —
   * the app backgrounded, locked, or the ceremony moved on (§7.1's
   * `windowLost`, a UX/timing outcome, not an error this should throw for).
   */
  respondToSensor(params: {
    taskDigestMultibase: string
    challenge: string
    directive: LocalitySensorDirective
  }): Promise<LocalityTranscript | null>
}

/** No-op — used when locality is off, or until a real BLE peripheral (item 9) exists. */
export class NullDeviceLocalityProvider implements DeviceLocalityProvider {
  readonly name = 'null'
  async respondToSensor(): Promise<LocalityTranscript | null> {
    return null
  }
}

/**
 * The five-value binding both directions commit to (plan §5.4): context
 * string, session task digest, challenge, sensor nonce, sensor DID. JCS'd so
 * signer (this file) and verifier (witness-server's `verifyTranscript`) agree
 * on the exact bytes. This is what `signLocalityTranscript` on the native
 * peripheral (§10.3 item 9, not yet built) must sign — via `SHA256withECDSA`,
 * so the raw bytes go in, not a pre-hashed digest; the hardware signing key
 * hashes internally, matching `signVrcWithHardwareKey`'s existing pattern.
 */
export function bindingFor(t: {
  taskDigestMultibase: string
  challenge: string
  sensorNonce: string
  sensorDid: string
}): Uint8Array {
  return new TextEncoder().encode(
    jcsCanonicalize({
      context: LOCALITY_BINDING_CONTEXT,
      taskDigestMultibase: t.taskDigestMultibase,
      challenge: t.challenge,
      sensorNonce: t.sensorNonce,
      sensorDid: t.sensorDid,
    })
  )
}

/** §5.4: the digest over the full transcript, matching witness-server's `locality.ts` exactly — signer and verifier must agree on these bytes. */
export function transcriptDigestMultibase(transcript: LocalityTranscript): string {
  const canonical = new TextEncoder().encode(jcsCanonicalize(transcript))
  return `sha256:${toHex(sha256(canonical))}`
}
