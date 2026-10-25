/**
 * Whether a contact speaks `keyring/chat/1.0`.
 *
 * Keyring has no DIDComm Discover Features exchange. A contact's
 * capabilities come from the RCE version it announces in the relationship
 * handshake (`vrc:rceVersion:<n>`), stored on its RelationshipDidRecord, the
 * same check VRC issuance uses (`counterpartyRceVersionAtLeast` in
 * vrc-manager.ts). Version 6 means "speaks keyring/chat/1.0".
 *
 * Chat events ride DIDComm v1 connections only, for now. Over v2 (and TSP) a
 * message can reach a connection with no authenticated sender, and the
 * inbound handler drops those (`no-authenticated-sender` in inbound.ts).
 * Until chat over v2 is designed on purpose, a v2 connection counts as "no",
 * so it keeps today's plain BasicMessages.
 *
 * @module chat/capability
 */

import type { Agent } from '@credo-ts/core'

import { RelationshipDidRepository } from '../vrc/repositories/RelationshipDidRepository'

/** The first RCE protocol version whose peers speak `keyring/chat/1.0`. */
export const CHAT_MIN_RCE_VERSION = 6

/**
 * True only when the contact on this connection announced at least
 * {@link CHAT_MIN_RCE_VERSION}, on a DIDComm v1 connection. A contact that
 * never announced a version, a v2 connection, or any lookup failure counts as
 * "no", so the contact keeps getting plain BasicMessages it can read.
 */
export async function counterpartySpeaksChat(agent: Agent, connectionId: string): Promise<boolean> {
  try {
    const connection = await agent.modules.didcomm.connections.getById(connectionId)
    if (!connection.theirDid || connection.didcommVersion === 'v2') return false
    const repository = agent.dependencyManager.resolve(RelationshipDidRepository)
    const record = await repository.findByConnectionDid(agent.context, connection.theirDid)
    return (record?.counterpartyRceVersion ?? 1) >= CHAT_MIN_RCE_VERSION
  } catch {
    return false
  }
}
