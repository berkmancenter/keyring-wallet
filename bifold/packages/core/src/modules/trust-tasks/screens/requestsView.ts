/**
 * requestsView — what the Requests screen shows.
 *
 * Requests reach the phone only as messages over the live agent connection:
 * there is no call that lists them. So "nothing is waiting" can be said only
 * once the connection has been up and quiet for a while ({@link QUIET_MS});
 * until then the screen says it is getting them. A request that arrives later
 * still shows.
 *
 * Pure: this decides what is shown; `VtaRequests` words it.
 *
 * @module trust-tasks/screens/requestsView
 */
import type { VtiApproval } from '../module/vtaAgent'
import type { VtaLinkState } from '../module/vtaLinkMachine'
import { waitingRequests } from '../module/waitingRequests'

/** How long the connection must have been up, with nothing received, before "nothing is waiting". */
export const QUIET_MS = 10_000

export type RequestsMode =
  /** Not linked to an agent: there is nothing this screen can show. */
  | 'notLinked'
  /** One or more requests wait for a decision. */
  | 'waiting'
  /** The person just decided, and nothing else waits. */
  | 'done'
  /** Nothing waits, but a request that reached this phone has expired: its card says so. */
  | 'expired'
  /** The connection is coming up, or has not been quiet long enough. */
  | 'loading'
  /** Connected and quiet: nothing waits. */
  | 'empty'
  /** The agent cannot be reached. */
  | 'unreachable'

export interface RequestsView {
  mode: RequestsMode
  /** Waiting for a decision, newest first. */
  waiting: VtiApproval[]
  /** Still undecided, past their expiry: shown without buttons. */
  expired: VtiApproval[]
  /** Decided in this session, or failed to send: shown under "Earlier". */
  earlier: VtiApproval[]
  /** What the person just decided, said above whatever else shows. */
  decided?: 'approved' | 'denied'
}

export interface RequestsInput {
  link: VtaLinkState
  /** Reconnecting stopped after its tries: the agent did not answer. */
  reconnectGaveUp?: boolean
  approvals: VtiApproval[]
  now: number
  /** When this screen first saw the connection up; undefined while it is not. */
  onlineSince?: number
  /** The decision the person just made on this screen, if any. */
  decided?: 'approved' | 'denied'
}

export function requestsView(input: RequestsInput): RequestsView {
  const { link, approvals, now, decided } = input
  const waiting = waitingRequests(approvals, now)
  const expired = approvals.filter(
    (approval) => (approval.status === 'pending' && !waiting.includes(approval)) || approval.status === 'expired'
  )
  const earlier = approvals.filter(
    (approval) => approval.status === 'approved' || approval.status === 'denied' || approval.status === 'failed'
  )
  const lists = { waiting, expired, earlier, ...(decided ? { decided } : {}) }

  if (link.kind !== 'linked') return { mode: 'notLinked', ...lists }
  if (waiting.length > 0) return { mode: 'waiting', ...lists }
  if (decided) return { mode: 'done', ...lists }
  if (expired.length > 0) return { mode: 'expired', ...lists }

  const connection = link.connection.kind
  if (input.reconnectGaveUp || connection === 'offline') return { mode: 'unreachable', ...lists }
  if (connection === 'online' && input.onlineSince !== undefined && now - input.onlineSince >= QUIET_MS) {
    return { mode: 'empty', ...lists }
  }
  return { mode: 'loading', ...lists }
}
