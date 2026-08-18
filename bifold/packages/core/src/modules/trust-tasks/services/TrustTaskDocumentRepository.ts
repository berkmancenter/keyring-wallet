/**
 * TrustTaskDocumentRepository
 *
 * Repository over TrustTaskDocumentRecord. The query the ceremony layer needs
 * most is "the outcome-evidence pair for exchange X": the initiating document
 * plus its terminal success response.
 *
 * Note: uses factory registration for DI (no decorators), matching the VRC
 * module's repositories.
 *
 * @module trust-tasks/services/TrustTaskDocumentRepository
 */

import { AgentContext, Repository, StorageService, EventEmitter } from '@credo-ts/core'

import { TrustTaskDocumentRecord } from './TrustTaskDocumentRecord'

export class TrustTaskDocumentRepository extends Repository<TrustTaskDocumentRecord> {
  public constructor(storageService: StorageService<TrustTaskDocumentRecord>, eventEmitter: EventEmitter) {
    super(TrustTaskDocumentRecord, storageService, eventEmitter)
  }

  /** All documents of one exchange, oldest first. */
  public async findByExchangeId(agentContext: AgentContext, exchangeId: string): Promise<TrustTaskDocumentRecord[]> {
    const records = await this.findByQuery(agentContext, { exchangeId })
    return records.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }

  /**
   * The outcome-evidence pair for an exchange (cred-spec Outcome
   * Interpretability): the initiating document (role `request`, id ==
   * exchangeId) and the terminal `#response`. Either half may be missing —
   * callers must treat an incomplete pair as non-evidence.
   */
  public async findOutcomeEvidencePair(
    agentContext: AgentContext,
    exchangeId: string
  ): Promise<{ initiating?: TrustTaskDocumentRecord; terminal?: TrustTaskDocumentRecord }> {
    const records = await this.findByExchangeId(agentContext, exchangeId)
    const initiating = records.find((r) => r.role === 'request' && String(r.document.id) === exchangeId)
    const terminal = records.find((r) => r.role === 'response' && String(r.document.type ?? '').endsWith('#response'))
    return { initiating, terminal }
  }
}
