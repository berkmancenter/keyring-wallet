/**
 * LocalityService Unit Tests
 *
 * Tests for the co-locality verification service.
 * Proximity transport is decoupled via LocalityProvider. In tests we use
 * NullLocalityProvider (no-op); the real BLE implementation will plug in here.
 */

import { LocalityService, LocalityConfig, loadLocalityConfig } from '../../src/LocalityService'
import { NullLocalityProvider } from '../../src/LocalityProvider'

describe('LocalityService', () => {
  let service: LocalityService

  const enabledConfig: LocalityConfig = {
    enabled: true,
    challengeRotationMinutes: 5,
    proofLifetimeMinutes: 30,
  }

  const disabledConfig: LocalityConfig = {
    ...enabledConfig,
    enabled: false,
  }

  afterEach(async () => {
    if (service) {
      await service.stop()
    }
  })

  describe('Configuration', () => {
    it('should report enabled state correctly', () => {
      service = new LocalityService(enabledConfig)
      expect(service.isEnabled()).toBe(true)
    })

    it('should report disabled state correctly', () => {
      service = new LocalityService(disabledConfig)
      expect(service.isEnabled()).toBe(false)
    })

    it('should return config copy', () => {
      service = new LocalityService(enabledConfig)
      const config = service.getConfig()
      expect(config).toEqual(enabledConfig)
      expect(config).not.toBe(enabledConfig) // Should be a copy
    })
  })

  describe('Challenge Management', () => {
    it('should generate initial challenge on construction', () => {
      service = new LocalityService(enabledConfig)
      const challenge = service.getCurrentChallenge()
      expect(challenge).toBeDefined()
      expect(challenge).toHaveLength(64) // 32 bytes = 64 hex chars
    })

    it('should generate different challenges each time', () => {
      const service1 = new LocalityService(enabledConfig)
      const service2 = new LocalityService(enabledConfig)

      const challenge1 = service1.getCurrentChallenge()
      const challenge2 = service2.getCurrentChallenge()

      expect(challenge1).not.toBe(challenge2)

      service1.stop()
      service2.stop()
    })
  })

  describe('Challenge Verification', () => {
    beforeEach(() => {
      service = new LocalityService(enabledConfig)
    })

    it('should accept correct challenge and signature', async () => {
      const challenge = service.getCurrentChallenge()
      const result = await service.verifyLocality('did:test:123', challenge, 'test-signature')
      expect(result.success).toBe(true)
    })

    it('should reject incorrect challenge', async () => {
      const result = await service.verifyLocality(
        'did:test:123',
        'wrong-challenge-value',
        'test-signature'
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('does not match')
      }
    })

    it('should reject empty signature', async () => {
      const challenge = service.getCurrentChallenge()
      const result = await service.verifyLocality('did:test:123', challenge, '')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('Signature is required')
      }
    })
  })

  describe('Proof Management', () => {
    beforeEach(() => {
      service = new LocalityService(enabledConfig)
    })

    it('should store proof after successful verification', async () => {
      const did = 'did:test:alice'
      const challenge = service.getCurrentChallenge()

      // Initially no proof
      expect(service.hasValidProof(did)).toBe(false)

      // Verify
      await service.verifyLocality(did, challenge, 'test-signature')

      // Now has proof
      expect(service.hasValidProof(did)).toBe(true)
    })

    it('should return proof details', async () => {
      const did = 'did:test:alice'
      const challenge = service.getCurrentChallenge()

      await service.verifyLocality(did, challenge, 'test-signature')

      const proof = service.getValidProof(did)
      expect(proof).toBeDefined()
      expect(proof?.did).toBe(did)
      expect(proof?.challenge).toBe(challenge)
      expect(proof?.signature).toBe('test-signature')
      expect(proof?.verifiedAt).toBeInstanceOf(Date)
      expect(proof?.expiresAt).toBeInstanceOf(Date)
      expect(proof!.expiresAt.getTime()).toBeGreaterThan(proof!.verifiedAt.getTime())
    })

    it('should clear proof on request', async () => {
      const did = 'did:test:alice'
      const challenge = service.getCurrentChallenge()

      await service.verifyLocality(did, challenge, 'test-signature')
      expect(service.hasValidProof(did)).toBe(true)

      service.clearProof(did)
      expect(service.hasValidProof(did)).toBe(false)
    })

    it('should overwrite existing proof on re-verification', async () => {
      const did = 'did:test:alice'
      const challenge = service.getCurrentChallenge()

      await service.verifyLocality(did, challenge, 'signature-1')
      const proof1 = service.getValidProof(did)

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10))

      await service.verifyLocality(did, challenge, 'signature-2')
      const proof2 = service.getValidProof(did)

      expect(proof2?.signature).toBe('signature-2')
      expect(proof2!.verifiedAt.getTime()).toBeGreaterThanOrEqual(proof1!.verifiedAt.getTime())
    })
  })

  describe('Proof Expiration', () => {
    it('should expire proofs after configured lifetime', async () => {
      // Use short lifetime for testing
      const shortLifetimeConfig: LocalityConfig = {
        ...enabledConfig,
        proofLifetimeMinutes: 0.001, // ~60ms
      }
      service = new LocalityService(shortLifetimeConfig)

      const did = 'did:test:alice'
      const challenge = service.getCurrentChallenge()

      await service.verifyLocality(did, challenge, 'test-signature')
      expect(service.hasValidProof(did)).toBe(true)

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Proof should now be invalid
      expect(service.hasValidProof(did)).toBe(false)
      expect(service.getValidProof(did)).toBeUndefined()
    })
  })

  describe('Locality Evidence Building', () => {
    beforeEach(() => {
      service = new LocalityService(enabledConfig)
    })

    it('should return undefined when disabled', async () => {
      const disabledService = new LocalityService(disabledConfig)
      const evidence = disabledService.buildLocalityEvidence(['did:test:alice', 'did:test:bob'])
      expect(evidence).toBeUndefined()
    })

    it('should return undefined when participant lacks proof', async () => {
      const challenge = service.getCurrentChallenge()
      await service.verifyLocality('did:test:alice', challenge, 'sig-alice')

      // Bob has no proof
      const evidence = service.buildLocalityEvidence(['did:test:alice', 'did:test:bob'])
      expect(evidence).toBeUndefined()
    })

    it('should build evidence when all participants have proofs', async () => {
      const challenge = service.getCurrentChallenge()
      await service.verifyLocality('did:test:alice', challenge, 'sig-alice')
      await service.verifyLocality('did:test:bob', challenge, 'sig-bob')

      const evidence = service.buildLocalityEvidence(['did:test:alice', 'did:test:bob'])

      expect(evidence).toBeDefined()
      expect(evidence?.challenge).toBe(challenge)
      expect(evidence?.proofs).toHaveLength(2)
    })

    it('should include correct participant data in evidence', async () => {
      const challenge = service.getCurrentChallenge()
      await service.verifyLocality('did:test:alice', challenge, 'sig-alice')
      await service.verifyLocality('did:test:bob', challenge, 'sig-bob')

      const evidence = service.buildLocalityEvidence(['did:test:alice', 'did:test:bob'])

      const aliceProof = evidence?.proofs.find((p) => p.did === 'did:test:alice')
      const bobProof = evidence?.proofs.find((p) => p.did === 'did:test:bob')

      expect(aliceProof).toBeDefined()
      expect(aliceProof?.sig).toBe('sig-alice')
      expect(bobProof).toBeDefined()
      expect(bobProof?.sig).toBe('sig-bob')
    })
  })

  describe('Service Lifecycle', () => {
    it('should skip start when disabled', async () => {
      service = new LocalityService(disabledConfig)
      await service.start()

      // Should still work for challenge generation
      expect(service.getCurrentChallenge()).toBeDefined()
    })

    it('should start and stop cleanly', async () => {
      service = new LocalityService(enabledConfig)
      await service.start()
      await service.stop()

      // Should not throw
      expect(true).toBe(true)
    })

    it('should accept an explicit NullLocalityProvider (default for tests)', async () => {
      // NullLocalityProvider is the stand-in until Bluetooth BLE is implemented.
      // It is a no-op: it does not advertise the challenge or report proof callbacks.
      const provider = new NullLocalityProvider()
      service = new LocalityService(enabledConfig, provider)

      expect(provider.name).toBe('null')

      await service.start()
      await service.stop()

      // Service still works for challenge management
      expect(service.getCurrentChallenge()).toBeDefined()
    })

    it('should default to NullLocalityProvider when none is given', async () => {
      // Passing no provider is equivalent to NullLocalityProvider
      service = new LocalityService(enabledConfig)
      await service.start()

      const challenge = service.getCurrentChallenge()
      expect(challenge).toBeDefined()
      expect(challenge).toHaveLength(64)
    })
  })
})

describe('loadLocalityConfig', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('should return default values when no env vars set', () => {
    delete process.env.WITNESS_LOCALITY_ENABLED
    delete process.env.WITNESS_LOCALITY_PROOF_LIFETIME_MINUTES
    delete process.env.WITNESS_LOCALITY_CHALLENGE_ROTATION_MINUTES

    const config = loadLocalityConfig()

    expect(config.enabled).toBe(true) // Enabled by default
    expect(config.proofLifetimeMinutes).toBe(30)
    expect(config.challengeRotationMinutes).toBe(5)
  })

  it('should load values from env vars', () => {
    process.env.WITNESS_LOCALITY_ENABLED = 'true'
    process.env.WITNESS_LOCALITY_PROOF_LIFETIME_MINUTES = '60'
    process.env.WITNESS_LOCALITY_CHALLENGE_ROTATION_MINUTES = '10'

    const config = loadLocalityConfig()

    expect(config.enabled).toBe(true)
    expect(config.proofLifetimeMinutes).toBe(60)
    expect(config.challengeRotationMinutes).toBe(10)
  })

  it('should handle WITNESS_LOCALITY_ENABLED=false explicitly', () => {
    process.env.WITNESS_LOCALITY_ENABLED = 'false'

    const config = loadLocalityConfig()
    expect(config.enabled).toBe(false)
  })
})
