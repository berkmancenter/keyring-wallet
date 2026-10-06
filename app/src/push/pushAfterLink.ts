/**
 * Make the phone wakeable by each agent it works with, for a person who has
 * notifications turned on.
 *
 * Turning notifications on (in onboarding, or in Settings before any agent is
 * linked) only records the choice and the system permission: with no agent
 * there is nothing to give a wake channel to (`enablePushWake` answers
 * `notLinked`). Without this, the Settings switch would show on and the agent
 * would never wake the phone. So when the agent link controller reports a new
 * link, and the person has notifications on, this does what the switch does.
 *
 * Also when the phone switches to another of its agents: each agent holds its
 * own wake channel, and one linked or switched to while notifications were
 * already on was left without one until the switch was turned off and on
 * (Alberto's iPhone, 10-06: al-signer's `device list` said pushCapable false).
 * And a try that fails is tried again on a timer, not only when the link next
 * changes: right after a link the session is busy, and one refusal or timeout
 * left the agent with no wake channel for the rest of the session.
 *
 * A link restored at launch does not count: an already wakeable phone is not
 * registered again at every start.
 */
import { isHandleLimitRefusal } from './pushGateway'
import type { PushWakeOutcome } from './pushWake'

/** The parts of bifold's `vtaAgent` this reads. */
export interface LinkSource {
  subscribe(listener: () => void): () => void
  getState(): {
    link: { kind: string; vtaDid?: string; connection?: { kind: string } }
    activity: ReadonlyArray<{ at: number; kind: string }>
  }
}

export interface PushAfterLinkDeps {
  source: LinkSource
  /** Activity at or before this time is history, not a new link. */
  since: number
  /** Whether the person has notifications on, read when it is time to act. */
  optedIn(): boolean
  enableWake(): Promise<PushWakeOutcome>
  log(message: string, data?: Record<string, unknown>): void
  /** The gateway keeps no more handles for this phone's token: say so, and do not retry. */
  onHandleLimit?(): void
}

/** How often one new link is tried before giving up until the next one. */
export const PUSH_AFTER_LINK_TRIES = 4

/** How long after a failed try the next one is made: 5 s, 30 s, 2 min. */
export const PUSH_AFTER_LINK_RETRY_MS = [5_000, 30_000, 120_000]

/** Start watching; returns the unsubscribe. */
export function watchLinkForPush(deps: PushAfterLinkDeps): () => void {
  let seenUpTo = deps.since
  let pending = false
  let tries = 0
  let inFlight = false
  let stopped = false
  let retry: ReturnType<typeof setTimeout> | undefined
  // The agent the link was on when last seen: another one is a switch.
  let lastAgent: string | undefined
  let first = true

  const startOver = () => {
    pending = true
    tries = 0
    if (retry) clearTimeout(retry)
    retry = undefined
  }

  const check = () => {
    if (stopped) return
    const { link, activity } = deps.source.getState()
    const fresh = activity.filter((a) => a.at > seenUpTo)
    if (fresh.length > 0) {
      seenUpTo = Math.max(...fresh.map((a) => a.at))
      if (fresh.some((a) => a.kind === 'linked')) startOver()
    }
    const agent = link.kind === 'linked' ? link.vtaDid : undefined
    if (agent && agent !== lastAgent) {
      // A switch to another agent, never the agent seen at start-up.
      if (!first && lastAgent !== undefined) startOver()
      lastAgent = agent
    }
    if (link.kind === 'linked') first = false
    if (!pending || inFlight || retry) return
    if (!deps.optedIn()) {
      pending = false
      return
    }
    // The wake channel is set over the link: wait until it is online. A later
    // change (it comes online, it reconnects) checks again.
    if (link.kind !== 'linked' || link.connection?.kind !== 'online') return

    inFlight = true
    tries += 1
    deps
      .enableWake()
      .then((outcome) => {
        deps.log('push wake: enable after link', { status: outcome.status, agent: lastAgent })
        // notLinked: the link went away under us; the next new link starts over.
        pending = false
      })
      .catch((e) => {
        deps.log('push wake: enable after link failed', {
          error: e instanceof Error ? e.message : String(e),
          try: tries,
        })
        // The gateway's limit does not lift by trying again soon (retryable: false).
        if (isHandleLimitRefusal(e)) {
          deps.onHandleLimit?.()
          pending = false
          return
        }
        if (tries >= PUSH_AFTER_LINK_TRIES) {
          pending = false
          return
        }
        // Again after a while, whether or not the link changes meanwhile.
        const wait = PUSH_AFTER_LINK_RETRY_MS[Math.min(tries - 1, PUSH_AFTER_LINK_RETRY_MS.length - 1)]
        retry = setTimeout(() => {
          retry = undefined
          check()
        }, wait)
      })
      .finally(() => {
        inFlight = false
      })
  }

  const unsubscribe = deps.source.subscribe(check)
  check()
  return () => {
    stopped = true
    if (retry) clearTimeout(retry)
    unsubscribe()
  }
}
