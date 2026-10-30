/**
 * Whether the person's agent is being reached again, and when it last was: what a rooms screen needs to wait for
 * the agent rather than say it is unreachable, and to read again the moment it is back (#772, 276.9).
 *
 * After an unlock the session reopens behind a link still shown online, so the connection alone does not say it:
 * `sessionOpening` does. An agent offline after its retries, or gone, is not being reached again: a read that
 * failed then says so.
 *
 * @module rooms/agentSession
 */
import { useSyncExternalStore } from 'react'

import { vtaAgent, type VtaAgentState } from '../trust-tasks/module/vtaAgent'

export function agentReconnecting(state: Pick<VtaAgentState, 'link' | 'sessionOpening'>): boolean {
  const { link } = state
  if (link.kind !== 'linked') return false
  return (
    Boolean(state.sessionOpening) || link.connection.kind === 'connecting' || link.connection.kind === 'reconnecting'
  )
}

export interface AgentSession {
  /** The agent is being reached again: a failed read waits for it. */
  reconnecting: boolean
  /** When a session to the agent last opened: a change is "the agent is back". */
  openedAt?: number
}

export function useAgentSession(): AgentSession {
  const reconnecting = useSyncExternalStore(vtaAgent.subscribe, () => agentReconnecting(vtaAgent.getState()))
  const openedAt = useSyncExternalStore(vtaAgent.subscribe, () => vtaAgent.getState().sessionOpenedAt)
  return { reconnecting, openedAt }
}
