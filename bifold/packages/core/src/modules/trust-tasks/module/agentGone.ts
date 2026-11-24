/**
 * Whether the linked agent is gone for good, rather than only out of reach.
 *
 * Retrying forever suits an agent that is offline for a while; it does not
 * suit one that no longer exists (the Farm wipe of 09-29 left testers linked
 * to agents that did not), where the person needs to hear it and link a new
 * one. Gone is either:
 *  - its address does not exist: the DID host answered "not found" on two
 *    checks at least `AGENT_NOT_FOUND_CONFIRM_MS` apart, since one could be a
 *    host mid-redeploy;
 *  - this phone has not reached it for `AGENT_UNREACHABLE_GONE_MS`.
 *
 * Both thresholds are the recommended values of decision #41, which is still
 * open: change them here when it is answered.
 *
 * @module trust-tasks/module/agentGone
 */

/** Two "not found" answers at least this far apart make the address gone (decision #41). */
export const AGENT_NOT_FOUND_CONFIRM_MS = 60 * 60 * 1000

/** Not reaching the agent for this long makes it gone (decision #41). */
export const AGENT_UNREACHABLE_GONE_MS = 3 * 24 * 60 * 60 * 1000

export type AgentGoneWhy = 'notFound' | 'unreachable'

/** What the link record keeps for this: when the phone last reached the agent, and the first "not found" since. */
export interface AgentReachHistory {
  linkedAt: string
  lastOnlineAt?: number
  notFoundAt?: number
}

/**
 * After a failed sign-in: what to keep of the "not found" history, and whether
 * the agent is gone. `notFound` is whether its DID host said, this time, that
 * the address does not exist; undefined when the lookup could not tell (the
 * host did not answer), which neither adds to nor erases what was seen.
 */
export function agentGoneVerdict(
  history: AgentReachHistory,
  seen: { notFound?: boolean; now: number }
): { notFoundAt?: number; gone?: AgentGoneWhy } {
  const notFoundAt =
    seen.notFound === true ? (history.notFoundAt ?? seen.now) : seen.notFound === false ? undefined : history.notFoundAt
  const kept = notFoundAt !== undefined ? { notFoundAt } : {}
  if (seen.notFound === true && notFoundAt !== undefined && seen.now - notFoundAt >= AGENT_NOT_FOUND_CONFIRM_MS)
    return { ...kept, gone: 'notFound' }
  const lastReached = history.lastOnlineAt ?? Date.parse(history.linkedAt)
  if (Number.isFinite(lastReached) && seen.now - lastReached >= AGENT_UNREACHABLE_GONE_MS)
    return { ...kept, gone: 'unreachable' }
  return kept
}
