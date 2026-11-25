/**
 * The chain of a hardware-signed card is checked as it stood when the card was signed, and that time comes only
 * from the signed content. An App Attest leaf certificate lasts about 72 hours; checking it against today's date
 * made every iPhone-signed card fail three days after it was made, on both platforms.
 *
 * The natives are mocked here: what is proven is what JS hands them (the date, and when nothing reaches them at
 * all). The certificates are throw-away ones with fixed windows (gen-signing-time-certs.sh, beside this file),
 * plus the real Apple App Attestation root as a control on the DER reader.
 */

const mockVerifyHardwareEvidence = jest.fn()
jest.mock('@bifold/react-native-attestation', () => ({
  verifyHardwareEvidence: (...args: unknown[]) => mockVerifyHardwareEvidence(...args),
}))

import { contentHashBase64 } from '../../src/hardware-signing/binding'
import {
  SIGNED_BEFORE_ATTESTATION_TOLERANCE_MS,
  certificateValidity,
  chainVerificationTime,
  signedTimeOf,
} from '../../src/hardware-signing/signingTime'
import type { HardwareAttestationEvidence } from '../../src/hardware-signing/types'
import { HardwareSignatureVerifier, verifySignedPayload } from '../../src/hardware-signing/verify'

const APPLE_APP_ATTESTATION_ROOT = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----`

const APP_ATTEST_LEAF = `-----BEGIN CERTIFICATE-----
MIIBTTCB9KADAgECAgIQADAKBggqhkjOPQQDAjAZMRcwFQYDVQQDDA5hcHBhdHRl
c3RfbGVhZjAeFw0yNjEwMjAxMDAwMDBaFw0yNjEwMjMxMDAwMDBaMBkxFzAVBgNV
BAMMDmFwcGF0dGVzdF9sZWFmMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAECY2Y
Q0ODg2D3ZTXqhP/EDkrS98Q2ik8iu1I6kjdqWhgfPjJe3CyPrJd9IEVBN6Z1ffN8
Tzgdbu8BLPu+4TN0raMsMCowCQYDVR0TBAIwADAdBgNVHQ4EFgQURb/EeXX6dm/C
R2xAAvkio3T6qwcwCgYIKoZIzj0EAwIDSAAwRQIhAO+GMX5H0Y9qbeH8l5GOjIrR
0zj0bf+iPJTREhvlM9r/AiAC8UlbdcNk5JSjPz3YlRQ0kHBChiHz+oiw29lQs5Ml
ig==
-----END CERTIFICATE-----`

const GENERALIZED_TIME_CERT = `-----BEGIN CERTIFICATE-----
MIIBUjCB+qADAgECAgIQADAKBggqhkjOPQQDAjAbMRkwFwYDVQQDDBBnZW5lcmFs
aXplZF90aW1lMCAXDTQ5MTIzMTAwMDAwMFoYDzIwNTEwMTAxMTIzNDU2WjAbMRkw
FwYDVQQDDBBnZW5lcmFsaXplZF90aW1lMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcD
QgAEv9dW0OGgarlInjxHkoHImtfX8Ayo/gaqXvD2pczJy+RS/qpu2MbGBsAKgHjl
Q5MJo74lnSCHR1tTuSIuR2puQ6MsMCowCQYDVR0TBAIwADAdBgNVHQ4EFgQUjG0M
lQ+MuY5hK0U6PuERzeEPdoEwCgYIKoZIzj0EAwIDRwAwRAIgfWlFbuD2flj9p249
xOLQfcmDSqsLlln7bTlmEb39ZDACIFUxSH3vWk5Ond48+/E6Rh9acXjfdDYa99tR
RgRVqyux
-----END CERTIFICATE-----`

const HOUR = 60 * 60 * 1000
const at = (iso: string) => Date.parse(iso)
// APP_ATTEST_LEAF's window.
const NOT_BEFORE = at('2026-10-20T10:00:00Z')
const NOT_AFTER = at('2026-10-23T10:00:00Z')

const card = (validFrom: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential'],
    issuer: 'did:peer:x',
    validFrom,
    credentialSubject: { id: 'did:peer:s' },
    ...extra,
  })

const evidenceFor = (
  content: string,
  format: 'apple-appattest-v1' | 'android-key-attestation-v3' = 'apple-appattest-v1',
  created = '2030-01-01T00:00:00.000Z'
): HardwareAttestationEvidence => ({
  id: 'urn:uuid:e',
  type: ['BiometricAttestation', 'HardwareKeyAttestation'],
  // Deliberately unlike any signed time: the evidence block is not signed, so it must never set the date.
  created,
  biometricMethod: { type: 'FaceID', authenticatorType: 'platform', userVerification: 'required' },
  hardwareBinding: {
    keyStorage: 'SecureEnclave',
    platform: 'ios',
    keyType: 'EC-P256',
    algorithm: 'ECDSA-SHA256',
    publicKey: 'cHVia2V5',
  },
  attestation: { format, certificateChain: [APP_ATTEST_LEAF, APPLE_APP_ATTESTATION_ROOT] },
  signature: { value: 'c2ln', algorithm: 'ECDSA-SHA256', signedContentHash: contentHashBase64(content) },
})

const nativeOk = { valid: true, certificateChainValid: true, publicKeyMatchesLeafCert: true, signatureValid: true }
const silent = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
const verifyAtPassed = () => mockVerifyHardwareEvidence.mock.calls[0][6]

describe('the signed time a card carries', () => {
  test('is its validFrom, or VC 1.1 issuanceDate, with validFrom first', () => {
    expect(signedTimeOf(card('2026-10-21T12:00:00.000Z'))).toBe(at('2026-10-21T12:00:00Z'))
    expect(signedTimeOf(JSON.stringify({ issuanceDate: '2026-10-21T12:00:00Z' }))).toBe(at('2026-10-21T12:00:00Z'))
    expect(
      signedTimeOf(JSON.stringify({ issuanceDate: '2020-01-01T00:00:00Z', validFrom: '2026-10-21T12:00:00+02:00' }))
    ).toBe(at('2026-10-21T10:00:00Z'))
  })

  test('is absent for anything else: a challenge, a zoneless date, a non-string, an array', () => {
    expect(signedTimeOf('login-challenge-1234')).toBeUndefined()
    expect(signedTimeOf(card('2026-10-21T12:00:00'))).toBeUndefined()
    expect(signedTimeOf(JSON.stringify({ validFrom: 1792500000000 }))).toBeUndefined()
    expect(signedTimeOf(JSON.stringify(['2026-10-21T12:00:00Z']))).toBeUndefined()
    expect(signedTimeOf(card('not a date Z'))).toBeUndefined()
  })
})

describe("a certificate's validity window", () => {
  test('reads the real Apple App Attestation root (control: dates as openssl reports them)', () => {
    expect(certificateValidity(APPLE_APP_ATTESTATION_ROOT)).toEqual({
      notBefore: at('2020-03-18T18:32:53Z'),
      notAfter: at('2045-03-15T00:00:00Z'),
    })
  })

  test('reads UTCTime and GeneralizedTime, either side of 2050', () => {
    expect(certificateValidity(APP_ATTEST_LEAF)).toEqual({ notBefore: NOT_BEFORE, notAfter: NOT_AFTER })
    expect(certificateValidity(GENERALIZED_TIME_CERT)).toEqual({
      notBefore: at('2049-12-31T00:00:00Z'),
      notAfter: at('2051-01-01T12:34:56Z'),
    })
  })

  test('is undefined for anything that is not a certificate', () => {
    expect(certificateValidity('c1')).toBeUndefined()
    expect(certificateValidity('')).toBeUndefined()
    expect(certificateValidity(APP_ATTEST_LEAF.slice(0, 120))).toBeUndefined()
  })
})

describe('when an App Attest chain is checked', () => {
  const chain = [APP_ATTEST_LEAF, APPLE_APP_ATTESTATION_ROOT]
  const timeFor = (validFrom: string) => chainVerificationTime(card(validFrom), chain, 'apple-appattest-v1')

  test('a card signed inside the leaf window is checked at its signed time', () => {
    expect(timeFor('2026-10-21T12:00:00Z')).toEqual({ ok: true, verifyAtMs: at('2026-10-21T12:00:00Z') })
  })

  test('the bound before the leaf is exactly the tolerance: at it passes (checked at notBefore), a second earlier fails', () => {
    expect(SIGNED_BEFORE_ATTESTATION_TOLERANCE_MS).toBe(HOUR)
    expect(timeFor('2026-10-20T09:00:00Z')).toEqual({ ok: true, verifyAtMs: NOT_BEFORE })
    expect(timeFor('2026-10-20T09:59:59Z')).toEqual({ ok: true, verifyAtMs: NOT_BEFORE })
    expect(timeFor('2026-10-20T08:59:59Z')).toMatchObject({ ok: false })
  })

  test('the bound after the leaf is its notAfter: at it passes, a second later fails', () => {
    expect(timeFor('2026-10-23T10:00:00Z')).toEqual({ ok: true, verifyAtMs: NOT_AFTER })
    const late = timeFor('2026-10-23T10:00:01Z')
    expect(late).toMatchObject({ ok: false })
    expect(late.ok === false && late.error).toMatch(/after the attestation certificate expired/)
  })

  test('content with no signed time is checked now, as before', () => {
    expect(chainVerificationTime('login-challenge-1234', chain, 'apple-appattest-v1')).toEqual({
      ok: true,
      verifyAtMs: 0,
    })
  })

  test('a leaf that cannot be read leaves the check at now, as before', () => {
    expect(chainVerificationTime(card('2026-10-21T12:00:00Z'), ['c1'], 'apple-appattest-v1')).toEqual({
      ok: true,
      verifyAtMs: 0,
    })
  })

  test("an Android chain is checked at the signed time, with no leaf window (its leaf's dates are key parameters)", () => {
    expect(chainVerificationTime(card('2019-01-01T00:00:00Z'), chain, 'android-key-attestation-v3')).toEqual({
      ok: true,
      verifyAtMs: at('2019-01-01T00:00:00Z'),
    })
  })
})

describe('what the verifier hands the native check', () => {
  let now: jest.SpyInstance
  beforeEach(() => {
    mockVerifyHardwareEvidence.mockReset().mockResolvedValue(nativeOk)
    // Every check here runs 80 hours after the card was signed, when the leaf has long expired.
    now = jest.spyOn(Date, 'now').mockReturnValue(at('2026-10-21T12:00:00Z') + 80 * HOUR)
  })
  afterEach(() => now.mockRestore())

  test('a card signed in the window and checked 80 hours later is checked at its signed time, not now', async () => {
    const content = card('2026-10-21T12:00:00Z')
    const result = await new HardwareSignatureVerifier(silent).verifyEvidence(evidenceFor(content), content)
    expect(result.valid).toBe(true)
    expect(verifyAtPassed()).toBe(at('2026-10-21T12:00:00Z'))
  })

  test("the evidence block's created time never sets the date", async () => {
    const content = card('2026-10-21T12:00:00Z')
    await new HardwareSignatureVerifier(silent).verifyEvidence(
      evidenceFor(content, 'apple-appattest-v1', '2026-10-22T09:00:00.000Z'),
      content
    )
    expect(verifyAtPassed()).toBe(at('2026-10-21T12:00:00Z'))
  })

  test('a card dated before its leaf (inside the tolerance) is checked at notBefore', async () => {
    const content = card('2026-10-20T09:30:00Z')
    await new HardwareSignatureVerifier(silent).verifyEvidence(evidenceFor(content), content)
    expect(verifyAtPassed()).toBe(NOT_BEFORE)
  })

  test.each([
    ['before notBefore − 1 h', '2026-10-20T08:59:59Z'],
    ['after notAfter', '2026-10-23T10:00:01Z'],
  ])('a card dated %s fails without reaching the native check', async (_label, validFrom) => {
    const content = card(validFrom)
    const result = await new HardwareSignatureVerifier(silent).verifyEvidence(evidenceFor(content), content)
    expect(result.valid).toBe(false)
    expect(result.details.certificateChainValid).toBe(false)
    expect(mockVerifyHardwareEvidence).not.toHaveBeenCalled()
  })

  test('content tampered to move its date fails without reaching the native check', async () => {
    const signed = card('2026-10-21T12:00:00Z')
    const tampered = card('2026-10-22T12:00:00Z')
    const result = await new HardwareSignatureVerifier(silent).verifyEvidence(evidenceFor(signed), tampered)
    expect(result.valid).toBe(false)
    expect(mockVerifyHardwareEvidence).not.toHaveBeenCalled()
  })

  test('a signed challenge (no date in it) is checked now, as before', async () => {
    const payload = 'login-challenge-1234'
    await verifySignedPayload({ payload, signedAt: '2030-01-01T00:00:00.000Z', evidence: evidenceFor(payload) }, silent)
    expect(verifyAtPassed()).toBe(0)
  })

  test('an Android card is checked at its signed time', async () => {
    const content = card('2026-10-21T12:00:00Z')
    await new HardwareSignatureVerifier(silent).verifyEvidence(
      evidenceFor(content, 'android-key-attestation-v3'),
      content
    )
    expect(verifyAtPassed()).toBe(at('2026-10-21T12:00:00Z'))
  })
})
