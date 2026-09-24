/**
 * vtiVetting — peer identity vetting, both seats, as the reference client
 * does it (`openvtc-core/src/vetting/{applicant,vetter,tickets}.rs`, design
 * §8–§10, wire types `trust-tasks-rs 0.21` `specs/vetting/*`).
 *
 *   applicant:  Sent ──#response──▶ Accepted ──session──▶ Session ──statement──▶ Attested
 *   vetter:     request+ticket ──▶ Accepted ──open──▶ Session ──card──▶ CardReceived ──attest──▶ Attested
 *
 * Both halves ride the persona's community session (`vtiAgent`): a vetting
 * task is a Trust Task document between two personas, signed by its issuer
 * (the spec makes the proof REQUIRED — it is what survives the transport),
 * and the reply to a request is threaded on the request document's id.
 *
 * Tickets are client-local in V0, exactly as the reference client keeps them
 * (moving them to the VTA as `vetting/tickets/*` is V1).
 *
 * @module trust-tasks/module/vtiVetting
 */

import type { Agent } from '@credo-ts/core'
import { TypedArrayEncoder, utils } from '@credo-ts/core'
import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'
import {
  CROCKFORD,
  digestMultibase,
  evaluateStatements,
  statementFacts,
  encodeTicketUri,
  parseTicketUri,
  signDocumentProof,
  verifyDocumentProof,
  vettingMatchCode,
  type TicketPresentation,
} from '@bifold/trust-tasks'

import type { VtiCommunityStore, VtiHeldCredential } from './VtiCommunityStore'
import type { VtiPersona } from './VtiIdentityStore'
import { IDENTITY_VETTING_ENDORSEMENT_TYPE, CREDENTIAL_EXCHANGE_ISSUE } from './vtiInbox'
import { resolveDidDocumentRetrying } from './VtiMediatorTransport'
import { recordAnswer, recordSent, recordStatus } from './joinSubmission'
import { joinRequestRefusal, openJoinRequestOf, vtiAgent, type VtiManifest, type VtiVerdict } from './vtiAgent'
import { checkCredentialStatus, checkStatusEntry, statusEntryOf, type CredentialStatusResult } from './vtiStatusList'
import { pickOwnVetterGrant, vetterNotEligibleReason } from './vtiGrantState'

export const VETTING = {
  request: 'https://trusttasks.org/spec/vetting/request/0.1',
  session: 'https://trusttasks.org/spec/vetting/session/0.1',
  decline: 'https://trusttasks.org/spec/vetting/decline/0.1',
  revokeStatement: 'https://trusttasks.org/spec/vetting/revoke-statement/0.1',
  vettersList: 'https://trusttasks.org/spec/vtc/vetting/vetters/list/0.1',
  vettersProfile: 'https://trusttasks.org/spec/vtc/vetting/vetters/profile/0.1',
} as const
const RESPONSE = '#response'
const TASK_ERROR = 'https://trusttasks.org/spec/trust-task-error/'
const DTG_CONTEXT = ['https://www.w3.org/ns/credentials/v2', 'https://firstperson.network/credentials/dtg/v1']

export type VettingMethod = 'inPerson' | 'video' | 'priorAcquaintance'

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** A ticket a vetter cut: the code to read aloud, the secret behind the QR. */
export interface VettingTicket {
  ticketId: string
  code: string
  secret: string
  communityDid: string
  usesLeft: number
  expiresAt: string
  boundTo?: string
  methods?: VettingMethod[]
  createdAt: string
}

/** One request on the vetter's desk. */
export interface VettingDeskRequest {
  requestId: string
  applicantDid: string
  communityDid: string
  requirementsDigest?: string
  preferredMethod?: VettingMethod
  message?: string
  status: 'accepted' | 'session' | 'cardReceived' | 'attested' | 'declined'
  receivedAt: string
  session?: {
    documentId: string
    challenge: string
    domain: string
    requiredClaims: string[]
    method: VettingMethod
    expiresAt: string
    matchCode: string
  }
  card?: Record<string, unknown>
  statementId?: string
}

/** One request the applicant made of one vetter. */
export interface VettingApplicationRequest {
  vetterDid: string
  requestDocumentId: string
  requestId?: string
  /** When this phone sent the request; unlike `updatedAt`, a later answer does not move it. */
  sentAt?: string
  status: 'sent' | 'accepted' | 'refused' | 'session' | 'cardSent' | 'attested' | 'declined'
  refusalCode?: string
  eligibilityOk?: boolean
  session?: {
    documentId: string
    challenge: string
    domain: string
    requiredClaims: string[]
    method: VettingMethod
    expiresAt: string
    matchCode: string
  }
  cardDigest?: string
  statementId?: string
  /** The vetter grant's window, read from the eligibility presentation. */
  grantValidFrom?: string
  grantValidUntil?: string
  /** When the applicant last satisfied itself the grant was live. */
  grantCheckedAt?: string
  statementSignedAt?: string
  /** False when the grant was issued after the statement was signed. */
  grantedBeforeSigning?: boolean
  grantStillValid?: boolean
  /**
   * The live status of the vetter's grant, the half a validity window cannot
   * answer. `none` means the grant carries no status block at all, which is
   * the community claiming it does not revoke — kept distinct from `ok`, which
   * means a list was fetched, its signature checked and the bit read.
   */
  grantStatus?: CredentialStatusResult['state']
  /** Why the status is `unknown` — an offline phone must not read as revoked. */
  grantStatusReason?: string
  grantStatusCheckedAt?: string
  /** Enough of the grant's `credentialStatus` to re-check it later. */
  grantStatusEntry?: { url: string; index: number; purpose: string }
  updatedAt: string
}

/**
 * The grant's status entry, kept so the check can be repeated later without
 * holding on to the whole credential. A malformed entry is dropped rather
 * than stored: a re-check has nothing to go on, and the state recorded at
 * acceptance already says the entry was unreadable.
 */
const statusEntryFor = (credential: Record<string, unknown>) => {
  const entry = statusEntryOf(credential)
  return entry && entry !== 'malformed' ? entry : undefined
}

/** What this phone last published as its vetter profile, and when. */
export interface VettingVetterProfile {
  communityDid: string
  vetterDid: string
  listed: boolean
  displayName?: string
  publishedAt: string
}

/**
 * Where the join request this application produced stands, as the community
 * last told us. `deferred` means the community asked for more and is waiting
 * on the applicant — the one state `supplement` answers; `pending` means the
 * community owes the decision. Both are open, and both can be withdrawn.
 */
export interface VettingSubmission {
  requestId?: string
  state: 'deferred' | 'pending' | 'decided' | 'withdrawn'
  effect?: string
  needs?: string[]
  at: string
}

/** A verdict effect that leaves the request open, and on whom it waits. */
const openStateOf = (effect: string): 'deferred' | 'pending' | undefined =>
  effect === 'requestMore' ? 'deferred' : effect === 'refer' || effect === 'pending' ? 'pending' : undefined

/**
 * Why a vetter's ticket cannot be used for this application (p220 item 3),
 * typed so a screen can word it: `unreadable` is not a ticket this client can
 * read; `otherCommunity` is a ticket for vetting in a different community —
 * using it would send this person's request, and so reveal them, to that
 * community's vetter. Mirrors openvtc's `TicketUriError` (Unreadable,
 * OtherCommunity). Nothing is signed or sent when this is thrown.
 */
export class VettingTicketError extends Error {
  constructor(
    readonly reason: 'unreadable' | 'otherCommunity',
    /** The community the ticket is for, when it could be read. */
    readonly ticketCommunityDid?: string
  ) {
    super(
      reason === 'otherCommunity'
        ? `vtiVetting: that ticket is for vetting in another community (${ticketCommunityDid})`
        : 'vtiVetting: that is not a vetting ticket this app can read'
    )
    this.name = 'VettingTicketError'
  }
}

/**
 * Whether a ticket link can be used for an application to `communityDid` —
 * pure, so a screen can check it as it is pasted, before anything is sent.
 */
export function checkTicketFor(
  link: string,
  communityDid: string
): { ok: true; vetterDid: string; presentation: TicketPresentation } | { ok: false; error: VettingTicketError } {
  let ticket: ReturnType<typeof parseTicketUri>
  try {
    ticket = parseTicketUri(link)
  } catch {
    return { ok: false, error: new VettingTicketError('unreadable') }
  }
  if (ticket.community !== communityDid) {
    return { ok: false, error: new VettingTicketError('otherCommunity', ticket.community) }
  }
  return { ok: true, vetterDid: ticket.vetter, presentation: ticket.presentation }
}

/** The applicant's one application to one community. */
export interface VettingApplication {
  communityDid: string
  joinDid: string
  requirementsDigest?: string
  minStatements: number
  requiredClaims: string[]
  acceptedMethods: VettingMethod[]
  /** Per-method floors the community published, e.g. at least one `inPerson`. */
  minByMethod?: Record<string, number>
  /** ISO 8601 duration; a statement older than this at submit does not count. */
  maxStatementAge?: string
  /** Relationship caps and commitment consistency, as published. */
  independence?: {
    maxByDeclaredRelationship?: Record<string, number>
    requireConsistentIdentityCommitment?: boolean
  }
  /** One salt per application, so every vetter sees the same commitment. */
  commitmentSalt: string
  /** What the card will carry — the face, kept on the phone for now. */
  claims: Record<string, string>
  requests: VettingApplicationRequest[]
  startedAt: string
  /** The join request this application produced, once submitted. */
  submission?: VettingSubmission
}

export interface VtiVettingStore {
  listTickets(communityDid: string): Promise<VettingTicket[]>
  saveTicket(ticket: VettingTicket): Promise<void>
  listDesk(): Promise<VettingDeskRequest[]>
  saveDesk(request: VettingDeskRequest): Promise<void>
  /** Drop every desk request for a community — a desk is working state, not a record. */
  clearDesk(communityDid: string): Promise<void>
  getProfile(communityDid: string): Promise<VettingVetterProfile | undefined>
  saveProfile(profile: VettingVetterProfile): Promise<void>
  getApplication(communityDid: string): Promise<VettingApplication | undefined>
  saveApplication(application: VettingApplication): Promise<void>
  forget(communityDid: string): Promise<void>
}

const RECORD_TYPE = 'keyring/vti-vetting'

export class GenericRecordsVettingStore implements VtiVettingStore {
  constructor(private readonly agent: Agent) {}
  private async put(kind: string, key: string, content: Record<string, unknown>) {
    const existing = await this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE, kind, key })
    if (existing[0]) {
      existing[0].content = content
      await this.agent.genericRecords.update(existing[0])
    } else await this.agent.genericRecords.save({ content, tags: { recordType: RECORD_TYPE, kind, key } })
  }
  private async list<T>(kind: string): Promise<T[]> {
    const rs = await this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE, kind })
    return rs.map((r) => r.content as unknown as T)
  }
  async listTickets(communityDid: string) {
    return (await this.list<VettingTicket>('ticket')).filter((t) => t.communityDid === communityDid)
  }
  saveTicket(t: VettingTicket) {
    return this.put('ticket', t.ticketId, { ...t })
  }
  /** Newest first — the person in front of the vetter is the latest request. */
  async listDesk() {
    return (await this.list<VettingDeskRequest>('desk')).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
  }
  saveDesk(r: VettingDeskRequest) {
    return this.put('desk', r.requestId, { ...r })
  }
  async getProfile(communityDid: string) {
    return (await this.list<VettingVetterProfile>('profile')).find((p) => p.communityDid === communityDid)
  }
  saveProfile(p: VettingVetterProfile) {
    return this.put('profile', p.communityDid, { ...p })
  }
  async clearDesk(communityDid: string) {
    const rs = await this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE, kind: 'desk' })
    for (const r of rs) {
      if ((r.content as { communityDid?: string }).communityDid === communityDid)
        await this.agent.genericRecords.delete(r)
    }
  }
  async getApplication(communityDid: string) {
    return (await this.list<VettingApplication>('application')).find((a) => a.communityDid === communityDid)
  }
  saveApplication(a: VettingApplication) {
    return this.put('application', a.communityDid, { ...a })
  }
  async forget(communityDid: string) {
    const rs = await this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE })
    for (const r of rs) {
      const c = r.content as { communityDid?: string }
      if (c.communityDid === communityDid) await this.agent.genericRecords.delete(r)
    }
  }
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const b64url = (bytes: Uint8Array) => TypedArrayEncoder.toBase64Url(bytes)
function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  // Credo's utils.uuid is CSPRNG-backed on RN; draw from it rather than Math.random.
  let i = 0
  while (i < n) {
    const hex = utils.uuid().replace(/-/g, '')
    for (let j = 0; j < hex.length && i < n; j += 2) out[i++] = parseInt(hex.slice(j, j + 2), 16)
  }
  return out
}
/** `XXXX-XXXX` from 40 fresh bits — a ticket code is a secret, not a derivation. */
function randomCode(): string {
  const b = randomBytes(5)
  let bits = 0n
  for (const x of b) bits = (bits << 8n) | BigInt(x)
  let out = ''
  for (let i = 0; i < 8; i++) {
    if (i === 4) out += '-'
    out += CROCKFORD[Number((bits >> BigInt(35 - 5 * i)) & 0x1fn)]
  }
  return out
}
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** A Trust Task document from `issuer` to `recipient`, signed as the persona. */
async function signedDocument(
  agent: Agent,
  persona: VtiPersona,
  recipient: string,
  type: string,
  payload: Record<string, unknown>,
  threadId?: string
): Promise<Record<string, unknown>> {
  const doc: Record<string, unknown> = {
    id: `urn:uuid:${utils.uuid()}`,
    type,
    ...(threadId ? { threadId } : {}),
    issuer: persona.did,
    recipient,
    issuedAt: new Date().toISOString(),
    payload,
  }
  return signDocumentProof(agent, doc, persona.did, {
    kmsKeyId: persona.kmsKeyIds?.signing,
    verificationMethodId: persona.vtaKeyIds.signing,
  })
}

const bodyOf = (m: DidCommV2PlaintextMessage) => (m.body ?? {}) as Record<string, unknown>
const payloadOf = (m: DidCommV2PlaintextMessage) => (bodyOf(m).payload ?? {}) as Record<string, unknown>
const typeOf = (m: DidCommV2PlaintextMessage) => String(m.type ?? bodyOf(m).type ?? '')
const threadOf = (m: DidCommV2PlaintextMessage) => String(m.thid ?? bodyOf(m).threadId ?? '')

/** The identity commitment: digestMultibase over `{salt, claims}` with claims sorted by type. */
/** How long a Vetting Card may be valid: vta-sdk `vetting::card::MAX_CARD_VALIDITY`. */
export const MAX_CARD_VALIDITY_MS = 15 * 60 * 1000

/**
 * The identity commitment a card and every statement on it carry, exactly as
 * the spec and the VTI SDK compute it (`vta-sdk` `vetting::card::identity_commitment`,
 * trust-tasks `vetting/session/0.1`): over `{ salt, claims }` where `claims`
 * is `{ type, value }` — nothing else — for each distinct claim type, in code
 * point order of the type. Keyring used to hash the whole claim, `provenance`
 * included, and sort with `localeCompare`; its own vetters never recomputed
 * it, so Keyring agreed with itself while every openvtc vetter refused its
 * cards (2026-09-24, a maintainer's run: "waiting for their card").
 */
export function identityCommitment(salt: string, claims: { type: string; value: unknown }[]): string {
  const byType = new Map<string, unknown>()
  for (const claim of claims) if (!byType.has(claim.type)) byType.set(claim.type, claim.value)
  const selected = [...byType.keys()]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((type) => ({ type, value: byType.get(type) }))
  return digestMultibase({ salt, claims: selected })
}

// ---------------------------------------------------------------------------
// The vetter's desk
// ---------------------------------------------------------------------------

export class VtiVetterDesk {
  private stop?: () => void
  constructor(
    private readonly agent: Agent,
    private readonly persona: VtiPersona,
    private readonly store: VtiVettingStore,
    private readonly communityStore: VtiCommunityStore,
    private readonly onChange?: () => void
  ) {}

  /**
   * Publish this vetter's profile to the community
   * (`vtc/vetting/vetters/profile/0.1`). Until a vetter does this they are
   * invisible to an applicant looking for one: the community's listing skips
   * any vetter without a published profile. `listed: false` withdraws from
   * the listing without giving up the grant.
   *
   * `location` is sent only when a country is given — the community's schema
   * requires one inside it, so a half-filled location is refused rather than
   * stored.
   */
  async publishProfile(input: {
    listed?: boolean
    displayName?: string
    languages?: string[]
    methods?: VettingMethod[]
    country?: string
    city?: string
    acceptsDocumentation?: string[]
    events?: { name: string; startDate: string; endDate: string }[]
  }): Promise<void> {
    const country = input.country?.trim()
    const payload: Record<string, unknown> = {
      listed: input.listed ?? true,
      languages: input.languages ?? ['en'],
      methods: input.methods ?? ['inPerson', 'video'],
      ...(input.displayName?.trim() ? { displayName: input.displayName.trim() } : {}),
      ...(country ? { location: { country, ...(input.city?.trim() ? { city: input.city.trim() } : {}) } } : {}),
      // Both are required by the community's schema even when they say
      // nothing: an empty `acceptsDocumentation` means "no statement either
      // way" rather than "none accepted", and a vetter with no listed events
      // still has a profile.
      acceptsDocumentation: input.acceptsDocumentation ?? [],
      events: input.events ?? [],
    }
    // The community's document may not be in the resolver's cache on this
    // phone yet, and the hosting daemon rate-limits a burst (VTI-19), so warm
    // it patiently rather than letting the first ask fail as `invalidDid`.
    await resolveDidDocumentRetrying(this.agent, this.persona.communityDid)
    const answer = await vtiAgent.ask(this.persona.communityDid, VETTING.vettersProfile, payload)
    if (!answer) throw new Error('vtiVetting: the community did not answer the profile publish')
    const type = String((answer.body as { type?: string } | undefined)?.type ?? '')
    if (type.startsWith(TASK_ERROR)) {
      const p = (answer.body as { payload?: { code?: string; message?: string } } | undefined)?.payload
      throw new Error(`vtiVetting: ${p?.message ?? p?.code ?? 'the community refused the profile'}`)
    }
    await this.store.saveProfile({
      communityDid: this.persona.communityDid,
      vetterDid: this.persona.did,
      listed: (payload.listed as boolean) ?? true,
      displayName: input.displayName?.trim(),
      publishedAt: new Date().toISOString(),
    })
    this.onChange?.()
  }

  /**
   * The vetter grant this persona should act under: the newest one that is
   * actually live, with its state, or the newest one and the reason it cannot
   * be used.
   *
   * This used to be "the first grant the store returns whose subject is this
   * persona", which is not a choice at all once a vetter has been re-granted
   * and holds several. It signed statements under revoked grants while a live
   * one sat beside them; the community discounted those statements and the
   * applicant was told "the vetter's grant did not cover the moment they
   * signed" — with nothing on the vetter's side saying so (keyring-test,
   * 2026-09-22). The evaluation lives in `vtiGrantState`, which the agent
   * screens already use, so the grant a screen says you hold is now the grant
   * this signs with.
   */
  async grantWithState(): Promise<Awaited<ReturnType<typeof pickOwnVetterGrant>>> {
    const all = await this.communityStore.listHeldCredentials('vetter-grant', this.persona.communityDid)
    const mine = all.filter((g) => g.subjectDid === this.persona.did)
    return pickOwnVetterGrant(this.agent, mine.length > 0 ? mine : all, { allowInsecureLocal: __DEV__ })
  }

  /** The grant to act under, or nothing when none of those held is live. */
  async grant(): Promise<VtiHeldCredential | undefined> {
    const picked = await this.grantWithState()
    return picked.state.state === 'active' ? picked.held : undefined
  }

  /** Cut a ticket: one use, fourteen days, both forms. */
  async issueTicket(
    options: { uses?: number; days?: number; methods?: VettingMethod[] } = {}
  ): Promise<VettingTicket & { link: string }> {
    const ticket: VettingTicket = {
      ticketId: `vt-${utils.uuid().replace(/-/g, '')}`,
      code: randomCode(),
      secret: b64url(randomBytes(32)),
      communityDid: this.persona.communityDid,
      usesLeft: options.uses ?? 1,
      expiresAt: new Date(Date.now() + (options.days ?? 14) * 86400000).toISOString(),
      methods: options.methods,
      createdAt: new Date().toISOString(),
    }
    await this.store.saveTicket(ticket)
    this.onChange?.()
    return { ...ticket, link: this.linkFor(ticket) }
  }

  linkFor(ticket: VettingTicket): string {
    return encodeTicketUri({
      community: ticket.communityDid,
      vetter: this.persona.did,
      presentation: { qr: { ticketId: ticket.ticketId, secret: ticket.secret } },
    })
  }

  /** Start listening for requests, cards and the rest on the persona's session. */
  listen(): () => void {
    this.stop?.()
    this.stop = vtiAgent.onInbound((m) => {
      void this.inbound(m).catch(() => undefined)
    })
    return this.stop
  }

  private async inbound(m: DidCommV2PlaintextMessage): Promise<void> {
    const type = typeOf(m)
    if (type === VETTING.request) return this.takeRequest(m)
    if (type === `${VETTING.session}${RESPONSE}`) return this.receiveCard(m)
  }

  /** A request earns an answer only with a live ticket; accepting is automatic. */
  private async takeRequest(m: DidCommV2PlaintextMessage): Promise<void> {
    const body = bodyOf(m)
    const p = payloadOf(m)
    const applicantDid = String(body.issuer ?? m.from ?? '')
    if (String(p.community ?? '') !== this.persona.communityDid) return
    if (String(p.joinDid ?? '') !== applicantDid) return
    const presented = p.ticket as { code?: string; ticketId?: string; secret?: string } | undefined
    const tickets = await this.store.listTickets(this.persona.communityDid)
    const now = Date.now()
    const ticket = tickets.find((t) => {
      if (t.usesLeft <= 0 || new Date(t.expiresAt).getTime() < now) return false
      if (t.boundTo && t.boundTo !== applicantDid) return false
      if (presented?.code) return constantTimeEqual(t.code, presented.code)
      if (presented?.ticketId && presented?.secret)
        return t.ticketId === presented.ticketId && constantTimeEqual(t.secret, presented.secret)
      return false
    })
    if (!ticket) {
      // A wrong code is never answered; a wrong QR secret says so.
      if (presented?.ticketId) await this.refuse(m, applicantDid, 'vetting/request:invalidTicket')
      return
    }
    // A ticket outstanding when the grant dies would otherwise start a ceremony
    // that cannot finish: the whole exchange runs, and the applicant learns at
    // the end that no statement counted. Refuse it now, to the APPLICANT, who is
    // the stranger to this problem and the one whose time it wastes. The
    // vetter's own desk explains its standing and will not cut a new ticket, so
    // this refusal is not the only thing either party has to go on.
    //
    // Before the ticket is spent, deliberately: a single-use ticket burned here
    // would make the applicant ask the vetter for another one to recover from
    // the vetter's own problem. Restore the grant and the ticket they already
    // hold still works.
    const standing = await this.grantWithState()
    if (standing.state.state !== 'active') {
      await this.refuse(m, applicantDid, vetterNotEligibleReason(standing.state.state))
      return
    }

    ticket.usesLeft -= 1
    ticket.boundTo = applicantDid
    await this.store.saveTicket(ticket)

    const request: VettingDeskRequest = {
      requestId: utils.uuid(),
      applicantDid,
      communityDid: this.persona.communityDid,
      requirementsDigest: typeof p.requirementsDigest === 'string' ? p.requirementsDigest : undefined,
      preferredMethod: p.preferredMethod as VettingMethod | undefined,
      message: typeof p.message === 'string' ? p.message : undefined,
      status: 'accepted',
      receivedAt: new Date().toISOString(),
    }
    await this.store.saveDesk(request)
    const grant = await this.grant()
    const eligibilityVp = grant
      ? await this.eligibilityPresentation(grant.credential, applicantDid, request.requestId)
      : undefined
    const response = await signedDocument(
      this.agent,
      this.persona,
      applicantDid,
      `${VETTING.request}${RESPONSE}`,
      {
        requestId: request.requestId,
        ...(eligibilityVp ? { eligibilityVp } : {}),
        acceptsDocumentation: ['passport', 'nationalId', 'driverLicence'],
        sessionHint: 'Ready when you are — the session opens from this phone.',
      },
      String(body.threadId ?? body.id ?? '')
    )
    await vtiAgent.send(applicantDid, `${VETTING.request}${RESPONSE}`, response, { thid: String(m.id ?? '') })
    this.onChange?.()
  }

  private async refuse(m: DidCommV2PlaintextMessage, to: string, code: string): Promise<void> {
    const body = bodyOf(m)
    const error = await signedDocument(
      this.agent,
      this.persona,
      to,
      `${TASK_ERROR}0.3`,
      { code, message: code },
      String(body.threadId ?? body.id ?? '')
    )
    await vtiAgent.send(to, `${TASK_ERROR}0.3`, error, { thid: String(m.id ?? '') })
  }

  /** The VP that shows the applicant this persona currently holds the vetter role. */
  private async eligibilityPresentation(grant: Record<string, unknown>, applicantDid: string, nonce: string) {
    const vp = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiablePresentation'],
      holder: this.persona.did,
      domain: applicantDid,
      nonce,
      verifiableCredential: [grant],
    }
    return signDocumentProof(this.agent, vp, this.persona.did, {
      kmsKeyId: this.persona.kmsKeyIds?.signing,
      verificationMethodId: this.persona.vtaKeyIds.signing,
    })
  }

  /** Open the session: a fresh challenge, the community as domain, the required claims. */
  async openSession(
    requestId: string,
    requiredClaims: string[],
    method: VettingMethod = 'inPerson'
  ): Promise<VettingDeskRequest> {
    const desk = (await this.store.listDesk()).find((r) => r.requestId === requestId)
    if (!desk) throw new Error('vtiVetting: no such request')
    const challenge = b64url(randomBytes(32))
    const expiresAt = new Date(Date.now() + 3600000).toISOString()
    const doc = await signedDocument(this.agent, this.persona, desk.applicantDid, VETTING.session, {
      requestId,
      challenge,
      domain: desk.communityDid,
      method,
      requiredClaims,
      expiresAt,
    })
    await vtiAgent.send(desk.applicantDid, VETTING.session, doc, { expiresInSec: 3600 })
    desk.status = 'session'
    desk.session = {
      documentId: String(doc.id),
      challenge,
      domain: desk.communityDid,
      requiredClaims,
      method,
      expiresAt,
      matchCode: vettingMatchCode(String(doc.id)),
    }
    await this.store.saveDesk(desk)
    this.onChange?.()
    return desk
  }

  /** The applicant's card: verify it against this session before showing it. */
  private async receiveCard(m: DidCommV2PlaintextMessage): Promise<void> {
    const body = bodyOf(m)
    const card = (payloadOf(m).card ?? {}) as Record<string, unknown>
    const thread = threadOf(m)
    const desk = (await this.store.listDesk()).find(
      (r) => r.session?.documentId === thread || r.applicantDid === String(body.issuer)
    )
    if (!desk?.session) return
    const ok =
      card.audience === this.persona.did &&
      card.challenge === desk.session.challenge &&
      card.domain === desk.session.domain &&
      card.community === desk.communityDid &&
      card.publisher === desk.applicantDid &&
      (await verifyDocumentProof(this.agent, card, desk.applicantDid))
    if (!ok) return
    desk.card = card
    desk.status = 'cardReceived'
    await this.store.saveDesk(desk)
    this.onChange?.()
  }

  /** The human check, then the statement — never automatic, signed as the member persona. */
  async attest(
    requestId: string,
    decision: {
      documentClasses: string[]
      claimsVerified: string[]
      livenessConfirmed: boolean
      declaredRelationship?: string
      validDays?: number
    }
  ): Promise<VettingDeskRequest> {
    const desk = (await this.store.listDesk()).find((r) => r.requestId === requestId)
    if (!desk?.card || !desk.session) throw new Error('vtiVetting: no card to attest')
    if (!decision.livenessConfirmed) throw new Error('vtiVetting: confirm the match code with the person present first')
    const carried = ((desk.card.claims as { type: string }[]) ?? []).map((c) => c.type)
    for (const c of decision.claimsVerified)
      if (!carried.includes(c)) throw new Error(`vtiVetting: the card does not carry ${c}`)
    for (const c of desk.session.requiredClaims)
      if (!decision.claimsVerified.includes(c)) throw new Error(`vtiVetting: ${c} was not verified`)
    if (decision.documentClasses.length === 0 && desk.session.method !== 'priorAcquaintance')
      throw new Error('vtiVetting: name the documentation relied on')

    const { proof: _p, ...cardWithoutProof } = desk.card
    void _p
    const validFrom = new Date()
    const validUntil = new Date(validFrom.getTime() + (decision.validDays ?? 120) * 86400000)
    const statement: Record<string, unknown> = {
      '@context': DTG_CONTEXT,
      type: ['VerifiableCredential', 'DTGCredential', 'EndorsementCredential'],
      id: `urn:uuid:${utils.uuid()}`,
      issuer: this.persona.did,
      validFrom: validFrom.toISOString(),
      validUntil: validUntil.toISOString(),
      taskContext: desk.session.documentId,
      credentialSubject: {
        id: desk.applicantDid,
        endorsement: {
          type: IDENTITY_VETTING_ENDORSEMENT_TYPE,
          community: desk.communityDid,
          method: desk.session.method,
          documentClasses: decision.documentClasses,
          claimsVerified: decision.claimsVerified,
          livenessConfirmed: true,
          identityCommitment: desk.card.identityCommitment,
          cardDigestMultibase: digestMultibase(desk.card),
          declaredRelationship: decision.declaredRelationship ?? 'none',
        },
      },
    }
    void cardWithoutProof
    const signed = await signDocumentProof(this.agent, statement, this.persona.did, {
      kmsKeyId: this.persona.kmsKeyIds?.signing,
      verificationMethodId: this.persona.vtaKeyIds.signing,
    })
    const issue = await signedDocument(this.agent, this.persona, desk.applicantDid, CREDENTIAL_EXCHANGE_ISSUE, {
      credential_response: { credential: signed },
    })
    await vtiAgent.send(desk.applicantDid, CREDENTIAL_EXCHANGE_ISSUE, issue)
    desk.status = 'attested'
    desk.statementId = String(signed.id)
    await this.store.saveDesk(desk)
    this.onChange?.()
    return desk
  }

  async decline(requestId: string, message?: string): Promise<void> {
    const desk = (await this.store.listDesk()).find((r) => r.requestId === requestId)
    if (!desk) return
    const doc = await signedDocument(this.agent, this.persona, desk.applicantDid, VETTING.decline, {
      requestId,
      ...(message ? { message } : {}),
    })
    await vtiAgent.send(desk.applicantDid, VETTING.decline, doc)
    desk.status = 'declined'
    await this.store.saveDesk(desk)
    this.onChange?.()
  }
}

// ---------------------------------------------------------------------------
// The applicant's application
// ---------------------------------------------------------------------------

export class VtiApplicant {
  private stop?: () => void
  constructor(
    private readonly agent: Agent,
    private readonly persona: VtiPersona,
    private readonly store: VtiVettingStore,
    private readonly communityStore: VtiCommunityStore,
    private readonly onChange?: () => void
  ) {}

  /** Start (or resume) the application: the join DID is the persona, chosen before gathering. */
  async start(manifest: VtiManifest, claims: Record<string, string>): Promise<VettingApplication> {
    const existing = await this.store.getApplication(this.persona.communityDid)
    const vetting = manifest.criteria.map((c) => (c as { vetting?: Record<string, unknown> }).vetting).find(Boolean) as
      | {
          minStatements?: number
          requiredClaims?: string[]
          acceptedMethods?: VettingMethod[]
          minByMethod?: Record<string, number>
          maxStatementAge?: string
          independence?: {
            maxByDeclaredRelationship?: Record<string, number>
            requireConsistentIdentityCommitment?: boolean
          }
        }
      | undefined
    const digest =
      (
        manifest.criteria.find((c) => (c as { vetting?: unknown }).vetting) as
          | { requirementsDigest?: string }
          | undefined
      )?.requirementsDigest ?? manifest.requirementsDigest
    const application: VettingApplication = existing ?? {
      communityDid: this.persona.communityDid,
      joinDid: this.persona.did,
      minStatements: 1,
      requiredClaims: [],
      acceptedMethods: ['inPerson', 'video'],
      commitmentSalt: b64url(randomBytes(32)),
      claims: {},
      requests: [],
      startedAt: new Date().toISOString(),
    }
    application.requirementsDigest = digest
    application.minStatements = vetting?.minStatements ?? 1
    application.requiredClaims = vetting?.requiredClaims ?? ['name.legal']
    application.acceptedMethods = vetting?.acceptedMethods ?? ['inPerson', 'video']
    // The rest of the published requirement. A community sets every one of
    // these and applies them at intake; an applicant that reads only the
    // statement count gathers against a rule it never saw.
    application.minByMethod = vetting?.minByMethod
    application.maxStatementAge = vetting?.maxStatementAge
    application.independence = vetting?.independence
    application.claims = { ...application.claims, ...claims }
    await this.store.saveApplication(application)
    this.onChange?.()
    return application
  }

  listen(): () => void {
    this.stop?.()
    this.stop = vtiAgent.onInbound((m) => {
      void this.inbound(m).catch(() => undefined)
    })
    return this.stop
  }

  private async inbound(m: DidCommV2PlaintextMessage): Promise<void> {
    const type = typeOf(m)
    if (type === `${VETTING.request}${RESPONSE}`) return this.accepted(m)
    if (type.startsWith(TASK_ERROR)) return this.refused(m)
    if (type === VETTING.session) return this.sessionOpened(m)
    if (type === VETTING.decline) return this.declined(m)
    if (type === CREDENTIAL_EXCHANGE_ISSUE) return this.statementDelivered(m)
  }

  private async app(): Promise<VettingApplication> {
    const a = await this.store.getApplication(this.persona.communityDid)
    if (!a) throw new Error('vtiVetting: no application — start one first')
    return a
  }

  /** Ask a vetter, with the ticket they handed over. A link for another community is refused before anything is sent. */
  async requestVetter(input: {
    link?: string
    vetterDid?: string
    code?: string
    method?: VettingMethod
    message?: string
  }): Promise<VettingApplicationRequest> {
    const application = await this.app()
    let vetterDid = input.vetterDid
    let presentation: TicketPresentation | undefined
    if (input.link) {
      // Before anything is signed or sent: a ticket for another community would
      // hand this person's request to that community's vetter.
      const checked = checkTicketFor(input.link, application.communityDid)
      if (!checked.ok) throw checked.error
      vetterDid = checked.vetterDid
      presentation = checked.presentation
    } else if (input.code) presentation = { code: { code: input.code } }
    if (!vetterDid || !presentation) throw new Error('vtiVetting: a ticket and a vetter are needed')
    const ticket =
      'qr' in presentation
        ? { ticketId: presentation.qr.ticketId, secret: presentation.qr.secret }
        : { code: presentation.code.code }
    const doc = await signedDocument(this.agent, this.persona, vetterDid, VETTING.request, {
      community: application.communityDid,
      ...(application.requirementsDigest ? { requirementsDigest: application.requirementsDigest } : {}),
      joinDid: application.joinDid,
      ticket,
      preferredMethod: input.method ?? 'inPerson',
      languages: ['en'],
      ...(input.message ? { message: input.message } : {}),
    })
    await vtiAgent.send(vetterDid, VETTING.request, doc)
    const request: VettingApplicationRequest = {
      vetterDid,
      requestDocumentId: String(doc.id),
      status: 'sent',
      sentAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    application.requests = [...application.requests.filter((r) => r.vetterDid !== vetterDid), request]
    await this.store.saveApplication(application)
    this.onChange?.()
    return request
  }

  private async update(vetterDid: string, patch: Partial<VettingApplicationRequest>): Promise<void> {
    const application = await this.app()
    application.requests = application.requests.map((r) =>
      r.vetterDid === vetterDid ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r
    )
    await this.store.saveApplication(application)
    this.onChange?.()
  }

  private async accepted(m: DidCommV2PlaintextMessage): Promise<void> {
    const body = bodyOf(m)
    const p = payloadOf(m)
    const vetterDid = String(body.issuer ?? m.from ?? '')
    const vp = p.eligibilityVp as Record<string, unknown> | undefined
    let eligibilityOk = false
    let grantValidFrom: string | undefined
    let grantValidUntil: string | undefined
    let grantCredential: Record<string, unknown> | undefined
    if (vp) {
      const creds = (vp.verifiableCredential as Record<string, unknown>[]) ?? []
      const grant = creds.find((c) => {
        const e = (c.credentialSubject as { endorsement?: { role?: string; communityDid?: string } })?.endorsement
        return e?.role === 'vetter' && e?.communityDid === this.persona.communityDid
      })
      eligibilityOk = !!grant && (await verifyDocumentProof(this.agent, vp, vetterDid))
      grantValidFrom = typeof grant?.validFrom === 'string' ? grant.validFrom : undefined
      grantValidUntil = typeof grant?.validUntil === 'string' ? grant.validUntil : undefined
      grantCredential = grant
    }
    // The window says when the grant was *meant* to be live; the status list
    // says whether the community has since withdrawn it. Only the second one
    // catches a vetter revoked this morning, and it is the one the community
    // applies at intake — so an applicant that never asks can gather a
    // statement, submit it, and be told nothing about why it did not count.
    const status = grantCredential
      ? await checkCredentialStatus(
          this.agent,
          grantCredential,
          String(grantCredential.issuer ?? this.persona.communityDid),
          { allowInsecureLocal: __DEV__ }
        )
      : undefined
    if (status?.state === 'unknown') this.logUncheckedGrant(vetterDid, status.reason)
    await this.update(vetterDid, {
      status: 'accepted',
      requestId: String(p.requestId ?? ''),
      eligibilityOk,
      grantValidFrom,
      grantValidUntil,
      grantCheckedAt: new Date().toISOString(),
      grantStatus: status?.state,
      grantStatusReason: status?.state === 'unknown' ? status.reason : undefined,
      grantStatusCheckedAt: status?.checkedAt,
      grantStatusEntry: grantCredential ? statusEntryFor(grantCredential) : undefined,
    })
  }

  private async refused(m: DidCommV2PlaintextMessage): Promise<void> {
    const body = bodyOf(m)
    const vetterDid = String(body.issuer ?? m.from ?? '')
    const application = await this.store.getApplication(this.persona.communityDid)
    if (!application?.requests.some((r) => r.vetterDid === vetterDid)) return
    await this.update(vetterDid, { status: 'refused', refusalCode: String(payloadOf(m).code ?? 'refused') })
  }

  private async sessionOpened(m: DidCommV2PlaintextMessage): Promise<void> {
    const body = bodyOf(m)
    const p = payloadOf(m)
    const vetterDid = String(body.issuer ?? m.from ?? '')
    const documentId = String(body.id ?? m.id ?? '')
    await this.update(vetterDid, {
      status: 'session',
      session: {
        documentId,
        challenge: String(p.challenge ?? ''),
        domain: String(p.domain ?? ''),
        requiredClaims: (p.requiredClaims as string[]) ?? [],
        method: (p.method as VettingMethod) ?? 'inPerson',
        expiresAt: String(p.expiresAt ?? ''),
        matchCode: vettingMatchCode(documentId),
      },
    })
  }

  /** Build the Vetting Card from the face, sign it as the join persona, send it into the session. */
  async sendCard(vetterDid: string): Promise<Record<string, unknown>> {
    const application = await this.app()
    const request = application.requests.find((r) => r.vetterDid === vetterDid)
    if (!request?.session) throw new Error('vtiVetting: no open session with that vetter')
    const claims = request.session.requiredClaims.map((type) => {
      const value = application.claims[type]
      if (value === undefined || value === '') throw new Error(`vtiVetting: your face has no ${type}`)
      return { type, value, provenance: 'selfAsserted' }
    })
    const issuedAt = new Date()
    const sessionEnd = new Date(request.session.expiresAt).getTime()
    // A card is valid for at most 15 minutes (vta-sdk `MAX_CARD_VALIDITY`); a
    // vetter refuses a longer one, whatever the session allows.
    const expiresAt = new Date(Math.min(sessionEnd || Infinity, issuedAt.getTime() + MAX_CARD_VALIDITY_MS))
    const card: Record<string, unknown> = {
      id: `urn:uuid:${utils.uuid()}`,
      type: ['VerifiableDataStructure', 'RelationshipCard', 'VettingCard'],
      cardVersion: 1,
      publisher: application.joinDid,
      community: application.communityDid,
      domain: request.session.domain,
      audience: vetterDid,
      challenge: request.session.challenge,
      claims,
      commitmentSalt: application.commitmentSalt,
      identityCommitment: identityCommitment(application.commitmentSalt, claims),
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }
    const signed = await signDocumentProof(this.agent, card, application.joinDid, {
      kmsKeyId: this.persona.kmsKeyIds?.signing,
      verificationMethodId: this.persona.vtaKeyIds.signing,
    })
    const response = await signedDocument(
      this.agent,
      this.persona,
      vetterDid,
      `${VETTING.session}${RESPONSE}`,
      { card: signed },
      request.session.documentId
    )
    await vtiAgent.send(vetterDid, `${VETTING.session}${RESPONSE}`, response, { thid: request.session.documentId })
    await this.update(vetterDid, { status: 'cardSent', cardDigest: digestMultibase(signed) })
    return signed
  }

  /** A statement is claimed only when it is about this application, and verified against our own card before it is kept. */
  private async statementDelivered(m: DidCommV2PlaintextMessage): Promise<void> {
    const body = bodyOf(m)
    const p = (body.payload ?? body) as Record<string, unknown>
    const credential = ((p.credential_response as Record<string, unknown>)?.credential ?? undefined) as
      | Record<string, unknown>
      | undefined
    if (!credential) return
    const subject = credential.credentialSubject as { id?: string; endorsement?: Record<string, unknown> } | undefined
    const endorsement = subject?.endorsement
    if (endorsement?.type !== IDENTITY_VETTING_ENDORSEMENT_TYPE) return
    const application = await this.store.getApplication(this.persona.communityDid)
    if (!application || subject?.id !== application.joinDid) return
    const issuer =
      typeof credential.issuer === 'string'
        ? credential.issuer
        : String((credential.issuer as { id?: string })?.id ?? '')
    const request = application.requests.find((r) => r.vetterDid === issuer)
    if (!request) return
    const expectedCommitment = identityCommitment(
      application.commitmentSalt,
      (request.session?.requiredClaims ?? []).map((type) => ({
        type,
        value: application.claims[type],
        provenance: 'selfAsserted',
      }))
    )
    const ok =
      endorsement.community === application.communityDid &&
      endorsement.identityCommitment === expectedCommitment &&
      (!request.cardDigest || endorsement.cardDigestMultibase === request.cardDigest) &&
      (await verifyDocumentProof(this.agent, credential, issuer))
    if (!ok) return
    // Two things a community checks that a verifying signature does not: the
    // signer must have held the vetter grant BEFORE signing (sign first, grant
    // second and the statement verifies perfectly, then counts for nothing —
    // the community reports it as issuer-not-vetter), and the statement must
    // be inside the criterion's maxStatementAge when it is submitted. Both are
    // recorded here so the checklist can say so rather than the community
    // discounting it silently.
    const signedAt = String(credential.validFrom ?? (credential as { issuanceDate?: string }).issuanceDate ?? '')
    const grantedBeforeSigning =
      !request.grantValidFrom || !signedAt || Date.parse(request.grantValidFrom) <= Date.parse(signedAt)
    const grantStillValid = !request.grantValidUntil || Date.parse(request.grantValidUntil) > Date.now()
    await this.communityStore.saveHeldCredential({
      kind: 'vetting-statement',
      communityDid: application.communityDid,
      subjectDid: application.joinDid,
      credential,
      receivedAt: new Date().toISOString(),
    })
    await this.update(issuer, {
      status: 'attested',
      statementId: String(credential.id ?? ''),
      statementSignedAt: signedAt || undefined,
      grantedBeforeSigning,
      grantStillValid,
    })
  }

  private async declined(m: DidCommV2PlaintextMessage): Promise<void> {
    const vetterDid = String(bodyOf(m).issuer ?? m.from ?? '')
    await this.update(vetterDid, { status: 'declined' })
  }

  /**
   * The applicant saw a match code that differs from the vetter's: end this
   * session on this phone. The protocol gives the applicant no decline of its
   * own (only the vetter declines, `vetting/decline/0.1`), so the screen asks
   * the person to tell the vetter, whose "Codes differ" ends it on theirs.
   */
  async abandonSession(vetterDid: string): Promise<void> {
    await this.update(vetterDid, { status: 'declined' })
  }

  /**
   * Re-ask the community whether each vetter's grant is still live.
   *
   * A grant checked when it arrived says nothing about this afternoon, and the
   * community applies the status at intake — so the moment that matters is
   * just before the submit, not when the statement was gathered. Runs the
   * checks together because they usually hit the same list, and a phone on a
   * slow link should not pay for them one after another.
   *
   * A check that cannot complete leaves the previous answer alone and records
   * why. An applicant offline in a basement is not an applicant with a revoked
   * vetter, and collapsing the two would refuse someone for having no signal.
   */
  /**
   * Send the application — or, when the community deferred an earlier one,
   * answer that deferral in place. A second submit while a request is open is
   * refused (VTI-04), so an open deferred request is supplemented instead, with
   * every statement: a supplement replaces the presentation, it does not add
   * to it. What the community says is recorded, so the next call knows which
   * of the two to make.
   */
  async submit(
    manifest: VtiManifest,
    statements: unknown[],
    requirementsDigest?: string,
    // Sent with a fresh application only: a supplement answers the open one,
    // whose consent was given when it was sent.
    registryConsent?: boolean
  ): Promise<VtiVerdict> {
    const application = await this.app()
    const communityDid = this.persona.communityDid
    const open = application.submission?.state === 'deferred' ? application.submission : undefined
    let verdict: VtiVerdict
    if (open) {
      try {
        verdict = await vtiAgent.supplement(communityDid, {
          credentials: statements,
          requestId: open.requestId,
          requirementsDigest,
        })
        await recordAnswer(this.communityStore, communityDid, { verdict }).catch(() => undefined)
      } catch (e) {
        const reason = joinRequestRefusal(e)
        if (reason === 'notFound') {
          // Nothing open after all — withdrawn elsewhere or swept by retention.
          // A fresh submission is the honest next step, not an error.
          verdict = await this.applyRecorded(manifest, {
            credentials: statements,
            requirementsDigest,
            registryConsent,
          })
        } else {
          if (reason === 'alreadyDecided') await this.recordSubmission({ ...open, state: 'decided' })
          throw e
        }
      }
    } else {
      try {
        verdict = await this.applyRecorded(manifest, {
          credentials: statements,
          requirementsDigest,
          registryConsent,
        })
      } catch (e) {
        // The community already holds an open request from this applicant that
        // the phone lost track of (a reinstall, another device). Its refusal
        // names the request (vti #1592): record it, so withdraw and supplement
        // act on it and the screen can say "you already applied", then let the
        // refusal through.
        const already = openJoinRequestOf(e)
        if (already) {
          await this.recordSubmission({
            requestId: already.requestId,
            state: already.status === 'deferred' ? 'deferred' : 'pending',
            at: new Date().toISOString(),
          })
          await recordStatus(this.communityStore, communityDid, {
            requestId: already.requestId,
            status: already.status === 'deferred' ? 'deferred' : 'pending',
          }).catch(() => undefined)
        }
        throw e
      }
    }
    await this.recordSubmission({
      requestId: verdict.requestId ?? open?.requestId,
      state: openStateOf(verdict.effect) ?? 'decided',
      effect: verdict.effect,
      needs: verdict.needs,
      at: new Date().toISOString(),
    })
    return verdict
  }

  /**
   * Close this application's open request, so the applicant is free to apply
   * again. `alreadyDecided` means an outcome stands and is recorded as such;
   * `notFound` means nothing was open, which leaves the applicant exactly
   * where a withdrawal would have — so it is not an error to them.
   */
  async withdraw(reason?: string): Promise<'withdrawn' | 'nothingOpen' | 'alreadyDecided'> {
    const application = await this.app()
    const requestId = application.submission?.requestId
    try {
      await vtiAgent.withdraw(this.persona.communityDid, { requestId, reason })
      await this.recordSubmission({ requestId, state: 'withdrawn', at: new Date().toISOString() })
      return 'withdrawn'
    } catch (e) {
      const refusal = joinRequestRefusal(e)
      if (refusal === 'notFound') {
        await this.recordSubmission(undefined)
        return 'nothingOpen'
      }
      if (refusal === 'alreadyDecided') {
        await this.recordSubmission({
          ...(application.submission ?? { at: new Date().toISOString() }),
          state: 'decided',
        })
        return 'alreadyDecided'
      }
      throw e
    }
  }

  /**
   * A fresh application, recorded for the join state (p220 item 7): sent
   * before the send, answered after — so a lost answer still reads "Sent —
   * waiting for the community".
   */
  private async applyRecorded(
    manifest: VtiManifest,
    options: { credentials: unknown[]; requirementsDigest?: string; registryConsent?: boolean }
  ): Promise<VtiVerdict> {
    const communityDid = this.persona.communityDid
    await recordSent(this.communityStore, {
      communityDid,
      personaDid: this.persona.did,
      withInvitation: false,
      via: 'vetting',
    }).catch(() => undefined)
    try {
      const verdict = await vtiAgent.apply(communityDid, manifest, options)
      await recordAnswer(this.communityStore, communityDid, { verdict }).catch(() => undefined)
      return verdict
    } catch (e) {
      await recordAnswer(this.communityStore, communityDid, { refusal: e }).catch(() => undefined)
      throw e
    }
  }

  private async recordSubmission(submission: VettingSubmission | undefined): Promise<void> {
    const application = await this.app()
    await this.store.saveApplication({ ...application, submission })
    this.onChange?.()
  }

  // The checklist shows only how many grants could not be checked; the reason
  // lives in the record. Say it where a developer will look.
  private logUncheckedGrant(vetterDid: string, reason: string): void {
    this.agent.config.logger.warn(`[VTI] vetter grant status not checked: ${reason}`, { vetterDid })
  }

  async refreshGrantStatus(): Promise<void> {
    const application = await this.app()
    const checkable = application.requests.filter((r) => r.grantStatusEntry)
    if (checkable.length === 0) return
    const results = await Promise.all(
      checkable.map(async (r) => ({
        vetterDid: r.vetterDid,
        result: await checkStatusEntry(this.agent, r.grantStatusEntry!, application.communityDid, {
          allowInsecureLocal: __DEV__,
        }),
      }))
    )
    for (const { vetterDid, result } of results) {
      if (result.state === 'unknown') {
        this.logUncheckedGrant(vetterDid, result.reason)
        await this.update(vetterDid, {
          grantStatusReason: result.reason,
          grantStatusCheckedAt: result.checkedAt,
        })
        continue
      }
      await this.update(vetterDid, {
        grantStatus: result.state,
        grantStatusReason: undefined,
        grantStatusCheckedAt: result.checkedAt,
      })
    }
    this.onChange?.()
  }

  /** The advisory checklist: statements held against the published requirement. */
  async checklist(): Promise<{
    held: number
    needed: number
    meets: boolean
    statements: Record<string, unknown>[]
    /** How many of those will actually count. */
    counted: number
    /**
     * Statements the community will discount — too old, from a vetter who has
     * already spoken, about a different face, or backed by a grant that did
     * not cover the signing or has since been revoked.
     */
    discounted: number
    /** What is still missing, in the community's own terms. */
    needs: { kind: 'statements' | 'method'; method?: string; n: number }[]
    /** False when a declared-relationship cap is over — a referral, not a refusal. */
    independenceOk: boolean
    exceededCaps: { relationship: string; limit: number; seen: number }[]
    /** Set when the community published an age limit this client could not read. */
    unreadableMaxAge?: string
    /** Vetters whose grant status could not be reached, and why. */
    unchecked: { vetterDid: string; reason: string }[]
  }> {
    const application = await this.app()
    // Only statements about THIS application count. A phone that was vetted
    // before holds statements naming an older join DID, and the mediator can
    // redeliver one at any time; counting those reads as "2 of 1" and would
    // let a stale statement stand in for one this application never gathered.
    const statements = (await this.communityStore.listHeldCredentials('vetting-statement', application.communityDid))
      .map((s) => s.credential)
      .filter((c) => (c as { credentialSubject?: { id?: string } }).credentialSubject?.id === application.joinDid)
    // What the community will actually make of these: age, per-method floors,
    // one voice per vetter, and a consistent commitment. Judged at now,
    // because the submit is the moment that decides.
    const evaluation = evaluateStatements(
      statements.map(statementFacts),
      {
        minStatements: application.minStatements,
        minByMethod: application.minByMethod,
        acceptedMethods: application.acceptedMethods,
        maxStatementAge: application.maxStatementAge,
        independence: application.independence,
      },
      application.joinDid
    )

    // A revoked grant joins the evaluation's own reasons: all of them are ways
    // the community counts a statement as nothing, and an applicant is better
    // off hearing it here than inferring it from a refusal. A grant we could
    // not reach is NOT counted — it is reported separately, because "we could
    // not ask" and "the answer was no" are different things to tell someone.
    const grantFaults = application.requests.filter(
      (r) =>
        r.status === 'attested' &&
        (r.grantedBeforeSigning === false || r.grantStillValid === false || r.grantStatus === 'revoked')
    ).length
    const unchecked = application.requests
      .filter((r) => r.status === 'attested' && r.grantStatusReason)
      .map((r) => ({ vetterDid: r.vetterDid, reason: r.grantStatusReason! }))
    return {
      // `held` stays the number gathered, not the number that will count —
      // the two are said separately so "3 of 2 statements" with a discount
      // line beneath it reads as what it is.
      held: statements.length,
      needed: application.minStatements,
      counted: evaluation.counted.length,
      meets: evaluation.meets && grantFaults < statements.length,
      statements,
      discounted: evaluation.discounted.length + grantFaults,
      needs: evaluation.needs,
      independenceOk: evaluation.independenceOk,
      exceededCaps: evaluation.exceededCaps,
      unreadableMaxAge: evaluation.unreadableMaxAge,
      unchecked,
    }
  }
}
