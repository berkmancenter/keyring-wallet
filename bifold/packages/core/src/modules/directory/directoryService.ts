/**
 * The directory client: each request goes to the community as the persona the phone joined it with, over the session
 * it already has (the same `communityTask` the rooms use). `card/show` and `card/update` are "being the member: the
 * signer's own active membership" (vtc-service-v0.12.0 `trust_tasks/directory_tasks.rs`), which that session is.
 *
 * @module directory/directoryService
 */
import { refusalCode } from '../rooms/real/wire'
import type { OperationStatus } from '../rooms/types'

import {
  DirectoryConflict,
  DirectoryRefused,
  NAME_FIELD,
  type CardField,
  type DirectoryOperation,
  type DirectoryService,
  type MemberCard,
  type MemberPage,
  type MyCard,
} from './types'
import {
  DIRECTORY_TASK,
  MEMBERS_PAGE,
  entryFields,
  parseCard,
  parseEntries,
  parseFields,
  parseMemberCard,
  parseQueryName,
  queryFields,
} from './wire'

export interface DirectoryBackend {
  /** Send a Trust Task to a community as this phone's persona for it; resolves with the response payload. */
  communityTask(communityDid: string, type: string, payload: Record<string, unknown>): Promise<unknown>
}

/** The longest name a card holds, in characters (`displayName`, VTC `directory/fields.rs`). */
export const CARD_NAME_MAX = 64

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export class AgentDirectoryService implements DirectoryService {
  /** The members-list version each community last answered, so a page after the first goes at that one. */
  private readonly listVersion = new Map<string, string>()

  public constructor(private readonly backend: DirectoryBackend) {}

  public async listMembers(communityDid: string, cursor?: string): Promise<MemberPage> {
    const payload = { limit: MEMBERS_PAGE, ...(cursor ? { cursor } : {}) }
    const first = this.listVersion.get(communityDid) ?? DIRECTORY_TASK.entriesList02
    let type: string = first
    let answer: unknown
    try {
      answer = await this.ask('listMembers', communityDid, type, payload)
    } catch (e) {
      // A community serves one of the two (0.16: 0.2 only; 0.12: 0.1 only). The other is asked once.
      if (!(e instanceof DirectoryRefused) || (e.code !== 'unsupportedType' && e.code !== 'unsupportedVersion')) throw e
      type = first === DIRECTORY_TASK.entriesList02 ? DIRECTORY_TASK.entriesList : DIRECTORY_TASK.entriesList02
      answer = await this.ask('listMembers', communityDid, type, payload)
    }
    this.listVersion.set(communityDid, type)
    return parseEntries(answer)
  }

  public async showMyCard(communityDid: string): Promise<MyCard> {
    const card = parseCard(await this.ask('showMyCard', communityDid, DIRECTORY_TASK.cardShow, {}))
    if (!card) throw new Error(`${communityDid} answered for this member's card with something else`)
    return card
  }

  public async cardFields(communityDid: string, card: MyCard): Promise<CardField[]> {
    return parseFields(await this.ask('showMyCard', communityDid, DIRECTORY_TASK.fieldsList, {}), card)
  }

  public async setMyName(communityDid: string, name: string, expectedRevision: number): Promise<MyCard> {
    const tidy = Array.from(name.replace(/\s+/g, ' ').trim()).slice(0, CARD_NAME_MAX).join('').trim()
    if (!tidy) throw new DirectoryRefused('updateMyCard', 'valueInvalid', false, 'a name is needed')
    let answer: unknown
    try {
      answer = await this.ask('updateMyCard', communityDid, DIRECTORY_TASK.cardUpdate, {
        values: { [NAME_FIELD]: tidy },
        expectedRevision,
      })
    } catch (e) {
      if (e instanceof DirectoryRefused && e.code === 'superseded') throw new DirectoryConflict(communityDid)
      throw e
    }
    const card = parseCard(answer)
    if (!card) throw new Error(`${communityDid} answered the card update with something else`)
    return card
  }

  public async lookupName(communityDid: string, memberDid: string): Promise<string | undefined> {
    try {
      // `fields` narrows the answer to the name: nothing else about the member is asked for or kept.
      return parseQueryName(
        await this.ask('lookupName', communityDid, DIRECTORY_TASK.query, { subject: memberDid, fields: NAME_FIELD }),
        memberDid
      )
    } catch (e) {
      // "No such member" and "not shown to you" are one answer by design: either way there is no name to show.
      if (e instanceof DirectoryRefused && e.code === 'notFound') return undefined
      throw e
    }
  }

  public async showMember(communityDid: string, entryId: string): Promise<MemberCard | undefined> {
    return this.memberCard(communityDid, DIRECTORY_TASK.entriesShow, { entryId }, (p) => entryFields(p, entryId))
  }

  public async memberCardByDid(communityDid: string, memberDid: string): Promise<MemberCard | undefined> {
    // No `fields` hint: the whole card, as the community projects it for this member.
    return this.memberCard(communityDid, DIRECTORY_TASK.query, { subject: memberDid }, (p) => queryFields(p, memberDid))
  }

  /** A card read one way or the other, labelled by the community's fields; `notFound` is no card to show. */
  private async memberCard(
    communityDid: string,
    type: string,
    payload: Record<string, unknown>,
    fieldsOf: (answer: unknown) => Record<string, unknown> | undefined
  ): Promise<MemberCard | undefined> {
    let fields: Record<string, unknown> | undefined
    try {
      fields = fieldsOf(await this.ask('showMember', communityDid, type, payload))
    } catch (e) {
      // "No such member" and "not shown to you" are one answer by design.
      if (e instanceof DirectoryRefused && e.code === 'notFound') return undefined
      throw e
    }
    if (!fields) return undefined
    const definitions = parseFields(await this.ask('showMember', communityDid, DIRECTORY_TASK.fieldsList, {}))
    return parseMemberCard(fields, definitions)
  }

  /** A request to the community; its refusal reported by the task's own code. */
  private async ask(
    operation: DirectoryOperation,
    communityDid: string,
    type: string,
    payload: Record<string, unknown>
  ): Promise<unknown> {
    try {
      return await this.backend.communityTask(communityDid, type, payload)
    } catch (e) {
      const code = refusalCode(e)
      if (code) throw new DirectoryRefused(operation, code, code === 'rateLimited', message(e))
      throw e
    }
  }
}

/**
 * What a screen shows when a directory read or write failed: a community that does not serve the directory, a
 * phone that is no longer a member, or a community that did not answer (including a rate refusal: try again later).
 */
export function directoryStatusOf(error: unknown): OperationStatus {
  if (error instanceof DirectoryRefused) {
    if (error.code === 'unsupportedType' || error.code === 'unsupportedVersion')
      return { status: 'unavailable', reason: 'communityDoesNotServe', detail: error.message }
    if (error.code === 'notMember') return { status: 'unavailable', reason: 'noRight', detail: error.message }
  }
  return { status: 'unavailable', reason: 'communityUnreachable', detail: message(error) }
}
