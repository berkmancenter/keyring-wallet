/**
 * Unit tests for CredentialRegistry
 */

import {
  CredentialRegistry,
  RedisCredentialRegistry,
  createCredentialRegistry,
  IssuedCredentialRecord,
} from '../../src/CredentialRegistry'

describe('CredentialRegistry', () => {
  let registry: CredentialRegistry

  beforeEach(() => {
    registry = new CredentialRegistry()
  })

  const createMockRecord = (overrides?: Partial<IssuedCredentialRecord>): IssuedCredentialRecord => ({
    vwcId: `urn:uuid:${Math.random().toString(36).substring(7)}`,
    sessionId: `session-${Math.random().toString(36).substring(7)}`,
    vrcDigest: `sha256:${Math.random().toString(36).substring(7)}`,
    vrcIssuerId: `did:peer:2.Ez${Math.random().toString(36).substring(7)}`,
    recipientDid: `did:peer:2.Ey${Math.random().toString(36).substring(7)}`,
    recipientConnectionId: `conn-${Math.random().toString(36).substring(7)}`,
    issuedAt: new Date(),
    ...overrides,
  })

  describe('register', () => {
    it('should add a record to the registry', () => {
      const record = createMockRecord()
      registry.register(record)
      expect(registry.getCount()).toBe(1)
    })

    it('should index by VWC ID', () => {
      const record = createMockRecord({ vwcId: 'urn:uuid:test-123' })
      registry.register(record)
      expect(registry.findByVwcId('urn:uuid:test-123')).toEqual(record)
    })

    it('should index by VRC digest', () => {
      const record = createMockRecord({ vrcDigest: 'sha256:abc123' })
      registry.register(record)
      expect(registry.findByDigest('sha256:abc123')).toContain(record)
    })

    it('should index by session ID', () => {
      const record = createMockRecord({ sessionId: 'session-xyz' })
      registry.register(record)
      expect(registry.findBySessionId('session-xyz')).toContain(record)
    })

    it('should allow multiple records with the same session ID', () => {
      const record1 = createMockRecord({ sessionId: 'session-shared' })
      const record2 = createMockRecord({ sessionId: 'session-shared' })
      registry.register(record1)
      registry.register(record2)
      expect(registry.findBySessionId('session-shared')).toHaveLength(2)
    })
  })

  describe('findByVwcId', () => {
    it('should return undefined for non-existent ID', () => {
      expect(registry.findByVwcId('urn:uuid:nonexistent')).toBeUndefined()
    })

    it('should return the correct record', () => {
      const record = createMockRecord({ vwcId: 'urn:uuid:find-me' })
      registry.register(record)
      const found = registry.findByVwcId('urn:uuid:find-me')
      expect(found?.vwcId).toBe('urn:uuid:find-me')
    })
  })

  describe('findByDigest', () => {
    it('should return empty array for non-existent digest', () => {
      expect(registry.findByDigest('sha256:nonexistent')).toEqual([])
    })

    it('should return all records with the same digest', () => {
      const digest = 'sha256:shared-digest'
      const record1 = createMockRecord({ vrcDigest: digest })
      const record2 = createMockRecord({ vrcDigest: digest })
      registry.register(record1)
      registry.register(record2)
      expect(registry.findByDigest(digest)).toHaveLength(2)
    })
  })

  describe('findBySessionId', () => {
    it('should return empty array for non-existent session', () => {
      expect(registry.findBySessionId('session-nonexistent')).toEqual([])
    })

    it('should return all records for a session', () => {
      const sessionId = 'session-test'
      const record1 = createMockRecord({ sessionId })
      const record2 = createMockRecord({ sessionId })
      registry.register(record1)
      registry.register(record2)
      expect(registry.findBySessionId(sessionId)).toHaveLength(2)
    })
  })

  describe('hasVwcId', () => {
    it('should return false for non-existent ID', () => {
      expect(registry.hasVwcId('urn:uuid:nonexistent')).toBe(false)
    })

    it('should return true for existing ID', () => {
      const record = createMockRecord({ vwcId: 'urn:uuid:exists' })
      registry.register(record)
      expect(registry.hasVwcId('urn:uuid:exists')).toBe(true)
    })
  })

  describe('getAll', () => {
    it('should return empty array for empty registry', () => {
      expect(registry.getAll()).toEqual([])
    })

    it('should return all records in reverse order (most recent first)', () => {
      const record1 = createMockRecord({ vwcId: 'first' })
      const record2 = createMockRecord({ vwcId: 'second' })
      const record3 = createMockRecord({ vwcId: 'third' })
      registry.register(record1)
      registry.register(record2)
      registry.register(record3)
      const all = registry.getAll()
      expect(all[0].vwcId).toBe('third')
      expect(all[2].vwcId).toBe('first')
    })
  })

  describe('getRecent', () => {
    it('should return most recent records up to limit', () => {
      for (let i = 0; i < 10; i++) {
        registry.register(createMockRecord({ vwcId: `urn:uuid:record-${i}` }))
      }
      const recent = registry.getRecent(5)
      expect(recent).toHaveLength(5)
      expect(recent[0].vwcId).toBe('urn:uuid:record-9')
      expect(recent[4].vwcId).toBe('urn:uuid:record-5')
    })

    it('should return all records if less than limit', () => {
      registry.register(createMockRecord())
      registry.register(createMockRecord())
      const recent = registry.getRecent(10)
      expect(recent).toHaveLength(2)
    })
  })

  describe('getPaginated', () => {
    beforeEach(() => {
      // Add 50 records
      for (let i = 0; i < 50; i++) {
        registry.register(createMockRecord({ vwcId: `urn:uuid:record-${i}` }))
      }
    })

    it('should return correct page of records', () => {
      const result = registry.getPaginated(1, 10)
      expect(result.records).toHaveLength(10)
      expect(result.total).toBe(50)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(10)
      expect(result.totalPages).toBe(5)
    })

    it('should return records in reverse order (most recent first)', () => {
      const result = registry.getPaginated(1, 10)
      expect(result.records[0].vwcId).toBe('urn:uuid:record-49')
    })

    it('should return correct subsequent pages', () => {
      const page2 = registry.getPaginated(2, 10)
      expect(page2.records[0].vwcId).toBe('urn:uuid:record-39')
    })

    it('should handle partial last page', () => {
      const lastPage = registry.getPaginated(5, 10)
      expect(lastPage.records).toHaveLength(10)
    })
  })

  describe('getCount', () => {
    it('should return 0 for empty registry', () => {
      expect(registry.getCount()).toBe(0)
    })

    it('should return correct count', () => {
      registry.register(createMockRecord())
      registry.register(createMockRecord())
      registry.register(createMockRecord())
      expect(registry.getCount()).toBe(3)
    })
  })

  describe('getSessionCount', () => {
    it('should return 0 for empty registry', () => {
      expect(registry.getSessionCount()).toBe(0)
    })

    it('should count unique sessions', () => {
      registry.register(createMockRecord({ sessionId: 'session-1' }))
      registry.register(createMockRecord({ sessionId: 'session-1' }))
      registry.register(createMockRecord({ sessionId: 'session-2' }))
      expect(registry.getSessionCount()).toBe(2)
    })
  })

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const now = new Date()
      const earlier = new Date(now.getTime() - 1000)

      registry.register(
        createMockRecord({
          vrcIssuerId: 'did:peer:2.EzIssuer1',
          sessionId: 'session-1',
          issuedAt: earlier,
        })
      )
      registry.register(
        createMockRecord({
          vrcIssuerId: 'did:peer:2.EzIssuer1',
          sessionId: 'session-1',
          issuedAt: now,
        })
      )
      registry.register(
        createMockRecord({
          vrcIssuerId: 'did:peer:2.EzIssuer2',
          sessionId: 'session-2',
          issuedAt: now,
        })
      )

      const stats = registry.getStats()
      expect(stats.totalCredentials).toBe(3)
      expect(stats.totalSessions).toBe(2)
      expect(stats.uniqueVrcIssuers).toBe(2)
      expect(stats.oldestRecord).toEqual(earlier)
      expect(stats.newestRecord).toEqual(now)
    })

    it('should handle empty registry', () => {
      const stats = registry.getStats()
      expect(stats.totalCredentials).toBe(0)
      expect(stats.totalSessions).toBe(0)
      expect(stats.uniqueVrcIssuers).toBe(0)
      expect(stats.oldestRecord).toBeUndefined()
      expect(stats.newestRecord).toBeUndefined()
    })
  })

  describe('clear', () => {
    it('should remove all records', () => {
      registry.register(createMockRecord())
      registry.register(createMockRecord())
      registry.clear()
      expect(registry.getCount()).toBe(0)
      expect(registry.getSessionCount()).toBe(0)
    })

    it('should clear all indexes', () => {
      const record = createMockRecord({
        vwcId: 'urn:uuid:clear-test',
        vrcDigest: 'sha256:clear-test',
        sessionId: 'session-clear-test',
      })
      registry.register(record)
      registry.clear()
      expect(registry.findByVwcId('urn:uuid:clear-test')).toBeUndefined()
      expect(registry.findByDigest('sha256:clear-test')).toEqual([])
      expect(registry.findBySessionId('session-clear-test')).toEqual([])
    })
  })

  describe('max records limit', () => {
    it('should prune oldest records when exceeding limit', () => {
      const smallRegistry = new CredentialRegistry({ maxRecords: 5 })

      for (let i = 0; i < 10; i++) {
        smallRegistry.register(createMockRecord({ vwcId: `urn:uuid:record-${i}` }))
      }

      expect(smallRegistry.getCount()).toBe(5)
      // Should have records 5-9, not 0-4
      expect(smallRegistry.hasVwcId('urn:uuid:record-0')).toBe(false)
      expect(smallRegistry.hasVwcId('urn:uuid:record-4')).toBe(false)
      expect(smallRegistry.hasVwcId('urn:uuid:record-5')).toBe(true)
      expect(smallRegistry.hasVwcId('urn:uuid:record-9')).toBe(true)
    })

    it('should clean up indexes when pruning', () => {
      const smallRegistry = new CredentialRegistry({ maxRecords: 3 })

      smallRegistry.register(
        createMockRecord({
          vwcId: 'urn:uuid:old',
          vrcDigest: 'sha256:old',
          sessionId: 'session-old',
        })
      )
      smallRegistry.register(createMockRecord())
      smallRegistry.register(createMockRecord())
      smallRegistry.register(createMockRecord())

      expect(smallRegistry.findByVwcId('urn:uuid:old')).toBeUndefined()
      expect(smallRegistry.findByDigest('sha256:old')).toEqual([])
      expect(smallRegistry.findBySessionId('session-old')).toEqual([])
    })
  })

  describe('eventName field', () => {
    it('should store and retrieve eventName', () => {
      const record = createMockRecord({ eventName: 'EthDenver 2024' })
      registry.register(record)
      const found = registry.findByVwcId(record.vwcId)
      expect(found?.eventName).toBe('EthDenver 2024')
    })

    it('should handle missing eventName', () => {
      const record = createMockRecord()
      delete (record as any).eventName
      registry.register(record)
      const found = registry.findByVwcId(record.vwcId)
      expect(found?.eventName).toBeUndefined()
    })
  })
})

describe('RedisCredentialRegistry', () => {
  describe('constructor', () => {
    it('should require redisUrl', () => {
      expect(() => new RedisCredentialRegistry({})).toThrow('Redis URL is required')
    })

    it('should accept valid config', () => {
      const registry = new RedisCredentialRegistry({
        redisUrl: 'redis://localhost:6379',
        redisPrefix: 'test:',
        redisTtl: 3600,
        maxRecords: 500,
      })
      expect(registry).toBeDefined()
    })

    it('should use default prefix if not provided', () => {
      const registry = new RedisCredentialRegistry({
        redisUrl: 'redis://localhost:6379',
      })
      expect(registry).toBeDefined()
    })

    it('should default to unlimited storage (no maxRecords limit)', () => {
      // Redis should NOT enforce the 1000 limit by default
      // This is different from in-memory which defaults to 1000
      const registry = new RedisCredentialRegistry({
        redisUrl: 'redis://localhost:6379',
      })
      // Access private field for testing (TypeScript allows this in tests)
      expect((registry as any).maxRecords).toBeUndefined()
    })

    it('should respect explicit maxRecords when provided', () => {
      const registry = new RedisCredentialRegistry({
        redisUrl: 'redis://localhost:6379',
        maxRecords: 5000,
      })
      expect((registry as any).maxRecords).toBe(5000)
    })
  })

  describe('connection required', () => {
    let registry: RedisCredentialRegistry

    beforeEach(() => {
      registry = new RedisCredentialRegistry({
        redisUrl: 'redis://localhost:6379',
      })
    })

    it('should throw if register called without connect', async () => {
      const record: IssuedCredentialRecord = {
        vwcId: 'urn:uuid:test',
        sessionId: 'session-test',
        vrcDigest: 'sha256:test',
        vrcIssuerId: 'did:peer:2.EzTest',
        recipientDid: 'did:peer:2.EyTest',
        recipientConnectionId: 'conn-test',
        issuedAt: new Date(),
      }
      await expect(registry.register(record)).rejects.toThrow('not connected')
    })

    it('should throw if findByVwcId called without connect', async () => {
      await expect(registry.findByVwcId('test')).rejects.toThrow('not connected')
    })

    it('should throw if findByDigest called without connect', async () => {
      await expect(registry.findByDigest('test')).rejects.toThrow('not connected')
    })

    it('should throw if findBySessionId called without connect', async () => {
      await expect(registry.findBySessionId('test')).rejects.toThrow('not connected')
    })

    it('should throw if hasVwcId called without connect', async () => {
      await expect(registry.hasVwcId('test')).rejects.toThrow('not connected')
    })

    it('should throw if getAll called without connect', async () => {
      await expect(registry.getAll()).rejects.toThrow('not connected')
    })

    it('should throw if getRecent called without connect', async () => {
      await expect(registry.getRecent()).rejects.toThrow('not connected')
    })

    it('should throw if getPaginated called without connect', async () => {
      await expect(registry.getPaginated()).rejects.toThrow('not connected')
    })

    it('should throw if getCount called without connect', async () => {
      await expect(registry.getCount()).rejects.toThrow('not connected')
    })

    it('should throw if getSessionCount called without connect', async () => {
      await expect(registry.getSessionCount()).rejects.toThrow('not connected')
    })

    it('should throw if getStats called without connect', async () => {
      await expect(registry.getStats()).rejects.toThrow('not connected')
    })

    it('should throw if clear called without connect', async () => {
      await expect(registry.clear()).rejects.toThrow('not connected')
    })
  })

  describe('connect error handling', () => {
    it('should throw meaningful error when Redis is unavailable', async () => {
      const registry = new RedisCredentialRegistry({
        redisUrl: 'redis://nonexistent-host:9999',
      })

      // This will fail because ioredis isn't installed or can't connect
      await expect(registry.connect()).rejects.toThrow()
    })
  })
})

describe('createCredentialRegistry factory', () => {
  it('should create in-memory registry by default', async () => {
    const registry = await createCredentialRegistry()
    expect(registry).toBeInstanceOf(CredentialRegistry)
  })

  it('should create in-memory registry when storage is "memory"', async () => {
    const registry = await createCredentialRegistry({ storage: 'memory' })
    expect(registry).toBeInstanceOf(CredentialRegistry)
  })

  it('should respect maxRecords for in-memory registry', async () => {
    const registry = await createCredentialRegistry({ maxRecords: 10 })
    expect(registry).toBeInstanceOf(CredentialRegistry)

    // Add 15 records, should only keep 10
    for (let i = 0; i < 15; i++) {
      registry.register({
        vwcId: `urn:uuid:record-${i}`,
        sessionId: 'session-test',
        vrcDigest: 'sha256:test',
        vrcIssuerId: 'did:peer:2.EzTest',
        recipientDid: 'did:peer:2.EyTest',
        recipientConnectionId: 'conn-test',
        issuedAt: new Date(),
      })
    }

    expect(registry.getCount()).toBe(10)
  })

  it('should throw when redis storage requested without URL', async () => {
    await expect(createCredentialRegistry({ storage: 'redis' })).rejects.toThrow('Redis URL is required')
  })

  it('should attempt to create Redis registry when storage is "redis"', async () => {
    // This will fail because Redis isn't available, but it shows the factory
    // correctly routes to Redis
    await expect(
      createCredentialRegistry({
        storage: 'redis',
        redisUrl: 'redis://nonexistent:9999',
      })
    ).rejects.toThrow()
  })
})

describe('IAsyncCredentialRegistry interface compliance', () => {
  // These tests verify that RedisCredentialRegistry implements the interface correctly
  // We can't test actual functionality without Redis, but we can verify the shape

  it('should have all required async methods', () => {
    const registry = new RedisCredentialRegistry({
      redisUrl: 'redis://localhost:6379',
    })

    // Verify all interface methods exist and are functions
    expect(typeof registry.register).toBe('function')
    expect(typeof registry.findByVwcId).toBe('function')
    expect(typeof registry.findByDigest).toBe('function')
    expect(typeof registry.findBySessionId).toBe('function')
    expect(typeof registry.hasVwcId).toBe('function')
    expect(typeof registry.getAll).toBe('function')
    expect(typeof registry.getRecent).toBe('function')
    expect(typeof registry.getPaginated).toBe('function')
    expect(typeof registry.getCount).toBe('function')
    expect(typeof registry.getSessionCount).toBe('function')
    expect(typeof registry.getStats).toBe('function')
    expect(typeof registry.clear).toBe('function')
    expect(typeof registry.close).toBe('function')
    expect(typeof registry.connect).toBe('function')
  })

  it('close should be safe to call without connection', async () => {
    const registry = new RedisCredentialRegistry({
      redisUrl: 'redis://localhost:6379',
    })

    // Should not throw
    await expect(registry.close()).resolves.toBeUndefined()
  })
})
