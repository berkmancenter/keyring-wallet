/**
 * App Attest assertion verification — the iOS half of locality transcript
 * signing (docs/plans/locality-plan/2026-09-12-al.md).
 *
 * WHY THIS FILE EXISTS AT ALL. Android and iOS both sign the locality
 * binding with the same hardware-attestation key they already use for VRC
 * content, but they hand back structurally different bytes:
 *
 *   Android  `java.security.Signature("SHA256withECDSA")` → a DER ECDSA
 *            signature directly over the binding. `p256.verify(..., {
 *            format: 'der', prehash: true })` in `locality.ts` reads it as is.
 *
 *   iOS      `DCAppAttestService generateAssertion:clientDataHash:` → a CBOR
 *            map `{ signature, authenticatorData }`, where `signature` is a
 *            DER ECDSA signature NOT over the binding but over
 *            `SHA256(authenticatorData ‖ SHA256(binding))`. Handing that
 *            straight to `p256.verify` does not throw — it silently returns
 *            false, the same failure mode `rawPointFromDevicePublicKey`'s own
 *            comment warns about for SPKI keys.
 *
 * iOS has no lower-level door. `SecKeyCreateSignature` over a Secure Enclave
 * key would produce Android-shaped bytes, but the key the VRC evidence
 * already commits to is an App Attest key, and App Attest keys are reachable
 * ONLY through `generateAssertion`. Signing the locality binding with a
 * second, non-App-Attest Secure Enclave key would produce a signature this
 * file would not need — and a public key that
 * `transcriptKeyMatchesVrcSigner`'s `===` would then never match, defeating
 * the one check that ties the radio to the credential. So the witness learns
 * App Attest instead. See the plan companion for the three options and why
 * this is the one.
 *
 * WHAT THIS IS NOT. The wallet ALSO verifies App Attest assertions, in
 * `@bifold/core`'s `BiometricSignatureVerifier` → `verifyHardwareEvidence` →
 * `Attestation.mm`. That path runs on the phone and delegates to Apple's own
 * frameworks. This one runs in a Node service with no Apple anything, so the
 * unwrapping is re-implemented here rather than shared — the same
 * cross-runtime duplication `locality.ts`'s own header already documents for
 * the binding algebra.
 *
 * WHAT IS NOT YET PROVEN. Every test beside this file builds its assertions
 * with the algorithm below, so they prove this module is self-consistent and
 * that it rejects the tampering they describe. They do NOT prove agreement
 * with Apple: only a real `generateAssertion` capture from a real device can
 * do that, and this environment has no App Attest (the simulator refuses —
 * `DCAppAttestService.isSupported` is false). `__tests__/unit/appAttest.test.ts`
 * has a `describe.skip` block ready for that fixture; fill it in from a
 * device run before trusting this in production.
 */

import { createHash } from 'node:crypto'
import { p256 } from '@noble/curves/nist.js'

// ------------------------------------------------------------- minimal CBOR

/**
 * Just enough CBOR to read one flat `{ text => bytes }` map — deliberately
 * not a dependency. An App Attest assertion is a two-key map of byte
 * strings; a general decoder would be more surface than the format needs,
 * and `Attestation.mm` hand-rolls the same subset on the iOS side for the
 * same reason (see its `cborReadByteString` and friends).
 *
 * Strict by construction: definite lengths only, no tags, no indefinite
 * chunks, and every read bounds-checks before it advances. Anything outside
 * the subset throws, and every caller here treats a throw as "not an
 * assertion" rather than letting it escape.
 */
class CborReader {
  private offset = 0

  constructor(private readonly bytes: Uint8Array) {}

  get exhausted(): boolean {
    return this.offset >= this.bytes.length
  }

  private byte(): number {
    if (this.offset >= this.bytes.length) throw new Error('cborTruncated')
    return this.bytes[this.offset++]
  }

  /** Major type + argument from one initial byte, resolving the 1/2/4/8-byte forms. */
  private head(): { major: number; argument: number } {
    const initial = this.byte()
    const major = initial >> 5
    const additional = initial & 0x1f
    if (additional < 24) return { major, argument: additional }
    let width: number
    if (additional === 24) width = 1
    else if (additional === 25) width = 2
    else if (additional === 26) width = 4
    else if (additional === 27) width = 8
    // 28-30 are reserved; 31 is the indefinite-length form this reader rejects.
    else throw new Error('cborUnsupportedLength')
    let argument = 0
    for (let i = 0; i < width; i++) {
      argument = argument * 256 + this.byte()
      // An assertion is a few hundred bytes. Anything claiming more than this
      // is malformed or hostile, and `argument` would stop being an exact
      // integer past 2^53 anyway.
      if (argument > 0xffffff) throw new Error('cborLengthTooLarge')
    }
    return { major, argument }
  }

  private take(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) throw new Error('cborTruncated')
    const slice = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return slice
  }

  /** Map header; returns the declared pair count. */
  mapHeader(): number {
    const { major, argument } = this.head()
    if (major !== 5) throw new Error('cborNotAMap')
    return argument
  }

  textString(): string {
    const { major, argument } = this.head()
    if (major !== 3) throw new Error('cborNotText')
    return Buffer.from(this.take(argument)).toString('utf8')
  }

  byteString(): Uint8Array {
    const { major, argument } = this.head()
    if (major !== 2) throw new Error('cborNotBytes')
    return this.take(argument)
  }
}

// ----------------------------------------------------------- the assertion

export interface AppAttestAssertion {
  /** DER ECDSA over `SHA256(authenticatorData ‖ clientDataHash)` — NOT over the binding. */
  signature: Uint8Array
  authenticatorData: Uint8Array
}

/**
 * The first byte tells the two platforms apart with no wire change and no
 * per-platform flag on the transcript: a DER signature is a SEQUENCE, which
 * is always `0x30`; a CBOR map's initial byte is `0xa0 | n` for the small
 * maps this format uses. The ranges cannot collide, so a transcript stays
 * exactly the shape `LocalityTranscript` already describes and Android's
 * existing bytes keep taking the existing path untouched.
 */
export function looksLikeAppAttestAssertion(signatureBytes: Uint8Array): boolean {
  if (signatureBytes.length === 0) return false
  const initial = signatureBytes[0]
  return (initial >> 5) === 5
}

/**
 * Read `{ signature, authenticatorData }`. Returns `undefined` — never
 * throws — for anything that is not that map, so callers can fall through
 * to the Android path on a sniff that turned out wrong.
 *
 * Key order is NOT assumed: Apple documents the members, not their
 * ordering, and CBOR maps are unordered by definition. Extra members are
 * skipped rather than rejected, on the same reasoning — a future iOS could
 * add one, and this module only needs the two.
 */
export function parseAppAttestAssertion(bytes: Uint8Array): AppAttestAssertion | undefined {
  try {
    const reader = new CborReader(bytes)
    const pairs = reader.mapHeader()
    let signature: Uint8Array | undefined
    let authenticatorData: Uint8Array | undefined
    for (let i = 0; i < pairs; i++) {
      const key = reader.textString()
      const value = reader.byteString()
      if (key === 'signature') signature = value
      else if (key === 'authenticatorData') authenticatorData = value
      // Anything else is a member this module does not need; already consumed.
    }
    if (!signature || !authenticatorData) return undefined
    return { signature, authenticatorData }
  } catch {
    return undefined
  }
}

// ------------------------------------------------------ authenticator data

/**
 * The fixed WebAuthn-shaped prefix App Attest reuses: a 32-byte RP ID hash,
 * one flags byte, then a big-endian 4-byte counter. Apple appends nothing
 * else for an assertion (an *attestation*'s authenticator data carries the
 * attested credential too, but that is the enrolment path, not this one).
 */
export const AUTHENTICATOR_DATA_MIN_BYTES = 37

export interface AuthenticatorData {
  /** SHA-256 of `"<teamId>.<bundleId>"` — Apple's RP ID for App Attest. */
  rpIdHash: Uint8Array
  flags: number
  /**
   * Apple increments this on every assertion for the key. A verifier that
   * keeps per-key state rejects any assertion whose counter did not advance,
   * which is what makes a captured assertion non-replayable on its own.
   * The witness does not keep that state today — see
   * `verifyAppAttestAssertion`'s note on why the binding covers it here.
   */
  signCount: number
}

export function parseAuthenticatorData(bytes: Uint8Array): AuthenticatorData | undefined {
  if (bytes.length < AUTHENTICATOR_DATA_MIN_BYTES) return undefined
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    rpIdHash: bytes.subarray(0, 32),
    flags: bytes[32],
    signCount: view.readUInt32BE(33),
  }
}

/** Apple's RP ID for App Attest is the app's full identifier, hashed. */
export function rpIdHashFor(appId: string): Uint8Array {
  return createHash('sha256').update(appId, 'utf8').digest()
}

// ------------------------------------------------------------ verification

export type AppAttestVerdict = { ok: true; signCount: number } | { ok: false; reason: string }

export interface AppAttestExpectations {
  /**
   * `"<teamId>.<bundleId>"`, e.g. `"ABCDE12345.org.keyring.wallet"`. When
   * given, the assertion's RP ID hash must match it — which pins the
   * assertion to THIS app, not merely to some App Attest key on some
   * device. When omitted the check is skipped and the verdict rests on the
   * signature alone; omit it only where the deployment genuinely does not
   * know its own app identifier.
   */
  appId?: string
  /**
   * The highest counter already seen for this device key, if the caller
   * keeps that state. When given, the assertion's counter must exceed it.
   */
  lastSignCount?: number
}

/**
 * Verify an iOS assertion over `message`.
 *
 * The three-step shape is Apple's, not ours: hash the message to get the
 * client data hash the device was asked to attest, concatenate the
 * authenticator data in front of it, hash again to get the nonce, and check
 * the ECDSA signature over that nonce. Getting any step wrong produces a
 * false verdict rather than an error, so the tests beside this file assert
 * each wrong variant fails rather than only asserting the right one passes.
 *
 * ON REPLAY. Without `lastSignCount` this function does not detect a
 * replayed assertion by itself. In the locality ceremony that is covered a
 * layer up and more tightly than a counter would: `message` is
 * `bindingFor(transcript)`, which commits to the witness's own freshly
 * minted `challenge` and `sensorNonce`, and `verifyTranscript` compares both
 * against what the witness itself issued for THIS session before it ever
 * gets here. A replayed assertion is an assertion over a different binding,
 * and fails at the signature. Callers outside that ceremony should pass
 * `lastSignCount`.
 */
export function verifyAppAttestAssertion(
  assertion: AppAttestAssertion,
  message: Uint8Array,
  rawPublicKey: Uint8Array,
  expectations: AppAttestExpectations = {}
): AppAttestVerdict {
  const authenticatorData = parseAuthenticatorData(assertion.authenticatorData)
  if (!authenticatorData) return { ok: false, reason: 'malformedAuthenticatorData' }

  if (expectations.appId !== undefined) {
    const expected = rpIdHashFor(expectations.appId)
    if (!Buffer.from(authenticatorData.rpIdHash).equals(Buffer.from(expected))) {
      return { ok: false, reason: 'appIdMismatch' }
    }
  }

  if (expectations.lastSignCount !== undefined && authenticatorData.signCount <= expectations.lastSignCount) {
    return { ok: false, reason: 'signCountNotAdvanced' }
  }

  const clientDataHash = createHash('sha256').update(Buffer.from(message)).digest()
  const nonce = createHash('sha256')
    .update(Buffer.from(assertion.authenticatorData))
    .update(clientDataHash)
    .digest()

  let valid: boolean
  try {
    // `prehash: true` because ECDSA signs SHA-256 OF the nonce, not the nonce
    // as a digest — the same convention Apple's own verification sample and
    // `createVerify('SHA256').update(nonce)` both use. `lowS: false` for the
    // same reason `locality.ts` needs it on the Android path: platform
    // signers do not canonicalize S, and @noble/curves rejects high-S by
    // default.
    valid = p256.verify(assertion.signature, nonce, rawPublicKey, { format: 'der', prehash: true, lowS: false })
  } catch {
    valid = false
  }
  if (!valid) return { ok: false, reason: 'assertionSignatureInvalid' }
  return { ok: true, signCount: authenticatorData.signCount }
}
