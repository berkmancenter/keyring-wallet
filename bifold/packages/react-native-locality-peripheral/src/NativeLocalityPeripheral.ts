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
  /** `LOCALITY_CHARACTERISTIC_UUID` — the one characteristic, write-then-read. */
  characteristicUuid: string;
  /** `'keyring-locality-v1'` today; versioned per plan §5.4, passed rather than hardcoded natively. */
  contextString: string;
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
};

export type NativeLocalityTranscriptResult = {
  /** Hex — what the sensor actually wrote to the characteristic. */
  sensorNonceHex: string;
  /** Base64, raw EC-P256 point — the same hardware-attestation public key `@bifold/react-native-attestation` already exposes. */
  devicePublicKeyBase64: string;
  /** Base64url — SHA256withECDSA over the five-value JCS binding, using the already-authorized `CryptoObject` (see below). */
  signatureBase64Url: string;
};

export interface Spec extends TurboModule {
  /** False on any platform/OS-version combination that can't run the peripheral role at all (not a permission or timing question — a capability one). */
  isSupported(): Promise<boolean>;

  /**
   * Present the biometric prompt ONCE, now — authorizing a `Signature`
   * bound to the existing hardware-attestation key via `CryptoObject`,
   * *before* advertising starts and outside the RTT-bound window — then run
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
