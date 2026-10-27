/**
 * The real rooms service, R1: what a member reads. The phone talks only to its own agent and to its
 * communities, over the legs it already has (wallet docs/plans/openvtc-rooms-plan/2026-10-25-al.md):
 *
 * - **My rooms** is the community's record (`vtc/rooms/memberships/list`, sent as the persona the phone
 *   joined with) joined with the agent's key custody (`rooms/keys/list`). A room the agent holds keys for
 *   but no community lists is `source: 'custody'`.
 * - **Notes**: the agent lists and opens them (`rooms/keys/browse`, `rooms/keys/read`). The agent makes the
 *   host call itself, and the host comes from the membership. The phone never talks to a host and never
 *   holds a room key.
 *
 * Writes, offers, files and agent access are later phases and report `clientNotBuilt`.
 */
import { deriveCapabilities, deriveRoomCapabilities } from '../capabilities'
import { inertFlags, toInertText } from '../inertText'
import type {
  AgentGrant,
  CommunityRoomMember,
  Identity,
  Note,
  NoteList,
  OfferPreview,
  OpenedFile,
  Room,
  RoomCapabilities,
  RoomFile,
  RoomOffer,
  RoomsCapabilities,
  RoomsOperation,
  RoomsService,
  RoomSummary,
  WritePreview,
} from '../types'
import { RoomsUnavailable } from '../types'

import {
  parseBrowse,
  parseKeysList,
  parseMemberships,
  parseRead,
  ROOMS_TASK,
  type HeldRoom,
  type RoomMembershipRecord,
} from './wire'

/** A community this phone belongs to, and the persona it belongs as. */
export interface RoomsCommunity {
  did: string
  name?: string
  personaDid: string
  /** The community's identity words for the persona, when it supplied them. */
  identityWords?: string
}

/** What the service needs from the rest of the app. The adapter wires it to VtaClient and vtiAgent. */
export interface RoomsBackend {
  agentLinked(): boolean
  /** The agent's `trust-task-discovery` answer; undefined when it could not be asked. */
  agentServedTypes(): Promise<readonly string[] | undefined>
  /** Send a Trust Task to the person's own agent; resolves with the response payload. */
  agentTask(type: string, payload: Record<string, unknown>): Promise<unknown>
  communities(): Promise<RoomsCommunity[]>
  /** Send a Trust Task to a community as this phone's persona for it; resolves with the response payload. */
  communityTask(communityDid: string, type: string, payload: Record<string, unknown>): Promise<unknown>
  leaveCommunity(communityDid: string): Promise<void>
  decodeBase64Url(value: string): string
}

/** The operations this phase implements. */
export const R1_BUILT: ReadonlySet<RoomsOperation> = new Set<RoomsOperation>([
  'listMyRooms',
  'getRoom',
  'listNotes',
  'readNote',
  'leaveViaCommunity',
])

/** How many pages of a community's membership record to read before stopping. */
const MAX_MEMBERSHIP_PAGES = 10

const shortId = (id: string) => id.replace(/^did:[^:]+:/, '').slice(-10)

interface KnownRoom extends Room {
  community?: RoomsCommunity
}

export class AgentRoomsService implements RoomsService {
  public readonly isSample = false
  public readonly label = 'rooms: the person’s own agent and communities'

  private served?: { types: readonly string[] | undefined }
  private rooms = new Map<string, KnownRoom>()

  public constructor(
    private readonly backend: RoomsBackend,
    private readonly built: ReadonlySet<RoomsOperation> = R1_BUILT
  ) {}

  public async capabilities(options: { refresh?: boolean } = {}): Promise<RoomsCapabilities> {
    const linked = this.backend.agentLinked()
    if (linked && (options.refresh || !this.served)) this.served = { types: await this.backend.agentServedTypes() }
    return deriveCapabilities({ agentLinked: linked, servedTypes: this.served?.types, built: this.built })
  }

  private async require(operation: RoomsOperation): Promise<void> {
    const status = (await this.capabilities())[operation]
    if (status.status !== 'available') throw new RoomsUnavailable(operation, status.reason, status.detail)
  }

  public async listMyRooms(): Promise<RoomSummary[]> {
    await this.require('listMyRooms')
    const communities = await this.backend.communities()
    // A community that cannot answer loses only its own details: its rooms still show from custody,
    // as `detailsNotLoaded`, and the other communities' rooms are unaffected.
    const memberships = await Promise.all(
      communities.map(async (community) => ({
        community,
        records: await this.membershipsOf(community).catch((): RoomMembershipRecord[] => []),
      }))
    )
    const held = await this.heldRooms()

    const next = new Map<string, KnownRoom>()
    for (const { community, records } of memberships) {
      for (const record of records) {
        if (record.state === 'offered') continue // an offer, not a room yet: listOffers shows it
        next.set(
          record.roomId,
          this.fromMembership(
            community,
            record,
            held.find((h) => h.roomId === record.roomId)
          )
        )
      }
    }
    for (const custody of held) if (!next.has(custody.roomId)) next.set(custody.roomId, this.fromCustody(custody))
    this.rooms = next
    return [...next.values()].map(({ community: _community, actingAs: _actingAs, ...summary }) => summary)
  }

  private async membershipsOf(community: RoomsCommunity): Promise<RoomMembershipRecord[]> {
    const out: RoomMembershipRecord[] = []
    let cursor: string | undefined
    for (let page = 0; page < MAX_MEMBERSHIP_PAGES; page++) {
      const answer = parseMemberships(
        await this.backend.communityTask(community.did, ROOMS_TASK.membershipsList, cursor ? { cursor } : {})
      )
      out.push(...answer.items)
      cursor = answer.nextCursor
      if (!cursor) break
    }
    return out
  }

  private async heldRooms(): Promise<HeldRoom[]> {
    const served = this.served?.types ?? []
    if (served.includes(ROOMS_TASK.keysList02))
      return parseKeysList(await this.backend.agentTask(ROOMS_TASK.keysList02, { includePersonal: true }))
    return parseKeysList(await this.backend.agentTask(ROOMS_TASK.keysList01, {}))
  }

  private fromMembership(community: RoomsCommunity, record: RoomMembershipRecord, held?: HeldRoom): KnownRoom {
    const name = record.label ?? held?.personalLabel
    return {
      roomId: record.roomId,
      name: toInertText(name ?? shortId(record.roomId)),
      nameFrom: record.label ? 'community' : held?.personalLabel ? 'personal' : 'roomId',
      source: 'community',
      communityDid: community.did,
      communityName: community.name !== undefined ? toInertText(community.name) : undefined,
      tier: record.tier,
      verbs: record.state === 'removed' ? [] : record.actions,
      validUntil: record.validUntil,
      host: record.host,
      standing: record.state === 'removed' ? 'removed' : 'member',
      actingAs: { did: community.personaDid, identityWords: community.identityWords },
      community,
    }
  }

  private fromCustody(held: HeldRoom): KnownRoom {
    const me: Identity = { did: held.member ?? '' }
    return {
      roomId: held.roomId,
      name: toInertText(held.personalLabel ?? shortId(held.roomId)),
      nameFrom: held.personalLabel ? 'personal' : 'roomId',
      source: 'custody',
      tier: 'unknown',
      standing: 'member',
      actingAs: me,
    }
  }

  private async known(roomId: string): Promise<KnownRoom> {
    if (!this.rooms.has(roomId)) await this.listMyRooms()
    const room = this.rooms.get(roomId)
    if (!room) throw new Error(`no room ${roomId} among this member's rooms`)
    return room
  }

  public async getRoom(roomId: string): Promise<Room> {
    await this.require('getRoom')
    const { community: _community, ...room } = await this.known(roomId)
    return room
  }

  public async roomCapabilities(roomId: string): Promise<RoomCapabilities> {
    return deriveRoomCapabilities(await this.capabilities(), await this.known(roomId))
  }

  private async requireInRoom(roomId: string, operation: keyof RoomCapabilities): Promise<KnownRoom> {
    const room = await this.known(roomId)
    const status = deriveRoomCapabilities(await this.capabilities(), room)[operation]
    if (status.status !== 'available') throw new RoomsUnavailable(operation, status.reason, status.detail)
    if (!room.host) throw new RoomsUnavailable(operation, 'detailsNotLoaded', 'no host is known for this room')
    return room
  }

  public async listNotes(roomId: string): Promise<NoteList> {
    const room = await this.requireInRoom(roomId, 'listNotes')
    const listing = parseBrowse(await this.backend.agentTask(ROOMS_TASK.keysBrowse, { roomId, host: room.host }))
    return {
      notes: listing.records.map((r) => ({
        key: r.key,
        version: r.version,
        title: r.title !== undefined ? toInertText(r.title) : undefined,
        author: r.author ? { did: r.author } : undefined,
        updatedAt: r.updatedAt,
        status: r.status,
        pinned: false,
      })),
      complete: listing.complete,
      check: listing.check,
    }
  }

  public async readNote(roomId: string, key: string): Promise<Note> {
    const room = await this.requireInRoom(roomId, 'readNote')
    const opened = parseRead(await this.backend.agentTask(ROOMS_TASK.keysRead, { roomId, host: room.host, key }), (s) =>
      this.backend.decodeBase64Url(s)
    )
    if (!opened) throw new Error(`the agent's answer for note ${key} could not be read`)
    const body = toInertText(opened.body)
    return {
      key: opened.key,
      version: opened.version,
      title: opened.title !== undefined ? toInertText(opened.title) : undefined,
      author: opened.author ? { did: opened.author } : undefined,
      updatedAt: opened.updatedAt,
      status: opened.status,
      pinned: false,
      body,
      flags: inertFlags(body),
      check: opened.check,
    }
  }

  public async leaveViaCommunity(communityDid: string): Promise<void> {
    await this.require('leaveViaCommunity')
    await this.backend.leaveCommunity(communityDid)
    for (const [id, room] of this.rooms) if (room.communityDid === communityDid) this.rooms.delete(id)
  }

  // Later phases. Each reports its status, so a screen never reaches these while they are not built.
  private notYet(operation: RoomsOperation): Promise<never> {
    return this.require(operation).then(() => {
      throw new RoomsUnavailable(operation, 'clientNotBuilt', 'not built in this version of Keyring')
    })
  }

  public prepareWrite(): Promise<WritePreview> {
    return this.notYet('write')
  }
  public confirmWrite(): Promise<{ key: string; version: number }> {
    return this.notYet('write')
  }
  public curate(): Promise<void> {
    return this.notYet('curate')
  }
  public listOffers(): Promise<RoomOffer[]> {
    return this.notYet('listOffers')
  }
  public previewOffer(): Promise<OfferPreview> {
    return this.notYet('acceptOffer')
  }
  public acceptOffer(): Promise<{ roomId: string }> {
    return this.notYet('acceptOffer')
  }
  public hideOffer(): Promise<void> {
    return this.notYet('hideOffer')
  }
  public listFiles(): Promise<RoomFile[]> {
    return this.notYet('listFiles')
  }
  public openFile(): Promise<OpenedFile> {
    return this.notYet('openFile')
  }
  public releaseFile(): Promise<void> {
    return Promise.resolve()
  }
  public listCommunityMembers(): Promise<CommunityRoomMember[]> {
    return this.notYet('listCommunityMembers')
  }
  public listAgentAccess(): Promise<AgentGrant[]> {
    return this.notYet('agentAccess')
  }
  public grantAgentAccess(): Promise<AgentGrant> {
    return this.notYet('agentAccess')
  }
  public withdrawAgentAccess(): Promise<void> {
    return this.notYet('agentAccess')
  }
}
