/**
 * locality.ts tests — the EID derivation, the P-256 transcript binding
 * (real device crypto, not the reference ladder's Ed25519 stand-in), the
 * flat VWC assertion shape, and residuals.
 */
import { randomBytes } from 'crypto'
import { p256 } from '@noble/curves/nist.js'

import {
  LocalityTranscript,
  assertionFromObservation,
  bindingFor,
  deriveEid,
  residualsFor,
  serviceUuidFromEid,
  transcriptDigestMultibase,
  transcriptKeyMatchesVrcSigner,
  verifyTranscript,
} from '../../src/trustTasks/locality'
import { createHash } from 'crypto'

const CHALLENGE = '9f2c1d7e4a8b0c5f3e6d1a2b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d'
const TASK_DIGEST = 'zQmThPAfpiEuXaQYikrEdvtWJbtJSCcwYPrh9vWe2pTaoWZ'
const SENSOR_NONCE = '5a6b7c8d9e0f1a2b3c4d5e6f70819200'
const SENSOR_DID = 'did:peer:4wendy'

function makeSignedTranscript(privateKey: Uint8Array, overrides: Partial<LocalityTranscript> = {}): LocalityTranscript {
  const publicKey = p256.getPublicKey(privateKey)
  const base: LocalityTranscript = {
    method: 'ble-challenge-response/0.1',
    taskDigestMultibase: TASK_DIGEST,
    challenge: CHALLENGE,
    sensorNonce: SENSOR_NONCE,
    sensorDid: SENSOR_DID,
    devicePublicKey: Buffer.from(publicKey).toString('base64'),
    signature: '',
    hardwareAttestation: 'verified',
    ...overrides,
  }
  // DER, not noble's own raw/compact default — matches what a real device's
  // java.security.Signature ("SHA256withECDSA") actually produces. Signing
  // the pre-hashed digest directly (not the raw binding, no `prehash`
  // option) mirrors that same API's single-hash behavior. A live on-device
  // capture (2026-08-21, see docs/plans/locality-plan/2026-08-21-bam.md)
  // found verifyTranscript silently failing against a real transcript
  // because these tests' own noble-signed fixtures used noble's convenient
  // low-S/compact defaults instead — which never exercised the DER-parsing
  // or high-S path a real device's signature actually needs.
  // `prehash: false` here is deliberate, not noble's default: verifyTranscript
  // hashes the raw binding itself (`prehash: true`, matching Android's
  // Signature.update(rawBytes) semantics), so signing must treat `digest`
  // as the exact value to sign over — noble's own unspecified/true default
  // would hash it a second time and silently produce a fixture that never
  // matches a real device's signature shape.
  const digest = createHash('sha256').update(bindingFor(base)).digest()
  const signature = p256.sign(digest, privateKey, { format: 'der', prehash: false })
  return { ...base, signature: Buffer.from(signature).toString('base64url') }
}

describe('deriveEid / serviceUuidFromEid', () => {
  test('is deterministic', () => {
    expect(deriveEid(CHALLENGE, TASK_DIGEST)).toBe(deriveEid(CHALLENGE, TASK_DIGEST))
  })

  test('different challenges (as two sessions of one exchange must have) derive different EIDs', () => {
    expect(deriveEid(CHALLENGE, TASK_DIGEST)).not.toBe(deriveEid('f'.repeat(64), TASK_DIGEST))
  })

  test('the service UUID keeps the KRL1 scan prefix and is a well-formed 128-bit UUID', () => {
    const uuid = serviceUuidFromEid(deriveEid(CHALLENGE, TASK_DIGEST))
    expect(uuid).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/)
    expect(uuid.startsWith('4b524c31')).toBe(true)
  })
})

describe('verifyTranscript', () => {
  const privateKey = randomBytes(32)
  const expected = { taskDigestMultibase: TASK_DIGEST, challenge: CHALLENGE, sensorNonce: SENSOR_NONCE, sensorDid: SENSOR_DID }

  test('a genuine transcript, signed with a real P-256 key, verifies', () => {
    const transcript = makeSignedTranscript(privateKey)
    expect(verifyTranscript(transcript, expected)).toEqual({ ok: true })
  })

  test('a transcript signed by a different key fails', () => {
    const otherKey = randomBytes(32)
    const transcript = makeSignedTranscript(otherKey)
    // Signed correctly under otherKey, but devicePublicKey in the transcript
    // is otherKey's — swap it for a key whose signature won't match, the
    // way a forged devicePublicKey claim would look.
    const forged = { ...transcript, devicePublicKey: Buffer.from(p256.getPublicKey(privateKey)).toString('base64') }
    expect(verifyTranscript(forged, expected)).toEqual({ ok: false, reason: 'transcriptSignatureInvalid' })
  })

  test('replay across sessions — the taskDigestMultibase does not match this session', () => {
    const transcript = makeSignedTranscript(privateKey)
    expect(verifyTranscript(transcript, { ...expected, taskDigestMultibase: 'zSomeOtherSession' })).toEqual({
      ok: false,
      reason: 'taskDigestMismatch',
    })
  })

  test('a stale challenge fails — this transcript answered a different one', () => {
    const transcript = makeSignedTranscript(privateKey)
    expect(verifyTranscript(transcript, { ...expected, challenge: 'f'.repeat(64) })).toEqual({
      ok: false,
      reason: 'challengeMismatch',
    })
  })

  test("the witness's own sensor nonce must match — a session cannot claim an observation it did not earn", () => {
    const transcript = makeSignedTranscript(privateKey)
    expect(verifyTranscript(transcript, { ...expected, sensorNonce: '00'.repeat(16) })).toEqual({
      ok: false,
      reason: 'sensorNonceMismatch',
    })
  })

  test('a single tampered byte in the signature is rejected', () => {
    const transcript = makeSignedTranscript(privateKey)
    const tampered = { ...transcript, signature: transcript.signature.slice(0, -4) + 'XXXX' }
    expect(verifyTranscript(tampered, expected)).toEqual({ ok: false, reason: 'transcriptSignatureInvalid' })
  })

  test('a valid-looking but wrong signature over a mutated binding field is rejected', () => {
    // The transcript still claims the original challenge (so the mismatch
    // check above doesn't fire first) but the SIGNATURE was computed over a
    // different sensorDid — proving the binding actually covers what it
    // claims to, not just the fields we happen to compare.
    const transcript = makeSignedTranscript(privateKey, { sensorDid: 'did:peer:4mallory' })
    const relabelled = { ...transcript, sensorDid: SENSOR_DID }
    expect(verifyTranscript(relabelled, expected)).toEqual({ ok: false, reason: 'transcriptSignatureInvalid' })
  })
})

describe('transcriptKeyMatchesVrcSigner', () => {
  const privateKey = randomBytes(32)
  const transcript = makeSignedTranscript(privateKey)

  test('true when the transcript key equals the VRC evidence key', () => {
    expect(transcriptKeyMatchesVrcSigner(transcript, transcript.devicePublicKey)).toBe(true)
  })

  test('false when they differ — a genuine device answered, but not the credential signer', () => {
    const otherKey = Buffer.from(p256.getPublicKey(randomBytes(32))).toString('base64')
    expect(transcriptKeyMatchesVrcSigner(transcript, otherKey)).toBe(false)
  })

  test('false when there is no VRC evidence to compare against', () => {
    expect(transcriptKeyMatchesVrcSigner(transcript, undefined)).toBe(false)
  })
})

describe('residualsFor', () => {
  test('ble-challenge-response leaves the RF-relay residual open', () => {
    expect(residualsFor('ble-challenge-response/0.1')).toEqual(['rf-relay'])
  })
  test('nfc-kiosk closes it', () => {
    expect(residualsFor('nfc-kiosk/0.1')).toEqual([])
  })
  test('none carries no residuals — nothing was attempted', () => {
    expect(residualsFor('none')).toEqual([])
  })
})

describe('assertionFromObservation', () => {
  test('a confirmed observation produces a flat assertion with every tier populated', () => {
    const assertion = assertionFromObservation(
      {
        method: 'ble-challenge-response/0.1',
        sensorDid: SENSOR_DID,
        venueClaim: 'ATL, Room 2',
        observedAt: '2026-08-21T00:00:00Z',
        windowSeconds: 120,
        confirmed: true,
        transcriptDigestMultibase: 'sha256:abc',
        corroboration: { rttMs: 180, rssiDbm: -58, rttBoundMs: 400 },
      },
      true,
      'verified'
    )
    expect(assertion).toEqual({
      localityConfirmed: true,
      localityMethod: 'ble-challenge-response/0.1',
      localityTopology: 'witness-anchored',
      localitySensor: SENSOR_DID,
      localityVenue: 'ATL, Room 2',
      localityObservedAt: '2026-08-21T00:00:00Z',
      localityWindowSeconds: 120,
      localityKeyMatchesCredentialSigner: true,
      localityHardwareAttestation: 'verified',
      localityEvidenceCommitment: 'sha256:abc',
      localityRttMs: 180,
      localityRssiDbm: -58,
      localityRttBoundMs: 400,
    })
    for (const [key, value] of Object.entries(assertion)) {
      expect(typeof value === 'object' && value !== null).toBe(false)
    }
  })

  test('a declined observation emits confirmed:false WITH a reason — never omitted', () => {
    const assertion = assertionFromObservation(
      { method: 'none', sensorDid: SENSOR_DID, observedAt: '2026-08-21T00:00:00Z', confirmed: false, reason: 'windowLost' },
      undefined,
      undefined
    )
    expect(assertion).toEqual({ localityConfirmed: false, localityMethod: 'none', localityReason: 'windowLost' })
  })
})

describe('transcriptDigestMultibase', () => {
  test('is stable and changes when the transcript changes', () => {
    const privateKey = randomBytes(32)
    const transcript = makeSignedTranscript(privateKey)
    const digest = transcriptDigestMultibase(transcript)
    expect(transcriptDigestMultibase(transcript)).toBe(digest)
    expect(transcriptDigestMultibase({ ...transcript, sensorNonce: '11'.repeat(16) })).not.toBe(digest)
  })
})

describe('verifyTranscript against a real on-device capture (2026-08-21)', () => {
  // A genuine transcript from LocalityPeripheralModule.kt running on a
  // physical Android device (Galaxy S20+, API 33), captured via a temporary
  // debug trigger — not a noble-signed fixture. This is what first caught
  // verifyTranscript silently rejecting every real Android signature: SPKI-
  // wrapped public key (91 bytes, not a raw point) and a DER, high-S
  // signature, neither of which the noble-signed unit tests above ever
  // exercised. Frozen here so the exact regression can't come back quietly.
  const REAL_CAPTURE: LocalityTranscript = {
    method: 'ble-challenge-response/0.1',
    taskDigestMultibase: 'sha256:aabbccddeeff00112233445566778899aabbccddeeff0011223344556677889900',
    challenge: 'live-verification-9f2c1d7e4a8b0c5f3e6d1a2b7c8d9e0f',
    sensorNonce: '23da7fac4656e3aa823e0563855e074ba8cbef6190579155deccd0f5b265779d',
    sensorDid: 'did:peer:4live-verification-sensor',
    devicePublicKey:
      'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEkdyC6qqXx/cI6xPhcsJ/cBf8+Bj73rgS1Js52NllgJ9MatXXs3XgvadN6orO+UQLP2wYK3x4Rc9zMEE5UGTAXg==',
    signature:
      'MEUCIDFr3HOvRT2JzgeEFjsfRAKQk3PYAialWBKH-fsH2nrJAiEAlCCVmi3ZBCCUsRP_Tm7zPWVkR0NXyRAJv1g5FK_6hk0',
    hardwareAttestation: 'present-unverified',
  }
  const REAL_CAPTURE_EXPECTED = {
    taskDigestMultibase: REAL_CAPTURE.taskDigestMultibase,
    challenge: REAL_CAPTURE.challenge,
    sensorNonce: REAL_CAPTURE.sensorNonce,
    sensorDid: REAL_CAPTURE.sensorDid,
  }

  test('verifies (SPKI-wrapped public key, DER high-S signature)', () => {
    expect(verifyTranscript(REAL_CAPTURE, REAL_CAPTURE_EXPECTED)).toEqual({ ok: true })
  })

  test('a single tampered byte in the real capture is still rejected', () => {
    const tampered = { ...REAL_CAPTURE, signature: REAL_CAPTURE.signature.slice(0, -4) + 'XXXX' }
    expect(verifyTranscript(tampered, REAL_CAPTURE_EXPECTED)).toEqual({ ok: false, reason: 'transcriptSignatureInvalid' })
  })
})
