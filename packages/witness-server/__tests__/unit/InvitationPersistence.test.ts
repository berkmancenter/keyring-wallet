/**
 * Unit tests for invitation persistence functionality
 *
 * These tests verify the file-based persistence logic for stable invitation URLs
 * without spinning up actual Credo agents.
 */

import { writeFileSync, unlinkSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { PersistedInvitation } from '../../src/WitnessService'

describe('Invitation Persistence', () => {
  const testDir = join(__dirname, '.test-invitations')
  const testInvitationFile = join(testDir, 'test-invitation.json')

  beforeAll(() => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true })
    }
  })

  afterEach(() => {
    // Clean up test files
    try {
      unlinkSync(testInvitationFile)
    } catch {
      // ignore if doesn't exist
    }
  })

  afterAll(() => {
    // Clean up test directory
    try {
      unlinkSync(testInvitationFile)
    } catch {
      // ignore
    }
  })

  describe('PersistedInvitation structure', () => {
    it('should have required fields', () => {
      const invitation: PersistedInvitation = {
        invitationUrl: 'http://localhost:9002?oob=abc123',
        outOfBandId: 'oob-id-123',
        createdAt: new Date().toISOString(),
      }

      expect(invitation.invitationUrl).toBeDefined()
      expect(invitation.outOfBandId).toBeDefined()
      expect(invitation.createdAt).toBeDefined()
    })

    it('should be serializable to JSON', () => {
      const invitation: PersistedInvitation = {
        invitationUrl: 'http://localhost:9002?oob=abc123',
        outOfBandId: 'oob-id-123',
        createdAt: '2026-01-14T23:30:00.000Z',
      }

      const json = JSON.stringify(invitation)
      const parsed = JSON.parse(json) as PersistedInvitation

      expect(parsed.invitationUrl).toBe(invitation.invitationUrl)
      expect(parsed.outOfBandId).toBe(invitation.outOfBandId)
      expect(parsed.createdAt).toBe(invitation.createdAt)
    })
  })

  describe('Saving invitation to file', () => {
    it('should write invitation data to file', () => {
      const invitation: PersistedInvitation = {
        invitationUrl: 'http://localhost:9002?oob=abc123',
        outOfBandId: 'oob-id-456',
        createdAt: new Date().toISOString(),
      }

      writeFileSync(testInvitationFile, JSON.stringify(invitation, null, 2), 'utf-8')

      expect(existsSync(testInvitationFile)).toBe(true)
    })

    it('should write valid JSON', () => {
      const invitation: PersistedInvitation = {
        invitationUrl: 'http://localhost:9002?oob=test',
        outOfBandId: 'test-oob-id',
        createdAt: '2026-01-14T23:30:00.000Z',
      }

      writeFileSync(testInvitationFile, JSON.stringify(invitation, null, 2), 'utf-8')
      const content = readFileSync(testInvitationFile, 'utf-8')

      expect(() => JSON.parse(content)).not.toThrow()
    })
  })

  describe('Loading invitation from file', () => {
    /**
     * Helper to simulate loading invitation (mirrors WitnessService.loadPersistedInvitation)
     */
    function loadPersistedInvitation(filePath: string): PersistedInvitation {
      const content = readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(content) as PersistedInvitation

      if (!parsed.invitationUrl || !parsed.outOfBandId) {
        throw new Error('Invalid invitation file: missing invitationUrl or outOfBandId')
      }

      return parsed
    }

    it('should load valid invitation from file', () => {
      const originalInvitation: PersistedInvitation = {
        invitationUrl: 'http://localhost:9002?oob=loadtest',
        outOfBandId: 'load-test-oob-id',
        createdAt: '2026-01-14T12:00:00.000Z',
      }

      writeFileSync(testInvitationFile, JSON.stringify(originalInvitation, null, 2), 'utf-8')

      const loaded = loadPersistedInvitation(testInvitationFile)

      expect(loaded.invitationUrl).toBe(originalInvitation.invitationUrl)
      expect(loaded.outOfBandId).toBe(originalInvitation.outOfBandId)
      expect(loaded.createdAt).toBe(originalInvitation.createdAt)
    })

    it('should throw for non-existent file', () => {
      expect(() => loadPersistedInvitation('/nonexistent/path.json')).toThrow()
    })

    it('should throw for invalid JSON', () => {
      writeFileSync(testInvitationFile, 'not valid json', 'utf-8')

      expect(() => loadPersistedInvitation(testInvitationFile)).toThrow()
    })

    it('should throw if invitationUrl is missing', () => {
      writeFileSync(
        testInvitationFile,
        JSON.stringify({
          outOfBandId: 'oob-id',
          createdAt: new Date().toISOString(),
        }),
        'utf-8'
      )

      expect(() => loadPersistedInvitation(testInvitationFile)).toThrow('missing invitationUrl')
    })

    it('should throw if outOfBandId is missing', () => {
      writeFileSync(
        testInvitationFile,
        JSON.stringify({
          invitationUrl: 'http://localhost:9002?oob=test',
          createdAt: new Date().toISOString(),
        }),
        'utf-8'
      )

      expect(() => loadPersistedInvitation(testInvitationFile)).toThrow('missing invitationUrl or outOfBandId')
    })

    it('should handle file with extra fields gracefully', () => {
      const invitationWithExtra = {
        invitationUrl: 'http://localhost:9002?oob=extra',
        outOfBandId: 'extra-oob-id',
        createdAt: '2026-01-14T12:00:00.000Z',
        extraField: 'should be ignored',
        anotherField: 123,
      }

      writeFileSync(testInvitationFile, JSON.stringify(invitationWithExtra, null, 2), 'utf-8')

      const loaded = loadPersistedInvitation(testInvitationFile)

      expect(loaded.invitationUrl).toBe(invitationWithExtra.invitationUrl)
      expect(loaded.outOfBandId).toBe(invitationWithExtra.outOfBandId)
    })
  })

  describe('File existence check', () => {
    it('should detect existing file', () => {
      writeFileSync(testInvitationFile, '{}', 'utf-8')

      expect(existsSync(testInvitationFile)).toBe(true)
    })

    it('should detect non-existing file', () => {
      expect(existsSync(join(testDir, 'nonexistent.json'))).toBe(false)
    })
  })

  describe('Invitation URL format', () => {
    it('should preserve full OOB invitation URL', () => {
      // Real OOB URLs can be quite long with base64-encoded data
      const longOobUrl =
        'http://localhost:9002?oob=eyJAdHlwZSI6Imh0dHBzOi8vZGlkY29tbS5vcmcvb3V0LW9mLWJhbmQvMS4xL2ludml0YXRpb24iLCJAaWQiOiIxMjM0NTY3OCIsImxhYmVsIjoid2l0bmVzcy1zZXJ2ZXIiLCJhY2NlcHQiOlsiZGlkY29tbS9haXAxIiwiZGlkY29tbS9haXAyO2Vudj1yZmMyMDg0Il0sInNlcnZpY2VzIjpbeyJpZCI6IiNpbmxpbmUtMCIsInNlcnZpY2VFbmRwb2ludCI6Imh0dHA6Ly9sb2NhbGhvc3Q6OTAwMiIsInR5cGUiOiJkaWQtY29tbXVuaWNhdGlvbiJ9XX0'

      const invitation: PersistedInvitation = {
        invitationUrl: longOobUrl,
        outOfBandId: 'oob-id',
        createdAt: new Date().toISOString(),
      }

      writeFileSync(testInvitationFile, JSON.stringify(invitation, null, 2), 'utf-8')

      const content = readFileSync(testInvitationFile, 'utf-8')
      const parsed = JSON.parse(content) as PersistedInvitation

      expect(parsed.invitationUrl).toBe(longOobUrl)
    })
  })

  describe('File reset behavior', () => {
    it('should allow file deletion and recreation', () => {
      // Create initial invitation
      const firstInvitation: PersistedInvitation = {
        invitationUrl: 'http://localhost:9002?oob=first',
        outOfBandId: 'first-oob-id',
        createdAt: '2026-01-14T10:00:00.000Z',
      }
      writeFileSync(testInvitationFile, JSON.stringify(firstInvitation), 'utf-8')

      expect(existsSync(testInvitationFile)).toBe(true)

      // Delete file (simulating resetInvitation)
      unlinkSync(testInvitationFile)

      expect(existsSync(testInvitationFile)).toBe(false)

      // Create new invitation
      const secondInvitation: PersistedInvitation = {
        invitationUrl: 'http://localhost:9002?oob=second',
        outOfBandId: 'second-oob-id',
        createdAt: '2026-01-14T11:00:00.000Z',
      }
      writeFileSync(testInvitationFile, JSON.stringify(secondInvitation), 'utf-8')

      const content = readFileSync(testInvitationFile, 'utf-8')
      const parsed = JSON.parse(content) as PersistedInvitation

      expect(parsed.outOfBandId).toBe('second-oob-id')
      expect(parsed.invitationUrl).toContain('second')
    })
  })

  describe('Config hash invalidation', () => {
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
     * Helper to load invitation with config validation (mirrors WitnessService.loadPersistedInvitation)
     */
    function loadPersistedInvitationWithValidation(filePath: string, currentConfigHash: string): PersistedInvitation {
      const content = readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(content) as PersistedInvitation

      if (!parsed.invitationUrl || !parsed.outOfBandId) {
        throw new Error('Invalid invitation file: missing invitationUrl or outOfBandId')
      }

      // Check if config has changed since invitation was created
      if (parsed.configHash && parsed.configHash !== currentConfigHash) {
        throw new Error(
          `Config has changed since invitation was created (expected hash: ${parsed.configHash}, current: ${currentConfigHash}). Invitation will be regenerated.`
        )
      }

      return parsed
    }

    it('should include configHash when saving invitation', () => {
      const configHash = computeConfigHash({
        publicUrl: 'http://localhost:9002',
        port: 9002,
        name: 'witness-server',
      })

      const invitation: PersistedInvitation = {
        invitationUrl: 'http://localhost:9002?oob=test',
        outOfBandId: 'test-oob-id',
        createdAt: new Date().toISOString(),
        configHash,
      }

      writeFileSync(testInvitationFile, JSON.stringify(invitation, null, 2), 'utf-8')

      const content = readFileSync(testInvitationFile, 'utf-8')
      const parsed = JSON.parse(content) as PersistedInvitation

      expect(parsed.configHash).toBe(configHash)
      expect(parsed.configHash).toHaveLength(16)
    })

    it('should successfully load invitation when config hash matches', () => {
      const config = {
        publicUrl: 'http://192.168.1.50:9002',
        port: 9002,
        name: 'witness-server',
      }
      const configHash = computeConfigHash(config)

      const invitation: PersistedInvitation = {
        invitationUrl: 'http://192.168.1.50:9002?oob=test',
        outOfBandId: 'test-oob-id',
        createdAt: new Date().toISOString(),
        configHash,
      }

      writeFileSync(testInvitationFile, JSON.stringify(invitation, null, 2), 'utf-8')

      const currentConfigHash = computeConfigHash(config)

      expect(() => loadPersistedInvitationWithValidation(testInvitationFile, currentConfigHash)).not.toThrow()
    })

    it('should throw when config hash does not match (publicUrl changed)', () => {
      const oldConfig = {
        publicUrl: 'http://localhost:9002',
        port: 9002,
        name: 'witness-server',
      }
      const oldConfigHash = computeConfigHash(oldConfig)

      const invitation: PersistedInvitation = {
        invitationUrl: 'http://localhost:9002?oob=test',
        outOfBandId: 'test-oob-id',
        createdAt: new Date().toISOString(),
        configHash: oldConfigHash,
      }

      writeFileSync(testInvitationFile, JSON.stringify(invitation, null, 2), 'utf-8')

      // Config has changed - different publicUrl
      const newConfig = {
        publicUrl: 'http://192.168.1.50:9002',
        port: 9002,
        name: 'witness-server',
      }
      const newConfigHash = computeConfigHash(newConfig)

      expect(() => loadPersistedInvitationWithValidation(testInvitationFile, newConfigHash)).toThrow(
        'Config has changed'
      )
    })

    it('should throw when config hash does not match (port changed)', () => {
      const oldConfig = {
        publicUrl: 'http://localhost:9002',
        port: 9002,
        name: 'witness-server',
      }
      const oldConfigHash = computeConfigHash(oldConfig)

      const invitation: PersistedInvitation = {
        invitationUrl: 'http://localhost:9002?oob=test',
        outOfBandId: 'test-oob-id',
        createdAt: new Date().toISOString(),
        configHash: oldConfigHash,
      }

      writeFileSync(testInvitationFile, JSON.stringify(invitation, null, 2), 'utf-8')

      // Config has changed - different port
      const newConfig = {
        publicUrl: 'http://localhost:9002',
        port: 9003,
        name: 'witness-server',
      }
      const newConfigHash = computeConfigHash(newConfig)

      expect(() => loadPersistedInvitationWithValidation(testInvitationFile, newConfigHash)).toThrow(
        'Config has changed'
      )
    })

    it('should throw when config hash does not match (name changed)', () => {
      const oldConfig = {
        publicUrl: 'http://localhost:9002',
        port: 9002,
        name: 'witness-server',
      }
      const oldConfigHash = computeConfigHash(oldConfig)

      const invitation: PersistedInvitation = {
        invitationUrl: 'http://localhost:9002?oob=test',
        outOfBandId: 'test-oob-id',
        createdAt: new Date().toISOString(),
        configHash: oldConfigHash,
      }

      writeFileSync(testInvitationFile, JSON.stringify(invitation, null, 2), 'utf-8')

      // Config has changed - different name
      const newConfig = {
        publicUrl: 'http://localhost:9002',
        port: 9002,
        name: 'witness-server-2',
      }
      const newConfigHash = computeConfigHash(newConfig)

      expect(() => loadPersistedInvitationWithValidation(testInvitationFile, newConfigHash)).toThrow(
        'Config has changed'
      )
    })

    it('should throw when config hash does not match (mediator added)', () => {
      const oldConfig = {
        publicUrl: 'http://localhost:9002',
        port: 9002,
        name: 'witness-server',
      }
      const oldConfigHash = computeConfigHash(oldConfig)

      const invitation: PersistedInvitation = {
        invitationUrl: 'http://localhost:9002?oob=test',
        outOfBandId: 'test-oob-id',
        createdAt: new Date().toISOString(),
        configHash: oldConfigHash,
      }

      writeFileSync(testInvitationFile, JSON.stringify(invitation, null, 2), 'utf-8')

      // Config has changed - mediator added
      const newConfig = {
        publicUrl: 'http://localhost:9002',
        port: 9002,
        name: 'witness-server',
        mediatorInvitationUrl: 'https://mediator.example.com/invite',
      }
      const newConfigHash = computeConfigHash(newConfig)

      expect(() => loadPersistedInvitationWithValidation(testInvitationFile, newConfigHash)).toThrow(
        'Config has changed'
      )
    })

    it('should allow loading old invitations without configHash (backward compatibility)', () => {
      // Old invitation format without configHash
      const invitation: PersistedInvitation = {
        invitationUrl: 'http://localhost:9002?oob=test',
        outOfBandId: 'test-oob-id',
        createdAt: new Date().toISOString(),
        // No configHash
      }

      writeFileSync(testInvitationFile, JSON.stringify(invitation, null, 2), 'utf-8')

      const currentConfig = {
        publicUrl: 'http://192.168.1.50:9002',
        port: 9002,
        name: 'witness-server',
      }
      const currentConfigHash = computeConfigHash(currentConfig)

      // Should not throw even though config is different (backward compatibility)
      expect(() => loadPersistedInvitationWithValidation(testInvitationFile, currentConfigHash)).not.toThrow()
    })

    it('should produce different hashes for different configs', () => {
      const config1 = computeConfigHash({
        publicUrl: 'http://localhost:9002',
        port: 9002,
        name: 'witness-server',
      })

      const config2 = computeConfigHash({
        publicUrl: 'http://192.168.1.50:9002',
        port: 9002,
        name: 'witness-server',
      })

      const config3 = computeConfigHash({
        publicUrl: 'http://localhost:9002',
        port: 9003,
        name: 'witness-server',
      })

      expect(config1).not.toBe(config2)
      expect(config1).not.toBe(config3)
      expect(config2).not.toBe(config3)
    })

    it('should produce same hash for same config', () => {
      const config = {
        publicUrl: 'http://localhost:9002',
        port: 9002,
        name: 'witness-server',
      }

      const hash1 = computeConfigHash(config)
      const hash2 = computeConfigHash(config)

      expect(hash1).toBe(hash2)
    })

    it('should produce deterministic hashes regardless of property order', () => {
      const crypto = require('crypto')

      // Create config with properties in different orders
      const config1 = {
        publicUrl: 'http://localhost:9002',
        port: 9002,
        name: 'witness-server',
        mediatorInvitationUrl: undefined,
      }

      const config2 = {
        name: 'witness-server',
        mediatorInvitationUrl: undefined,
        publicUrl: 'http://localhost:9002',
        port: 9002,
      }

      // Both should produce the same hash due to key sorting
      const configString1 = JSON.stringify(config1, Object.keys(config1).sort())
      const configString2 = JSON.stringify(config2, Object.keys(config2).sort())

      const hash1 = crypto.createHash('sha256').update(configString1).digest('hex').substring(0, 16)
      const hash2 = crypto.createHash('sha256').update(configString2).digest('hex').substring(0, 16)

      expect(hash1).toBe(hash2)
    })
  })

  describe('Edge cases', () => {
    it('should handle empty string invitationFile config', () => {
      const invitationFile = ''

      // Empty string should mean "don't persist"
      if (invitationFile) {
        writeFileSync(invitationFile, '{}', 'utf-8')
      }

      // No file should be created
      expect(existsSync(testInvitationFile)).toBe(false)
    })

    it('should handle URLs with special characters', () => {
      const invitation: PersistedInvitation = {
        invitationUrl: 'http://localhost:9002?oob=abc123&foo=bar%20baz',
        outOfBandId: 'special-chars-oob',
        createdAt: new Date().toISOString(),
      }

      writeFileSync(testInvitationFile, JSON.stringify(invitation, null, 2), 'utf-8')

      const content = readFileSync(testInvitationFile, 'utf-8')
      const parsed = JSON.parse(content) as PersistedInvitation

      expect(parsed.invitationUrl).toBe(invitation.invitationUrl)
    })

    it('should handle UUID-format outOfBandId', () => {
      const invitation: PersistedInvitation = {
        invitationUrl: 'http://localhost:9002?oob=test',
        outOfBandId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        createdAt: new Date().toISOString(),
      }

      writeFileSync(testInvitationFile, JSON.stringify(invitation, null, 2), 'utf-8')

      const content = readFileSync(testInvitationFile, 'utf-8')
      const parsed = JSON.parse(content) as PersistedInvitation

      expect(parsed.outOfBandId).toBe(invitation.outOfBandId)
    })

    it('should preserve ISO date format in createdAt', () => {
      const isoDate = '2026-01-14T23:30:45.123Z'
      const invitation: PersistedInvitation = {
        invitationUrl: 'http://localhost:9002?oob=test',
        outOfBandId: 'date-test-oob',
        createdAt: isoDate,
      }

      writeFileSync(testInvitationFile, JSON.stringify(invitation, null, 2), 'utf-8')

      const content = readFileSync(testInvitationFile, 'utf-8')
      const parsed = JSON.parse(content) as PersistedInvitation

      expect(parsed.createdAt).toBe(isoDate)
    })
  })
})
