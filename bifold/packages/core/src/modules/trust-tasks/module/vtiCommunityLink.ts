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
  /** What it is called: the community's own published name, else the link author's. */
  name?: string
  /**
   * The name came from the community's own join manifest rather than from a
   * link. Anyone can write a link, so only a published name is shown plainly.
   */
  published?: boolean
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
  /**
   * Names communities published about themselves, by DID. Kept apart from the
   * links because a published name belongs to the community, not to the visit:
   * the build's suggested community is named by no link at all, and a name
   * learned once should still be the name next time it is offered.
   */
  private readonly published = new Map<string, string>()
  private readonly listeners = new Set<Listener>()

  /** Whatever the community itself published, applied over a link's claim. */
  private named = (link?: CommunityLink): CommunityLink | undefined => {
    if (!link) return undefined
    const name = this.published.get(link.communityDid)
    return name ? { ...link, name, published: true } : link
  }

  /** For the join screens: the community being looked at, else the chosen one. */
  get = (): CommunityLink | undefined => this.named(this.viewing ?? this.chosen)

  /** Only the community a link is showing, if any. */
  getViewing = (): CommunityLink | undefined => this.named(this.viewing)

  /** The phone's community, whatever a link is showing. */
  getChosen = (): CommunityLink | undefined => this.named(this.chosen)

  /** What a community published about itself, for one it is not looking at. */
  publishedNameOf = (communityDid: string): string | undefined => this.published.get(communityDid)

  /** A link named this community: show it, change nothing else. */
  set(link: CommunityLink): void {
    if (!link.communityDid) return
    // A name the community published itself outranks a link's claim, which
    // `named` applies on the way out: a second link to a community already
    // known by name cannot rename it.
    if (this.viewing && this.viewing.communityDid === link.communityDid && this.viewing.name === link.name) return
    this.viewing = link
    this.notify()
  }

  /**
   * The community published its own name, in the manifest a join reads. It
   * replaces whatever a link called it — a link's author is anyone, the
   * community's service is the community — and it is remembered for the
   * chosen one, so the name survives a relaunch and is not lost by leaving
   * the join screens.
   */
  publishedName(communityDid: string, displayName?: string): void {
    const named = displayName?.trim()
    if (!communityDid || !named || this.published.get(communityDid) === named) return
    this.published.set(communityDid, named)
    // Remember it with the chosen community too, so the name survives a
    // relaunch rather than waiting on the next manifest.
    if (this.chosen?.communityDid === communityDid) {
      this.chosen = { ...this.chosen, name: named, published: true }
      keep(this.chosen)
    }
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
    if (!this.viewing && !this.chosen && this.published.size === 0) return
    this.viewing = undefined
    this.chosen = undefined
    this.published.clear()
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
