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
  type MemberPage,
  type MyCard,
} from './types'
import { DIRECTORY_TASK, MEMBERS_PAGE, parseCard, parseEntries, parseFields, parseQueryName } from './wire'

export interface DirectoryBackend {
  /** Send a Trust Task to a community as this phone's persona for it; resolves with the response payload. */
  communityTask(communityDid: string, type: string, payload: Record<string, unknown>): Promise<unknown>
}

/** The longest name a card holds, in characters (`displayName`, VTC `directory/fields.rs`). */
export const CARD_NAME_MAX = 64

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export class AgentDirectoryService implements DirectoryService {
  public constructor(private readonly backend: DirectoryBackend) {}

  public async listMembers(communityDid: string, cursor?: string): Promise<MemberPage> {
    return parseEntries(
      await this.ask('listMembers', communityDid, DIRECTORY_TASK.entriesList, {
        limit: MEMBERS_PAGE,
        ...(cursor ? { cursor } : {}),
      })
    )
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
