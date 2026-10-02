/**
 * waitingRequests — the requests that wait for this phone's decision.
 *
 * A request the agent sent for consent waits while it is `pending` and its
 * expiry has not passed. Decided, failed and expired requests do not wait.
 * This is the one count the app shows: the badge on the My Agent tab and the
 * "something waits" banner on "Your agent" read it from here, so they agree,
 * and neither needs the agent screen to have been opened.
 *
 * @module trust-tasks/module/waitingRequests
 */
import type { TFunction } from 'i18next'
import { useEffect, useState, useSyncExternalStore } from 'react'

import { vtaAgent, type VtiApproval } from './vtaAgent'

const expiryOf = (approval: Pick<VtiApproval, 'expiresAt'>): number | undefined => {
  const at = Date.parse(String(approval.expiresAt ?? ''))
  return Number.isFinite(at) ? at : undefined
}

/**
 * The requests still waiting at `now`. A request whose expiry cannot be read
 * is kept: better a request shown that the agent then refuses than one hidden.
 */
export function waitingRequests<T extends Pick<VtiApproval, 'status' | 'expiresAt'>>(approvals: T[], now: number): T[] {
  return approvals.filter((approval) => {
    if (approval.status !== 'pending') return false
    const expiry = expiryOf(approval)
    return expiry === undefined || expiry > now
  })
}

/** When the next of these expires, if any has an expiry. */
export function nextExpiry(waiting: Array<Pick<VtiApproval, 'expiresAt'>>): number | undefined {
  const times = waiting.map(expiryOf).filter((at): at is number => at !== undefined)
  return times.length ? Math.min(...times) : undefined
}

/** The longest a timer can be set for. */
const MAX_TIMER_MS = 2 ** 31 - 1

/**
 * How many requests wait for this phone's decision, kept current: it drops
 * when one is decided, and when one expires, with nothing else happening.
 */
export function useWaitingRequestsCount(clock: () => number = Date.now): number {
  const approvals = useSyncExternalStore(vtaAgent.subscribe, () => vtaAgent.getState().approvals)
  const [, look] = useState(0)
  const waiting = waitingRequests(approvals, clock())
  const next = nextExpiry(waiting)
  useEffect(() => {
    if (next === undefined) return
    const timer = setTimeout(() => look((n) => n + 1), Math.min(Math.max(next - clock(), 0) + 50, MAX_TIMER_MS))
    return () => clearTimeout(timer)
  }, [next, clock])
  return waiting.length
}

/** The My Agent tab's badge and spoken label for a count of waiting requests. */
export function myAgentTabBadge(count: number, t: TFunction): { badge: number | undefined; label: string } {
  return count > 0
    ? { badge: count, label: `${t('TabStack.MyAgent')}, ${t('TabStack.RequestsWaiting', { count })}` }
    : { badge: undefined, label: t('TabStack.MyAgent') as string }
}
