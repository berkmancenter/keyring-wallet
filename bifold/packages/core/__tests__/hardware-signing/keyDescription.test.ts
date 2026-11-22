/**
 * An Android-attested key earns a hardware shield only if it needs its owner, enforced in secure hardware: read from
 * the key description of the very leaf the native verifier validated, and only after it did. The certificates are
 * throw-away ones carrying hand-built key descriptions (gen-key-description-certs.sh, beside this file).
 */
const mockVerifyHardwareEvidence = jest.fn()
jest.mock('@bifold/react-native-attestation', () => ({
  verifyHardwareEvidence: (...args: unknown[]) => mockVerifyHardwareEvidence(...args),
}))

import { contentHashBase64 } from '../../src/hardware-signing/binding'
import {
  isLeafNativeChecked,
  leafCheckRefusal,
  readLeaf,
  userAuthenticationRefusal,
} from '../../src/hardware-signing/keyDescription'
import type { HardwareAttestationEvidence } from '../../src/hardware-signing/types'
import { HardwareSignatureVerifier } from '../../src/hardware-signing/verify'
import {
  AUTH_REQUIRED,
  AUTH_REQUIRED_STRONGBOX,
  NO_AUTH_REQUIRED,
  NO_AUTH_REQUIRED_IN_SOFTWARE,
  SOFTWARE_LEVEL,
  USER_AUTH_MISSING,
  USER_AUTH_SOFTWARE_ONLY,
  USER_AUTH_ZERO,
  USER_AUTH_ENUMERATED,
  USER_AUTH_WRONG_TYPE,
  NO_EXTENSION,
  rawKeyOf,
  spkiOf,
} from './fixtures/keyDescriptionCerts'

describe('reading an Android key description', () => {
  test('the leaf’s key description: security level and both authorization lists', () => {
    const leaf = readLeaf(AUTH_REQUIRED)
    expect(leaf?.keyDescription?.securityLevel).toBe(1)
    expect(leaf?.keyDescription?.hardware.has(504)).toBe(true)
    expect(readLeaf(AUTH_REQUIRED_STRONGBOX)?.keyDescription?.securityLevel).toBe(2)
    // The raw key is the uncompressed P-256 point inside the SPKI.
    expect(readLeaf(AUTH_REQUIRED)?.rawKey).toHaveLength(65)
  })

  test('a key that needs its owner, enforced in a TEE or StrongBox, is accepted', () => {
    expect(userAuthenticationRefusal(readLeaf(AUTH_REQUIRED))).toBeUndefined()
    expect(userAuthenticationRefusal(readLeaf(AUTH_REQUIRED_STRONGBOX))).toBeUndefined()
  })

  test('a user auth type written as ENUMERATED is read like an INTEGER, as devices have been seen to do', () => {
    expect(userAuthenticationRefusal(readLeaf(USER_AUTH_ENUMERATED))).toBeUndefined()
  })

  test.each([
    ['attested in software only', SOFTWARE_LEVEL],
    ['no authentication required (hardware list)', NO_AUTH_REQUIRED],
    ['no authentication required (software list), even beside a user auth type', NO_AUTH_REQUIRED_IN_SOFTWARE],
    ['no user auth type', USER_AUTH_MISSING],
    ['a user auth type of zero', USER_AUTH_ZERO],
    ['a user auth type in the software list only', USER_AUTH_SOFTWARE_ONLY],
    ['a user auth type that is not a number', USER_AUTH_WRONG_TYPE],
    ['no key description at all', NO_EXTENSION],
    ['not a certificate', '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----'],
  ])('a key %s is refused', (_label, pem) => {
    expect(userAuthenticationRefusal(readLeaf(pem))).toEqual(expect.any(String))
  })

  test('the leaf read is bound to the one native reported, in either platform’s form', () => {
    const leaf = readLeaf(AUTH_REQUIRED)!
    expect(isLeafNativeChecked(leaf, spkiOf(AUTH_REQUIRED))).toBe(true) // Android: SPKI
    expect(isLeafNativeChecked(leaf, rawKeyOf(AUTH_REQUIRED))).toBe(true) // iOS: the raw key
    expect(isLeafNativeChecked(leaf, spkiOf(NO_AUTH_REQUIRED))).toBe(false)
    expect(isLeafNativeChecked(leaf, '')).toBe(false)
    expect(isLeafNativeChecked(leaf, undefined)).toBe(false)
  })

  test('a leaf that cannot be tied to native’s says which of three ways, and one that can says nothing', () => {
    const leaf = readLeaf(AUTH_REQUIRED)!
    expect(leafCheckRefusal(undefined, spkiOf(AUTH_REQUIRED))).toMatch(/could not be read/)
    expect(leafCheckRefusal(leaf, undefined)).toMatch(/reported no certificate key/)
    expect(leafCheckRefusal(leaf, '')).toMatch(/reported no certificate key/)
    expect(leafCheckRefusal(leaf, spkiOf(NO_AUTH_REQUIRED))).toMatch(/not the certificate verified/)
    expect(leafCheckRefusal(leaf, spkiOf(AUTH_REQUIRED))).toBeUndefined()
  })
})

describe('what the verifier says of an Android-attested card', () => {
  const content = JSON.stringify({ type: ['VerifiableCredential'], issuer: 'did:peer:x' })
  const evidence = (
    leaf: string,
    format: 'android-key-attestation-v3' | 'apple-appattest-v1' = 'android-key-attestation-v3'
  ): HardwareAttestationEvidence => ({
    id: 'urn:uuid:e',
    type: ['BiometricAttestation', 'HardwareKeyAttestation'],
    created: '2026-10-25T00:00:00.000Z',
    biometricMethod: { type: 'Fingerprint', authenticatorType: 'platform', userVerification: 'required' },
    hardwareBinding: {
      keyStorage: 'StrongBox',
      platform: 'android',
      keyType: 'EC-P256',
      algorithm: 'ECDSA-SHA256',
      publicKey: 'cHVi',
    },
    attestation: { format, certificateChain: [leaf, 'intermediate', 'root'] },
    signature: { value: 'c2ln', algorithm: 'ECDSA-SHA256', signedContentHash: contentHashBase64(content) },
  })
  const native = (valid: boolean, leafPublicKeyBase64?: string) => ({
    valid,
    certificateChainValid: valid,
    publicKeyMatchesLeafCert: valid,
    signatureValid: valid,
    leafPublicKeyBase64,
    errors: valid ? [] : ['chain did not validate'],
  })
  const silent = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const verify = (e: HardwareAttestationEvidence) => new HardwareSignatureVerifier(silent).verifyEvidence(e, content)

  beforeEach(() => mockVerifyHardwareEvidence.mockReset())

  test('a key that needs its owner keeps its shield, whichever form native reports its key in', async () => {
    mockVerifyHardwareEvidence.mockResolvedValue(native(true, spkiOf(AUTH_REQUIRED)))
    expect((await verify(evidence(AUTH_REQUIRED))).valid).toBe(true)
    mockVerifyHardwareEvidence.mockResolvedValue(native(true, rawKeyOf(AUTH_REQUIRED)))
    expect((await verify(evidence(AUTH_REQUIRED))).valid).toBe(true)
  })

  test('a key that needs no authentication loses it, though native validated the chain', async () => {
    mockVerifyHardwareEvidence.mockResolvedValue(native(true, spkiOf(NO_AUTH_REQUIRED)))
    const result = await verify(evidence(NO_AUTH_REQUIRED))
    expect(result.valid).toBe(false)
    expect(result.details.verificationLevel).toBe('none')
    expect(result.error).toMatch(/no user authentication/)
  })

  test('a key description read from a certificate other than the one native validated is refused', async () => {
    // The chain's first certificate is a good key, but native validated (and reports) a different leaf.
    mockVerifyHardwareEvidence.mockResolvedValue(native(true, spkiOf(NO_AUTH_REQUIRED)))
    const result = await verify(evidence(AUTH_REQUIRED))
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/not the certificate verified/)
  })

  test('native validating the chain but reporting no key is refused, and says so', async () => {
    mockVerifyHardwareEvidence.mockResolvedValue(native(true, undefined))
    const result = await verify(evidence(AUTH_REQUIRED))
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/reported no certificate key/)
  })

  test('a first certificate that cannot be read is refused, and says so', async () => {
    mockVerifyHardwareEvidence.mockResolvedValue(native(true, spkiOf(AUTH_REQUIRED)))
    const result = await verify(evidence('not a certificate'))
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/could not be read/)
  })

  test('a chain native refused is never read: its own failure stands', async () => {
    mockVerifyHardwareEvidence.mockResolvedValue(native(false))
    const result = await verify(evidence('not a certificate'))
    expect(result.valid).toBe(false)
    expect(result.error).toBe('chain did not validate')
  })

  test('an iPhone-attested card is not read for an Android key description', async () => {
    mockVerifyHardwareEvidence.mockResolvedValue(native(true, 'aW9z'))
    expect((await verify(evidence('not an android leaf', 'apple-appattest-v1'))).valid).toBe(true)
  })
})
