/**
 * The community a screen works on: the one a scanned or pasted link chose
 * (`communityTarget`), else the build's suggested default. Every screen of a
 * join reads it here, so they cannot disagree about which community it is.
 *
 * @module trust-tasks/screens/useCommunity
 */

import { useSyncExternalStore } from 'react'

import { communityTarget, type CommunityLink } from '../module/vtiCommunityLink'

import { communityName, type CommunityName } from './communityName'

export function useCommunity(configured?: string): CommunityLink | undefined {
  const target = useSyncExternalStore(communityTarget.subscribe, communityTarget.get)
  if (target) return target
  if (!configured) return undefined
  // The build's suggestion is named by no link, so its name — if it has one —
  // can only be what the community published about itself.
  const published = communityTarget.publishedNameOf(configured)
  return published ? { communityDid: configured, name: published, published: true } : { communityDid: configured }
}

export function useCommunityDid(configured?: string): string | undefined {
  return useCommunity(configured)?.communityDid
}

/** The phone's community (chosen by making an identity), not the one a link is showing. */
export function useChosenCommunityDid(configured?: string): string | undefined {
  const chosen = useSyncExternalStore(communityTarget.subscribe, communityTarget.getChosen)
  return chosen?.communityDid ?? configured
}

/**
 * What to call one particular community — the one a screen was opened on,
 * which need not be the one being joined. A community's published name is
 * remembered by DID, so this answers for a community no link ever named.
 */
export function useCommunityCalled(communityDid: string): CommunityName {
  const target = useSyncExternalStore(communityTarget.subscribe, communityTarget.get)
  const known = target?.communityDid === communityDid ? target : undefined
  const published = communityTarget.publishedNameOf(communityDid)
  return communityName(
    communityDid,
    known ?? (published ? { communityDid, name: published, published: true } : undefined)
  )
}
