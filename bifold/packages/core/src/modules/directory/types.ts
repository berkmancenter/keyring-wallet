/**
 * A community's member directory, as a member reads it (`vtc/directory/*`, VTC 0.12 and later): the members list,
 * and the member's own card. Every answer comes from the community over the session the phone joined it with,
 * signed as the persona, and is the community's projection of each card for this member: a field is there only where
 * its owner shows it to members.
 *
 * Names here are what each member wrote about themselves. The community vouches that the member wrote it, not that it
 * is true, so a screen shows them as the member's own words.
 *
 * Statuses reuse the rooms shape (`OperationStatus`), so the screens show them the same way.
 *
 * @module directory/types
 */
import type { InertText } from '../rooms/inertText'
import type { OperationStatus } from '../rooms/types'

export type { OperationStatus }

/** Who a directory value is shown to (`vtc/directory/_shared/0.1` `Audience`). */
export const DIRECTORY_AUDIENCES = ['admins', 'groups', 'connections', 'members', 'public'] as const
export type DirectoryAudience = (typeof DIRECTORY_AUDIENCES)[number]

/** The base field a member's name is kept in. */
export const NAME_FIELD = 'displayName'
/** The base field the community derives from the member's role. */
export const ROLE_FIELD = 'role'

/** One member as the members list shows them. */
export interface MemberRow {
  /** Opaque, per community; never a DID. */
  entryId: string
  /** Their name, where they show it to members; their own words. */
  name?: InertText
  /** Their role in the community, where it is shown. */
  role?: InertText
  /** Whether the community records a relationship between you and them. */
  connected?: boolean
}

export interface MemberPage {
  rows: MemberRow[]
  /** Where the next page starts; none on the last page. */
  nextCursor?: string
}

/** A field of the member's card as the community defines it, with who sees it. */
export interface CardField {
  key: string
  /** The community's label for it. */
  label: InertText
  /** Who sees it now: the member's choice where they made one, else the field's default. */
  audience: DirectoryAudience
  /** The widest audience the community allows for it. */
  ceiling: DirectoryAudience
  /** Whether the member writes it (rather than an administrator, a credential or the community). */
  writable: boolean
  required: boolean
}

/** The member's own card in a community. */
export interface MyCard {
  entryId: string
  /** The card's revision: an update names it, and is refused if the card has moved on. */
  revision: number
  /** The name on it, if any. */
  name?: InertText
  /** Who sees each field, by key, where the member chose. */
  visibility: Readonly<Record<string, DirectoryAudience>>
  /** Required fields still empty. */
  missingRequired: readonly string[]
  updatedAt: string
}

/** What "Your card" would send: the name from the profile the member joined as, and who would see it. */
export interface CardProposal {
  name: string
  /** The profile it comes from, to name on the consent sheet. */
  profileId: string
}

/** The directory operations, each with a status a screen shows instead of guessing. */
export type DirectoryOperation = 'listMembers' | 'showMyCard' | 'updateMyCard' | 'lookupName'

/** The card changed since it was read (`superseded`): nothing was written. Read it again, then decide. */
export class DirectoryConflict extends Error {
  public constructor(public readonly communityDid: string) {
    super(`the card in ${communityDid} changed since it was read`)
    this.name = 'DirectoryConflict'
  }
}

/** The community refused, by the task's own code (e.g. `rateLimited`, `valueInvalid`, `notMember`). */
export class DirectoryRefused extends Error {
  public constructor(
    public readonly operation: DirectoryOperation,
    public readonly code: string,
    public readonly retryable: boolean,
    detail?: string
  ) {
    super(`${operation} was refused (${code})${detail ? `: ${detail}` : ''}`)
    this.name = 'DirectoryRefused'
  }
}

/** The directory of the communities this phone belongs to. */
export interface DirectoryService {
  /** One page of the members list, as the community projects it for this member. */
  listMembers(communityDid: string, cursor?: string): Promise<MemberPage>
  /** The member's own card. The first read creates it, empty. */
  showMyCard(communityDid: string): Promise<MyCard>
  /** The card's fields, with who sees each: the member's choice on `card` where they made one, else the default. */
  cardFields(communityDid: string, card: MyCard): Promise<CardField[]>
  /**
   * Set the name on the member's card, at the revision read. Throws `DirectoryConflict` when the card moved on,
   * `DirectoryRefused` when the community refused it. Visibility is left as it is: the field's default.
   */
  setMyName(communityDid: string, name: string, expectedRevision: number): Promise<MyCard>
  /**
   * The name a member wrote on their card, looked up by their DID (`query/0.1`). The community answers only for a
   * member who shows their identity to members; anyone else, and anyone who shows no name, is undefined.
   */
  lookupName(communityDid: string, memberDid: string): Promise<string | undefined>
}

/** A status from a failure, for a screen: what it shows instead of the list or the card. */
export type DirectoryStatus = OperationStatus
