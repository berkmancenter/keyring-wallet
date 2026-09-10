import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Everything the native side needs to run the whole peripheral lifecycle —
 * advertise, open a GATT server, wait for the sensor's nonce, sign, serve the
 * read, tear down — as ONE call. Deliberately NOT split into separate
 * advertise/sign/serve methods: each one would be a round trip across the RN
 * bridge, and `ref-06p2` measured ~180ms median / 224ms p95 for the honest
 * BLE round trip alone, with no bridge hop at all, against a witness-server
 * RTT bound that is itself only provisionally 400ms. See locality-plan.md
 * §10.3 item 9 and its companion (locality-plan/2026-08-21-bam.md) for why.
 *
 * `taskDigestMultibase`/`challenge`/`sensorDid`/`contextString` are passed
 * as plain strings, not pre-assembled binding bytes, because the fifth
 * binding value — `sensorNonce` — only exists once the sensor writes it
 * over BLE, which only the native side observes. The native implementation
 * MUST therefore assemble the same JCS-canonicalized five-value binding
 * `deviceLocality.ts`'s `bindingFor()` computes (byte-for-byte — see that
 * function's own frozen cross-parity fixture in
 * `__tests__/deviceLocality.test.ts`, which any Kotlin/Swift implementation
 * should be checked against too, not just eyeballed for agreement) and sign
 * SHA256withECDSA over it with the existing hardware-attestation key —
 * this is a third deliberate duplicate of that one algorithm, alongside the
 * wallet (Hermes) and witness-server (Node) copies, for the same
 * cross-runtime reason those two already are.
 */
export type NativeRespondToSensorParams = {
  /** From `serviceUuidFromEid(deriveEid(challenge, taskDigestMultibase))` — computed in JS, passed down ready-made. */
  serviceUuid: string;
  /**
   * `LOCALITY_CHARACTERISTIC_UUID` — write-then-read, carries every field
   * except `devicePublicKey`/`signature`. Split from a single characteristic
   * after a real, live-on-device finding (2026-08-21): BLE's GATT protocol
   * caps a single attribute value at 512 bytes (Bluetooth Core Spec, Vol 3,
   * Part F, §3.2.9), independent of the negotiated ATT MTU (517 in
   * testing) — the full transcript runs to ~630 bytes once it carries a
   * real key and signature, over that ceiling regardless of how the reads
   * are chunked. See `signatureCharacteristicUuid` below.
   */
  characteristicUuid: string;
  /** `LOCALITY_SIGNATURE_CHARACTERISTIC_UUID` — read-only, carries just `devicePublicKey`/`signature` (see `characteristicUuid`'s comment for why these are split out). */
  signatureCharacteristicUuid: string;
  /** `'keyring-locality-v1'` today; versioned per plan §5.4, passed rather than hardcoded natively. */
  contextString: string;
  /**
   * Needed only so native can assemble the FULL `LocalityTranscript` JSON
   * it writes back over the GATT characteristic on read — witness-server's
   * `runTranscriptExchange()` does `JSON.parse(raw) as LocalityTranscript`
   * and expects every field, `method` included, not just the signature.
   * The JS-facing result below deliberately omits it: the caller already
   * has `directive.method` and re-adds it when assembling its own
   * `LocalityTranscript` from `NativeLocalityTranscriptResult`.
   */
  method: 'ble-challenge-response/0.1' | 'nfc-kiosk/0.1';
  taskDigestMultibase: string;
  challenge: string;
  /** The witness's own DID, from the directive — known before advertising starts. */
  sensorDid: string;
  /**
   * Already known before advertising starts (from the existing attestation
   * flow) — NOT re-derived natively. Carried through so the JS-side
   * `DeviceLocalityProvider` implementation can assemble the full
   * `LocalityTranscript` without a second bridge call.
   */
  hardwareAttestation: 'verified' | 'present-unverified' | 'absent';
  /**
   * The SENSOR's bound (plan §5.5), not the device's own patience — how
   * long to advertise before giving up. Anchored on the native side's own
   * clock once advertising actually starts.
   */
  windowSeconds: number;
  /**
   * `'biometric'` or `'passcode'`, resolved by `@bifold/core`'s
   * `resolveHardwareSigningAuthMode()` — the SAME policy (device enrollment
   * + the user's `useBiometry` preference) that governs the OS prompt for
   * VRC content signing (`vrc-biometric.ts`), so the locality-transcript
   * signature — authorizing the same hardware key — doesn't independently
   * decide to always offer both biometric and device-credential regardless
   * of preference. Structurally identical to (but not imported from)
   * `@bifold/react-native-attestation`'s `HardwareSigningAuthMode`, per
   * this package's own convention of duplicating small cross-package types
   * by contract rather than a real Gradle/package dependency (see
   * `HARDWARE_SIGNING_KEY_ALIAS`'s own comment in
   * `LocalityPeripheralModule.kt`).
   */
  authMode: 'biometric' | 'passcode';
};

export type NativeLocalityTranscriptResult = {
  /**
   * Hex — what the sensor actually wrote to the characteristic. Traced
   * against witness-server's real `BleLocalityProvider.runTranscriptExchange()`:
   * the sensor mints `randomBytes(32).toString('hex')` and writes THAT
   * string's UTF-8 bytes (ASCII text, not raw binary) — so the native
   * write callback gets this value by decoding the write as UTF-8, no hex
   * decoding needed. The read response native serves back is the full
   * `JSON.stringify`'d `LocalityTranscript` (method included) as UTF-8
   * bytes too — witness-server does `JSON.parse(raw.toString('utf8'))`
   * and expects every field.
   */
  sensorNonceHex: string;
  /**
   * Base64 — exactly `@bifold/react-native-attestation`'s own
   * `getHardwarePublicKey()` output for this platform (SPKI-wrapped on
   * Android, not a raw point — see `BiometricSignatureVerifier.ts`'s
   * "platform asymmetries" note). `transcriptKeyMatchesVrcSigner`'s plain
   * `===` against the VRC evidence's stored key only holds if this matches
   * that encoding byte-for-byte.
   */
  devicePublicKeyBase64: string;
  /** Base64url — SHA256withECDSA over the five-value JCS binding, using the already-authorized `CryptoObject` (see below). */
  signatureBase64Url: string;
};

export interface Spec extends TurboModule {
  /** False on any platform/OS-version combination that can't run the peripheral role at all (not a permission or timing question — a capability one). */
  isSupported(): Promise<boolean>;

  /**
   * Present the biometric/passcode prompt ONCE, now — per `params.authMode`
   * — authorizing a `Signature` bound to the existing hardware-attestation
   * key via `CryptoObject`, *before* advertising starts and outside the
   * RTT-bound window — then run
   * the whole peripheral lifecycle: advertise `serviceUuid`, open the GATT
   * server, wait for a central to write to `characteristicUuid`, sign the
   * binding synchronously with the already-authorized object (no further
   * prompt), serve the transcript on read, and resolve once the sensor has
   * read it (or the read times out from the native side's perspective).
   *
   * Resolves `null` — not a rejection — if `windowSeconds` elapses with no
   * connection, the user declines/cancels biometric authorization, or the
   * app leaves the foreground before a sensor connects. All three are
   * §7.1's `windowLost`/`declinedByHolder` outcomes, which
   * `DeviceLocalityProvider.respondToSensor()` already models as `null`,
   * not a thrown error — this mirrors that contract exactly so the
   * wrapping JS implementation stays a thin pass-through.
   *
   * Rejects only for a genuine implementation error (no hardware key
   * exists yet, BLE hardware unavailable, adapter off) — conditions the
   * caller should treat as a bug or an environment problem, not a normal
   * ceremony outcome.
   */
  respondToSensor(params: NativeRespondToSensorParams): Promise<NativeLocalityTranscriptResult | null>;

  /**
   * Best-effort teardown: stop advertising, close the GATT server, release
   * the authorized signing object. Safe to call even if nothing is
   * running — the ceremony's own cleanup path (app backgrounded, session
   * abandoned) calls this unconditionally rather than tracking whether
   * `respondToSensor` is still in flight.
   */
  stopAdvertising(): Promise<void>;
}

export default TurboModuleRegistry.get<Spec>('LocalityPeripheral');
