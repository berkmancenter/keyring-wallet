/**
 * `getOrFetchAttestation`'s two "is this chain for our key?" guards used to
 * read `held.publicKey && held.publicKey !== publicKey` /
 * `attestation.publicKey && attestation.publicKey !== publicKey` — an
 * empty-string reported public key is falsy, so `&&` short-circuited BEFORE
 * the mismatch check ever ran, and the empty-key case fell through to
 * "matches", vouching for a signature with a chain that doesn't actually
 * certify the requested key. Reachable via the native fetch path: iOS can
 * return a non-empty certificate chain alongside an empty parsed public key
 * on a leaf-parse failure (`Attestation.mm`).
 *
 * Tested through the public `buildEvidenceFromSignature` API — the guards
 * themselves are private — via `getCachedHardwareKeyAttestation` (the
 * `afterSignature` / "held" guard) and `getHardwareKeyAttestation` (the
 * fetch guard).
 */
jest.mock('@bifold/react-native-attestation', () => ({
  getCachedHardwareKeyAttestation: jest.fn(),
  getHardwareKeyAttestation: jest.fn(),
  isHardwareAttestationAvailable: jest.fn(),
}))

import {
  getCachedHardwareKeyAttestation,
  getHardwareKeyAttestation,
  isHardwareAttestationAvailable,
} from '@bifold/react-native-attestation'

import { HardwareEvidenceBuilder, type AttestationCache } from './evidence'
import type { HardwareSigningResult } from './types'

const mockGetCached = getCachedHardwareKeyAttestation as jest.Mock
const mockGetFetched = getHardwareKeyAttestation as jest.Mock
const mockIsAvailable = isHardwareAttestationAvailable as jest.Mock

const REQUESTED_KEY = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAErequested'
const CHAIN = ['-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----']

function signingResult(): HardwareSigningResult {
  return {
    success: true,
    signature: {
      publicKey: REQUESTED_KEY,
      signature: 'sig',
      platform: 'ios',
      keyStorage: 'secure-enclave',
      authenticationMethod: 'biometric',
    },
  } as unknown as HardwareSigningResult
}

function noopCache(): AttestationCache {
  return { find: jest.fn().mockResolvedValue(null), save: jest.fn().mockResolvedValue(undefined) }
}

describe('HardwareEvidenceBuilder — empty/missing reported public key fails closed', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('the "held" (afterSignature) guard: an empty reported publicKey is refused, not treated as a match', async () => {
    mockGetCached.mockResolvedValue({
      success: true,
      publicKey: '', // native leaf-parse failure: chain present, key empty
      certificateChain: CHAIN,
    })

    const builder = new HardwareEvidenceBuilder({ cache: noopCache() })
    const result = await builder.buildEvidenceFromSignature(signingResult())

    expect(result.hasAttestation).toBe(false)
    expect(result.attestationSource).toBe('none')
    // Must NOT be the success path that would pair this chain with our key.
    expect(result.evidence?.attestation.certificateChain ?? []).toHaveLength(0)
  })

  test('the "held" guard still works for an ACTUAL key mismatch (regression guard)', async () => {
    mockGetCached.mockResolvedValue({
      success: true,
      publicKey: 'some-other-key',
      certificateChain: CHAIN,
    })

    const builder = new HardwareEvidenceBuilder({ cache: noopCache() })
    const result = await builder.buildEvidenceFromSignature(signingResult())

    expect(result.hasAttestation).toBe(false)
    expect(result.attestationSource).toBe('none')
  })

  test('the "held" guard passes a genuinely matching key through as a real match', async () => {
    mockGetCached.mockResolvedValue({
      success: true,
      publicKey: REQUESTED_KEY,
      certificateChain: CHAIN,
    })

    const builder = new HardwareEvidenceBuilder({ cache: noopCache() })
    const result = await builder.buildEvidenceFromSignature(signingResult())

    expect(result.hasAttestation).toBe(true)
    expect(result.attestationSource).toBe('cached')
    expect(result.evidence?.attestation.certificateChain).toEqual(CHAIN)
  })

  test('the fetch guard: an empty reported publicKey from a fresh fetch is refused, not treated as a match', async () => {
    mockGetCached.mockResolvedValue(null) // nothing held — falls through to the fetch path
    mockIsAvailable.mockResolvedValue(true)
    mockGetFetched.mockResolvedValue({
      success: true,
      publicKey: '', // same native leaf-parse failure, on the fetch path
      certificateChain: CHAIN,
    })

    const builder = new HardwareEvidenceBuilder({ cache: noopCache() })
    const result = await builder.buildEvidenceFromSignature(signingResult())

    expect(result.hasAttestation).toBe(false)
    expect(result.attestationSource).toBe('none')
    expect(result.evidence?.attestation.certificateChain ?? []).toHaveLength(0)
  })

  test('the fetch guard passes a genuinely matching key through as a real match', async () => {
    mockGetCached.mockResolvedValue(null)
    mockIsAvailable.mockResolvedValue(true)
    mockGetFetched.mockResolvedValue({
      success: true,
      publicKey: REQUESTED_KEY,
      certificateChain: CHAIN,
    })

    const builder = new HardwareEvidenceBuilder({ cache: noopCache() })
    const result = await builder.buildEvidenceFromSignature(signingResult())

    expect(result.hasAttestation).toBe(true)
    expect(result.attestationSource).toBe('fetched')
    expect(result.evidence?.attestation.certificateChain).toEqual(CHAIN)
  })
})
