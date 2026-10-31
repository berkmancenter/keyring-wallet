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
 *   and holds no key that could. On an `attributed` room the record is first signed as the member and sealed by
 *   the agent (`rooms/keys/seal/0.2`), so the host holds only ciphertext. `private` rooms are not written to yet.
 *
 * Files and agent access are later phases and report `clientNotBuilt`.
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { DeviceEventEmitter } from 'react-native'

import { WALLET_LOCKED_EVENT } from '../../../utils/walletLocked'
import { deriveCapabilities, deriveRoomCapabilities } from '../capabilities'
import { inertFlags, toInertText } from '../inertText'
import { chatMessageText } from '../roomPosts'
import { roomRef } from '../roomRef'
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
  KEYS_ACT_TYPES,
  OFFERS_LIST_TYPES,
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
  parseSealed,
  parseVaultQuery,
  refusalCode,
  ROOMS_TASK,
  vaultCredentialSubject,
  type FileManifest,
  type HeldRoom,
  type OfferRecord,
  type OpenedRecord,
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
  /**
   * The app's agent this backend talks through. An unlock restarts that same agent, and a service registered
   * again for it is the one already registered (register.ts).
   */
  readonly runsOn?: object
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
  encodeBase64Url(text: string): string
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
  'listFiles',
])

/**
 * A post's record key, from its idempotency key: the same on every retry, so a post sent again after its answer
 * was lost meets itself (create-only) instead of landing twice. Opaque, as a sealed room's keys must be.
 */
export function postKey(idempotencyKey: string): string {
  return `note/${bytesToHex(sha256(utf8ToBytes(`keyring.rooms.post|${idempotencyKey}`))).slice(0, 32)}`
}

/**
 * How many times a sealed note is sealed again when another write took the version it was sealed for, as upstream's
 * CLI does (`pnm rooms put`, VTA 0.67).
 */
const SEALED_WRITE_ATTEMPTS = 4

/** How many pages of a community's membership record, or of its offers, to read before stopping. */
const MAX_MEMBERSHIP_PAGES = 10
/**
 * How soon an agent that could not say what it serves is asked again. Its answer was kept until a pull to refresh:
 * one lost while the session reopened after an unlock left a room on "Couldn't reach your agent" (#772, 10-30).
 */
export const SERVED_UNKNOWN_RETRY_MS = 10_000

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

/** Where an opened record is kept: a record's version never changes once written, so key and version name it. */
const openedKey = (roomId: string, key: string, version: number) => `${roomId}\n${key}@${version}`
/** A record in a room, whatever its version: what the room's last listing said its version is. */
const listedKey = (roomId: string, key: string) => `${roomId}\n${key}`

/**
 * The most opened records a service keeps. An opened record is a decrypted body, kept in memory only; past this the
 * least recently used goes. Ten rooms of fifty posts each fit.
 */
export const MAX_OPENED_RECORDS = 500

// The services that hold opened records. When the wallet locks or the person logs out, each forgets them and the set
// is emptied, so it never keeps a service alive past a lock; a service joins again the next time it keeps a record.
const holdingOpened = new Set<{ dropOpenedRecords(): void }>()
DeviceEventEmitter.addListener(WALLET_LOCKED_EVENT, () => {
  for (const service of holdingOpened) service.dropOpenedRecords()
  holdingOpened.clear()
})

/** A record's file as a screen lists it: the name is untrusted text, shown inert. */
const roomFileOf = (file: FileManifest, record: Pick<OpenedRecord, 'author' | 'updatedAt'>): RoomFile => ({
  fileId: file.fileId,
  name: toInertText(file.name),
  ...(file.mediaType ? { mediaType: file.mediaType } : {}),
  size: file.size,
  ...(record.author ? { sharedBy: { did: record.author } } : {}),
  ...(record.updatedAt ? { sharedAt: record.updatedAt } : {}),
})

interface KnownRoom extends Room {
  community?: RoomsCommunity
}

export class AgentRoomsService implements RoomsService {
  public readonly isSample = false
  public readonly label = 'rooms: the person’s own agent and communities'
  public get runsOn(): object | undefined {
    return this.backend.runsOn
  }

  private served?: { types: readonly string[] | undefined; at: number }
  private servedInFlight?: Promise<void>
  /** How many asks of what the agent serves were started: only the latest one's answer is kept. */
  private servedAsks = 0
  private heldInFlight?: Promise<HeldRoom[]>
  private roomsInFlight?: Promise<RoomSummary[]>
  /** Counts the accepts and leaves: a listing asked before one is neither joined nor kept after it. */
  private roomsChanged = 0
  private rooms = new Map<string, KnownRoom>()
  private offers = new Map<string, { community: RoomsCommunity; offer: OfferRecord }>()
  private previews = new Map<string, { offerId: string; at: number }>()
  private writes = new Map<string, { roomId: string; draft: WriteDraft; at: number; replacedVersion?: number }>()
  // Records opened through the agent, by room, key and version: what a file listing and a second read of a post
  // reuse. Kept through keepOpened, oldest use first, within MAX_OPENED_RECORDS; forgotten on lock and on leaving.
  private opened = new Map<string, OpenedRecord>()
  /** Each record's version as the room's last listing gave it, so a read knows which opened copy is current. */
  private listed = new Map<string, number>()
  /**
   * A room's listing being asked now, by room and the version it starts from. Opening a room lists it twice at once
   * (its posts and its notes tab), and the agent client sends one task at a time, so the posts waited a whole second
   * listing before their first read (+0.6–0.9 s on each open, lab sim 10-30).
   */
  private listingInFlight = new Map<string, Promise<NoteList>>()
  /** A record's read being asked now, by room and key: every caller that reads it meanwhile waits for the same one. */
  private readsInFlight = new Map<string, Promise<OpenedRecord>>()
  /** How many times opened records were dropped (a lock, a leave): a read asked before the last one is not kept. */
  private drops = 0
  /** Renewals stored this run, by room and issue time: a renewal stays listed until the authority it renews lapses. */
  private renewed = new Set<string>()
  /** The offers list each community answered, so the badge's poll asks it once a session, not twice a minute. */
  private offersType = new Map<string, string>()
  /** The `rooms/records/put` each host took, so a host that refused 0.3 is not asked it on every post. */
  private putTypeOf = new Map<string, string>()
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
    const unknownAged = !this.served?.types && this.now() - (this.served?.at ?? -Infinity) >= SERVED_UNKNOWN_RETRY_MS
    if (linked && (options.refresh || unknownAged)) await this.askServed(options.refresh)
    return deriveCapabilities({ agentLinked: linked, servedTypes: this.served?.types, built: this.built })
  }

  /**
   * One ask of what the agent serves at a time: every caller that needs it while it is out waits for the same one.
   * The agent's client sends one task at a time, and an agent that does not answer would otherwise be asked once per
   * caller (each operation's check, every screen's read) and hold everything queued behind those asks.
   *
   * A refresh starts its own ask and does not join one already out: that one may have been sent to the agent before
   * a switch, and its answer would be kept as the new agent's. Only the latest ask's answer is kept, whichever answers
   * first.
   */
  private askServed(refresh = false): Promise<void> {
    if (this.servedInFlight && !refresh) return this.servedInFlight
    const asked = ++this.servedAsks
    const latest = () => asked === this.servedAsks
    this.servedInFlight = (async () => {
      const types = await this.backend.agentServedTypes()
      if (latest()) this.served = { types, at: this.now() }
    })().finally(() => {
      if (latest()) this.servedInFlight = undefined
    })
    return this.servedInFlight
  }

  private async require(operation: RoomsOperation): Promise<void> {
    const status = (await this.capabilities())[operation]
    if (status.status !== 'available') throw new RoomsUnavailable(operation, status.reason, status.detail)
  }

  /**
   * The member's rooms, one listing shared by every caller while it is out. Each surface that lists rooms (the
   * Messages rows' poll, My Agent, a community's screen, a room met before it was listed) asked on its own, and a
   * community is sent its membership list again for each, as a read (six answers at once in a tester's run, 10-30).
   * A listing that starts after one settles asks again, and so does one after an accept or a leave.
   */
  public listMyRooms(): Promise<RoomSummary[]> {
    if (this.roomsInFlight) return this.roomsInFlight
    const listing = this.readMyRooms().finally(() => {
      if (this.roomsInFlight === listing) this.roomsInFlight = undefined
    })
    this.roomsInFlight = listing
    return listing
  }

  private async readMyRooms(): Promise<RoomSummary[]> {
    await this.require('listMyRooms')
    const changes = this.roomsChanged
    // The agent's key list is asked beside the communities' lists, not after them: they are other parties, and
    // the key list waited out a whole community sign-in first (12 s in a tester's run, 10-30). When no community
    // answers, the listing fails on that, and the key list's own failure is not left unhandled.
    const heldAsked = this.heldRooms()
    heldAsked.catch(() => undefined)
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
    const held = await heldAsked

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
    // A listing asked before an accept or a leave answers its callers, but does not undo what that changed. Its
    // callers may see a room just left once more: the next listing, asked afresh after the leave, drops it. Answering
    // them from this.rooms instead would show no rooms at all after an accept, which empties it.
    if (changes === this.roomsChanged) this.rooms = next
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
      name: toInertText(name ?? roomRef(record.roomId)),
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
      name: toInertText(held.personalLabel ?? roomRef(held.roomId)),
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
   * A room's statuses, and what this build does not yet do in a room of its tier. Writing is built for `open` rooms
   * (cleartext `rooms/records/put`) and `attributed` ones, whose record the agent signs as the member and seals
   * first (`rooms/keys/seal/0.2`), so an agent without it cannot write there. Elsewhere the composer says writing
   * is on its way instead of every post failing.
   */
  private async capabilitiesIn(room: KnownRoom): Promise<RoomCapabilities> {
    const statuses = deriveRoomCapabilities(await this.capabilities(), room)
    // Files exist on attributed and private rooms only: upstream refuses them on an open room.
    if (room.tier === 'open')
      for (const op of ['listFiles', 'openFile'] as const)
        statuses[op] = {
          status: 'unavailable',
          reason: 'notOnThisTier',
          detail: 'files are shared in attributed and private rooms',
        }
    if (statuses.write.status !== 'available' || room.tier === 'open') return statuses
    if (room.tier !== 'attributed')
      statuses.write = {
        status: 'comingSoon',
        reason: 'tierNotYet',
        detail: `writing to ${room.tier} rooms is not built yet`,
      }
    else if (!(this.served?.types ?? []).includes(ROOMS_TASK.keysSeal02))
      statuses.write = {
        status: 'unavailable',
        reason: 'agentDoesNotServe',
        detail: `the agent does not serve ${ROOMS_TASK.keysSeal02}`,
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

  public listNotes(roomId: string, options: { sinceVersion?: number } = {}): Promise<NoteList> {
    const flightKey = `${roomId}\n${options.sinceVersion ?? 'all'}`
    let flight = this.listingInFlight.get(flightKey)
    if (!flight) {
      const asked = this.readListing(roomId, options.sinceVersion).finally(() => {
        if (this.listingInFlight.get(flightKey) === asked) this.listingInFlight.delete(flightKey)
      })
      this.listingInFlight.set(flightKey, asked)
      flight = asked
    }
    // Each caller its own list, so one sorting or trimming it can't change what another holds.
    return flight.then((list) => ({ ...list, notes: [...list.notes] }))
  }

  private async readListing(roomId: string, sinceVersion: number | undefined): Promise<NoteList> {
    const room = await this.requireInRoom(roomId, 'listNotes')
    const listing = parseBrowse(
      await this.backend.agentTask(this.browseType(), {
        roomId,
        host: room.host,
        ...(sinceVersion !== undefined ? { sinceVersion } : {}),
      })
    )
    for (const r of listing.records) {
      // A version only goes up: an answer that arrives late never takes a record back.
      const k = listedKey(roomId, r.key)
      this.listed.set(k, Math.max(r.version, this.listed.get(k) ?? 0))
    }
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
      ...(listing.lastPrune ? { lastPrune: listing.lastPrune } : {}),
    }
  }

  /**
   * A post or note, from what was opened before when the room's last listing names that same version, else from the
   * agent. Reopening a room read its whole first page again, one task at a time (ten reads, ~5 s on the lab sim,
   * 10-30); a record at a new version (an edit, a retract) is read afresh. A copy reused this way carries the host
   * check of the read that opened it, not a fresh one: a conflict found since shows on the listing's banner.
   */
  public async readNote(roomId: string, key: string): Promise<Note> {
    const room = await this.requireInRoom(roomId, 'readNote')
    const held = this.openedNow(roomId, key)
    if (held) return this.noteOf(held)
    // One read of a record at a time, shared by every caller while it is out: opening a room reads its newest records
    // for the chat and for its Notes tab at the same moment, so ten of an open's first twenty reads were the same
    // records twice (a tester's run, 10-30). A read that starts after one settles asks again. Shared by the key
    // asked for; readRecord moves the listed version by the key the agent answered with.
    const k = listedKey(roomId, key)
    let read = this.readsInFlight.get(k)
    if (!read) {
      const asked = this.readRecord(room, roomId, key).finally(() => {
        if (this.readsInFlight.get(k) === asked) this.readsInFlight.delete(k)
      })
      this.readsInFlight.set(k, (read = asked))
      // Told of a lock while its first read is still out, not only once one is kept.
      holdingOpened.add(this)
    }
    return this.noteOf(await read)
  }

  private async readRecord(room: KnownRoom, roomId: string, key: string): Promise<OpenedRecord> {
    const drops = this.drops
    const opened = parseRead(await this.backend.agentTask(ROOMS_TASK.keysRead, { roomId, host: room.host, key }), (s) =>
      this.backend.decodeBase64Url(s)
    )
    if (!opened) throw new Error(`the agent's answer for note ${key} could not be read`)
    // An answer that arrives after the lock answers its caller, but is not kept: the lock forgot what was read.
    if (drops !== this.drops) return opened
    this.keepOpened(roomId, opened)
    // A read can find a newer version than the listing named (an edit since): that copy is the one to reuse. Only a
    // version a listing already named moves; a read never starts one, so with no listing a read always asks.
    const k = listedKey(roomId, opened.key)
    const named = this.listed.get(k)
    if (named !== undefined && opened.version > named) this.listed.set(k, opened.version)
    return opened
  }

  private noteOf(opened: OpenedRecord): Note {
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
      ...(opened.file ? { files: [roomFileOf(opened.file, opened)] } : {}),
    }
  }

  /** The opened copy of the version the room's last listing names, if there is one (and it is now the newest used). */
  private openedNow(roomId: string, key: string): OpenedRecord | undefined {
    const version = this.listed.get(listedKey(roomId, key))
    return version === undefined ? undefined : this.openedAt(roomId, key, version)
  }

  /** The opened copy of one version, made the newest used: a reuse from the files tab counts as much as the chat's. */
  private openedAt(roomId: string, key: string, version: number): OpenedRecord | undefined {
    const k = openedKey(roomId, key, version)
    const held = this.opened.get(k)
    if (held) {
      this.opened.delete(k)
      this.opened.set(k, held)
    }
    return held
  }

  /** Keep an opened record as the newest used, dropping the least recently used past MAX_OPENED_RECORDS. */
  private keepOpened(roomId: string, record: OpenedRecord): void {
    const k = openedKey(roomId, record.key, record.version)
    this.opened.delete(k)
    this.opened.set(k, record)
    for (const oldest of this.opened.keys()) {
      if (this.opened.size <= MAX_OPENED_RECORDS) break
      this.opened.delete(oldest)
    }
    holdingOpened.add(this)
  }

  /** Drop every opened record and listed version (the wallet locked, or the person logged out). */
  public dropOpenedRecords(): void {
    this.opened.clear()
    this.listed.clear()
    // A read asked before the lock is not joined after it, nor kept when it answers.
    this.readsInFlight.clear()
    this.drops++
  }

  private dropRoomReads(roomId: string): void {
    const prefix = `${roomId}\n`
    for (const k of [...this.opened.keys()]) if (k.startsWith(prefix)) this.opened.delete(k)
    for (const k of [...this.listed.keys()]) if (k.startsWith(prefix)) this.listed.delete(k)
    for (const k of [...this.readsInFlight.keys()]) if (k.startsWith(prefix)) this.readsInFlight.delete(k)
    // A read of the room still out answers its caller but is not kept, as at a lock (readRecord).
    this.drops++
  }

  public async leaveViaCommunity(communityDid: string): Promise<void> {
    await this.require('leaveViaCommunity')
    await this.backend.leaveCommunity(communityDid)
    this.roomsChanged++
    this.roomsInFlight = undefined
    for (const [id, room] of this.rooms)
      if (room.communityDid === communityDid) {
        this.rooms.delete(id)
        this.dropRoomReads(id)
      }
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
    // Asked of the agent only when an accepted sealed offer needs it: this is the offers badge's poll. Undefined when
    // the agent did not answer: whether such an offer was joined is then unknown, and it is left out of this listing.
    // Read as "holds none", an offer accepted and joined long ago came back as new, and its notice said so after an
    // unlock, while the agent's session reopened (276.9).
    let held: Promise<HeldRoom[] | undefined> | undefined
    const heldNow = () =>
      (held ??= this.heldRooms().catch((e): undefined => {
        this.backend.warn(`rooms: the agent did not list the rooms it holds: ${message(e)}`)
        return undefined
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
        if (offer.state === 'accepted' && isSealed(offer.tier)) {
          const rooms = await heldNow()
          if (!rooms) {
            this.backend.warn(`rooms: whether ${offer.roomId} was joined is unknown; left out of this listing`)
            continue
          }
          if (rooms.some((h) => holdsAs(h, offer.roomId, community.personaDid))) continue
        } else if (offer.state === 'accepted') continue
        const offerId = offerIdOf(community.did, offer.roomId)
        this.offers.set(offerId, { community, offer })
        if (!hidden.has(offerId)) out.push(this.toRoomOffer(community, offer, offerId))
      }
    }
    return out
  }

  /** Every page of a community's offers to this member, and the renewals the first page carries. */
  private async offersOf(community: RoomsCommunity): Promise<{ items: OfferRecord[]; renewals: RenewalRecord[] }> {
    // The version the community last answered first, then the others newest first: a community older than renewals
    // is read at 0.2, which carries none, and one that moved on to 0.4 alone (VTC 0.16) is still read.
    const known = this.offersType.get(community.did)
    const types: string[] = known ? [known, ...OFFERS_LIST_TYPES.filter((t) => t !== known)] : [...OFFERS_LIST_TYPES]
    let type = types[0]
    let first: unknown
    for (let i = 0; ; i++) {
      type = types[i]
      try {
        first = await this.backend.communityTask(community.did, type, {})
        break
      } catch (e) {
        const code = refusalCode(e)
        if (i === types.length - 1 || (code !== 'unsupportedVersion' && code !== 'unsupportedType')) throw e
      }
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
   * key holder holding two authorities from one room cannot choose between them (`vtc/rooms/offers/list` 0.3/0.4).
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
      roomName: toInertText(offer.label || roomRef(offer.roomId)),
      ...(offer.label ? {} : { roomNameFrom: 'roomId' as const }),
      description: offer.description !== undefined ? toInertText(offer.description) : undefined,
      communityDid: community.did,
      communityName: community.name !== undefined ? toInertText(community.name) : undefined,
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
    if (!this.actType()) missing.push(KEYS_ACT_TYPES[0])
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
      this.roomsChanged++
      this.roomsInFlight = undefined
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

  /**
   * The newest `rooms/keys/browse` the agent serves. 0.3 asks the same and answers the same, plus the room's
   * `lastPrune`, which `listNotes` passes on; an agent that lists neither is asked 0.1, as before 0.3.
   */
  private browseType(): string {
    const served = this.served?.types ?? []
    return [ROOMS_TASK.keysBrowse03, ROOMS_TASK.keysBrowse].find((t) => served.includes(t)) ?? ROOMS_TASK.keysBrowse
  }

  /** The newest `rooms/keys/act` the agent serves, if any. */
  private actType(): string | undefined {
    const served = this.served?.types ?? []
    return KEYS_ACT_TYPES.find((t) => served.includes(t))
  }

  /**
   * A record put to `host`, completed as the member by the agent. From act 0.8 the agent completes put 0.3 as well as
   * 0.1, and which one the host takes is the host's own: VTC 0.16 serves only 0.3, VTC 0.15 both, VTC 0.12 (the lab)
   * only 0.1 and 0.2. So the version the host last took is sent first (else 0.3), and the other when the host does not
   * serve it; 0.3 is 0.1 with optional members this client does not send. Before act 0.8 the agent completes only
   * 0.1. A refused document did nothing, and the one sent again is new (`actAndSend`).
   */
  private async put(community: RoomsCommunity, host: string, payload: Record<string, unknown>): Promise<unknown> {
    const act = this.actType()
    const types: string[] =
      act === ROOMS_TASK.keysAct09 || act === ROOMS_TASK.keysAct08
        ? [ROOMS_TASK.recordsPut03, ROOMS_TASK.recordsPut]
        : [ROOMS_TASK.recordsPut]
    const took = this.putTypeOf.get(host)
    if (took && types.includes(took)) types.sort((a, b) => Number(b === took) - Number(a === took))
    for (let i = 0; ; i++) {
      try {
        const answer = await this.actAndSend('write', community, host, types[i], payload)
        this.putTypeOf.set(host, types[i])
        return answer
      } catch (e) {
        const code = refusalCode(e)
        if (i === types.length - 1 || (code !== 'unsupportedVersion' && code !== 'unsupportedType')) throw e
      }
    }
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
        `the agent serves none of ${KEYS_ACT_TYPES.join(', ')}`
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
      // A sealed room's host holds only ciphertext.
      visibleTo: room.tier === 'open' ? 'membersAndHost' : 'members',
      authorShown: true,
      title: toInertText(draft.title),
      body: toInertText(draft.body),
      validUntil: room.validUntil,
    }
  }

  /**
   * Writes the previewed note (`rooms/records/put/0.1`): on an open room the host reads `cleartext`, on an attributed
   * one it stores what the agent sealed (`writeSealed`). A new note is create-only under a fresh random key; a
   * replacement must still be at the version the preview read.
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
    if (room.tier === 'attributed')
      return this.writeSealed(
        room,
        community,
        host,
        key,
        expectedVersion,
        { title, body },
        !replaceKey && !!idempotencyKey
      )
    let answer: unknown
    try {
      answer = await this.put(community, host, {
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

  /**
   * Writes a note to an attributed room, as `pnm rooms put` does (VTA 0.67). The phone builds the record's body
   * naming the member as its author, without a proof; the agent signs it as the member and seals it
   * (`rooms/keys/seal/0.2`, `signAsPrincipal`), and the sealed form is put as the member like any write.
   *
   * The seal binds the version, and the host assigns versions from a room-wide counter, so the version is predicted
   * as the room's newest plus one. When another write took it, the note is stored but sealed for another version and
   * does not open: it is sealed again for the next version and written over exactly what landed, a few times.
   * `ownKey`: the key is this post's own, so a record already there at the first try is this post, sent again
   * after its answer was lost.
   */
  private async writeSealed(
    room: KnownRoom,
    community: RoomsCommunity,
    host: string,
    key: string,
    expectedVersion: number,
    note: { title: string; body: string },
    ownKey: boolean
  ): Promise<{ key: string; version: number }> {
    let intended = (await this.headVersion(room)) + 1
    let expected = expectedVersion
    let landed = 0
    for (let attempt = 0; attempt < SEALED_WRITE_ATTEMPTS; attempt++) {
      const unsigned = {
        roomId: room.roomId,
        key,
        version: intended,
        author: community.personaDid,
        ...(note.title.trim() ? { title: note.title } : {}),
        body: note.body,
      }
      const sealed = parseSealed(
        await this.agentStep('write', 'sign and seal the note as the member', ROOMS_TASK.keysSeal02, {
          roomId: room.roomId,
          key,
          version: intended,
          plaintext: this.backend.encodeBase64Url(JSON.stringify(unsigned)),
          signAsPrincipal: true,
        })
      )
      if (!sealed) throw new Error(`the agent answered the seal of ${key} with something else`)
      let answer: unknown
      try {
        answer = await this.put(community, host, {
          roomId: room.roomId,
          key,
          expectedVersion: expected,
          sealed,
        })
      } catch (e) {
        const refused = await this.hostRefusal('write', room, key, expected, e)
        if (attempt === 0 && ownKey && refused instanceof RoomsConflict) return { key, version: refused.currentVersion }
        throw refused
      }
      const put = parsePut(answer)
      if (!put || put.key !== key) throw new Error(`the host answered the write of ${key} with something else`)
      if (put.version === intended) return put
      landed = put.version
      expected = landed
      intended = landed + 1
    }
    throw new RoomsRefused(
      'write',
      'roomKeptMoving',
      true,
      `${key} is stored at version ${landed} but sealed for another version, so it does not open: the room kept moving`
    )
  }

  /** The newest version among the room's records, as the agent lists them; 0 for an empty room. */
  private async headVersion(room: KnownRoom): Promise<number> {
    const listing = parseBrowse(
      await this.agentStep('write', 'list the room', this.browseType(), { roomId: room.roomId, host: room.host })
    )
    return listing.records.reduce((head, r) => Math.max(head, r.version), 0)
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
  /**
   * The room's files. No task lists them: a file is described in its record's sealed body, so the room is browsed
   * and each live record opened in turn, keeping what was opened by key and version so a second look reads only
   * what changed. This loop awaits each read, so it does not use the client's read lane (up to VTA_READ_LANE_SIZE
   * reads at once, see trust-tasks/module/vtaReadLane.ts). Because a second look reuses what was opened, the
   * one-after-another cost falls on a first open; a warm open hides it. A record that can't be opened is left out;
   * if none could be and there were some to open, that failure is the answer rather than "no files".
   */
  public async listFiles(roomId: string): Promise<RoomFile[]> {
    const room = await this.requireInRoom(roomId, 'listFiles')
    const listing = parseBrowse(await this.backend.agentTask(this.browseType(), { roomId, host: room.host }))
    const files: RoomFile[] = []
    let opened = 0
    let failure: unknown
    for (const record of listing.records) {
      if (record.status === 'retracted') continue
      let read = this.openedAt(roomId, record.key, record.version)
      if (!read) {
        try {
          read = parseRead(
            await this.backend.agentTask(ROOMS_TASK.keysRead, { roomId, host: room.host, key: record.key }),
            (s) => this.backend.decodeBase64Url(s)
          )
        } catch (e) {
          failure = e
          continue
        }
        if (!read) continue
        this.keepOpened(roomId, read)
      }
      opened++
      if (read.file) files.push(roomFileOf(read.file, read))
    }
    if (opened === 0 && failure !== undefined) throw failure
    return files
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
