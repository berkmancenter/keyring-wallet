/**
 * The community a screen works on: the one a scanned or pasted link chose
 * (`communityTarget`), else the build's suggested default. Every screen of a
 * join reads it here, so they cannot disagree about which community it is.
 *
 * @module trust-tasks/screens/useCommunity
 */

import { useSyncExternalStore } from 'react'

import { communityTarget, type CommunityLink } from '../module/vtiCommunityLink'

export function useCommunity(configured?: string): CommunityLink | undefined {
  const target = useSyncExternalStore(communityTarget.subscribe, communityTarget.get)
  return target ?? (configured ? { communityDid: configured } : undefined)
}

export function useCommunityDid(configured?: string): string | undefined {
  return useCommunity(configured)?.communityDid
}

/** The phone's community (chosen by making an identity), not the one a link is showing. */
export function useChosenCommunityDid(configured?: string): string | undefined {
  const chosen = useSyncExternalStore(communityTarget.subscribe, communityTarget.getChosen)
  return chosen?.communityDid ?? configured
}
