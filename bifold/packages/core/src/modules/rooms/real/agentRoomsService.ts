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
 * Writes, files and agent access are later phases and report `clientNotBuilt`.
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
import { PREVIEW_TOKEN_TTL_MS, RoomsPreviewExpired, RoomsRefused, RoomsUnavailable } from '../types'

import {
  parseAccept,
  parseBrowse,
  parseKeyPackage,
  parseKeysList,
  parseMemberships,
  parseOffers,
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

/** The operations this build implements: R1, and joining by a community's offer. */
export const BUILT: ReadonlySet<RoomsOperation> = new Set<RoomsOperation>([
  ...R1_BUILT,
  'listOffers',
  'acceptOffer',
  'hideOffer',
])

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
  private rooms = new Map<string, KnownRoom>()
  private offers = new Map<string, { community: RoomsCommunity; offer: OfferRecord }>()
  private previews = new Map<string, { offerId: string; at: number }>()
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
    const missing = [ROOMS_TASK.keysKeyPackage, ROOMS_TASK.keysWelcome].filter((t) => !served.includes(t))
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
      return { roomId }
    }

    // Joined already: from another surface, or an earlier run whose answer was lost.
    if (offer.state === 'accepted' && (!sealed || (await this.holds(roomId, community.personaDid)))) return done()

    for (const what of ['membership', 'authority'] as const) {
      await this.agentStep(`store the ${what} credential`, ROOMS_TASK.vaultReceive, {
        credential: credentialOf(offer.credentials[what], what),
      })
    }
    // The agent's own KeyPackage: the community completes an admission only with one the member's key holder
    // minted, and the agent answers a repeat with the one it already gave.
    let keyPackage: string | undefined
    if (sealed) {
      keyPackage = parseKeyPackage(
        await this.agentStep('give a key package', ROOMS_TASK.keysKeyPackage, {
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

  /** An agent task on the accept path, its refusal reported as the accept's. */
  private async agentStep(what: string, type: string, payload: Record<string, unknown>): Promise<unknown> {
    try {
      return await this.backend.agentTask(type, payload)
    } catch (e) {
      const code = refusalCode(e)
      if (code) throw new RoomsRefused('acceptOffer', code, false, `the agent would not ${what}: ${message(e)}`)
      throw e
    }
  }

  /** Sends the accept as the persona; an `admissionPending` answer is sent again, identically, a few times first. */
  private async sendAccept(community: RoomsCommunity, roomId: string, keyPackage?: string) {
    const payload = { roomId, ...(keyPackage ? { keyPackage } : {}) }
    for (let attempt = 0; ; attempt++) {
      let answer: unknown
      try {
        answer = await this.backend.communityTask(community.did, ROOMS_TASK.offersAccept, payload)
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
    return (await this.heldRooms()).some((h) => holdsAs(h, roomId, member))
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

  public prepareWrite(): Promise<WritePreview> {
    return this.notYet('write')
  }
  public confirmWrite(): Promise<{ key: string; version: number }> {
    return this.notYet('write')
  }
  public curate(): Promise<void> {
    return this.notYet('curate')
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
