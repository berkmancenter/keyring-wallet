/**
 * CredentialRegistry - Interface and implementations for tracking issued Witness Credentials (VWCs)
 *
 * Supports multiple storage backends:
 * - InMemoryCredentialRegistry (default) - In-memory storage with LRU eviction
 * - RedisCredentialRegistry - Redis-backed persistent storage
 */

/**
 * Record of an issued Witness Credential
 */
export interface IssuedCredentialRecord {
  /** VWC ID (urn:uuid:...) */
  vwcId: string
  /** Session ID from the witnessed exchange */
  sessionId: string
  /** SHA-256 digest of the witnessed VRC */
  vrcDigest: string
  /** DID of the party who issued the VRC (credentialSubject.id in VWC) */
  vrcIssuerId: string
  /** DID of the party who received the VWC */
  recipientDid: string
  /** Connection ID of the recipient */
  recipientConnectionId: string
  /** Timestamp when the VWC was issued */
  issuedAt: Date
  /** Event name (if configured) */
  eventName?: string
}

/**
 * Result of a credential verification
 */
export interface VerificationResult {
  /** Whether the credential was verified successfully */
  verified: boolean
  /** Whether the issuer DID matches this server */
  issuerMatch: boolean
  /** Whether the credential is in the registry */
  inRegistry: boolean
  /** ISO timestamp when the credential was issued (if in registry) */
  issuedAt?: string
  /** Session ID (if in registry) */
  sessionId?: string
  /** Error message (if verification failed) */
  error?: string
}

/**
 * Statistics about the registry
 */
export interface RegistryStats {
  totalCredentials: number
  totalSessions: number
  uniqueVrcIssuers: number
  oldestRecord?: Date
  newestRecord?: Date
}

/**
 * Paginated result
 */
export interface PaginatedResult {
  records: IssuedCredentialRecord[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/**
 * Configuration options for the registry
 */
export interface RegistryConfig {
  /** Maximum number of records to keep (default: 1000) */
  maxRecords?: number
  /** Storage type: 'memory' (default) or 'redis' */
  storage?: 'memory' | 'redis'
  /** Redis connection URL (required if storage is 'redis') */
  redisUrl?: string
  /** Redis key prefix (default: 'witness:') */
  redisPrefix?: string
  /** TTL for Redis records in seconds (default: 0 = no expiry) */
  redisTtl?: number
}

/**
 * Interface for async credential registry implementations (Redis, etc.)
 */
export interface IAsyncCredentialRegistry {
  /** Register a newly issued VWC */
  register(record: IssuedCredentialRecord): Promise<void>

  /** Find a record by VWC ID */
  findByVwcId(vwcId: string): Promise<IssuedCredentialRecord | undefined>

  /** Find records by VRC digest */
  findByDigest(digest: string): Promise<IssuedCredentialRecord[]>

  /** Find records by session ID */
  findBySessionId(sessionId: string): Promise<IssuedCredentialRecord[]>

  /** Check if a VWC ID exists in the registry */
  hasVwcId(vwcId: string): Promise<boolean>

  /** Get all records, most recent first */
  getAll(): Promise<IssuedCredentialRecord[]>

  /** Get the most recent N records */
  getRecent(limit?: number): Promise<IssuedCredentialRecord[]>

  /** Get paginated records */
  getPaginated(page?: number, pageSize?: number): Promise<PaginatedResult>

  /** Get total count of issued credentials */
  getCount(): Promise<number>

  /** Get count of unique sessions */
  getSessionCount(): Promise<number>

  /** Get statistics about the registry */
  getStats(): Promise<RegistryStats>

  /** Clear all records */
  clear(): Promise<void>

  /** Close any connections (for cleanup) */
  close(): Promise<void>
}

const DEFAULT_MAX_RECORDS = 1000

/**
 * In-memory credential registry implementation (synchronous)
 * This is the default storage backend used by WitnessService
 */
export class CredentialRegistry {
  private records: IssuedCredentialRecord[] = []
  private byVwcId: Map<string, IssuedCredentialRecord> = new Map()
  private byDigest: Map<string, IssuedCredentialRecord[]> = new Map()
  private bySessionId: Map<string, IssuedCredentialRecord[]> = new Map()
  private readonly maxRecords: number

  constructor(config?: RegistryConfig) {
    this.maxRecords = config?.maxRecords ?? DEFAULT_MAX_RECORDS
  }

  /**
   * Register a newly issued VWC
   */
  public register(record: IssuedCredentialRecord): void {
    // Add to main list
    this.records.push(record)

    // Index by VWC ID
    this.byVwcId.set(record.vwcId, record)

    // Index by digest
    const digestRecords = this.byDigest.get(record.vrcDigest) || []
    digestRecords.push(record)
    this.byDigest.set(record.vrcDigest, digestRecords)

    // Index by session ID
    const sessionRecords = this.bySessionId.get(record.sessionId) || []
    sessionRecords.push(record)
    this.bySessionId.set(record.sessionId, sessionRecords)

    // Enforce max records limit
    this.pruneOldRecords()
  }

  /**
   * Find a record by VWC ID
   */
  public findByVwcId(vwcId: string): IssuedCredentialRecord | undefined {
    return this.byVwcId.get(vwcId)
  }

  /**
   * Find records by VRC digest
   */
  public findByDigest(digest: string): IssuedCredentialRecord[] {
    return this.byDigest.get(digest) || []
  }

  /**
   * Find records by session ID
   */
  public findBySessionId(sessionId: string): IssuedCredentialRecord[] {
    return this.bySessionId.get(sessionId) || []
  }

  /**
   * Check if a VWC ID exists in the registry
   */
  public hasVwcId(vwcId: string): boolean {
    return this.byVwcId.has(vwcId)
  }

  /**
   * Get all records, most recent first
   */
  public getAll(): IssuedCredentialRecord[] {
    return [...this.records].reverse()
  }

  /**
   * Get the most recent N records
   */
  public getRecent(limit: number = 50): IssuedCredentialRecord[] {
    const start = Math.max(0, this.records.length - limit)
    return this.records.slice(start).reverse()
  }

  /**
   * Get paginated records
   */
  public getPaginated(
    page: number = 1,
    pageSize: number = 20
  ): {
    records: IssuedCredentialRecord[]
    total: number
    page: number
    pageSize: number
    totalPages: number
  } {
    const total = this.records.length
    const totalPages = Math.ceil(total / pageSize)
    const start = total - page * pageSize
    const end = start + pageSize

    const records = this.records.slice(Math.max(0, start), Math.max(0, end)).reverse()

    return {
      records,
      total,
      page,
      pageSize,
      totalPages,
    }
  }

  /**
   * Get total count of issued credentials
   */
  public getCount(): number {
    return this.records.length
  }

  /**
   * Get count of unique sessions
   */
  public getSessionCount(): number {
    return this.bySessionId.size
  }

  /**
   * Get statistics about the registry
   */
  public getStats(): {
    totalCredentials: number
    totalSessions: number
    uniqueVrcIssuers: number
    oldestRecord?: Date
    newestRecord?: Date
  } {
    const uniqueIssuers = new Set(this.records.map((r) => r.vrcIssuerId))

    return {
      totalCredentials: this.records.length,
      totalSessions: this.bySessionId.size,
      uniqueVrcIssuers: uniqueIssuers.size,
      oldestRecord: this.records[0]?.issuedAt,
      newestRecord: this.records[this.records.length - 1]?.issuedAt,
    }
  }

  /**
   * Clear all records
   */
  public clear(): void {
    this.records = []
    this.byVwcId.clear()
    this.byDigest.clear()
    this.bySessionId.clear()
  }

  /**
   * Remove oldest records when exceeding max limit
   */
  private pruneOldRecords(): void {
    while (this.records.length > this.maxRecords) {
      const oldest = this.records.shift()
      if (oldest) {
        this.byVwcId.delete(oldest.vwcId)

        // Remove from digest index
        const digestRecords = this.byDigest.get(oldest.vrcDigest)
        if (digestRecords) {
          const idx = digestRecords.findIndex((r) => r.vwcId === oldest.vwcId)
          if (idx >= 0) digestRecords.splice(idx, 1)
          if (digestRecords.length === 0) this.byDigest.delete(oldest.vrcDigest)
        }

        // Remove from session index
        const sessionRecords = this.bySessionId.get(oldest.sessionId)
        if (sessionRecords) {
          const idx = sessionRecords.findIndex((r) => r.vwcId === oldest.vwcId)
          if (idx >= 0) sessionRecords.splice(idx, 1)
          if (sessionRecords.length === 0) this.bySessionId.delete(oldest.sessionId)
        }
      }
    }
  }
}

/**
 * Redis-backed credential registry implementation (async)
 * Provides persistent storage across server restarts
 *
 * Requires ioredis to be installed: yarn add ioredis
 *
 * Usage:
 *   const registry = new RedisCredentialRegistry({ redisUrl: 'redis://localhost:6379' });
 *   await registry.connect();
 *   await registry.register(record);
 */
export class RedisCredentialRegistry implements IAsyncCredentialRegistry {
  private redis: any // Redis client (dynamically imported)
  private readonly prefix: string
  private readonly ttl: number
  private readonly maxRecords: number | undefined
  private readonly redisUrl: string
  private connected: boolean = false

  constructor(config: RegistryConfig) {
    if (!config.redisUrl) {
      throw new Error('Redis URL is required for RedisCredentialRegistry')
    }
    this.redisUrl = config.redisUrl
    this.prefix = config.redisPrefix ?? 'witness:'
    this.ttl = config.redisTtl ?? 0
    // Redis: unlimited by default (relies on TTL), only limit if explicitly configured
    this.maxRecords = config.maxRecords
  }

  /**
   * Initialize the Redis connection
   * Must be called before using the registry
   */
  public async connect(): Promise<void> {
    if (this.connected) return

    try {
      // Dynamically import ioredis
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Redis = require('ioredis')
      this.redis = new Redis(this.redisUrl)

      // Test connection
      await this.redis.ping()
      this.connected = true
      console.log(`[RedisRegistry] Connected to Redis at ${this.redisUrl}`)
    } catch (error) {
      throw new Error(`Failed to connect to Redis: ${(error as Error).message}`)
    }
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('Redis registry not connected. Call connect() first.')
    }
  }

  private recordKey(vwcId: string): string {
    return `${this.prefix}record:${vwcId}`
  }

  private digestKey(digest: string): string {
    return `${this.prefix}digest:${digest}`
  }

  private sessionKey(sessionId: string): string {
    return `${this.prefix}session:${sessionId}`
  }

  private listKey(): string {
    return `${this.prefix}list`
  }

  private issuersKey(): string {
    return `${this.prefix}issuers`
  }

  private serializeRecord(record: IssuedCredentialRecord): string {
    return JSON.stringify({
      ...record,
      issuedAt: record.issuedAt.toISOString(),
    })
  }

  private deserializeRecord(json: string): IssuedCredentialRecord {
    const data = JSON.parse(json)
    return {
      ...data,
      issuedAt: new Date(data.issuedAt),
    }
  }

  public async register(record: IssuedCredentialRecord): Promise<void> {
    this.ensureConnected()

    const serialized = this.serializeRecord(record)

    // Use a transaction for atomicity
    const multi = this.redis.multi()

    // Store the record
    if (this.ttl > 0) {
      multi.setex(this.recordKey(record.vwcId), this.ttl, serialized)
    } else {
      multi.set(this.recordKey(record.vwcId), serialized)
    }

    // Add to indexes
    multi.lpush(this.listKey(), record.vwcId)
    multi.sadd(this.digestKey(record.vrcDigest), record.vwcId)
    multi.sadd(this.sessionKey(record.sessionId), record.vwcId)
    multi.sadd(this.issuersKey(), record.vrcIssuerId)

    await multi.exec()

    // Enforce max records limit
    await this.pruneOldRecords()
  }

  public async findByVwcId(vwcId: string): Promise<IssuedCredentialRecord | undefined> {
    this.ensureConnected()
    const json = await this.redis.get(this.recordKey(vwcId))
    return json ? this.deserializeRecord(json) : undefined
  }

  public async findByDigest(digest: string): Promise<IssuedCredentialRecord[]> {
    this.ensureConnected()
    const vwcIds = await this.redis.smembers(this.digestKey(digest))
    const records: IssuedCredentialRecord[] = []

    for (const vwcId of vwcIds) {
      const record = await this.findByVwcId(vwcId)
      if (record) records.push(record)
    }

    return records
  }

  public async findBySessionId(sessionId: string): Promise<IssuedCredentialRecord[]> {
    this.ensureConnected()
    const vwcIds = await this.redis.smembers(this.sessionKey(sessionId))
    const records: IssuedCredentialRecord[] = []

    for (const vwcId of vwcIds) {
      const record = await this.findByVwcId(vwcId)
      if (record) records.push(record)
    }

    return records
  }

  public async hasVwcId(vwcId: string): Promise<boolean> {
    this.ensureConnected()
    const exists = await this.redis.exists(this.recordKey(vwcId))
    return exists === 1
  }

  public async getAll(): Promise<IssuedCredentialRecord[]> {
    this.ensureConnected()
    const vwcIds = await this.redis.lrange(this.listKey(), 0, -1)
    const records: IssuedCredentialRecord[] = []

    for (const vwcId of vwcIds) {
      const record = await this.findByVwcId(vwcId)
      if (record) records.push(record)
    }

    return records
  }

  public async getRecent(limit: number = 50): Promise<IssuedCredentialRecord[]> {
    this.ensureConnected()
    const vwcIds = await this.redis.lrange(this.listKey(), 0, limit - 1)
    const records: IssuedCredentialRecord[] = []

    for (const vwcId of vwcIds) {
      const record = await this.findByVwcId(vwcId)
      if (record) records.push(record)
    }

    return records
  }

  public async getPaginated(page: number = 1, pageSize: number = 20): Promise<PaginatedResult> {
    this.ensureConnected()

    const total = await this.redis.llen(this.listKey())
    const totalPages = Math.ceil(total / pageSize)
    const start = (page - 1) * pageSize
    const end = start + pageSize - 1

    const vwcIds = await this.redis.lrange(this.listKey(), start, end)
    const records: IssuedCredentialRecord[] = []

    for (const vwcId of vwcIds) {
      const record = await this.findByVwcId(vwcId)
      if (record) records.push(record)
    }

    return {
      records,
      total,
      page,
      pageSize,
      totalPages,
    }
  }

  public async getCount(): Promise<number> {
    this.ensureConnected()
    return this.redis.llen(this.listKey())
  }

  public async getSessionCount(): Promise<number> {
    this.ensureConnected()
    // Count unique session keys by scanning
    let cursor = '0'
    const sessionIds = new Set<string>()

    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', `${this.prefix}session:*`, 'COUNT', 100)
      cursor = nextCursor
      keys.forEach((key: string) => sessionIds.add(key))
    } while (cursor !== '0')

    return sessionIds.size
  }

  public async getStats(): Promise<RegistryStats> {
    this.ensureConnected()

    const totalCredentials = await this.getCount()
    const totalSessions = await this.getSessionCount()
    const uniqueVrcIssuers = await this.redis.scard(this.issuersKey())

    // Get oldest and newest by looking at list ends
    let oldestRecord: Date | undefined
    let newestRecord: Date | undefined

    const newestId = await this.redis.lindex(this.listKey(), 0)
    if (newestId) {
      const newest = await this.findByVwcId(newestId)
      if (newest) newestRecord = newest.issuedAt
    }

    const oldestId = await this.redis.lindex(this.listKey(), -1)
    if (oldestId) {
      const oldest = await this.findByVwcId(oldestId)
      if (oldest) oldestRecord = oldest.issuedAt
    }

    return {
      totalCredentials,
      totalSessions,
      uniqueVrcIssuers,
      oldestRecord,
      newestRecord,
    }
  }

  public async clear(): Promise<void> {
    this.ensureConnected()

    // Get all keys with our prefix and delete them
    let cursor = '0'
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', `${this.prefix}*`, 'COUNT', 100)
      cursor = nextCursor
      if (keys.length > 0) {
        await this.redis.del(...keys)
      }
    } while (cursor !== '0')
  }

  public async close(): Promise<void> {
    if (this.redis && this.connected) {
      await this.redis.quit()
      this.connected = false
    }
  }

  private async pruneOldRecords(): Promise<void> {
    // Skip pruning if no limit configured (unlimited storage, relies on TTL)
    if (!this.maxRecords || this.maxRecords <= 0) return

    const count = await this.redis.llen(this.listKey())
    if (count <= this.maxRecords) return

    // Get the IDs to remove (oldest ones)
    const toRemove = count - this.maxRecords
    const oldIds = await this.redis.lrange(this.listKey(), -toRemove, -1)

    for (const vwcId of oldIds) {
      const record = await this.findByVwcId(vwcId)
      if (record) {
        // Remove from indexes
        await this.redis.del(this.recordKey(vwcId))
        await this.redis.srem(this.digestKey(record.vrcDigest), vwcId)
        await this.redis.srem(this.sessionKey(record.sessionId), vwcId)
      }
    }

    // Trim the list
    await this.redis.ltrim(this.listKey(), 0, this.maxRecords - 1)
  }
}

/**
 * Factory function to create a credential registry based on configuration
 *
 * Usage:
 *   // In-memory (default)
 *   const registry = await createCredentialRegistry();
 *
 *   // Redis-backed
 *   const registry = await createCredentialRegistry({
 *     storage: 'redis',
 *     redisUrl: 'redis://localhost:6379',
 *     redisPrefix: 'witness:',
 *     redisTtl: 86400, // 24 hours
 *   });
 */
export async function createCredentialRegistry(
  config?: RegistryConfig
): Promise<CredentialRegistry | RedisCredentialRegistry> {
  const storage = config?.storage ?? 'memory'

  if (storage === 'redis') {
    if (!config?.redisUrl) {
      throw new Error('Redis URL is required when using redis storage')
    }
    const registry = new RedisCredentialRegistry(config)
    await registry.connect()
    return registry
  }

  return new CredentialRegistry(config)
}
