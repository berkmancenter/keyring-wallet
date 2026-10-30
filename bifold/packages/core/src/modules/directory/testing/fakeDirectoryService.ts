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
  }))
  let card: MyCard = {
    entryId: 'dir_mine0000000000000000',
    revision: 0,
    name: options.cardName !== undefined ? toInertText(options.cardName) : undefined,
    visibility: {},
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
    changeElsewhere(name) {
      card = { ...card, name: toInertText(name), revision: card.revision + 1 }
    },
  }
}
