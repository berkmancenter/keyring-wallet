/**
 * Keyring's chat identity for one agent (docs/plans/agent-connect-plan.md §3.5, §3.2 step 13; backlog 2 fb-C1).
 *
 * Keyring talks to an agent `K_a` from its own pairwise key `K_c`, a fresh `did:key` made for that agent alone (its
 * **`chatDid`**), signed in at the mediator the chat uses. Its chat module keeps the conversation's events under
 * `chatConnectionId`, `agent-chat:<record id>`, so `modules/chat/`'s storage and `mergeByTime` run unchanged; only the
 * send is replaced (`./carrier.ts`).
 *
 * **Made once, never moved.** Each member is written only while it is absent, inside the store's own read-modify-write
 * (`AgentConnectionStore.update`), so a concurrent writer is never overwritten and a record that already has a
 * `chatDid` keeps it. The agent will take chat only from the `chatDid` it was given (§3.2 step 13), so a second key
 * would cut the chat off for good.
 *
 * **Not announced.** Nothing here tells the agent `chatDid` or the mediator; how they reach it is the plan owner's open
 * question (§11 Q7: the VTA writes them into `redeem`'s `ext`, or Keyring's first message names them, signed by
 * `ownerPersonaDid`). That lands with the answer.
 *
 * @module connected-agents/chat/chatIdentity
 */

import type { Agent } from '@credo-ts/core'

import { createVtiTemporaryDidKey } from '../../trust-tasks/module/VtiMediatorTransport'
import type { AgentConnectionStore } from '../store'
import type { AgentConnection } from '../types'

/** The prefix of a chat's connection id; the record's `id` follows it. */
export const AGENT_CHAT_CONNECTION_PREFIX = 'agent-chat:'

/** The chat module's connection id for an agent's chat: `agent-chat:<record id>`. */
export const agentChatConnectionId = (recordId: string): string => `${AGENT_CHAT_CONNECTION_PREFIX}${recordId}`

/** The record id an agent chat's connection id names, or undefined when it is not an agent chat's. */
export const recordIdOfChatConnection = (connectionId: string): string | undefined =>
  connectionId.startsWith(AGENT_CHAT_CONNECTION_PREFIX) && connectionId.length > AGENT_CHAT_CONNECTION_PREFIX.length
    ? connectionId.slice(AGENT_CHAT_CONNECTION_PREFIX.length)
    : undefined

/** Keyring's chat identity for one agent. */
export type ChatIdentity = { chatDid: string; chatConnectionId: string }

/** What makes `K_c`: a fresh Ed25519 `did:key` whose key stays in the KMS. {@link chatIdentityKms} in the app. */
export interface ChatIdentityKms {
  createDidKey(): Promise<string>
}

/**
 * The app's {@link ChatIdentityKms}: one new Ed25519 key in Askar, imported as a `did:key` with both its Ed25519 and
 * its derived X25519 methods (`createVtiTemporaryDidKey`), so the key signs in at a mediator, authcrypts, and signs.
 */
export const chatIdentityKms = (agent: Agent): ChatIdentityKms => ({
  createDidKey: () => createVtiTemporaryDidKey(agent),
})

/** Thrown when the record to give a chat identity is gone. */
export class AgentChatRecordMissing extends Error {
  public constructor(public readonly recordId: string) {
    super(`no agent connection ${recordId} to give a chat identity`)
    this.name = 'AgentChatRecordMissing'
  }
}

/** A mint in progress per record, so two calls at once in this process make one key, not two. */
const minting = new Map<string, Promise<ChatIdentity>>()

/**
 * The chat identity of `record`'s agent: made the first time, read every time after. `chatDid` is minted only when the
 * record (as it is in the store, not as it was handed in) has none; `chatConnectionId` is set only when absent. Both
 * are written with `store.update(id, r => ({ ...r, chatDid, chatConnectionId }))`, keeping whatever the record already
 * holds. Throws {@link AgentChatRecordMissing} when the record is gone.
 */
export function ensureChatIdentity(
  store: AgentConnectionStore,
  record: AgentConnection,
  kms: ChatIdentityKms
): Promise<ChatIdentity> {
  if (record.chatDid && record.chatConnectionId) {
    return Promise.resolve({ chatDid: record.chatDid, chatConnectionId: record.chatConnectionId })
  }
  const running = minting.get(record.id)
  if (running) return running
  const run = mint(store, record.id, kms).finally(() => {
    if (minting.get(record.id) === run) minting.delete(record.id)
  })
  minting.set(record.id, run)
  return run
}

async function mint(store: AgentConnectionStore, id: string, kms: ChatIdentityKms): Promise<ChatIdentity> {
  // Read again: the record handed in may be older than the store's, and a key minted beside a kept one is never used.
  const current = await store.get(id)
  if (!current) throw new AgentChatRecordMissing(id)
  const minted = current.chatDid ? undefined : await kms.createDidKey()
  const written = await store.update(id, (r) => {
    const chatDid = r.chatDid ?? minted
    const chatConnectionId = r.chatConnectionId ?? agentChatConnectionId(id)
    if (r.chatDid === chatDid && r.chatConnectionId === chatConnectionId) return r
    return { ...r, chatDid, chatConnectionId }
  })
  if (!written) throw new AgentChatRecordMissing(id)
  // Only when another writer took `chatDid` away between the read and the write, which nothing here does.
  if (!written.chatDid || !written.chatConnectionId) throw new Error(`the chat identity of ${id} was not kept`)
  return { chatDid: written.chatDid, chatConnectionId: written.chatConnectionId }
}
