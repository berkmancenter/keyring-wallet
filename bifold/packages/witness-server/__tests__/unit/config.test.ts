/**
 * Unit tests for config.ts
 *
 * These tests verify configuration loading from environment variables
 * without spinning up any agents (unlike the integration tests in vrc_reference).
 */

import {
  loadConfig,
  defaultConfig,
  WitnessServerConfig,
  loadKeyFile,
  isValidHex,
  parseEventTime,
  detectDidMethod,
  getDidSourceDescription,
  isMediatorEnabled,
} from '../../src/config'
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

describe('WitnessServerConfig', () => {
  const originalEnv = process.env

  beforeEach(() => {
    // Clear all witness-related env vars before each test
    jest.resetModules()
    process.env = { ...originalEnv }
    delete process.env.WITNESS_PORT
    delete process.env.WITNESS_WEB_PORT
    delete process.env.WITNESS_NAME
    delete process.env.WITNESS_PUBLIC_URL
    delete process.env.WITNESS_SESSION_EXPIRATION
    delete process.env.WITNESS_VERBOSE
    delete process.env.WITNESS_EVENT_NAME
    delete process.env.WITNESS_VERIFICATION_METHOD
    delete process.env.WITNESS_ISSUER_DID
    delete process.env.WITNESS_ISSUER_SEED
    delete process.env.WITNESS_ISSUER_KEY_FILE
    delete process.env.WITNESS_INVITATION_FILE
    delete process.env.MEDIATOR_INVITATION_URL
    delete process.env.WITNESS_REPORTING_ENABLED
    delete process.env.WITNESS_RETAIN_MESSAGES
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('loadConfig', () => {
    it('should return default values when no env vars are set', () => {
      const config = loadConfig()

      expect(config.port).toBe(9002)
      expect(config.webPort).toBe(9003)
      expect(config.name).toBe('witness-server')
      expect(config.publicUrl).toBe('http://localhost:9002')
      expect(config.sessionExpirationMinutes).toBe(30)
      expect(config.verbose).toBe(false)
      expect(config.eventName).toBeUndefined()
      expect(config.verificationMethod).toBe('session-based-challenge')
    })

    it('should load WITNESS_PORT from environment', () => {
      process.env.WITNESS_PORT = '9010'

      const config = loadConfig()

      expect(config.port).toBe(9010)
      // publicUrl should also update to match the port
      expect(config.publicUrl).toBe('http://localhost:9010')
    })

    it('should load WITNESS_WEB_PORT from environment', () => {
      process.env.WITNESS_WEB_PORT = '9011'

      const config = loadConfig()

      expect(config.webPort).toBe(9011)
    })

    it('should load WITNESS_NAME from environment', () => {
      process.env.WITNESS_NAME = 'conference-witness'

      const config = loadConfig()

      expect(config.name).toBe('conference-witness')
    })

    it('should load WITNESS_PUBLIC_URL from environment', () => {
      process.env.WITNESS_PUBLIC_URL = 'https://witness.example.com'

      const config = loadConfig()

      expect(config.publicUrl).toBe('https://witness.example.com')
    })

    it('should load WITNESS_SESSION_EXPIRATION from environment', () => {
      process.env.WITNESS_SESSION_EXPIRATION = '60'

      const config = loadConfig()

      expect(config.sessionExpirationMinutes).toBe(60)
    })

    it('should set verbose to true when WITNESS_VERBOSE is "true"', () => {
      process.env.WITNESS_VERBOSE = 'true'

      const config = loadConfig()

      expect(config.verbose).toBe(true)
    })

    it('should keep verbose false for other WITNESS_VERBOSE values', () => {
      process.env.WITNESS_VERBOSE = 'yes'

      const config = loadConfig()

      expect(config.verbose).toBe(false)
    })

    it('should handle all env vars together', () => {
      process.env.WITNESS_PORT = '8080'
      process.env.WITNESS_WEB_PORT = '8081'
      process.env.WITNESS_NAME = 'test-witness'
      process.env.WITNESS_PUBLIC_URL = 'https://test.example.com'
      process.env.WITNESS_SESSION_EXPIRATION = '15'
      process.env.WITNESS_VERBOSE = 'true'
      process.env.WITNESS_EVENT_NAME = 'Test Conference'
      process.env.WITNESS_VERIFICATION_METHOD = 'in-person-proximity'

      const config = loadConfig()

      expect(config.port).toBe(8080)
      expect(config.webPort).toBe(8081)
      expect(config.name).toBe('test-witness')
      expect(config.publicUrl).toBe('https://test.example.com')
      expect(config.sessionExpirationMinutes).toBe(15)
      expect(config.verbose).toBe(true)
      expect(config.eventName).toBe('Test Conference')
      expect(config.verificationMethod).toBe('in-person-proximity')
    })

    it('should load WITNESS_ISSUER_DID from environment', () => {
      process.env.WITNESS_ISSUER_DID = 'did:key:z6MkpTHR8VNs...'

      const config = loadConfig()

      expect(config.issuerDid).toBe('did:key:z6MkpTHR8VNs...')
    })

    it('should load WITNESS_ISSUER_SEED from environment', () => {
      const validSeed = 'a'.repeat(64) // 64 hex chars = 32 bytes
      process.env.WITNESS_ISSUER_SEED = validSeed

      const config = loadConfig()

      expect(config.issuerDidSeed).toBe(validSeed)
    })

    it('should load WITNESS_ISSUER_KEY_FILE from environment', () => {
      process.env.WITNESS_ISSUER_KEY_FILE = '/path/to/key.json'

      const config = loadConfig()

      expect(config.issuerKeyFile).toBe('/path/to/key.json')
    })

    it('should have undefined DID config values by default', () => {
      const config = loadConfig()

      expect(config.issuerDid).toBeUndefined()
      expect(config.issuerDidSeed).toBeUndefined()
      expect(config.issuerKeyFile).toBeUndefined()
    })

    it('should default WITNESS_INVITATION_FILE to .oob-invitation.json', () => {
      const config = loadConfig()

      expect(config.invitationFile).toBe('.oob-invitation.json')
    })

    it('should load WITNESS_INVITATION_FILE from environment', () => {
      process.env.WITNESS_INVITATION_FILE = '/custom/path/invitation.json'

      const config = loadConfig()

      expect(config.invitationFile).toBe('/custom/path/invitation.json')
    })

    it('should allow empty WITNESS_INVITATION_FILE to disable persistence', () => {
      process.env.WITNESS_INVITATION_FILE = ''

      const config = loadConfig()

      expect(config.invitationFile).toBe('')
    })

    it('should handle invalid port numbers gracefully', () => {
      process.env.WITNESS_PORT = 'invalid'

      const config = loadConfig()

      expect(config.port).toBeNaN()
    })

    it('should have undefined mediatorInvitationUrl by default', () => {
      const config = loadConfig()

      expect(config.mediatorInvitationUrl).toBeUndefined()
    })

    it('should load MEDIATOR_INVITATION_URL from environment', () => {
      process.env.MEDIATOR_INVITATION_URL = 'https://mediator.example.com/invite?oob=eyJ...'

      const config = loadConfig()

      expect(config.mediatorInvitationUrl).toBe('https://mediator.example.com/invite?oob=eyJ...')
    })

    it('should load WITNESS_EVENT_NAME from environment', () => {
      process.env.WITNESS_EVENT_NAME = 'EthDenver 2024'

      const config = loadConfig()

      expect(config.eventName).toBe('EthDenver 2024')
    })

    it('should load WITNESS_VERIFICATION_METHOD from environment', () => {
      process.env.WITNESS_VERIFICATION_METHOD = 'in-person-proximity'

      const config = loadConfig()

      expect(config.verificationMethod).toBe('in-person-proximity')
    })

    it('should use default verification method when not set', () => {
      const config = loadConfig()

      expect(config.verificationMethod).toBe('session-based-challenge')
    })

    // ── WITNESS_REPORTING_ENABLED ──────────────────────────────────────────

    it('reportingEnabled defaults to true when WITNESS_REPORTING_ENABLED is not set', () => {
      const config = loadConfig()

      expect(config.reportingEnabled).toBe(true)
    })

    it('reportingEnabled is false when WITNESS_REPORTING_ENABLED=false', () => {
      process.env.WITNESS_REPORTING_ENABLED = 'false'

      const config = loadConfig()

      expect(config.reportingEnabled).toBe(false)
    })

    it('reportingEnabled remains true when WITNESS_REPORTING_ENABLED=true (explicit opt-in)', () => {
      process.env.WITNESS_REPORTING_ENABLED = 'true'

      const config = loadConfig()

      expect(config.reportingEnabled).toBe(true)
    })

    it('reportingEnabled remains true for any value that is not exactly "false"', () => {
      for (const val of ['0', 'no', 'disabled', 'off', '']) {
        process.env.WITNESS_REPORTING_ENABLED = val
        const config = loadConfig()
        expect(config.reportingEnabled).toBe(true)
      }
    })

    // ── WITNESS_RETAIN_MESSAGES ──────────────────────────────────────────

    it('retainMessages defaults to false when WITNESS_RETAIN_MESSAGES is not set', () => {
      const config = loadConfig()

      expect(config.retainMessages).toBe(false)
    })

    it('retainMessages is true when WITNESS_RETAIN_MESSAGES=true', () => {
      process.env.WITNESS_RETAIN_MESSAGES = 'true'

      const config = loadConfig()

      expect(config.retainMessages).toBe(true)
    })

    it('retainMessages remains false for any value that is not exactly "true"', () => {
      for (const val of ['1', 'yes', 'enabled', 'on', 'false', '']) {
        process.env.WITNESS_RETAIN_MESSAGES = val
        const config = loadConfig()
        expect(config.retainMessages).toBe(false)
      }
    })
  })

  describe('defaultConfig', () => {
    it('should have expected default values', () => {
      expect(defaultConfig.port).toBe(9002)
      expect(defaultConfig.webPort).toBe(9003)
      expect(defaultConfig.name).toBe('witness-server')
      expect(defaultConfig.publicUrl).toBe('http://localhost:9002')
      expect(defaultConfig.sessionExpirationMinutes).toBe(30)
      expect(defaultConfig.verbose).toBe(false)
      expect(defaultConfig.eventName).toBeUndefined()
      expect(defaultConfig.verificationMethod).toBe('session-based-challenge')
    })

    it('should be a complete WitnessServerConfig', () => {
      const config: WitnessServerConfig = defaultConfig

      expect(config.port).toBeDefined()
      expect(config.webPort).toBeDefined()
      expect(config.name).toBeDefined()
      expect(config.publicUrl).toBeDefined()
      expect(config.sessionExpirationMinutes).toBeDefined()
      expect(config.verbose).toBeDefined()
      expect(config.verificationMethod).toBeDefined()
      // eventName is optional, so it may be undefined
    })

    it('should include DID config fields in defaultConfig', () => {
      expect(defaultConfig.issuerDid).toBeUndefined()
      expect(defaultConfig.issuerDidSeed).toBeUndefined()
      expect(defaultConfig.issuerKeyFile).toBeUndefined()
    })

    it('should include invitationFile in defaultConfig', () => {
      expect(defaultConfig.invitationFile).toBe('.oob-invitation.json')
    })

    it('should include mediatorInvitationUrl as undefined in defaultConfig', () => {
      expect(defaultConfig.mediatorInvitationUrl).toBeUndefined()
    })

    it('reportingEnabled is true in defaultConfig (on by default)', () => {
      expect(defaultConfig.reportingEnabled).toBe(true)
    })

    it('retainMessages is false in defaultConfig (privacy by default)', () => {
      expect(defaultConfig.retainMessages).toBe(false)
    })
  })

  describe('isMediatorEnabled', () => {
    it('should return false when mediatorInvitationUrl is undefined', () => {
      const config: WitnessServerConfig = {
        ...defaultConfig,
        mediatorInvitationUrl: undefined,
      }

      expect(isMediatorEnabled(config)).toBe(false)
    })

    it('should return false when mediatorInvitationUrl is empty string', () => {
      const config: WitnessServerConfig = {
        ...defaultConfig,
        mediatorInvitationUrl: '',
      }

      expect(isMediatorEnabled(config)).toBe(false)
    })

    it('should return true when mediatorInvitationUrl is set', () => {
      const config: WitnessServerConfig = {
        ...defaultConfig,
        mediatorInvitationUrl: 'https://mediator.example.com/invite?oob=eyJ...',
      }

      expect(isMediatorEnabled(config)).toBe(true)
    })

    it('should return true for any non-empty mediator URL', () => {
      const config: WitnessServerConfig = {
        ...defaultConfig,
        mediatorInvitationUrl: 'http://localhost:3000?oob=test',
      }

      expect(isMediatorEnabled(config)).toBe(true)
    })
  })

  describe('isValidHex', () => {
    it('should return true for valid hex strings', () => {
      expect(isValidHex('abcd')).toBe(true)
      expect(isValidHex('ABCD')).toBe(true)
      expect(isValidHex('1234')).toBe(true)
      expect(isValidHex('aB12cD34')).toBe(true)
    })

    it('should return false for invalid hex strings', () => {
      expect(isValidHex('ghij')).toBe(false)
      expect(isValidHex('xyz')).toBe(false)
      expect(isValidHex('hello')).toBe(false)
      expect(isValidHex(' 123')).toBe(false)
    })

    it('should validate expected length', () => {
      expect(isValidHex('abcd', 4)).toBe(true)
      expect(isValidHex('abcd', 8)).toBe(false)
      expect(isValidHex('a'.repeat(64), 64)).toBe(true)
      expect(isValidHex('a'.repeat(32), 64)).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(isValidHex('')).toBe(false)
    })
  })

  describe('parseEventTime', () => {
    it('should return undefined when value is undefined', () => {
      expect(parseEventTime('TEST_VAR', undefined)).toBeUndefined()
    })

    it('should return undefined when value is empty string', () => {
      expect(parseEventTime('TEST_VAR', '')).toBeUndefined()
    })

    it('should parse a valid ISO 8601 datetime with timezone', () => {
      const result = parseEventTime('TEST_VAR', '2026-04-01T09:00:00-07:00')

      expect(result).toBeInstanceOf(Date)
      expect(result!.getTime()).toBe(new Date('2026-04-01T09:00:00-07:00').getTime())
    })

    it('should parse a valid ISO 8601 UTC datetime', () => {
      const result = parseEventTime('TEST_VAR', '2026-04-01T16:00:00Z')

      expect(result).toBeInstanceOf(Date)
      expect(result!.toISOString()).toBe('2026-04-01T16:00:00.000Z')
    })

    it('should return undefined and warn for an invalid datetime string', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

      const result = parseEventTime('WITNESS_EVENT_START', 'not-a-date')

      expect(result).toBeUndefined()
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('WITNESS_EVENT_START')
      )
      warnSpy.mockRestore()
    })
  })

  describe('loadConfig event time window', () => {
    beforeEach(() => {
      delete process.env.WITNESS_EVENT_START
      delete process.env.WITNESS_EVENT_END
    })

    it('should have undefined eventStartTime and eventEndTime by default', () => {
      const config = loadConfig()

      expect(config.eventStartTime).toBeUndefined()
      expect(config.eventEndTime).toBeUndefined()
    })

    it('should parse WITNESS_EVENT_START into a Date', () => {
      process.env.WITNESS_EVENT_START = '2026-04-01T09:00:00Z'

      const config = loadConfig()

      expect(config.eventStartTime).toBeInstanceOf(Date)
      expect(config.eventStartTime!.toISOString()).toBe('2026-04-01T09:00:00.000Z')
    })

    it('should parse WITNESS_EVENT_END into a Date', () => {
      process.env.WITNESS_EVENT_END = '2026-04-01T17:00:00Z'

      const config = loadConfig()

      expect(config.eventEndTime).toBeInstanceOf(Date)
      expect(config.eventEndTime!.toISOString()).toBe('2026-04-01T17:00:00.000Z')
    })

    it('should parse both start and end times together', () => {
      process.env.WITNESS_EVENT_START = '2026-04-01T09:00:00Z'
      process.env.WITNESS_EVENT_END = '2026-04-01T17:00:00Z'

      const config = loadConfig()

      expect(config.eventStartTime).toBeInstanceOf(Date)
      expect(config.eventEndTime).toBeInstanceOf(Date)
      expect(config.eventStartTime!.getTime()).toBeLessThan(config.eventEndTime!.getTime())
    })

    it('should treat invalid WITNESS_EVENT_START as undefined', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
      process.env.WITNESS_EVENT_START = 'bad-date'

      const config = loadConfig()

      expect(config.eventStartTime).toBeUndefined()
      warnSpy.mockRestore()
    })

    it('should warn when start is not before end', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
      process.env.WITNESS_EVENT_START = '2026-04-01T17:00:00Z'
      process.env.WITNESS_EVENT_END = '2026-04-01T09:00:00Z'

      loadConfig()

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('WITNESS_EVENT_START is not before WITNESS_EVENT_END')
      )
      warnSpy.mockRestore()
    })
  })

  describe('defaultConfig event time fields', () => {
    it('should have undefined eventStartTime and eventEndTime', () => {
      expect(defaultConfig.eventStartTime).toBeUndefined()
      expect(defaultConfig.eventEndTime).toBeUndefined()
    })
  })

  describe('detectDidMethod', () => {
    it('should detect did:key method', () => {
      expect(detectDidMethod('did:key:z6MkpTHR8VNs...')).toBe('key')
    })

    it('should detect did:web method', () => {
      expect(detectDidMethod('did:web:witness.example.com')).toBe('web')
    })

    it('should detect did:peer method', () => {
      expect(detectDidMethod('did:peer:0z6MkpTHR...')).toBe('peer')
    })

    it('should return unknown for unsupported methods', () => {
      expect(detectDidMethod('did:ethr:0x123...')).toBe('unknown')
      expect(detectDidMethod('did:ion:xyz')).toBe('unknown')
      expect(detectDidMethod('not-a-did')).toBe('unknown')
    })
  })

  describe('getDidSourceDescription', () => {
    it('should return CONFIGURED when issuerDid is set', () => {
      const config: WitnessServerConfig = {
        ...defaultConfig,
        issuerDid: 'did:key:z6Mk...',
        issuerDidSeed: 'someseed',
      }

      const { didSource, keySource } = getDidSourceDescription(config)

      expect(didSource).toBe('CONFIGURED')
      expect(keySource).toBe('SEED_ENV')
    })

    it('should return DERIVED_FROM_SEED when only seed is set', () => {
      const config: WitnessServerConfig = {
        ...defaultConfig,
        issuerDidSeed: 'someseed',
      }

      const { didSource, keySource } = getDidSourceDescription(config)

      expect(didSource).toBe('DERIVED_FROM_SEED')
      expect(keySource).toBe('SEED_ENV')
    })

    it('should return KEY_FILE when issuerKeyFile is set', () => {
      const config: WitnessServerConfig = {
        ...defaultConfig,
        issuerKeyFile: '/path/to/key.json',
      }

      const { didSource, keySource } = getDidSourceDescription(config)

      expect(didSource).toBe('DERIVED_FROM_SEED')
      expect(keySource).toBe('KEY_FILE')
    })

    it('should prefer KEY_FILE over SEED_ENV when both are set', () => {
      const config: WitnessServerConfig = {
        ...defaultConfig,
        issuerDidSeed: 'someseed',
        issuerKeyFile: '/path/to/key.json',
      }

      const { keySource } = getDidSourceDescription(config)

      expect(keySource).toBe('KEY_FILE')
    })

    it('should return AUTO_GENERATED when nothing is set', () => {
      const config: WitnessServerConfig = { ...defaultConfig }

      const { didSource, keySource } = getDidSourceDescription(config)

      expect(didSource).toBe('AUTO_GENERATED')
      expect(keySource).toBe('AUTO_GENERATED')
    })
  })

  describe('loadKeyFile', () => {
    const testDir = join(__dirname, '.test-keys')
    const testKeyFile = join(testDir, 'test-key.json')

    beforeAll(() => {
      if (!existsSync(testDir)) {
        mkdirSync(testDir, { recursive: true })
      }
    })

    afterEach(() => {
      try {
        unlinkSync(testKeyFile)
      } catch {
        // ignore if doesn't exist
      }
    })

    afterAll(() => {
      try {
        unlinkSync(testKeyFile)
      } catch {
        // ignore
      }
    })

    it('should load key file with seed', () => {
      const seedHex = 'a'.repeat(64)
      writeFileSync(testKeyFile, JSON.stringify({ seed: seedHex }))

      const keyContents = loadKeyFile(testKeyFile)

      expect(keyContents.seed).toBe(seedHex)
    })

    it('should load key file with privateKeyHex', () => {
      const privateKeyHex = 'b'.repeat(64)
      writeFileSync(testKeyFile, JSON.stringify({ privateKeyHex }))

      const keyContents = loadKeyFile(testKeyFile)

      expect(keyContents.privateKeyHex).toBe(privateKeyHex)
    })

    it('should load key file with privateKeyBase64', () => {
      const privateKeyBase64 = 'SGVsbG9Xb3JsZA=='
      writeFileSync(testKeyFile, JSON.stringify({ privateKeyBase64 }))

      const keyContents = loadKeyFile(testKeyFile)

      expect(keyContents.privateKeyBase64).toBe(privateKeyBase64)
    })

    it('should throw for non-existent file', () => {
      expect(() => loadKeyFile('/nonexistent/path/key.json')).toThrow('Key file not found')
    })

    it('should throw for invalid JSON', () => {
      writeFileSync(testKeyFile, 'not valid json')

      expect(() => loadKeyFile(testKeyFile)).toThrow('Invalid JSON')
    })

    it('should throw if no key material present', () => {
      writeFileSync(testKeyFile, JSON.stringify({ foo: 'bar' }))

      expect(() => loadKeyFile(testKeyFile)).toThrow('must contain seed')
    })
  })
})
