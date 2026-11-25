import { AgentContext, EventEmitter, Repository, StorageService } from '@credo-ts/core'

import { ChatEventRecord, ChatEventRole } from './ChatEventRecord'

/** Storage for chat events, following Credo's standard repository pattern. */
export class ChatEventRepository extends Repository<ChatEventRecord> {
  public constructor(storageService: StorageService<ChatEventRecord>, eventEmitter: EventEmitter) {
    super(ChatEventRecord, storageService, eventEmitter)
  }

  /** The stored copy of one event, if this phone already has it. */
  public async findEvent(
    agentContext: AgentContext,
    connectionId: string,
    role: ChatEventRole,
    eventId: string
  ): Promise<ChatEventRecord | null> {
    const records = await this.findByQuery(agentContext, { connectionId, role, eventId })
    return records[0] ?? null
  }

  /** Every stored event of one chat. */
  public async findByConnection(agentContext: AgentContext, connectionId: string): Promise<ChatEventRecord[]> {
    return this.findByQuery(agentContext, { connectionId })
  }
}
