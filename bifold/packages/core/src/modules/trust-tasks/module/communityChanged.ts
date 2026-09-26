/**
 * "Something this phone knows about a community changed" — one event, from the
 * stores themselves, so a screen showing a community can re-read it the moment
 * it changes instead of on its next poll.
 *
 * The journey screens each kept their own copy of where the person stood and
 * refreshed it on a timer or not at all: a member was offered "Apply to join",
 * a finished step still read as pending, and a new membership reached My Agent
 * only after a background/foreground. The stores are where every change lands —
 * a screen's own action, the persona inbox with no screen mounted, a join in
 * flight — so the stores announce it.
 *
 * The emit is deferred and cannot throw: a listener's failure must never reach
 * the store call that already succeeded (in the persona inbox that would
 * withhold the mediator ack and process the message again), and deferring lets
 * a writer finish a sequence of writes (a membership, then its role card)
 * before anyone re-reads.
 *
 * @module trust-tasks/module/communityChanged
 */

import { useEffect, useRef } from 'react'
import { DeviceEventEmitter } from 'react-native'

import type { VtiHeldCredential } from './VtiCommunityStore'

export const COMMUNITY_CHANGED_EVENT = 'vti:community-changed'

/** The persona inbox's own event: a delivery it stored (kept here so both can be heard without an import cycle). */
export const VTI_PERSONA_DELIVERIES_EVENT = 'vti:persona-deliveries'

export type CommunityChange =
  | 'membership'
  | 'submission'
  | 'departure'
  | 'invitation'
  | 'application'
  | 'desk'
  | 'ticket'
  | 'profile'
  | 'grant'
  | 'forgotten'

export interface CommunityChangedEvent {
  communityDid: string
  what: CommunityChange
}

/** Announce a change to one community, after the write that made it. Never throws. */
export function emitCommunityChanged(communityDid: string | undefined, what: CommunityChange): void {
  if (!communityDid) return
  setTimeout(() => {
    try {
      DeviceEventEmitter.emit(COMMUNITY_CHANGED_EVENT, { communityDid, what } satisfies CommunityChangedEvent)
    } catch {
      // A listener's failure is the listener's; the write already stands.
    }
  }, 0)
}

/** What a held credential changes: a vetter grant is the vetter's standing, a role card the membership. */
export function changeOfHeldCredential(kind: VtiHeldCredential['kind']): CommunityChange {
  switch (kind) {
    case 'vetter-grant':
      return 'grant'
    case 'role':
      return 'membership'
    default:
      return 'application'
  }
}

/**
 * Call `refresh` whenever something about `communityDid` changes (any community
 * when none is given): a store write here, or a delivery the persona inbox
 * stored. Changes that land together call it once, and never after unmount.
 */
export function useCommunityChanged(refresh: () => void, communityDid?: string): void {
  // The latest refresh, read when the change is handled — so a screen whose
  // callback changes between a change and its tick is still refreshed. (The
  // subscription used to be torn down with the old callback, and a change
  // already queued was then dropped: the new subscription never saw it.)
  const latest = useRef(refresh)
  latest.current = refresh
  useEffect(() => {
    let live = true
    let queued = false
    const onChange = (e?: { communityDid?: string }) => {
      if (communityDid && e?.communityDid && e.communityDid !== communityDid) return
      if (queued) return
      queued = true
      setTimeout(() => {
        queued = false
        if (live) latest.current()
      }, 0)
    }
    const subs = [COMMUNITY_CHANGED_EVENT, VTI_PERSONA_DELIVERIES_EVENT].map((name) =>
      DeviceEventEmitter.addListener(name, onChange)
    )
    return () => {
      live = false
      subs.forEach((s) => s.remove())
    }
  }, [communityDid])
}
