/**
 * Member badges: the contract between the badges client (this module), the screens, the Wallet card and the room-post
 * chip (docs/plans/member-badges-plan.md, Interfaces). Only the client lane edits this file; a change is asked for.
 *
 * A community gives badges (`vtc/badges/*` 0.1, VTC v0.27.0 on). Keyring is the holder only: it reads what the member
 * holds and is offered, accepts or declines an offer, and reads another member's wall as the community shows it to this
 * member. It never shares a badge outside the community, and a badge is never called verified.
 *
 * The shapes follow the tasks' own responses (trust-tasks-tf `specs/vtc/badges/{mine/list,wall/show,show}/0.1`).
 *
 * @module badges/types
 */

/** What a badge is, as the community describes it. The picture is fetched with `images/get`, never by URL. */
export interface BadgeSummary {
  badgeId: string
  communityDid: string
  kind: 'community' | 'kudos'
  name: string
  description?: string
  criteria?: string
  image?: { sha256: string; mediaType: string }
}

/** A badge the member holds (`mine/list`): one per badge, however many times it was given. */
export interface HeldBadge extends BadgeSummary {
  /** How many times given (kudos, or a repeatable badge); 1 for most. */
  count: number
  /** When it was first given. */
  since: string
  /** When it was last given. */
  latestAt?: string
  /** Pinned beside their name (they chose so in the portal). */
  pinned: boolean
  /** Hidden from their wall (they chose so in the portal); still theirs. */
  hidden: boolean
  /** Until when the credential the community issued for it stands; none for kudos. */
  credentialValidUntil?: string
}

/** An award waiting for the member's answer. `note` is the giver's, seen by the member only. */
export interface BadgeOffer extends BadgeSummary {
  awardId: string
  offeredAt: string
  expiresAt?: string
  note?: string
  /** The giver's name as the directory shows it to this member, when it does. Never a DID. */
  givenBy?: string
}

/**
 * The member's own badges in one community (`mine/list`). A community with badges switched off answers this empty
 * (VTI-BDG-004), so a screen shows nothing when `held` and `offers` are both empty and there is no kudos total.
 */
export interface MyBadges {
  held: HeldBadge[]
  offers: BadgeOffer[]
  kudosTotal?: number
  /** Who sees their wall: the community's other members, or nobody. */
  visibility?: 'members' | 'nobody'
}

/** A badge on another member's wall (`wall/show`), as the community shows it to this member. */
export interface WallBadge extends BadgeSummary {
  count: number
  since?: string
  latestAt?: string
  pinned: boolean
}

/** A community that does not serve badges: show nothing for it. */
export type NotServed = 'notServed'
/** A wall the community does not show this member (its owner chose `nobody`, or the card is not shown to them). */
export type WallHidden = 'hidden'

export interface BadgeService {
  /** The member's badges and offers in one community. */
  mine(communityDid: string): Promise<MyBadges | NotServed>
  /** Accept an offer: the community issues the badge's credential to the member's agent afterwards. */
  accept(communityDid: string, awardId: string): Promise<void>
  /** Decline an offer: nobody is told, and it may be offered again. */
  decline(communityDid: string, awardId: string): Promise<void>
  /** Another member's wall, by their directory entry (`wall/show` takes an entry id, never a DID). */
  wall(communityDid: string, entryId: string): Promise<WallBadge[] | NotServed | WallHidden>
  /** One badge's description. */
  show(communityDid: string, badgeId: string): Promise<BadgeSummary | NotServed>
  /** A badge's picture as a data URI, cached by its digest. */
  image(communityDid: string, badgeId: string, sha256: string): Promise<string | undefined>
}

/** The screens' hooks (useBadges.ts). */
export interface MyBadgesState {
  badges?: MyBadges
  /** False while loading, and for a community that does not serve badges. */
  served: boolean
  loading: boolean
  refresh(): void
}
export interface MemberWallState {
  wall?: WallBadge[]
  state: 'loading' | 'shown' | 'hidden' | 'notServed'
}
