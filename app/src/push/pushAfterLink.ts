/**
 * Make the phone wakeable once it is linked to an agent, for a person who
 * already turned notifications on.
 *
 * Turning notifications on (in onboarding, or in Settings before any agent is
 * linked) only records the choice and the system permission: with no agent
 * there is nothing to give a wake channel to (`enablePushWake` answers
 * `notLinked`). Without this, the Settings switch would show on and the agent
 * would never wake the phone. So when the agent link controller reports a new
 * link, and the person has notifications on, this does what the switch does.
 *
 * Only a new link counts: the controller notes `linked` when a link is made, not
 * when a stored one is restored at launch, so an already wakeable phone is not
 * registered again at every start.
 */
import type { PushWakeOutcome } from './pushWake'

/** The parts of bifold's `vtaAgent` this reads. */
export interface LinkSource {
  subscribe(listener: () => void): () => void
  getState(): {
    link: { kind: string; connection?: { kind: string } }
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
}

/** How often one new link is tried before giving up until the next one. */
export const PUSH_AFTER_LINK_TRIES = 3

/** Start watching; returns the unsubscribe. */
export function watchLinkForPush(deps: PushAfterLinkDeps): () => void {
  let seenUpTo = deps.since
  let pending = false
  let tries = 0
  let inFlight = false

  const check = () => {
    const { link, activity } = deps.source.getState()
    const fresh = activity.filter((a) => a.at > seenUpTo)
    if (fresh.length > 0) {
      seenUpTo = Math.max(...fresh.map((a) => a.at))
      if (fresh.some((a) => a.kind === 'linked')) {
        pending = true
        tries = 0
      }
    }
    if (!pending || inFlight) return
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
        deps.log('push wake: enable after link', { status: outcome.status })
        // notLinked: the link went away under us; the next new link starts over.
        pending = false
      })
      .catch((e) => {
        deps.log('push wake: enable after link failed', {
          error: e instanceof Error ? e.message : String(e),
          try: tries,
        })
        if (tries >= PUSH_AFTER_LINK_TRIES) pending = false
      })
      .finally(() => {
        inFlight = false
      })
  }

  const unsubscribe = deps.source.subscribe(check)
  check()
  return unsubscribe
}
