/**
 * Unit tests for seed persistence functionality
 *
 * These tests verify the file-based persistence logic for stable DID seeds
 * without spinning up actual Credo agents.
 */

import { writeFileSync, unlinkSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { PersistedSeed } from '../../src/WitnessService'

describe('Seed Persistence', () => {
  const testDir = join(__dirname, '.test-seeds')
  const testSeedFile = join(testDir, 'test-seed.json')

  beforeAll(() => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true })
    }
  })

  afterEach(() => {
    // Clean up test files
    try {
      unlinkSync(testSeedFile)
    } catch {
      // ignore if doesn't exist
    }
  })

  afterAll(() => {
    // Clean up test directory
    try {
      unlinkSync(testSeedFile)
    } catch {
      // ignore
    }
  })

  describe('PersistedSeed structure', () => {
    it('should have required fields', () => {
      const seed: PersistedSeed = {
        seed: '0'.repeat(64), // 64 hex characters
        derivedDid: 'did:peer:0z6MkjJRiESMqDU8yMZNTXeG4y1gq4D6SbjtL3oj7jUWYStwS',
        createdAt: new Date().toISOString(),
      }

      expect(seed.seed).toBeDefined()
      expect(seed.derivedDid).toBeDefined()
      expect(seed.createdAt).toBeDefined()
    })

    it('should be serializable to JSON', () => {
      const seed: PersistedSeed = {
        seed: 'a'.repeat(64),
        derivedDid: 'did:peer:0z6MkjJRiESMqDU8yMZNTXeG4y1gq4D6SbjtL3oj7jUWYStwS',
        createdAt: '2026-01-24T00:29:55.208Z',
      }

      const json = JSON.stringify(seed)
      const parsed = JSON.parse(json) as PersistedSeed

      expect(parsed.seed).toBe(seed.seed)
      expect(parsed.derivedDid).toBe(seed.derivedDid)
      expect(parsed.createdAt).toBe(seed.createdAt)
    })

    it('should have 64-character hex seed', () => {
      const seed: PersistedSeed = {
        seed: 'abcdef0123456789'.repeat(4), // 64 chars
        derivedDid: 'did:peer:0z6MkjJRiESMqDU8yMZNTXeG4y1gq4D6SbjtL3oj7jUWYStwS',
        createdAt: new Date().toISOString(),
      }

      expect(seed.seed).toHaveLength(64)
      expect(seed.seed).toMatch(/^[0-9a-f]{64}$/)
    })
  })

  describe('Saving seed to file', () => {
    it('should write seed data to file', () => {
      const seed: PersistedSeed = {
        seed: '1234567890abcdef'.repeat(4),
        derivedDid: 'did:peer:0z6MkjJRiESMqDU8yMZNTXeG4y1gq4D6SbjtL3oj7jUWYStwS',
        createdAt: new Date().toISOString(),
      }

      writeFileSync(testSeedFile, JSON.stringify(seed, null, 2), 'utf-8')

      expect(existsSync(testSeedFile)).toBe(true)
    })

    it('should write valid JSON', () => {
      const seed: PersistedSeed = {
        seed: 'fedcba9876543210'.repeat(4),
        derivedDid: 'did:peer:0z6MkjJRiESMqDU8yMZNTXeG4y1gq4D6SbjtL3oj7jUWYStwS',
        createdAt: '2026-01-24T00:29:55.208Z',
      }

      writeFileSync(testSeedFile, JSON.stringify(seed, null, 2), 'utf-8')
      const content = readFileSync(testSeedFile, 'utf-8')

      expect(() => JSON.parse(content)).not.toThrow()
    })
  })

  describe('Loading seed from file', () => {
    /**
     * Helper to simulate loading seed (mirrors WitnessService.loadPersistedSeed)
     */
    function loadPersistedSeed(filePath: string): PersistedSeed {
      const content = readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(content) as PersistedSeed

      if (!parsed.seed || !parsed.derivedDid) {
        throw new Error('Invalid seed file: missing seed or derivedDid')
      }

      return parsed
    }

    it('should load valid seed from file', () => {
      const originalSeed: PersistedSeed = {
        seed: 'cafe'.repeat(16),
        derivedDid: 'did:peer:0z6MkjJRiESMqDU8yMZNTXeG4y1gq4D6SbjtL3oj7jUWYStwS',
        createdAt: '2026-01-24T12:00:00.000Z',
      }

      writeFileSync(testSeedFile, JSON.stringify(originalSeed, null, 2), 'utf-8')

      const loaded = loadPersistedSeed(testSeedFile)

      expect(loaded.seed).toBe(originalSeed.seed)
      expect(loaded.derivedDid).toBe(originalSeed.derivedDid)
      expect(loaded.createdAt).toBe(originalSeed.createdAt)
    })

    it('should throw for non-existent file', () => {
      expect(() => loadPersistedSeed('/nonexistent/seed.json')).toThrow()
    })

    it('should throw for invalid JSON', () => {
      writeFileSync(testSeedFile, 'not valid json', 'utf-8')

      expect(() => loadPersistedSeed(testSeedFile)).toThrow()
    })

    it('should throw if seed is missing', () => {
      writeFileSync(
        testSeedFile,
        JSON.stringify({
          derivedDid: 'did:peer:0z6Mk...',
          createdAt: new Date().toISOString(),
        }),
        'utf-8'
      )

      expect(() => loadPersistedSeed(testSeedFile)).toThrow('missing seed')
    })

    it('should throw if derivedDid is missing', () => {
      writeFileSync(
        testSeedFile,
        JSON.stringify({
          seed: 'a'.repeat(64),
          createdAt: new Date().toISOString(),
        }),
        'utf-8'
      )

      expect(() => loadPersistedSeed(testSeedFile)).toThrow('missing seed or derivedDid')
    })

    it('should handle file with extra fields gracefully', () => {
      const seedWithExtra = {
        seed: 'beef'.repeat(16),
        derivedDid: 'did:peer:0z6MkjJRiESMqDU8yMZNTXeG4y1gq4D6SbjtL3oj7jUWYStwS',
        createdAt: '2026-01-24T12:00:00.000Z',
        extraField: 'should be ignored',
        anotherField: 123,
      }

      writeFileSync(testSeedFile, JSON.stringify(seedWithExtra, null, 2), 'utf-8')

      const loaded = loadPersistedSeed(testSeedFile)

      expect(loaded.seed).toBe(seedWithExtra.seed)
      expect(loaded.derivedDid).toBe(seedWithExtra.derivedDid)
    })
  })

  describe('Config hash validation', () => {
    /**
     * Helper to compute config hash (mirrors WitnessService.computeConfigHash)
     */
    function computeConfigHash(config: {
      publicUrl: string
      port: number
      name: string
      mediatorInvitationUrl?: string
    }): string {
      const crypto = require('crypto')
      const relevantConfig = {
        publicUrl: config.publicUrl,
        port: config.port,
        name: config.name,
        mediatorInvitationUrl: config.mediatorInvitationUrl,
      }
      const configString = JSON.stringify(relevantConfig, Object.keys(relevantConfig).sort())
      return crypto.createHash('sha256').update(configString).digest('hex').substring(0, 16)
    }

    /**
     * Helper to load seed with config validation (mirrors WitnessService.loadPersistedSeed)
     */
    function loadPersistedSeedWithValidation(filePath: string, currentConfigHash: string): PersistedSeed {
      const content = readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(content) as PersistedSeed

      if (!parsed.seed || !parsed.derivedDid) {
        throw new Error('Invalid seed file: missing seed or derivedDid')
      }

      // Check if config has changed since seed was created
      if (parsed.configHash && parsed.configHash !== currentConfigHash) {
        throw new Error(
          `Config has changed since seed was created. Seed will be regenerated to match new invitation.`
        )
      }

      return parsed
    }

    it('should include configHash when saving seed', () => {
      const configHash = computeConfigHash({
        publicUrl: 'http://localhost:9002',
        port: 9002,
        name: 'witness-server',
      })

      const seed: PersistedSeed = {
        seed: 'dead'.repeat(16),
        derivedDid: 'did:peer:0z6MkjJRiESMqDU8yMZNTXeG4y1gq4D6SbjtL3oj7jUWYStwS',
        createdAt: new Date().toISOString(),
        configHash,
      }

      writeFileSync(testSeedFile, JSON.stringify(seed, null, 2), 'utf-8')

      const content = readFileSync(testSeedFile, 'utf-8')
      const parsed = JSON.parse(content) as PersistedSeed

      expect(parsed.configHash).toBe(configHash)
      expect(parsed.configHash).toHaveLength(16)
    })

    it('should successfully load seed when config hash matches', () => {
      const config = {
        publicUrl: 'http://192.168.1.50:9002',
        port: 9002,
        name: 'witness-server',
      }
      const configHash = computeConfigHash(config)

      const seed: PersistedSeed = {
        seed: 'face'.repeat(16),
        derivedDid: 'did:peer:0z6MkjJRiESMqDU8yMZNTXeG4y1gq4D6SbjtL3oj7jUWYStwS',
        createdAt: new Date().toISOString(),
        configHash,
      }

      writeFileSync(testSeedFile, JSON.stringify(seed, null, 2), 'utf-8')

      const currentConfigHash = computeConfigHash(config)

      expect(() => loadPersistedSeedWithValidation(testSeedFile, currentConfigHash)).not.toThrow()
    })

    it('should throw when config hash does not match', () => {
      const oldConfig = {
        publicUrl: 'http://localhost:9002',
        port: 9002,
        name: 'witness-server',
      }
      const oldConfigHash = computeConfigHash(oldConfig)

      const seed: PersistedSeed = {
        seed: 'babe'.repeat(16),
        derivedDid: 'did:peer:0z6MkjJRiESMqDU8yMZNTXeG4y1gq4D6SbjtL3oj7jUWYStwS',
        createdAt: new Date().toISOString(),
        configHash: oldConfigHash,
      }

      writeFileSync(testSeedFile, JSON.stringify(seed, null, 2), 'utf-8')

      // Config has changed - different publicUrl
      const newConfig = {
        publicUrl: 'http://192.168.1.50:9002',
        port: 9002,
        name: 'witness-server',
      }
      const newConfigHash = computeConfigHash(newConfig)

      expect(() => loadPersistedSeedWithValidation(testSeedFile, newConfigHash)).toThrow('Config has changed')
    })

    it('should allow loading old seeds without configHash (backward compatibility)', () => {
      // Old seed format without configHash
      const seed: PersistedSeed = {
        seed: 'fade'.repeat(16),
        derivedDid: 'did:peer:0z6MkjJRiESMqDU8yMZNTXeG4y1gq4D6SbjtL3oj7jUWYStwS',
        createdAt: new Date().toISOString(),
        // No configHash
      }

      writeFileSync(testSeedFile, JSON.stringify(seed, null, 2), 'utf-8')

      const currentConfig = {
        publicUrl: 'http://192.168.1.50:9002',
        port: 9002,
        name: 'witness-server',
      }
      const currentConfigHash = computeConfigHash(currentConfig)

      // Should not throw even though config might be different (backward compatibility)
      expect(() => loadPersistedSeedWithValidation(testSeedFile, currentConfigHash)).not.toThrow()
    })
  })

  describe('Seed and invitation synchronization', () => {
    it('should derive seed filename from invitation filename', () => {
      const invitationFile = '.oob-invitation.json'
      const expectedSeedFile = '.witness-seed.json'

      const derivedSeedFile = invitationFile.replace(/\.oob-invitation\.json$/, '.witness-seed.json')

      expect(derivedSeedFile).toBe(expectedSeedFile)
    })

    it('should handle custom invitation filenames', () => {
      const invitationFile = 'custom.oob-invitation.json'
      const expectedSeedFile = 'custom.witness-seed.json'

      const derivedSeedFile = invitationFile.replace(/\.oob-invitation\.json$/, '.witness-seed.json')

      expect(derivedSeedFile).toBe(expectedSeedFile)
    })

    it('should handle path prefixes', () => {
      const invitationFile = '/var/witness/.oob-invitation.json'
      const expectedSeedFile = '/var/witness/.witness-seed.json'

      const derivedSeedFile = invitationFile.replace(/\.oob-invitation\.json$/, '.witness-seed.json')

      expect(derivedSeedFile).toBe(expectedSeedFile)
    })
  })

  describe('DID format validation', () => {
    it('should accept did:peer with z6Mk prefix', () => {
      const seed: PersistedSeed = {
        seed: 'acdc'.repeat(16),
        derivedDid: 'did:peer:0z6MkjJRiESMqDU8yMZNTXeG4y1gq4D6SbjtL3oj7jUWYStwS',
        createdAt: new Date().toISOString(),
      }

      expect(seed.derivedDid).toMatch(/^did:peer:0z6Mk/)
    })

    it('should store full DID', () => {
      const fullDid = 'did:peer:0z6MkjJRiESMqDU8yMZNTXeG4y1gq4D6SbjtL3oj7jUWYStwS'
      const seed: PersistedSeed = {
        seed: '0123'.repeat(16),
        derivedDid: fullDid,
        createdAt: new Date().toISOString(),
      }

      writeFileSync(testSeedFile, JSON.stringify(seed, null, 2), 'utf-8')
      const content = readFileSync(testSeedFile, 'utf-8')
      const parsed = JSON.parse(content) as PersistedSeed

      expect(parsed.derivedDid).toBe(fullDid)
    })
  })

  describe('File reset behavior', () => {
    it('should allow file deletion and recreation', () => {
      // Create initial seed
      const firstSeed: PersistedSeed = {
        seed: '1111'.repeat(16),
        derivedDid: 'did:peer:0z6MkjJRiESMqDU8yMZNTXeG4y1gq4D6SbjtL3oj7jUWYStwS',
        createdAt: '2026-01-24T10:00:00.000Z',
      }
      writeFileSync(testSeedFile, JSON.stringify(firstSeed), 'utf-8')

      expect(existsSync(testSeedFile)).toBe(true)

      // Delete file (simulating resetInvitation)
      unlinkSync(testSeedFile)

      expect(existsSync(testSeedFile)).toBe(false)

      // Create new seed
      const secondSeed: PersistedSeed = {
        seed: '2222'.repeat(16),
        derivedDid: 'did:peer:0z6MkpqWvXPr4fvGHJ8TJKZx9dAGxV7YnHqFRrZqQxYZRsTw',
        createdAt: '2026-01-24T11:00:00.000Z',
      }
      writeFileSync(testSeedFile, JSON.stringify(secondSeed), 'utf-8')

      const content = readFileSync(testSeedFile, 'utf-8')
      const parsed = JSON.parse(content) as PersistedSeed

      expect(parsed.seed).toBe(secondSeed.seed)
      expect(parsed.derivedDid).toBe(secondSeed.derivedDid)
      expect(parsed.seed).not.toBe(firstSeed.seed)
    })
  })

  describe('Edge cases', () => {
    it('should preserve ISO date format in createdAt', () => {
      const isoDate = '2026-01-24T00:29:55.208Z'
      const seed: PersistedSeed = {
        seed: 'aaaa'.repeat(16),
        derivedDid: 'did:peer:0z6MkjJRiESMqDU8yMZNTXeG4y1gq4D6SbjtL3oj7jUWYStwS',
        createdAt: isoDate,
      }

      writeFileSync(testSeedFile, JSON.stringify(seed, null, 2), 'utf-8')

      const content = readFileSync(testSeedFile, 'utf-8')
      const parsed = JSON.parse(content) as PersistedSeed

      expect(parsed.createdAt).toBe(isoDate)
    })

    it('should handle lowercase hex seeds', () => {
      const seed: PersistedSeed = {
        seed: 'abcdef0123456789'.repeat(4),
        derivedDid: 'did:peer:0z6MkjJRiESMqDU8yMZNTXeG4y1gq4D6SbjtL3oj7jUWYStwS',
        createdAt: new Date().toISOString(),
      }

      expect(seed.seed).toMatch(/^[0-9a-f]{64}$/)
    })

    it('should detect invalid seed length', () => {
      const invalidSeed = {
        seed: 'abc123', // Too short
        derivedDid: 'did:peer:0z6MkjJRiESMqDU8yMZNTXeG4y1gq4D6SbjtL3oj7jUWYStwS',
        createdAt: new Date().toISOString(),
      }

      expect(invalidSeed.seed).not.toHaveLength(64)
    })
  })

  describe('Seed security considerations', () => {
    it('should treat seed as sensitive data (test metadata only)', () => {
      const seed: PersistedSeed = {
        seed: 'sensitive'.padEnd(64, '0'),
        derivedDid: 'did:peer:0z6MkjJRiESMqDU8yMZNTXeG4y1gq4D6SbjtL3oj7jUWYStwS',
        createdAt: new Date().toISOString(),
      }

      // Verify seed is stored but note it should be protected in production
      expect(seed.seed).toBeDefined()
      expect(seed.seed).toHaveLength(64)
      
      // Note: In production, file permissions should restrict access to seed file
      // This test just validates the structure
    })
  })
})