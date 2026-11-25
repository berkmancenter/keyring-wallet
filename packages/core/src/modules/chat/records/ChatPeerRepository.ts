import { AgentContext, EventEmitter, Repository, StorageService } from '@credo-ts/core'

import { ChatPeerRecord } from './ChatPeerRecord'

/** Storage for per-contact chat support, following Credo's standard repository pattern. */
export class ChatPeerRepository extends Repository<ChatPeerRecord> {
  public constructor(storageService: StorageService<ChatPeerRecord>, eventEmitter: EventEmitter) {
    super(ChatPeerRecord, storageService, eventEmitter)
  }

  public async findByConnection(agentContext: AgentContext, connectionId: string): Promise<ChatPeerRecord | null> {
    const records = await this.findByQuery(agentContext, { connectionId })
    return records[0] ?? null
  }
}
