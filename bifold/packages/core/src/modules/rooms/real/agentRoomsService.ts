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
 * - **Offers** are the community's (`vtc/rooms/offers/list`, sent as the persona). Accepting stores the offer's
 *   credentials in the agent's vault and, on a sealed room, has the agent mint the KeyPackage and join from the
 *   Welcome the community answers with. The phone never holds a room key or a KeyPackage's private half.
 *   Renewals the listing carries are stored in place of the credentials they renew; they are never accepted.
 *
 * - **Writes and curation** are requests to the room's host, completed as the member by the agent
 *   (`rooms/keys/act`), which inserts the member's presentation and signs; the phone sends the completed document
 *   to the host unchanged, over the same DIDComm session it reaches the community on. The phone adds nothing to it
 *   and holds no key that could. Writing is built for `open` rooms; a sealed room's record is sealed by the agent
 *   first, which is a later phase.
 *
 * Files and agent access are later phases and report `clientNotBuilt`.
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import { deriveCapabilities, deriveRoomCapabilities } from '../capabilities'
import { inertFlags, toInertText } from '../inertText'
import { chatMessageText } from '../roomPosts'
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
  WriteDraft,
  WritePreview,
} from '../types'
import {
  NOTE_BODY_MAX,
  NOTE_TITLE_MAX,
  PREVIEW_TOKEN_TTL_MS,
  RoomsConflict,
  RoomsPreviewExpired,
  RoomsRefused,
  RoomsUnavailable,
} from '../types'

import {
  parseAccept,
  parseActed,
  parseBrowse,
  parseCurate,
  parseKeyPackage,
  parseKeysList,
  parseMemberships,
  parseOffers,
  parsePut,
  parseRead,
  parseVaultQuery,
  refusalCode,
  ROOMS_TASK,
  vaultCredentialSubject,
  type HeldRoom,
  type OfferRecord,
  type RenewalRecord,
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
  /**
   * Deliver a document the agent completed (`rooms/keys/act`) to `recipientDid` unchanged, over the session to
   * `communityDid`; resolves with the response payload.
   */
  sendCompleted(communityDid: string, recipientDid: string, document: Record<string, unknown>): Promise<unknown>
  /** A fresh random identifier (a UUID). */
  newId(): string
  leaveCommunity(communityDid: string): Promise<void>
  decodeBase64Url(value: string): string
  /** The offers hidden on this phone, by `offerId`. Upstream has no decline, so this is all hiding is. */
  hiddenOffers(): Promise<string[]>
  hideOffer(offerId: string): Promise<void>
  /** A step that went wrong without failing the operation, for the log. */
  warn(message: string): void
}

/** What the service needs besides the backend. Tests replace the clock and the wait between retries. */
export interface AgentRoomsOptions {
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/** The operations this phase implements. */
export const R1_BUILT: ReadonlySet<RoomsOperation> = new Set<RoomsOperation>([
  'listMyRooms',
  'getRoom',
  'listNotes',
  'readNote',
  'leaveViaCommunity',
])

/** The operations this build implements: R1, joining by a community's offer, and writing notes. */
export const BUILT: ReadonlySet<RoomsOperation> = new Set<RoomsOperation>([
  ...R1_BUILT,
  'listOffers',
  'acceptOffer',
  'hideOffer',
  'write',
  'curate',
])

/**
 * A post's record key, from its idempotency key: the same on every retry, so a post sent again after its answer
 * was lost meets itself (create-only) instead of landing twice. Opaque, as a sealed room's keys must be.
 */
export function postKey(idempotencyKey: string): string {
  return `note/${bytesToHex(sha256(utf8ToBytes(`keyring.rooms.post|${idempotencyKey}`))).slice(0, 32)}`
}

/** How many pages of a community's membership record, or of its offers, to read before stopping. */
const MAX_MEMBERSHIP_PAGES = 10

/**
 * How often an accept the community answers `admissionPending` is sent again, identically, before the refusal
 * reaches the screen, and the wait before each. The community is settling the admission with its own agent;
 * the same KeyPackage is answered with the same Welcome (`vtc/rooms/offers/accept/0.1`).
 */
const ADMISSION_PENDING_WAITS_MS = [1000, 2000, 4000]

const isSealed = (tier: OfferRecord['tier']) => tier !== 'open'

/** An offer's name for screens: opaque, and a valid route parameter. */
export const offerIdOf = (communityDid: string, roomId: string) =>
  `offer:${encodeURIComponent(communityDid)}:${encodeURIComponent(roomId)}`

const parseOfferId = (offerId: string): { communityDid: string; roomId: string } | undefined => {
  const [tag, community, room, ...rest] = offerId.split(':')
  if (tag !== 'offer' || !community || !room || rest.length > 0) return undefined
  try {
    return { communityDid: decodeURIComponent(community), roomId: decodeURIComponent(room) }
  } catch {
    return undefined
  }
}

/** Refusals of an accept that the same request may get past: the community or its key holder is still settling. */
const RETRYABLE = new Set(['admissionPending', 'keyHolderRefused'])

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Whether the agent holds `roomId`'s group as `member`. A 0.1 listing names no member: it holds it for someone. */
const holdsAs = (held: HeldRoom, roomId: string, member: string) =>
  held.roomId === roomId && (held.member === undefined || held.member === member)

/** A credential the community sent as JSON text, as the object the vault takes. */
function credentialOf(text: string, what: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`the ${what} credential is not JSON`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(`the ${what} credential is not a credential`)
  return parsed as Record<string, unknown>
}

/** The credential types a room issues a member, by the tag the vault is queried with. */
const RENEWED = [
  ['membership', 'MembershipCredential'],
  ['authority', 'AuthorityCredential'],
] as const

const shortId = (id: string) => id.replace(/^did:[^:]+:/, '').slice(-10)

interface KnownRoom extends Room {
  community?: RoomsCommunity
}

export class AgentRoomsService implements RoomsService {
  public readonly isSample = false
  public readonly label = 'rooms: the person’s own agent and communities'

  private served?: { types: readonly string[] | undefined }
  private heldInFlight?: Promise<HeldRoom[]>
  private rooms = new Map<string, KnownRoom>()
  private offers = new Map<string, { community: RoomsCommunity; offer: OfferRecord }>()
  private previews = new Map<string, { offerId: string; at: number }>()
  private writes = new Map<string, { roomId: string; draft: WriteDraft; at: number; replacedVersion?: number }>()
  /** Renewals stored this run, by room and issue time: a renewal stays listed until the authority it renews lapses. */
  private renewed = new Set<string>()
  /** The offers list each community answered, so the badge's poll asks it once a session, not twice a minute. */
  private offersType = new Map<string, string>()
  private nextToken = 1
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>

  public constructor(
    private readonly backend: RoomsBackend,
    private readonly built: ReadonlySet<RoomsOperation> = BUILT,
    options: AgentRoomsOptions = {}
  ) {
    this.now = options.now ?? (() => Date.now())
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

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
    // as `detailsNotLoaded`, and the other communities' rooms are unaffected. Why it did not answer is logged.
    const unreachable: string[] = []
    const memberships = await Promise.all(
      communities.map(async (community) => ({
        community,
        records: await this.membershipsOf(community).catch((e: unknown): RoomMembershipRecord[] => {
          this.backend.warn(`rooms: ${community.did} did not list this member's rooms: ${message(e)}`)
          unreachable.push(community.did)
          return []
        }),
      }))
    )
    // When none answered, custody alone is not the member's rooms: an open room holds no keys and would be
    // missing, and every other room would show by its id. The read fails instead, and the screen says why.
    if (communities.length > 0 && unreachable.length === communities.length)
      throw new RoomsUnavailable(
        'listMyRooms',
        'communityUnreachable',
        `no community answered for this member's rooms (${unreachable.join(', ')})`
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

  /**
   * The agent's key list, one read shared by every caller while it is in flight: the screens that list rooms
   * read again on focus, together, and the agent client sends one task at a time, so each copy queued behind the
   * last (five in 4.5 s in a tester's run, 10-29). A read that starts after one settles asks again; `holds`
   * always asks afresh.
   */
  private heldRooms(): Promise<HeldRoom[]> {
    if (this.heldInFlight) return this.heldInFlight
    const read = this.readHeldRooms().finally(() => {
      if (this.heldInFlight === read) this.heldInFlight = undefined
    })
    this.heldInFlight = read
    return read
  }

  private async readHeldRooms(): Promise<HeldRoom[]> {
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
    return this.capabilitiesIn(await this.known(roomId))
  }

  /**
   * A room's statuses, and what this build does not yet do in a room of its tier: writing is built for `open` rooms
   * only (cleartext `rooms/records/put`). A sealed room's record is sealed and signed by the agent first
   * (`rooms/keys/seal/0.2`), which is not built, so the composer says so instead of every post failing.
   */
  private async capabilitiesIn(room: KnownRoom): Promise<RoomCapabilities> {
    const statuses = deriveRoomCapabilities(await this.capabilities(), room)
    if (statuses.write.status === 'available' && room.tier !== 'open')
      statuses.write = {
        status: 'comingSoon',
        reason: 'tierNotYet',
        detail: `writing to ${room.tier} rooms is not built yet`,
      }
    return statuses
  }

  private async requireInRoom(roomId: string, operation: keyof RoomCapabilities): Promise<KnownRoom> {
    const room = await this.known(roomId)
    const status = (await this.capabilitiesIn(room))[operation]
    if (status.status !== 'available') throw new RoomsUnavailable(operation, status.reason, status.detail)
    if (!room.host) throw new RoomsUnavailable(operation, 'detailsNotLoaded', 'no host is known for this room')
    return room
  }

  public async listNotes(roomId: string, options: { sinceVersion?: number } = {}): Promise<NoteList> {
    const room = await this.requireInRoom(roomId, 'listNotes')
    const { sinceVersion } = options
    const listing = parseBrowse(
      await this.backend.agentTask(ROOMS_TASK.keysBrowse, {
        roomId,
        host: room.host,
        ...(sinceVersion !== undefined ? { sinceVersion } : {}),
      })
    )
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

  /**
   * The offers this member can act on, community by community: open ones, and accepted ones on a sealed room the
   * agent does not hold yet, which accepting again finishes (`vtc/rooms/memberships/list/0.1`, "One record,
   * every surface"). Hidden ones are left out. One community that cannot answer leaves out only its own, unless
   * it is the one asked for. The renewals a listing carries are stored on the way.
   */
  public async listOffers(communityDid?: string): Promise<RoomOffer[]> {
    await this.require('listOffers')
    const communities = (await this.backend.communities()).filter((c) => !communityDid || c.did === communityDid)
    const hidden = new Set(await this.backend.hiddenOffers())
    // Asked of the agent only when an accepted sealed offer needs it: this is the offers badge's poll.
    let held: Promise<HeldRoom[]> | undefined
    const heldNow = () =>
      (held ??= this.heldRooms().catch((e): HeldRoom[] => {
        this.backend.warn(`rooms: the agent did not list the rooms it holds: ${message(e)}`)
        return []
      }))
    const out: RoomOffer[] = []
    for (const community of communities) {
      let listing: { items: OfferRecord[]; renewals: RenewalRecord[] }
      try {
        listing = await this.offersOf(community)
      } catch (e) {
        if (communityDid) throw e
        this.backend.warn(`rooms: ${community.did} did not list its offers: ${message(e)}`)
        continue
      }
      await this.takeRenewals(community, listing.renewals)
      for (const [id, entry] of this.offers) if (entry.community.did === community.did) this.offers.delete(id)
      for (const offer of listing.items) {
        // A community offers its own rooms, and the accept goes to it.
        if (offer.host !== community.did) {
          this.backend.warn(`rooms: ${community.did} offered ${offer.roomId} hosted by ${offer.host}; left out`)
          continue
        }
        if (offer.state === 'accepted') {
          const joined =
            !isSealed(offer.tier) || (await heldNow()).some((h) => holdsAs(h, offer.roomId, community.personaDid))
          if (joined) continue
        }
        const offerId = offerIdOf(community.did, offer.roomId)
        this.offers.set(offerId, { community, offer })
        if (!hidden.has(offerId)) out.push(this.toRoomOffer(community, offer, offerId))
      }
    }
    return out
  }

  /** Every page of a community's offers to this member, and the renewals the first page carries. */
  private async offersOf(community: RoomsCommunity): Promise<{ items: OfferRecord[]; renewals: RenewalRecord[] }> {
    let type: string = this.offersType.get(community.did) ?? ROOMS_TASK.offersList03
    let first: unknown
    try {
      first = await this.backend.communityTask(community.did, type, {})
    } catch (e) {
      const code = refusalCode(e)
      // A community older than renewals is read at 0.2, which carries none.
      if (type !== ROOMS_TASK.offersList03 || (code !== 'unsupportedVersion' && code !== 'unsupportedType')) throw e
      type = ROOMS_TASK.offersList02
      first = await this.backend.communityTask(community.did, type, {})
    }
    this.offersType.set(community.did, type)
    const page = parseOffers(first)
    const items = [...page.items]
    let cursor = page.nextCursor
    for (let n = 1; cursor && n < MAX_MEMBERSHIP_PAGES; n++) {
      const next = parseOffers(await this.backend.communityTask(community.did, type, { cursor }))
      items.push(...next.items)
      cursor = next.nextCursor
    }
    return { items, renewals: page.renewals }
  }

  /**
   * Stores each renewal's credentials in the agent's vault in place of the ones they renew, never beside them: a
   * key holder holding two authorities from one room cannot choose between them (`vtc/rooms/offers/list/0.3`).
   * Storing one already stored is success, so whichever surface collects it first wins.
   */
  private async takeRenewals(community: RoomsCommunity, renewals: RenewalRecord[]): Promise<void> {
    const pending = renewals.filter((r) => !this.renewed.has(`${r.roomId}|${r.issuedAt}`))
    if (pending.length === 0) return
    const served = this.served?.types ?? []
    const get = [ROOMS_TASK.vaultGet02, ROOMS_TASK.vaultGet01].find((t) => served.includes(t))
    if (!get || !served.includes(ROOMS_TASK.vaultQuery) || !served.includes(ROOMS_TASK.vaultReceive)) {
      const needed = [ROOMS_TASK.vaultQuery, ROOMS_TASK.vaultGet02, ROOMS_TASK.vaultReceive]
      this.backend.warn(
        `rooms: ${pending.length} renewal(s) left uncollected: the agent does not serve ${needed.join(', ')}`
      )
      return
    }
    for (const renewal of pending) {
      try {
        for (const [what, tag] of RENEWED) {
          const replaces = await this.heldCredential(get, renewal.roomId, community.personaDid, tag)
          await this.backend.agentTask(ROOMS_TASK.vaultReceive, {
            credential: credentialOf(renewal.credentials[what], what),
            ...(replaces ? { id: replaces } : {}),
          })
        }
        this.renewed.add(`${renewal.roomId}|${renewal.issuedAt}`)
      } catch (e) {
        this.backend.warn(`rooms: the renewal of ${renewal.roomId} was not stored: ${message(e)}`)
      }
    }
  }

  /** The vault's handle of the one credential of `tag` the room issued `member`, if it holds one. */
  private async heldCredential(get: string, roomId: string, member: string, tag: string): Promise<string | undefined> {
    const found = parseVaultQuery(await this.backend.agentTask(ROOMS_TASK.vaultQuery, { type: tag, issuerDid: roomId }))
    const mine: string[] = []
    for (const { id } of found)
      if (vaultCredentialSubject(await this.backend.agentTask(get, { id })) === member) mine.push(id)
    if (mine.length > 1)
      throw new Error(
        `the agent holds ${mine.length} ${tag}s ${roomId} issued ${member}, and acts with none until one is left`
      )
    return mine[0]
  }

  private toRoomOffer(community: RoomsCommunity, offer: OfferRecord, offerId: string): RoomOffer {
    return {
      offerId,
      roomId: offer.roomId,
      roomName: toInertText(offer.label || shortId(offer.roomId)),
      description: offer.description !== undefined ? toInertText(offer.description) : undefined,
      communityDid: community.did,
      communityName: toInertText(community.name ?? shortId(community.did)),
      tier: offer.tier,
      verbs: offer.actions,
      validUntil: offer.validUntil,
    }
  }

  /** A sealed room is joined by the agent: it must serve the KeyPackage and Welcome tasks. */
  private requireSealedSupport(offer: OfferRecord): void {
    if (!isSealed(offer.tier)) return
    const served = this.served?.types ?? []
    const missing: string[] = [ROOMS_TASK.keysKeyPackage, ROOMS_TASK.keysWelcome].filter((t) => !served.includes(t))
    // The acceptance carries the agent's KeyPackage, so the agent completes it (`rooms/keys/act`, recipient item 10).
    if (!this.actType()) missing.push(ROOMS_TASK.keysAct06)
    if (missing.length > 0)
      throw new RoomsUnavailable('acceptOffer', 'agentDoesNotServe', `a ${offer.tier} room needs ${missing.join(', ')}`)
  }

  public async previewOffer(offerId: string): Promise<OfferPreview> {
    await this.require('acceptOffer')
    const ref = parseOfferId(offerId)
    if (!ref) throw new RoomsRefused('acceptOffer', 'notFound', false, 'not an offer')
    if (!this.offers.has(offerId)) await this.listOffers(ref.communityDid)
    const entry = this.offers.get(offerId)
    if (!entry)
      throw new RoomsRefused('acceptOffer', 'notFound', false, `${ref.communityDid} lists no offer of ${ref.roomId}`)
    this.requireSealedSupport(entry.offer)
    const token = `o${this.nextToken++}`
    this.previews.set(token, { offerId, at: this.now() })
    return {
      token,
      offer: this.toRoomOffer(entry.community, entry.offer, offerId),
      actingAs: { did: entry.community.personaDid, identityWords: entry.community.identityWords },
    }
  }

  /**
   * Accepts what the preview showed, step for step as every other surface does (`pnm rooms offers accept`), so
   * any surface finishes what another began: each step answers a repeat with its first answer. The offer is read
   * again first, since it may have been withdrawn or accepted elsewhere since the preview.
   */
  public async acceptOffer(token: string): Promise<{ roomId: string }> {
    const pending = this.previews.get(token)
    this.previews.delete(token)
    if (!pending || this.now() - pending.at > PREVIEW_TOKEN_TTL_MS) throw new RoomsPreviewExpired(token)
    await this.require('acceptOffer')
    const entry = this.offers.get(pending.offerId)
    if (!entry) throw new RoomsPreviewExpired(token)
    const { community } = entry
    const roomId = entry.offer.roomId
    const offer = (await this.offersOf(community)).items.find((o) => o.roomId === roomId && o.host === community.did)
    if (!offer) throw new RoomsRefused('acceptOffer', 'notFound', false, `${community.did} no longer lists ${roomId}`)
    this.requireSealedSupport(offer)
    const sealed = isSealed(offer.tier)
    const done = () => {
      this.offers.delete(pending.offerId)
      this.rooms = new Map() // the next read lists the room
      this.heldInFlight = undefined // nor joins a key list asked before the room was held
      return { roomId }
    }

    // Joined already: from another surface, or an earlier run whose answer was lost.
    if (offer.state === 'accepted' && (!sealed || (await this.holds(roomId, community.personaDid)))) return done()

    for (const what of ['membership', 'authority'] as const) {
      await this.agentStep('acceptOffer', `store the ${what} credential`, ROOMS_TASK.vaultReceive, {
        credential: credentialOf(offer.credentials[what], what),
      })
    }
    // The agent's own KeyPackage: the community completes an admission only with one the member's key holder
    // minted, and the agent answers a repeat with the one it already gave.
    let keyPackage: string | undefined
    if (sealed) {
      keyPackage = parseKeyPackage(
        await this.agentStep('acceptOffer', 'give a key package', ROOMS_TASK.keysKeyPackage, {
          roomId,
          invitation: offer.credentials.invitation,
        })
      )?.keyPackage
      if (!keyPackage) throw new Error('the agent answered without a key package')
    }

    let accepted: NonNullable<ReturnType<typeof parseAccept>>
    try {
      accepted = await this.sendAccept(community, roomId, keyPackage)
    } catch (e) {
      // Accepted with this KeyPackage too long ago to be answered again, but joined: that is done.
      if (e instanceof RoomsRefused && e.code === 'alreadyAccepted' && sealed) {
        if (await this.holds(roomId, community.personaDid).catch(() => false)) return done()
      }
      throw e
    }
    if (!sealed) return done()
    if (!accepted.welcome)
      throw new RoomsRefused(
        'acceptOffer',
        'welcomeMissing',
        true,
        `${community.did} admitted the member but sent no Welcome`
      )

    try {
      await this.backend.agentTask(ROOMS_TASK.keysWelcome, {
        roomId,
        welcome: accepted.welcome,
        invitation: offer.credentials.invitation,
        ...(accepted.ratchetTree ? { ratchetTree: accepted.ratchetTree } : {}),
      })
    } catch (e) {
      // Another surface handed the same Welcome over first.
      if (refusalCode(e) !== 'alreadyJoined')
        throw new RoomsRefused(
          'acceptOffer',
          'joinFailed',
          true,
          `the agent did not join from the Welcome: ${message(e)}`
        )
    }
    // The epoch keys the member may read, so the room opens at once. A failure here leaves reads to repair it.
    if ((this.served?.types ?? []).includes(ROOMS_TASK.keysBackfill)) {
      await this.backend
        .agentTask(ROOMS_TASK.keysBackfill, { roomId, host: offer.host })
        .catch((e) => this.backend.warn(`rooms: backfill of ${roomId} after joining failed: ${message(e)}`))
    }
    return done()
  }

  /** An agent task on an operation's path, its refusal reported as the operation's. */
  private async agentStep(
    operation: RoomsOperation,
    what: string,
    type: string,
    payload: Record<string, unknown>
  ): Promise<unknown> {
    try {
      return await this.backend.agentTask(type, payload)
    } catch (e) {
      const code = refusalCode(e)
      if (code) throw new RoomsRefused(operation, code, false, `the agent would not ${what}: ${message(e)}`)
      throw e
    }
  }

  /** The newest `rooms/keys/act` the agent serves, if any. */
  private actType(): string | undefined {
    const served = this.served?.types ?? []
    return [ROOMS_TASK.keysAct06, ROOMS_TASK.keysAct05].find((t) => served.includes(t))
  }

  /**
   * One request to `recipient`, completed as the member by the agent (`rooms/keys/act`) and sent by the phone
   * unchanged, over the session to the member's community. The document is new each time: its id is single-use
   * at the host, so a request is never sent twice. Resolves with the recipient's answer; its refusals pass through.
   */
  private async actAndSend(
    operation: RoomsOperation,
    community: RoomsCommunity,
    recipient: string,
    type: string,
    payload: Record<string, unknown>
  ): Promise<unknown> {
    const act = this.actType()
    if (!act)
      throw new RoomsUnavailable(
        operation,
        'agentDoesNotServe',
        `the agent serves neither ${ROOMS_TASK.keysAct06} nor ${ROOMS_TASK.keysAct05}`
      )
    const document = {
      id: `urn:uuid:${this.backend.newId()}`,
      type,
      issuer: community.personaDid,
      recipient,
      issuedAt: new Date(this.now()).toISOString(),
      payload,
    }
    const acted = parseActed(await this.agentStep(operation, 'complete the request as the member', act, { document }))
    if (!acted || acted.principal !== community.personaDid || acted.document.type !== type)
      throw new Error(`the agent did not complete ${type} as ${community.personaDid}`)
    return this.backend.sendCompleted(community.did, recipient, acted.document)
  }

  /**
   * Sends the accept; an `admissionPending` answer is sent again, identically, a few times first. An accept
   * carrying the agent's KeyPackage is completed by the agent, the only party that can vouch for the package
   * (`rooms/keys/act`, recipient item 10); one without is signed on the phone as the persona.
   */
  private async sendAccept(community: RoomsCommunity, roomId: string, keyPackage?: string) {
    const payload = { roomId, ...(keyPackage ? { keyPackage } : {}) }
    for (let attempt = 0; ; attempt++) {
      let answer: unknown
      try {
        answer = keyPackage
          ? await this.actAndSend('acceptOffer', community, community.did, ROOMS_TASK.offersAccept, payload)
          : await this.backend.communityTask(community.did, ROOMS_TASK.offersAccept, payload)
      } catch (e) {
        const code = refusalCode(e)
        if (!code) throw e
        if (code === 'admissionPending' && attempt < ADMISSION_PENDING_WAITS_MS.length) {
          await this.sleep(ADMISSION_PENDING_WAITS_MS[attempt])
          continue
        }
        throw new RoomsRefused('acceptOffer', code, RETRYABLE.has(code), message(e))
      }
      const accepted = parseAccept(answer)
      if (!accepted || accepted.roomId !== roomId)
        throw new Error(`${community.did} answered the acceptance of ${roomId} with something else`)
      return accepted
    }
  }

  private async holds(roomId: string, member: string): Promise<boolean> {
    // Asked fresh, never joined to a read in flight: after a Welcome, one that left before it would say no.
    return (await this.readHeldRooms()).some((h) => holdsAs(h, roomId, member))
  }

  public async hideOffer(offerId: string): Promise<void> {
    await this.require('hideOffer')
    await this.backend.hideOffer(offerId)
  }

  // Later phases. Each reports its status, so a screen never reaches these while they are not built.
  private notYet(operation: RoomsOperation): Promise<never> {
    return this.require(operation).then(() => {
      throw new RoomsUnavailable(operation, 'clientNotBuilt', 'not built in this version of Keyring')
    })
  }

  /**
   * What `confirmWrite` will send, for the confirmation sheet. A note is replaced only at the version read here:
   * if it changes before the confirmation, the host refuses and `confirmWrite` reports `RoomsConflict`.
   */
  public async prepareWrite(roomId: string, draft: WriteDraft): Promise<WritePreview> {
    const room = await this.requireInRoom(roomId, 'write')
    // Files are not built: a post that carries one is refused, never sent without it.
    if (draft.attachment) throw new RoomsUnavailable('write', 'clientNotBuilt', 'posting a file is not built yet')
    if (draft.body.trim().length === 0) throw new RoomsRefused('write', 'empty', false, 'the note has no text')
    // A post's limit is its words, not the keyring.chat/1 message around them, whose escaping (quotes, line breaks)
    // would refuse a post the composer allowed, on every retry.
    const words = chatMessageText(draft.body, this.now()) ?? draft.body
    if (words.length > NOTE_BODY_MAX || draft.title.length > NOTE_TITLE_MAX)
      throw new RoomsRefused('write', 'tooLong', false, `a note holds ${NOTE_BODY_MAX} characters`)
    let replacedVersion: number | undefined
    if (draft.replaceKey) {
      replacedVersion = await this.versionOf(room, draft.replaceKey)
      if (replacedVersion === undefined)
        throw new RoomsRefused('write', 'notFound', false, `no note ${draft.replaceKey} in this room`)
    }
    const token = `w${this.nextToken++}`
    this.writes.set(token, { roomId, draft, at: this.now(), replacedVersion })
    return {
      token,
      roomId,
      roomName: room.name,
      communityName: room.communityName,
      tier: room.tier,
      actingAs: room.actingAs,
      visibleTo: 'membersAndHost',
      authorShown: true,
      title: toInertText(draft.title),
      body: toInertText(draft.body),
      validUntil: room.validUntil,
    }
  }

  /**
   * Writes the previewed note (`rooms/records/put/0.1`, open room: the host reads `cleartext`). A new note is
   * create-only under a fresh random key; a replacement must still be at the version the preview read.
   */
  public async confirmWrite(token: string): Promise<{ key: string; version: number }> {
    const pending = this.writes.get(token)
    this.writes.delete(token)
    if (!pending || this.now() - pending.at > PREVIEW_TOKEN_TTL_MS) throw new RoomsPreviewExpired(token)
    const room = await this.requireInRoom(pending.roomId, 'write')
    const { community, host } = this.hostOf(room, 'write')
    const { title, body, replaceKey, idempotencyKey } = pending.draft
    const key = replaceKey ?? (idempotencyKey ? postKey(idempotencyKey) : `note/${this.backend.newId()}`)
    const expectedVersion = pending.replacedVersion ?? 0
    let answer: unknown
    try {
      answer = await this.actAndSend('write', community, host, ROOMS_TASK.recordsPut, {
        roomId: room.roomId,
        key,
        expectedVersion,
        cleartext: { ...(title.trim() ? { title } : {}), body },
      })
    } catch (e) {
      const refused = await this.hostRefusal('write', room, key, expectedVersion, e)
      // Sent again after its answer was lost: the key is this post's own, so the record already there is this post.
      if (!replaceKey && idempotencyKey && refused instanceof RoomsConflict)
        return { key, version: refused.currentVersion }
      throw refused
    }
    const put = parsePut(answer)
    if (!put || put.key !== key) throw new Error(`the host answered the write of ${key} with something else`)
    return put
  }

  /** Pins, unpins or retracts a note (`rooms/records/curate/0.1`). Any tier: the host sees only the key. */
  public async curate(roomId: string, key: string, action: 'pin' | 'unpin' | 'retract'): Promise<void> {
    const room = await this.requireInRoom(roomId, 'curate')
    const { community, host } = this.hostOf(room, 'curate')
    let answer: unknown
    try {
      answer = await this.actAndSend('curate', community, host, ROOMS_TASK.recordsCurate, {
        roomId,
        key,
        ...(action === 'retract' ? { status: 'retracted' } : { pinned: action === 'pin' }),
      })
    } catch (e) {
      throw await this.hostRefusal('curate', room, key, undefined, e)
    }
    if (!parseCurate(answer)) throw new Error(`the host answered the curation of ${key} with something else`)
  }

  /** The room's host, and the community whose session reaches it. A room only custody knows of has neither. */
  private hostOf(room: KnownRoom, operation: RoomsOperation): { community: RoomsCommunity; host: string } {
    if (!room.community || !room.host)
      throw new RoomsUnavailable(
        operation,
        'detailsNotLoaded',
        'the community’s record of this room has not been loaded'
      )
    return { community: room.community, host: room.host }
  }

  /** A note's current version, read through the agent; undefined when the host has no such note. */
  private async versionOf(room: KnownRoom, key: string): Promise<number | undefined> {
    try {
      return parseRead(
        await this.backend.agentTask(ROOMS_TASK.keysRead, { roomId: room.roomId, host: room.host, key }),
        (s) => this.backend.decodeBase64Url(s)
      )?.version
    } catch (e) {
      if (refusalCode(e) === 'notFound') return undefined
      throw e
    }
  }

  /**
   * A host's refusal as the screen reads it. The note having moved past `expectedVersion` is a conflict, whatever
   * code the host words it with (a VTC refuses a stale precondition as `taskFailed`, reason `conflict`), so the note is read
   * again to tell. Anything that is not a refusal passes through.
   */
  private async hostRefusal(
    operation: RoomsOperation,
    room: KnownRoom,
    key: string,
    expectedVersion: number | undefined,
    e: unknown
  ): Promise<unknown> {
    const code = refusalCode(e)
    if (!code) return e
    if (expectedVersion !== undefined) {
      const current = await this.versionOf(room, key).catch(() => undefined)
      if (current !== undefined && current !== expectedVersion) return new RoomsConflict(key, current)
    }
    return new RoomsRefused(operation, code, false, message(e))
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
