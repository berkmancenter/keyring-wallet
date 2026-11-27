/**
 * The shapes the connected-agents logic and its screens share (docs/plans/agent-connect-plan.md §3.11, §6, §7.7).
 *
 * The screens import these names rather than declaring their own, so a status or a memory option has one
 * definition. Nothing here carries copy: every user-visible string is a `ConnectedAgents.*` key in the screens.
 *
 * @module connected-agents/types
 */

import type { AgentPurpose } from './pairing'

/**
 * A row's status, in §6's order: "Connected" (a persistent agent), "Connected until <time>" (a temporary one),
 * "Not connected right now", "Expired", "Not finished", "Revoke not confirmed", "Revoked".
 */
export type AgentStatus =
  | 'connected'
  | 'connectedUntil'
  | 'unreachable'
  | 'expired'
  | 'notFinished'
  | 'revokeNotConfirmed'
  | 'revoked'

/** §6's order, for a reference list and for tests that must cover every status. */
export const AGENT_STATUSES: readonly AgentStatus[] = [
  'connected',
  'connectedUntil',
  'unreachable',
  'expired',
  'notFinished',
  'revokeNotConfirmed',
  'revoked',
]

/** A memory by its context id and the name the owner gave it (§3.15). A context id is never shown as a label. */
export type MemoryRef = { id: string; name: string }

/** A memory as the picker offers it: one that contains other memories cannot be picked (§3.15, §6). */
export type PickerMemory = MemoryRef & { containsOthers: boolean }

/** The answer to "New memory" (§3.15, §6). */
export type CreateMemoryResult = { ok: true; memory: MemoryRef } | { ok: false; code: 'duplicateName' | 'failed' }

/** A connection's stored state (§3.11). */
export type AgentConnectionState = 'pairing' | 'active' | 'expired' | 'revoking' | 'revoked' | 'notFinished'

/**
 * What Keyring keeps per agent (§3.11), as a Credo generic record. Members of §3.11 that later steps own (the chat's
 * `chatDid` and `chatConnectionId`, the VDC pair, `rooms`, `answersOthers`) are optional here and filled by them.
 * No private key of the agent is ever held.
 */
export type AgentConnection = {
  /** The agent's DID (`K_a`): one record per agent. */
  id: string
  name: string
  handle: string
  agentDid: string
  deviceId: string
  ownerPersonaDid: string
  vtaDid: string
  /** Every context in the entry's `act`. */
  contexts: string[]
  /** The agent's bound memory set: exact context ids (§3.15). */
  memoryContexts: string[]
  /**
   * Chosen memories the entry does not hold yet: a one-context grant's remainder (§7.5), shown with "Try again" (§7.7).
   * Not in §3.11's list; it is the record's side of #1048 finding 7.
   */
  pendingContexts: string[]
  capabilities: string[]
  purposes: AgentPurpose[]
  /** ISO 8601; absent once the owner keeps it connected (D42). */
  expiresAt?: string
  grantType: 'temporary' | 'persistent'
  persistentElectedAt?: string
  answersOthers: boolean
  state: AgentConnectionState
  keyChanged: boolean
  lastReconciledAt?: string
  lastSeenAt?: string
  createdAt: string
  chatDid?: string
  mediatorDid?: string
  chatConnectionId?: string
  vdcGrant?: Record<string, unknown>
  vdcAcceptance?: Record<string, unknown>
}

/** What a screen shows for one agent (the seam agreed with the UI/UX lane, 2026-11-26). */
export type AgentView = {
  id: string
  name: string
  handle: string
  status: AgentStatus
  /** Epoch ms; absent for a persistent agent. */
  expiresAt?: number
  grantType: 'temporary' | 'persistent'
  purposes: AgentPurpose[]
  keyChanged: boolean
  /** The entry holds memories the owner did not bind (`extra`), or lost some (`missing`) (§3.15 step 5). */
  drift?: { extra: MemoryRef[]; missing: MemoryRef[] }
  /** Chosen memories a one-context grant has not reached yet (§7.5), with "Try again". Not drift. */
  pending: MemoryRef[]
  memories: MemoryRef[]
  /** The persona's display name, for "Belongs to <owner>". */
  ownerName?: string
}
