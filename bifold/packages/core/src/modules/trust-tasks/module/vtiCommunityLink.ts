/**
 * Which community the person is joining — from a link, not from the build.
 *
 * A community is named by its DID; everything else (its mediator, its
 * manifest, its admin's invitations) is resolved from there. A person reaches
 * one by scanning or pasting:
 *
 *   keyring://vti/community?d=<community DID>[&n=<name to show>]
 *
 * or by a link that already names it: a vetter's ticket (`community=`) or an
 * invitation (its issuer). The build's `VTI_COMMUNITY_DID` is at most a
 * suggestion when no link has named one (UI/UX plan, dynamic community).
 *
 * The chosen community is held here, app-wide, so every screen of a join —
 * I want to join, I was invited, vetting — works on the same one. It is kept
 * across launches: a relaunch must not fall back to the build's community
 * for someone who joined another from a link.
 *
 * @module trust-tasks/module/vtiCommunityLink
 */

import AsyncStorage from '@react-native-async-storage/async-storage'

const STORAGE_KEY = 'keyring.vti.communityTarget'

/** Keep (or forget) the choice; storage trouble never gets in the way of choosing. */
function keep(link?: CommunityLink): void {
  try {
    const done = link ? AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(link)) : AsyncStorage.removeItem(STORAGE_KEY)
    void Promise.resolve(done).catch(() => undefined)
  } catch {
    // not kept this time; the next choice tries again
  }
}

export const VTI_COMMUNITY_PATH = 'vti/community'

export interface CommunityLink {
  communityDid: string
  /** What the link's author calls it; the DID's host is shown otherwise. */
  name?: string
}

export class CommunityLinkError extends Error {}

export function isCommunityLink(text: string): boolean {
  return text.trim().toLowerCase().startsWith(`keyring://${VTI_COMMUNITY_PATH}?`)
}

// Built and read by hand: React Native's URLSearchParams is only partly there.
export function buildCommunityLink(link: CommunityLink): string {
  const name = link.name ? `&n=${encodeURIComponent(link.name)}` : ''
  return `keyring://${VTI_COMMUNITY_PATH}?d=${encodeURIComponent(link.communityDid)}${name}`
}

export function parseCommunityLink(text: string): CommunityLink {
  if (!isCommunityLink(text)) throw new CommunityLinkError('not a community link')
  const trimmed = text.trim()
  const members: Record<string, string> = {}
  for (const pair of trimmed.slice(trimmed.indexOf('?') + 1).split('&')) {
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    try {
      members[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '))
    } catch {
      throw new CommunityLinkError('the link could not be read')
    }
  }
  const communityDid = members.d?.trim() ?? ''
  if (!/^did:[a-z0-9]+:.+/.test(communityDid)) throw new CommunityLinkError('the link names no community')
  const name = members.n?.trim()
  return { communityDid, ...(name ? { name } : {}) }
}

type Listener = () => void

/**
 * Two things, kept apart:
 * - **viewing** — the community a link just named. The join screens show it
 *   (what it asks, Join as), but opening a link changes nothing else.
 * - **chosen** — the phone's community: set when an identity is made for one
 *   (`choose`), kept across launches, and what My Agent, the community screen
 *   and the persona inbox follow.
 */
class CommunityTarget {
  private viewing?: CommunityLink
  private chosen?: CommunityLink
  private readonly listeners = new Set<Listener>()

  /** For the join screens: the community being looked at, else the chosen one. */
  get = (): CommunityLink | undefined => this.viewing ?? this.chosen

  /** Only the community a link is showing, if any. */
  getViewing = (): CommunityLink | undefined => this.viewing

  /** The phone's community, whatever a link is showing. */
  getChosen = (): CommunityLink | undefined => this.chosen

  /** A link named this community: show it, change nothing else. */
  set(link: CommunityLink): void {
    if (!link.communityDid) return
    if (this.viewing && this.viewing.communityDid === link.communityDid && this.viewing.name === link.name) return
    this.viewing = link
    this.notify()
  }

  /** An identity was made for this community: it is now the phone's, and kept. */
  choose(communityDid: string): void {
    if (!communityDid) return
    const link = this.viewing?.communityDid === communityDid ? this.viewing : { communityDid }
    if (this.chosen?.communityDid === link.communityDid && this.chosen.name === link.name) return
    this.chosen = link
    this.notify()
    keep(link)
  }

  clear(): void {
    if (!this.viewing && !this.chosen) return
    this.viewing = undefined
    this.chosen = undefined
    this.notify()
    keep()
  }

  /** The community chosen before this launch, if any. */
  async restore(): Promise<void> {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY)
      if (!saved || this.chosen) return
      const link = JSON.parse(saved) as CommunityLink
      if (typeof link?.communityDid === 'string' && /^did:[a-z0-9]+:.+/.test(link.communityDid)) {
        this.chosen = link
        this.notify()
      }
    } catch {
      // nothing kept, or unreadable: the build's suggestion stands
    }
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    this.listeners.forEach((l) => l())
  }
}

export const communityTarget = new CommunityTarget()

/** For a join: the community a link is showing, else the chosen one, else the build's suggestion. */
export function resolveCommunityDid(configured?: string): string | undefined {
  return communityTarget.get()?.communityDid ?? configured
}

/** The phone's community: the chosen one, else the build's suggestion. */
export function resolveChosenCommunityDid(configured?: string): string | undefined {
  return communityTarget.getChosen()?.communityDid ?? configured
}
