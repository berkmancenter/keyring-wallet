/**
 * A directory service on made-up data, for screen tests: a community of `members` people (some showing no name),
 * your card with a revision, and the base fields with the built defaults (name and role to members, the rest to
 * administrators). Nothing here is bundled into the app: only tests import it.
 *
 * @module directory/testing/fakeDirectoryService
 */
import { toInertText } from '../../rooms/inertText'
import {
  DirectoryConflict,
  DirectoryRefused,
  type CardField,
  type CardPicture,
  type DirectoryAudience,
  type DirectoryService,
  type MemberCard,
  type MemberRow,
  type MyCard,
} from '../types'

export interface FakeDirectoryOptions {
  /** How many members the community has; every fifth shows no name. Default 30. */
  members?: number
  /** Page size. Default 25. */
  pageSize?: number
  /** The name already on your card. */
  cardName?: string
  /** Make a call fail as the community would refuse it, by the task's code (e.g. `unsupportedType`, `rateLimited`). */
  refuse?: Partial<Record<'listMembers' | 'showMyCard' | 'setMyName' | 'lookupName' | 'showMember', string>>
  /** The names members show by DID, as `lookupName` finds them; anyone else has none. */
  shown?: Record<string, string>
  /** Cards by entry id or member DID, as `showMember` and `memberCardByDid` find them; anyone else has none. */
  cards?: Record<string, MemberCard>
  /** Pictures on members' rows, by their index in the list. */
  rowPictures?: Record<number, CardPicture>
  /** The picture on your card. */
  cardPicture?: CardPicture
  /** What `showPicture` answers, by digest: the checked `data:` URI. Any other digest has none. */
  pictureUris?: Record<string, string>
  /** The community defines the picture field, allowing at most this audience (default: no picture field). */
  pictureCeiling?: DirectoryAudience
  /** Who sees each field on your card, where you chose (e.g. set from the portal). */
  cardVisibility?: Record<string, DirectoryAudience>
  /** Make a photo upload or removal fail as the community would refuse it, by the task's code. */
  refusePhoto?: string
}

const field = (
  key: string,
  label: string,
  audience: DirectoryAudience,
  writable: boolean,
  ceiling: DirectoryAudience
) => ({ key, label: toInertText(label), audience, ceiling, writable, required: false }) satisfies CardField

export interface FakeDirectoryService extends DirectoryService {
  /** Someone else changes your card (as the portal would): the next save at the old revision is a conflict. */
  changeElsewhere(name: string): void
  /** Every call made, in order. */
  calls: string[]
}

export function createFakeDirectoryService(options: FakeDirectoryOptions = {}): FakeDirectoryService {
  const count = options.members ?? 30
  const pageSize = options.pageSize ?? 25
  const rows: MemberRow[] = Array.from({ length: count }, (_, i) => ({
    entryId: `dir_member${String(i).padStart(12, '0')}`,
    name: i % 5 === 4 ? undefined : toInertText(`Member ${i + 1}`),
    role: toInertText(i === 0 ? 'admin' : 'member'),
    picture: options.rowPictures?.[i],
  }))
  let card: MyCard = {
    entryId: 'dir_mine0000000000000000',
    revision: 0,
    name: options.cardName !== undefined ? toInertText(options.cardName) : undefined,
    picture: options.cardPicture,
    visibility: { ...options.cardVisibility },
    missingRequired: [],
    updatedAt: '2026-10-30T00:00:00Z',
  }
  const calls: string[] = []
  const refuse = (operation: 'listMembers' | 'showMyCard' | 'setMyName' | 'lookupName' | 'showMember') => {
    const code = options.refuse?.[operation]
    if (code)
      throw new DirectoryRefused(
        operation === 'setMyName' ? 'updateMyCard' : operation,
        code,
        code === 'rateLimited',
        'fake refusal'
      )
  }

  return {
    calls,
    async listMembers(_communityDid, cursor) {
      calls.push(`listMembers ${cursor ?? 'first'}`)
      refuse('listMembers')
      const start = cursor ? Number(cursor) : 0
      const end = start + pageSize
      return { rows: rows.slice(start, end), nextCursor: end < rows.length ? String(end) : undefined }
    },
    async showMyCard() {
      calls.push('showMyCard')
      refuse('showMyCard')
      return card
    },
    async cardFields(_communityDid, shown) {
      calls.push('cardFields')
      return [
        field('displayName', 'Name', 'members', true, 'public'),
        field('role', 'Role', 'members', false, 'members'),
        field('nickname', 'Nickname', 'admins', true, 'public'),
        field('did', 'Identifier', 'admins', false, 'members'),
        ...(options.pictureCeiling ? [field('avatar', 'Picture', 'admins', true, options.pictureCeiling)] : []),
      ].map((f) => ({ ...f, audience: shown.visibility[f.key] ?? f.audience }))
    },
    async setMyName(communityDid, name, expectedRevision) {
      calls.push(`setMyName ${name} @${expectedRevision}`)
      refuse('setMyName')
      if (expectedRevision !== card.revision) throw new DirectoryConflict(communityDid)
      card = { ...card, name: toInertText(name), revision: card.revision + 1 }
      return card
    },
    async lookupName(_communityDid, memberDid) {
      calls.push(`lookupName ${memberDid}`)
      refuse('lookupName')
      return options.shown?.[memberDid]
    },
    async showMember(_communityDid, entryId) {
      calls.push(`showMember ${entryId}`)
      refuse('showMember')
      return options.cards?.[entryId]
    },
    async memberCardByDid(_communityDid, memberDid) {
      calls.push(`memberCardByDid ${memberDid}`)
      refuse('showMember')
      return options.cards?.[memberDid]
    },
    async showPicture(_communityDid, entryId, picture) {
      calls.push(`showPicture ${entryId} ${picture.sha256.slice(0, 8)}`)
      return options.pictureUris?.[picture.sha256]
    },
    async setMyPicture(communityDid, _photo, audience, expectedRevision) {
      calls.push(`setMyPicture ${audience} @${expectedRevision}`)
      if (options.refusePhoto) throw new DirectoryRefused('updateMyCard', options.refusePhoto, false, 'fake refusal')
      if (expectedRevision !== card.revision) throw new DirectoryConflict(communityDid)
      // The community's copy: its own digest, never the profile photo's.
      const sha256 = `${String(card.revision + 1).padStart(2, '0')}${'e'.repeat(62)}`
      card = {
        ...card,
        picture: { sha256, mediaType: 'image/jpeg' },
        visibility: { ...card.visibility, avatar: audience },
        revision: card.revision + 1,
      }
      return card
    },
    async removeMyPicture(communityDid, expectedRevision) {
      calls.push(`removeMyPicture @${expectedRevision}`)
      if (options.refusePhoto) throw new DirectoryRefused('updateMyCard', options.refusePhoto, false, 'fake refusal')
      if (expectedRevision !== card.revision) throw new DirectoryConflict(communityDid)
      const { avatar: _avatar, ...visibility } = card.visibility
      card = { ...card, picture: undefined, visibility, revision: card.revision + 1 }
      return card
    },
    changeElsewhere(name) {
      card = { ...card, name: toInertText(name), revision: card.revision + 1 }
    },
  }
}
