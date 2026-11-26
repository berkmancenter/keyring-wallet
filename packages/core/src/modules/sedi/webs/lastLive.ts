/**
 * The last LIVE resolution of each did:webs, kept in memory for a short while so that a host which blips (the demo's
 * temporary tunnel) does not turn a card that checked out a minute ago into "Couldn't reach the state".
 *
 * What is reused, and what never is:
 * - Only a SUCCESSFUL resolution this phone made itself is kept: the verified bytes of the root's KEL as that host
 *   served them, with the time. A failure is never kept, so it can never stand in for a later check.
 * - It is OUR OWN earlier live observation. It is never the copy a card carries, and never a copy held anywhere else.
 * - The key is the exact did:webs that was fetched, which names the host and the AID. A new host (every tunnel run
 *   has a new one) never reuses what another host served.
 * - Only the KEL is reused, not a verdict: the whole Guardian check runs again on it with today's inputs (the ward,
 *   the roots this build trusts with their names and demo marks, the card's own text, the clock), so nothing else the
 *   verdict depends on can be stale.
 * - Only within LIVE_REUSE_MS of that success, and only after a fetch of the same did:webs has just failed. Past that,
 *   or with nothing kept, the check refuses as before (`stateNotResolved`, "Couldn't reach the state").
 * - Memory only: a restart or an OTA forgets everything. With trusted approvers or state-verified approvers off, or
 *   the SEDI/KERI umbrella set, nothing is reused and nothing is kept; any resolution asked for while they are off
 *   drops what was kept. (While they are off nothing asks: Who approves and the state card check nothing.)
 *
 * The cost, in plain words: while a state's host is unreachable, a rotation or revocation the state published after
 * our last successful fetch can take up to five minutes to show. Alberto accepted that for the demo (2026-11-11:
 * "Yes to the 5minite reuse", "5min reuse is fine"). The screen says the result is not fresh ("Fetched live from
 * <host> at <time>"), so nobody reads a reused result as one fetched just now.
 *
 * @module sedi/webs/lastLive
 */
import { isStateVerifiedApproversEnabled } from '../../trust-tasks/module/stateVerifiedApproversFlag'
import { isTrustedApproversEnabled } from '../../trust-tasks/module/trustedApproversFlag'

import type { RootKel, RootKelResolver } from './rootKel'

/** Five minutes. A success is reused while it is strictly younger than this; at exactly five minutes it is not. */
export const LIVE_REUSE_MS = 5 * 60 * 1000

/** A resolution as the Guardian check uses it: when it was fetched, and whether that fetch is a reused earlier one. */
export type LiveRootKel =
  | { ok: true; aid: string; kel: Uint8Array; fetchedAt: string; reused: boolean }
  | Extract<RootKel, { ok: false }>

const kept = new Map<string, { aid: string; kel: Uint8Array; at: number; fetchedAt: string }>()

const on = () => isTrustedApproversEnabled() && isStateVerifiedApproversEnabled()

/**
 * Resolve `did` through `resolver`; if that fails, our own last success for the same did:webs within LIVE_REUSE_MS
 * instead (marked `reused`, with the time of that success). A success replaces what was kept; a failure keeps nothing.
 */
export async function resolveRootKelReusing(did: string, resolver: RootKelResolver, now: Date): Promise<LiveRootKel> {
  if (!on()) kept.clear()
  const r = await resolver(did)
  if (r.ok) {
    if (on()) kept.set(did, { aid: r.aid, kel: r.kel, at: now.getTime(), fetchedAt: now.toISOString() })
    return { ok: true, aid: r.aid, kel: r.kel, fetchedAt: now.toISOString(), reused: false }
  }
  const last = on() ? kept.get(did) : undefined
  if (last && now.getTime() - last.at < LIVE_REUSE_MS)
    return { ok: true, aid: last.aid, kel: last.kel, fetchedAt: last.fetchedAt, reused: true }
  return r
}

/** Tests only: what a restart does (nothing kept). No production code calls it. */
export function resetLiveResolutions(): void {
  kept.clear()
}
