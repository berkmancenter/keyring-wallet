/**
 * The rooms data layer's contract with the screens: one `RoomsService`, injected through
 * `TOKENS.UTIL_ROOMS_SERVICE`, with a status for every operation so a screen never guesses
 * what is available.
 *
 * A room is a shared, encrypted set of records with its own DID. Members hold credentials the
 * room issued, and the person's own agent (VTA) holds the room's keys. The phone never does:
 * it asks its agent, which reads and writes for it (VTI `docs/02-vta/data-rooms.md` §2, §9).
 * Upstream's code is the reference for every shape here. The reasoning is in
 * docs/plans/openvtc-rooms-plan.md in the wallet repository.
 */
import type { InertText } from './inertText'

export type { InertText } from './inertText'

/** Every operation a screen can ask about. */
export type RoomsOperation =
  | 'listMyRooms'
  | 'getRoom'
  | 'listNotes'
  | 'readNote'
  | 'write'
  | 'curate'
  | 'listOffers'
  | 'acceptOffer'
  | 'hideOffer'
  | 'listFiles'
  | 'openFile'
  | 'listCommunityMembers'
  | 'agentAccess'
  | 'leaveViaCommunity'
  | 'groupChat'
  | 'requestToJoin'

/**
 * Why an operation is or is not available. The screens choose the words from this, never from
 * their own guess:
 * - `ok`: available.
 * - `sample`: available, on fixture data; show the "Sample data" banner.
 * - `clientNotBuilt`: the person's agent serves it, but Keyring has not built it yet ("Coming soon").
 * - `notBuiltUpstream`: nothing anywhere serves it, e.g. group chat ("Not available yet").
 * - `agentDoesNotServe`: this person's agent is too old to serve it ("Your agent needs an update").
 * - `adminOnly`: only a community's administrators may do it.
 * - `noAgentLinked`: the phone has no agent to ask.
 * - `agentUnknown`: the agent could not be asked what it serves; try again later.
 * - `communityDoesNotServe`: the community's service is too old for it (reserved: community
 *   operations are not yet discovered in advance, so today a call to an old community fails instead).
 * - `detailsNotLoaded`: a room known only from the agent's key custody, without the community's
 *   record of it (rights, host). The operation needs those ("Details not loaded").
 * - `noRight`: this member's rights in the room do not include it ("You can't post here").
 * - `communityUnreachable`: none of the member's communities answered for their rooms; try again later.
 * - `tierNotYet`: served, but Keyring does not yet do it in a room of this tier, e.g. writing in an `attributed`
 *   room, whose records are sealed ("not available yet in this kind of room").
 */
export type RoomsReason =
  | 'ok'
  | 'sample'
  | 'clientNotBuilt'
  | 'notBuiltUpstream'
  | 'agentDoesNotServe'
  | 'adminOnly'
  | 'noAgentLinked'
  | 'agentUnknown'
  | 'communityDoesNotServe'
  | 'detailsNotLoaded'
  | 'noRight'
  | 'communityUnreachable'
  | 'tierNotYet'
  // Never in this kind of room: files exist on attributed and private rooms only (upstream refuses them on open ones).
  | 'notOnThisTier'

export type RoomsStatus = 'available' | 'comingSoon' | 'unavailable'

export interface OperationStatus {
  status: RoomsStatus
  reason: RoomsReason
  /** A plain explanation for logs and support, not copy for the screen. */
  detail: string
}

export type RoomsCapabilities = Record<RoomsOperation, OperationStatus>

/** Upstream's visibility tiers (vti-rooms `Visibility`). `private` is stored but not served yet. */
export type RoomTier = 'open' | 'attributed' | 'private'

/** What a room's authority credential lets this member do (vti-rooms `Action`). */
export type RoomVerb = 'read' | 'write' | 'curate' | 'admin'

/**
 * An identity as a person sees it: never a name. `identityWords` are the community's words for the
 * DID when the community supplied them; without them a screen shows a short form of the DID.
 */
export interface Identity {
  identityWords?: string
  did: string
}

/**
 * A room as a list row. Its details come from the community's record of the member's rooms
 * (`vtc/rooms/memberships/list`: labels, tiers, actions, expiries, states). The agent's own list
 * (`rooms/keys/list`) says only which rooms it holds keys for, so a room known only that way has
 * `source: 'custody'` and no rights, host or expiry yet.
 */
export interface RoomSummary {
  roomId: string
  /** Never empty: the community's label, else the member's own label, else a short form of the room ID. */
  name: InertText
  /** Which of those `name` is. An ID is shown as an ID ("Room 3f9a…"), never as if the community named it. */
  nameFrom: 'community' | 'personal' | 'roomId'
  /** Where this room's details come from. */
  source: 'community' | 'custody'
  communityDid?: string
  communityName?: InertText
  /** `unknown` for a custody-only room: show no tier badge. */
  tier: RoomTier | 'unknown'
  /** Undefined: not known yet. `[]`: known, and none (e.g. lapsed). Screens use `roomCapabilities` for words. */
  verbs?: RoomVerb[]
  /** When this member's access ends unless renewed (ISO 8601). Unknown for a custody-only room. */
  validUntil?: string
  /** The DID of the host serving this room. Unknown for a custody-only room. */
  host?: string
  standing: 'member' | 'lapsed' | 'removed'
}

/** The operations whose status also depends on the room: its source and this member's rights in it. */
export type RoomOperation =
  | 'listNotes'
  | 'readNote'
  | 'write'
  | 'curate'
  | 'listFiles'
  | 'openFile'
  | 'agentAccess'
  | 'listCommunityMembers'

export type RoomCapabilities = Record<RoomOperation, OperationStatus>

export interface Room extends RoomSummary {
  /** The identity this member acts as in the room. */
  actingAs: Identity
}

export interface NoteSummary {
  /** The record's key. Opaque on attributed and private rooms; never shown as a title. */
  key: string
  version: number
  /**
   * Present only where the host can see it: an open room's records carry it. On attributed and
   * private rooms the title is sealed with the body, so it appears on the note once it is read.
   */
  title?: InertText
  author?: Identity
  /** Set when an AI agent wrote it under its person's membership. */
  byAgent?: boolean
  updatedAt?: string
  /** Upstream's curation state (`RecordMetadata.status`). `retracted` is a tombstone: no body. */
  status: 'active' | 'deprecated' | 'retracted'
  pinned: boolean
  /**
   * The files the record carries (`rooms/records/put` 0.2 `blobs`), with the details its body gives each: listed
   * from the host's metadata, with no file key and no download. Usually one; more when another client attached them.
   */
  files?: RoomFile[]
}

/**
 * What the person's agent concluded about the host's answer (`ReadVerification`): whether it is
 * consistent with what the host committed to and what the agent saw before. A host that drops or
 * rolls back records shows as `conflict`.
 * - `consistent`: every check the agent could make agreed.
 * - `unverified`: some checks could not be made, e.g. a first read or no anchor published.
 * - `conflict`: a check failed; show it, the host may be withholding or replaying records.
 */
export interface HostCheck {
  verdict: 'consistent' | 'unverified' | 'conflict'
  detail: string
}

/**
 * A room's last prune (`rooms/_shared/0.2` RecordPrune), as `rooms/keys/browse` 0.3 passes it on: the room version
 * the prune took it to, when, and how many records it removed outright, tombstones included.
 */
export interface RecordPrune {
  version: number
  prunedAt: string
  removed: number
}

export interface NoteList {
  notes: NoteSummary[]
  /** False when the host's listing stopped early. */
  complete: boolean
  check: HostCheck
  /** The room's last prune, when the agent passes one on (browse 0.3). */
  lastPrune?: RecordPrune
}

export interface InertFlags {
  /** The text contains something that looks like a link. It is shown as text and never followed. */
  containsLink: boolean
  /** The text reads like an instruction to an agent. It is shown as text and never acted on. */
  looksLikeInstruction: boolean
}

export interface Note extends NoteSummary {
  body: InertText
  flags: InertFlags
  check: HostCheck
}

/** A file to post, as the phone picked it: a local copy the service reads and uploads through the member's agent. */
export interface RoomsAttachment {
  uri: string
  name: string
  mimeType?: string
  size: number
}

/** The longest note title, in characters: the room schema's cleartext title (`RecordMetadata.title`). */
export const NOTE_TITLE_MAX = 512
/** The longest note body, in characters: the member sprint's 16 KiB cap on a record. */
export const NOTE_BODY_MAX = 16384

export interface WriteDraft {
  title: string
  body: string
  /** Replace this note instead of adding one. */
  replaceKey?: string
  /** One file to post with it (`rooms/records/put` 0.2 `blobs`). The service refuses one over its limit. */
  attachment?: RoomsAttachment /**
   * The post's own id, the same on every retry. The service derives the record's key from it and writes create-only,
   * so a retry of a post that already landed answers with that post instead of writing it twice; within one app run
   * a retried upload resumes rather than starting again. Without it, a retry may post twice.
   */
  idempotencyKey?: string
}

/**
 * What the confirmation sheet shows before anything leaves the phone. `confirmWrite(token)` sends
 * exactly this. The identity is named before consent, never after.
 *
 * A preview token is single-use and lasts `PREVIEW_TOKEN_TTL_MS`. A token that is spent, too old, or
 * from before the app restarted gives `RoomsPreviewExpired`, and the sheet says "prepare it again". If
 * a note being replaced changed since the preview, `confirmWrite` gives `RoomsConflict` with the
 * current version, and the sheet offers "Re-read". Nothing is sent in either case.
 */
export interface WritePreview {
  token: string
  roomId: string
  roomName: InertText
  communityName?: InertText
  tier: RoomSummary['tier']
  actingAs: Identity
  /** `members`: only members can read it. `membersAndHost`: an open room, readable by its host too. */
  visibleTo: 'members' | 'membersAndHost'
  /** Whether members (and on attributed rooms, the host) see that it is this member's. */
  authorShown: boolean
  title: InertText
  body: InertText
  validUntil?: string
}

export interface RoomOffer {
  /** Names the offer to `previewOffer` and `hideOffer`: a route parameter, opaque to screens. */
  offerId: string
  roomId: string
  /** The community's name for the room, else what tells it apart (`roomRef`): then `roomNameFrom` is `roomId`. */
  roomName: InertText
  roomNameFrom?: 'roomId'
  /** What the room is for, as the community's administrators wrote it. Absent when the room has none. */
  description?: InertText
  communityDid: string
  /** Absent when the community published no name: a screen says `offerCommunity`, never a cut of the DID. */
  communityName?: InertText
  tier: RoomTier
  verbs: RoomVerb[]
  validUntil?: string
}

/** What the offer sheet shows before accepting. `acceptOffer(token)` accepts exactly this. */
export interface OfferPreview {
  token: string
  offer: RoomOffer
  actingAs: Identity
}

/** Bytes moved so far, and in all. Upload or download alike. */
export interface RoomsTransferProgress {
  sent: number
  total: number
}

export interface RoomsTransferOptions {
  onProgress?: (progress: RoomsTransferProgress) => void
  /** Aborting it stops the transfer and rejects with an error named `AbortError`; no partial copy is kept. */
  signal?: AbortSignal
}

export interface RoomFile {
  /** The blob's id: what `openFile` takes. */
  fileId: string
  name: InertText
  mediaType?: string
  size?: number
  sharedBy?: Identity
  sharedAt?: string
}

/**
 * A file opened for viewing: a protected local copy. The file's key never leaves the service:
 * upstream warns it never expires (VTI `docs/05-design-notes/data-rooms-files.md`).
 */
export interface OpenedFile {
  localUri: string
  mediaType?: string
  size: number
}

export interface CommunityRoomMember {
  identity: Identity
  verbs: RoomVerb[]
}

/**
 * What an AI agent's grant lets it do in the rooms it covers: the capabilities its ACL entry on the
 * person's agent is narrowed to (VTI `vti-common` acl; docs/02-vta/personal-ai-agents.md).
 * - `roomPresent`: obtain short-lived, one-action presentations (`rooms/keys/present`, at most 4 h)
 *   for what the member may do, so it can read open text and act as itself, never as the member.
 * - `roomOpen`: also read sealed text, through the member's agent (`rooms/keys/open`). No key is ever
 *   handed to the AI agent.
 */
export type AgentRoomCapability = 'roomPresent' | 'roomOpen'

/**
 * An AI agent's access, as its grant scopes it upstream: by the person's persona **context**, covering
 * every room held by personas in it. Upstream cannot narrow an agent to one room, so the interface
 * does not pretend to. Withdrawing it stops new presentations; ones already issued last up to 4 h
 * unless the room's owner revokes them at the host.
 */
export interface AgentGrant {
  grantId: string
  agentDid: string
  agentLabel: InertText
  contextId: string
  contextLabel?: InertText
  capabilities: AgentRoomCapability[]
  expiresAt?: string
}

export interface AgentGrantRequest {
  agentDid: string
  contextId: string
  capabilities: AgentRoomCapability[]
  expiresAt: string
}

/** How long a write or offer preview token stays valid. */
export const PREVIEW_TOKEN_TTL_MS = 10 * 60 * 1000

/** Thrown by an operation whose status is not `available`. */
export class RoomsUnavailable extends Error {
  public constructor(
    public readonly operation: RoomsOperation,
    public readonly reason: RoomsReason,
    detail: string
  ) {
    super(`${operation} is not available (${reason}): ${detail}`)
    this.name = 'RoomsUnavailable'
  }
}

/** A preview token that is spent, older than `PREVIEW_TOKEN_TTL_MS`, or unknown. Nothing was sent. */
export class RoomsPreviewExpired extends Error {
  public constructor(public readonly token: string) {
    super('this preview has expired; prepare it again')
    this.name = 'RoomsPreviewExpired'
  }
}

/**
 * A community or the person's agent refused the operation, in its own terms. `code` is the refusal's code
 * without its task prefix (`vtc/rooms/offers/accept:alreadyAccepted` → `alreadyAccepted`), plus a few of
 * Keyring's own for a step that went wrong between them (`welcomeMissing`, `joinFailed`). Screens word the
 * codes they know and show a generic line for any other. `retryable`: the same request again may succeed.
 * A transport failure (no answer) is not a refusal and arrives as a plain `Error`.
 */
export class RoomsRefused extends Error {
  public constructor(
    public readonly operation: RoomsOperation,
    public readonly code: string,
    public readonly retryable: boolean,
    detail?: string
  ) {
    super(`${operation} was refused (${code})${detail ? `: ${detail}` : ''}`)
    this.name = 'RoomsRefused'
  }
}

/** The note being replaced changed since the preview. Nothing was sent; re-read it first. */
export class RoomsConflict extends Error {
  public constructor(
    public readonly key: string,
    public readonly currentVersion: number
  ) {
    super(`note ${key} changed since the preview (now version ${currentVersion})`)
    this.name = 'RoomsConflict'
  }
}

export interface RoomsService {
  /** True for the fixture service: every screen it feeds shows the "Sample data" banner. */
  readonly isSample: boolean
  /** For logs and support. The sample service puts its build marker here, where it is read at runtime. */
  readonly label: string
  /** The app's agent a real service is built on (`RoomsBackend.runsOn`); none for the sample. */
  readonly runsOn?: object
  /** One status per operation. Cached per agent; `refresh` asks again. */
  capabilities(options?: { refresh?: boolean }): Promise<RoomsCapabilities>

  listMyRooms(): Promise<RoomSummary[]>
  getRoom(roomId: string): Promise<Room>
  /** One status per room operation: the service-wide status, narrowed by the room's source and rights. */
  roomCapabilities(roomId: string): Promise<RoomCapabilities>
  /**
   * The room's records, metadata only. With `sinceVersion`, only those written or curated after it (a version is
   * the host's, monotonic per room), so a refresh asks only for what is new; such a listing is never complete
   * against the room's record count.
   */
  listNotes(roomId: string, options?: { sinceVersion?: number }): Promise<NoteList>
  readNote(roomId: string, key: string): Promise<Note>
  prepareWrite(roomId: string, draft: WriteDraft): Promise<WritePreview>
  /** Sends what the preview showed; with an attachment, `options` reports the upload and can cancel it (nothing is written). */
  confirmWrite(token: string, options?: RoomsTransferOptions): Promise<{ key: string; version: number }>
  curate(roomId: string, key: string, action: 'pin' | 'unpin' | 'retract'): Promise<void>

  listOffers(communityDid?: string): Promise<RoomOffer[]>
  /**
   * Called when a community a listing had to skip for now (another identity's step kept the community session) can
   * be read again; returns the unsubscribe. Absent where nothing is skipped that way (the sample).
   */
  onReadable?(listener: () => void): () => void
  previewOffer(offerId: string): Promise<OfferPreview>
  acceptOffer(token: string): Promise<{ roomId: string }>
  /** Hides an offer on this phone only. Upstream has no decline: the community is not told. */
  hideOffer(offerId: string): Promise<void>

  listFiles(roomId: string): Promise<RoomFile[]>
  openFile(roomId: string, fileId: string, options?: RoomsTransferOptions): Promise<OpenedFile>
  /**
   * Deletes the protected local copy a completed `openFile` made (a cancelled one keeps none). Call it when the viewer closes. The service also
   * deletes any copies left from earlier sessions on its first `openFile` after the app starts.
   */
  releaseFile(localUri: string): Promise<void>

  /** Administrator-only upstream (`vtc.rooms.manage`); a member gets `adminOnly`. */
  listCommunityMembers(communityDid: string, roomId?: string): Promise<CommunityRoomMember[]>

  /** The AI agents allowed into rooms, in one persona context or in all of them. */
  listAgentAccess(contextId?: string): Promise<AgentGrant[]>
  grantAgentAccess(request: AgentGrantRequest): Promise<AgentGrant>
  withdrawAgentAccess(grantId: string): Promise<void>

  /** Leaving goes through the community: leaving it takes the member out of its rooms. */
  leaveViaCommunity(communityDid: string): Promise<void>
}
