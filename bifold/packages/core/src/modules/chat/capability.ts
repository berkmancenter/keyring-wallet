/**
 * Whether a contact speaks `keyring/chat/1.0`.
 *
 * Keyring has no DIDComm Discover Features exchange. A contact's
 * capabilities come from the RCE version it announces in the relationship
 * handshake (`vrc:rceVersion:<n>`), stored on its RelationshipDidRecord, the
 * same check VRC issuance uses (`counterpartyRceVersionAtLeast` in
 * vrc-manager.ts). Version 6 means "speaks keyring/chat/1.0".
 *
 * @module chat/capability
 */

import type { Agent } from '@credo-ts/core'

import { RelationshipDidRepository } from '../vrc/repositories/RelationshipDidRepository'

/** The first RCE protocol version whose peers speak `keyring/chat/1.0`. */
export const CHAT_MIN_RCE_VERSION = 6

/**
 * True only when the contact on this connection announced at least
 * {@link CHAT_MIN_RCE_VERSION}. A contact that never announced a version, or
 * any lookup failure, counts as "no", so an older contact keeps getting plain
 * BasicMessages it can read.
 */
export async function counterpartySpeaksChat(agent: Agent, connectionId: string): Promise<boolean> {
  try {
    const connection = await agent.modules.didcomm.connections.getById(connectionId)
    if (!connection.theirDid) return false
    const repository = agent.dependencyManager.resolve(RelationshipDidRepository)
    const record = await repository.findByConnectionDid(agent.context, connection.theirDid)
    return (record?.counterpartyRceVersion ?? 1) >= CHAT_MIN_RCE_VERSION
  } catch {
    return false
  }
}
