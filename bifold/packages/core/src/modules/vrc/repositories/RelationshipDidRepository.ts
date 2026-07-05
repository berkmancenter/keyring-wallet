import { AgentContext, EventEmitter, Repository, StorageService } from '@credo-ts/core'
import { RelationshipDidRecord } from '../types/RelationshipDidRecord'

/**
 * Repository for managing RelationshipDidRecord storage
 * Follows Credo's standard repository pattern
 */
export class RelationshipDidRepository extends Repository<RelationshipDidRecord> {
  public constructor(storageService: StorageService<RelationshipDidRecord>, eventEmitter: EventEmitter) {
    super(RelationshipDidRecord, storageService, eventEmitter)
  }

  /**
   * Find a relationship DID record by the connection's theirDid (counterpartyConnectionDid)
   */
  async findByConnectionDid(
    agentContext: AgentContext,
    counterpartyConnectionDid: string
  ): Promise<RelationshipDidRecord | null> {
    const records = await this.findByQuery(agentContext, { counterpartyConnectionDid })
    return records[0] ?? null
  }

  /**
   * Find a relationship DID record by counterparty's relationship DID
   * This is the DID used as issuer.id in VRC credentials
   *
   * Note: Falls back to manual search for records created before tag indexing was added
   */
  async findByCounterpartyRelationshipDid(
    agentContext: AgentContext,
    counterpartyRelationshipDid: string
  ): Promise<RelationshipDidRecord | null> {
    // Try tag-based query first (fast)
    const records = await this.findByQuery(agentContext, { counterpartyRelationshipDid })
    if (records.length > 0) {
      return records[0]
    }

    // Fallback: manual search for records created before tag indexing was added
    const allRecords = await this.getAll(agentContext)
    return allRecords.find((r) => r.counterpartyRelationshipDid === counterpartyRelationshipDid) ?? null
  }

  /**
   * Create or update a relationship DID record
   */
  async createOrUpdate(
    agentContext: AgentContext,
    counterpartyConnectionDid: string,
    myRelationshipDid: string,
    connectionId?: string
  ): Promise<RelationshipDidRecord> {
    const existingRecord = await this.findByConnectionDid(agentContext, counterpartyConnectionDid)

    if (existingRecord) {
      existingRecord.myRelationshipDid = myRelationshipDid
      if (connectionId) {
        existingRecord.connectionId = connectionId
      }
      await this.update(agentContext, existingRecord)
      return existingRecord
    }

    const newRecord = new RelationshipDidRecord({
      counterpartyConnectionDid,
      myRelationshipDid,
      connectionId,
    })

    await this.save(agentContext, newRecord)
    return newRecord
  }

  /**
   * Get all relationship DID records
   */
  async getAll(agentContext: AgentContext): Promise<RelationshipDidRecord[]> {
    return this.findByQuery(agentContext, {})
  }

  /**
   * Update the counterparty's relationshipDid in an existing record
   */
  async updateCounterpartyRelationshipDid(
    agentContext: AgentContext,
    counterpartyConnectionDid: string,
    counterpartyRelationshipDid: string
  ): Promise<RelationshipDidRecord | null> {
    const record = await this.findByConnectionDid(agentContext, counterpartyConnectionDid)

    if (!record) {
      return null
    }

    record.counterpartyRelationshipDid = counterpartyRelationshipDid
    await this.update(agentContext, record)
    return record
  }

  /**
   * Delete a RelationshipDidRecord by connection DID
   */
  async deleteByConnectionDid(agentContext: AgentContext, counterpartyConnectionDid: string): Promise<void> {
    const record = await this.findByConnectionDid(agentContext, counterpartyConnectionDid)
    if (record) {
      await this.delete(agentContext, record)
    }
  }
}
