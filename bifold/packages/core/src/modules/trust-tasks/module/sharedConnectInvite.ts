/**
 * sharedConnectInvite — Keyring as the INVITER of a shared-connect code (relationship-over-tsp plan WP9, §2.8).
 *
 * The phone mints a fresh `did:peer:2` for one code, logs in to the inviter relay as that DID, and shows
 *
 *   https://link.trustoverip.org/t#_from=<that DID>&_id=<16 random bytes>&_exp=<≤ 10 min>&_type=/vti/flow/shared-connect/0.1
 *
 * A scanner then forms a TSP relationship (`XRFI`, answered here with `XRFA`) and proposes. Everything that arrives
 * for the code goes through ONE choke point, {@link SharedConnectInviter.admit}: frames are taken one at a time, in
 * order, and each is opened, checked and either acted on or dropped. A drop is silent: no error document, no
 * accept, no nack and no distinct teardown; the TSP binding (§6) owes an unsolicited sender no reply path.
 *
 * The standing rule for a `propose` (§2.8, {@link proposeStanding}): its recipient is this code's live encounter
 * VID, its enactment is the code's `_id`, the code has not expired, its proof verifies under its issuer, its sender
 * formed a relationship with this code first, and nothing has been accepted on the code before. Every condition is
 * evaluated, after the same work (open, proof check), whatever the outcome: a failing code is not answered faster or
 * differently from a valid but spent one, because neither is answered at all.
 *
 * The bounds (§2.8's spam guard, decided 2026-11-07), all in the persisted record:
 *  - relationships: invites are answered for at most {@link SHARED_CONNECT_INVITE_MAX_INVITES} distinct scanners;
 *  - acceptances: one propose is accepted. A scanner re-sending uses no slot: its invite is answered again, and the
 *    same propose (same sender, same id) is the same acceptance;
 *  - work: at most {@link SHARED_CONNECT_INVITE_MAX_FRAMES} frames are opened at all, whoever sends them. Each is
 *    counted and written before it is opened; the first frame past the budget is dropped unopened and the code ends (`exhausted`). Without this, a
 *    re-sent invite or a stream of proposes (whose proofs are checked before the rule is read, for equal work) had
 *    no ceiling.
 *
 * Teardown ({@link SharedConnectInviter.end}) is idempotent: expiry, cancel and completion all converge on it, the
 * first to arrive names the ending, and afterwards nothing survives: no timer, no listener, no relay session, and a
 * record written once more with a final state. This object is the record's only writer, and its writes are serial.
 *
 * Accepted proposals and the documents after them go to an attached {@link InviterCeremony} (the inverse ceremony,
 * a separate change); without one, an accepted propose leaves the code `proposed`.
 *
 * Nothing here logs the link, a label or any counterparty text: DID prefixes and outcome codes only (WP12).
 *
 * @module trust-tasks/module/sharedConnectInvite
 */

import { TypedArrayEncoder } from '@credo-ts/core'
import type { Agent } from '@credo-ts/core'
import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'
import * as propose from '@openvtc/trust-tasks/vrc/relationships/propose/0.1/payload'
import type { tsp } from '@bifold/trust-tasks'

import { verifyDocumentProof } from '../documentProof'

import { didPrefix } from './didPrefix'
import { getKeyed, listKeyed, putKeyed } from './keyedRecords'
import { isChallengeShaped } from './sharedConnectCeremony'
import {
  SHARED_CONNECT_EXP_GRACE_MS,
  SHARED_CONNECT_INVITE_MAX_FRAMES,
  SHARED_CONNECT_INVITE_MAX_INVITES,
  SHARED_CONNECT_INVITE_TTL_SECONDS,
  SHARED_CONNECT_INVITER_MEDIATOR_DID,
} from './sharedConnectDecisions'
import { createEncounterDid, ENCOUNTER_LOG_PREFIX } from './sharedConnectEncounter'
import { isSharedConnectInviteEnabled, onSharedConnectInviteTurnedOff } from './sharedConnectFlag'
import { SharedConnectInviterCeremony } from './sharedConnectInviterCeremony'
import type { SharedConnectInviteFailure, SharedConnectInviteState } from './sharedConnectInviteTypes'
import { SHARED_CONNECT_FLOW, TRIGGER_LINK_HOST, uriHostAndPath } from './triggerLink'
import { isTspFrameUnopenable } from './tspFrameUnopenable'
import {
  answerInviteOverTsp,
  packTrustTaskForPeer,
  tspSessionForManager,
  unpackTrustTaskFromPeer,
  type TspSessionIdentity,
} from './vtiTsp'
import {
  resolveVtiMediator,
  VtiMediatorSession,
  vtiClientIdentityFromDid,
  type VtiMediatorEndpoints,
} from './VtiMediatorTransport'

// ---- the code -------------------------------------------------------------------------------------------------

/** The flow version this build writes into `_type`. */
export const SHARED_CONNECT_FLOW_VERSION = '0.1'

/** The characters a `did:peer:2` and a base64url `_id` are made of: nothing in a link needs escaping. */
const LINK_SAFE = /^[A-Za-z0-9._:-]+$/

/**
 * The trigger link for a code (dtgwg-vti-spec#86): `_from`, `_id`, `_exp`, `_type`. No `_label` (Alberto,
 * 2026-11-07): the scanner sees "no name given", which is the truth.
 */
export function buildSharedConnectLink(fields: { from: string; id: string; exp: number }): string {
  if (!LINK_SAFE.test(fields.from) || !isChallengeShaped(fields.id) || !Number.isInteger(fields.exp)) {
    throw new Error(`${ENCOUNTER_LOG_PREFIX} refusing to build a link from malformed fields`)
  }
  const type = `${uriHostAndPath(SHARED_CONNECT_FLOW)?.path}/${SHARED_CONNECT_FLOW_VERSION}`
  return `https://${TRIGGER_LINK_HOST}/t#_from=${fields.from}&_id=${fields.id}&_exp=${fields.exp}&_type=${type}`
}

/** A fresh `_id`: 16 random bytes, unpadded base64url (22 characters). Credo's encoder: the app's Buffer has no base64url. */
export function newInviteEnactment(randomBytes: (length: number) => Uint8Array): string {
  const bytes = randomBytes(16)
  if (bytes.length !== 16) throw new Error('newInviteEnactment needs 16 random bytes')
  return TypedArrayEncoder.toBase64Url(bytes)
}

// ---- the record -----------------------------------------------------------------------------------------------

/** One code, persisted. Identifiers only: never the link text or anything a scanner wrote. */
export interface InviteRecord {
  /** The code's `_id`, the ceremony's enactment, and the record's key. */
  enactment: string
  /** This code's encounter DID (`_from`). */
  myVid: string
  /** The relay, by DID. */
  relay: string
  /** `_exp`, seconds since the epoch. */
  exp: number
  state: SharedConnectInviteState
  failure?: SharedConnectInviteFailure
  /** The scanners whose relationship invite this code answered: the bound on relationships. */
  invited: string[]
  /** Frames opened for this code, counted before each is opened: the bound on work. Absent on older records: 0. */
  handled?: number
  /** The one accepted propose. Set once, never cleared. */
  accepted?: { theirVid: string; proposeId: string; revision?: tsp.TspRevision }
  createdAt: string
}

const RECORD_TYPE = 'sharedConnect'
const RECORD_KIND = 'invite'

const TERMINAL: ReadonlySet<SharedConnectInviteState> = new Set(['connected', 'expired', 'failed', 'cancelled'])
export const isTerminalInviteState = (state: SharedConnectInviteState): boolean => TERMINAL.has(state)

export const saveInvite = (agent: Agent, record: InviteRecord): Promise<void> =>
  putKeyed(agent, RECORD_TYPE, RECORD_KIND, record.enactment, record as unknown as Record<string, unknown>)

export const getInvite = (agent: Agent, enactment: string): Promise<InviteRecord | undefined> =>
  getKeyed<InviteRecord>(agent, RECORD_TYPE, RECORD_KIND, enactment)

// ---- what arrives ---------------------------------------------------------------------------------------------

/** A frame, opened. `none`: it opened (or never will) and holds nothing this code acts on. */
export type InboundFrame =
  | { kind: 'invite'; sender: string; digest: Uint8Array; revision?: tsp.TspRevision }
  | { kind: 'document'; sender: string; document: Record<string, unknown>; revision?: tsp.TspRevision }
  | { kind: 'none' }

/**
 * Open a TSP frame addressed to `myVid`. A relationship invite is reported with its verified digest; a Trust Task
 * with its sender (identity-checked by `unpackTrustTaskFromPeer`). A frame that can never be opened is `none` (the
 * session acknowledges it); anything transient throws, so the frame stays queued at the relay.
 */
export async function openInviterFrame(
  identity: TspSessionIdentity,
  myVid: string,
  bytes: Uint8Array
): Promise<InboundFrame> {
  let invite: { sender: string; digest: Uint8Array; revision?: tsp.TspRevision } | undefined
  let opened
  try {
    opened = await unpackTrustTaskFromPeer(identity, bytes, myVid, {
      onControl: (frame) => {
        if (frame.control.kind === 'invite')
          invite = { sender: frame.sender, digest: frame.control.digest, revision: frame.revision }
      },
    })
  } catch (error) {
    if (isTspFrameUnopenable(error)) return { kind: 'none' }
    throw error
  }
  if (opened) {
    return {
      kind: 'document',
      sender: opened.unpacked.sender,
      document: opened.plaintext.body as Record<string, unknown>,
      revision: opened.unpacked.revision,
    }
  }
  return invite ? { kind: 'invite', ...invite } : { kind: 'none' }
}

// ---- the standing rule ----------------------------------------------------------------------------------------

export type StandingVerdict = 'accept' | 'again' | 'drop'

export interface StandingInput {
  document: Record<string, unknown>
  /** The authenticated TSP sender. */
  sender: string
  myVid: string
  enactment: string
  exp: number
  nowSeconds: number
  /** Whether the document's proof verified under its issuer (checked for every propose, before this rule). */
  proofOk: boolean
  /** Whether the sender formed a relationship with this code first (its invite was answered). */
  related: boolean
  accepted?: InviteRecord['accepted']
  /** How long past `_exp` the accepted scanner may still re-send its propose (the encounter's grace). */
  graceSeconds: number
}

/**
 * §2.8, for a `propose` that arrived at a code: `accept` it (the first), answer it `again` (the same propose from the
 * same scanner, re-sent), or `drop` it. Every condition is evaluated; none short-circuits another.
 */
export function proposeStanding(input: StandingInput): StandingVerdict {
  const d = input.document
  const ceremony = d.ceremony as { enactment?: unknown } | undefined
  const shape = [
    d.type === propose.TYPE_URI,
    d.recipient === input.myVid,
    d.issuer === input.sender,
    ceremony?.enactment === input.enactment,
    isChallengeShaped(d.id),
    d.threadId === d.id,
    input.proofOk,
    input.related,
  ]
  const standing = shape.every(Boolean)
  const fresh = input.nowSeconds <= input.exp
  const withinGrace = input.nowSeconds <= input.exp + input.graceSeconds
  const first = input.accepted === undefined
  const same = input.accepted?.theirVid === input.sender && input.accepted?.proposeId === d.id
  if (standing && first && fresh) return 'accept'
  if (standing && same && withinGrace) return 'again'
  return 'drop'
}

// ---- the inviter ----------------------------------------------------------------------------------------------

/** What the inverse ceremony (a separate change) is handed. */
export interface InviterCeremony {
  /** The first accepted propose: ask the person, then answer. */
  onProposal(document: Record<string, unknown>, theirVid: string): void | Promise<void>
  /** The accepted propose, re-sent by its scanner: repeat whatever was answered. */
  onProposalAgain(document: Record<string, unknown>): void | Promise<void>
  /** A later document on the accepted thread, from the accepted scanner. Its proof is the ceremony's to check. */
  onDocument(document: Record<string, unknown>): void | Promise<void>
}

/** The effects the inviter needs: real ones by default, stand-ins in tests. */
export interface InviterDeps {
  now(): number
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
  persist(record: InviteRecord): Promise<void>
  open(bytes: Uint8Array): Promise<InboundFrame>
  sendAccept(theirVid: string, inviteDigest: Uint8Array, revision?: tsp.TspRevision): Promise<void>
  verifyProof(document: Record<string, unknown>, signer: string): Promise<boolean>
  /** Send a Trust Task document to a scanner, sealed in the given TSP version. */
  sendDocument(theirVid: string, document: Record<string, unknown>, revision?: tsp.TspRevision): Promise<void>
  /** Close the relay session. Called once, at the end. */
  stopRelay(): Promise<void>
}

const live = new Map<string, SharedConnectInviter>()

// The switch governs the function, not only the button (Alberto, 2026-11-07): turned off, every live code ends now.
onSharedConnectInviteTurnedOff(() => {
  for (const inviter of [...live.values()]) void inviter.cancel()
})

/** The live inviter for a code, for the consent sheet and the screen. */
export const getSharedConnectInviter = (enactment: string): SharedConnectInviter | undefined => live.get(enactment)

export class SharedConnectInviter {
  private ended?: SharedConnectInviteState
  private ending?: Promise<void>
  private expiryTimer?: unknown
  private graceTimer?: unknown
  private ceremony?: InviterCeremony
  private readonly listeners = new Set<(state: SharedConnectInviteState) => void>()
  /** The choke point's queue: every frame, one at a time, after the record is first persisted. */
  private inbound: Promise<void>
  /** The record's writes, serial. */
  private writes: Promise<void> = Promise.resolve()
  private readonly ready: Promise<void>
  private markReady!: () => void

  constructor(
    private readonly agent: Agent,
    private readonly record: InviteRecord,
    private readonly deps: InviterDeps
  ) {
    this.ready = new Promise((resolve) => (this.markReady = resolve))
    this.inbound = this.ready
  }

  get enactment(): string {
    return this.record.enactment
  }

  get state(): SharedConnectInviteState {
    return this.record.state
  }

  get failure(): SharedConnectInviteFailure | undefined {
    return this.record.failure
  }

  /** A copy of the record, for tests and the screen. */
  snapshot(): InviteRecord {
    return { ...this.record, invited: [...this.record.invited] }
  }

  attach(ceremony: InviterCeremony): void {
    this.ceremony = ceremony
  }

  /** Be told each state. Returns the way to stop listening; all listeners go at the end. */
  subscribe(listener: (state: SharedConnectInviteState) => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  /** Persist the record, register the code and arm its expiry. Frames admitted before this resolves wait for it. */
  async start(): Promise<void> {
    await this.write()
    live.set(this.record.enactment, this)
    this.armExpiry()
    this.markReady()
  }

  /** The relay session is open: the code can be shown. */
  async showing(): Promise<void> {
    if (this.ended || this.record.state !== 'minting') return
    await this.setState('waiting')
  }

  /**
   * THE choke point: every inbound frame. Resolves when the frame was handled or dropped; rejects only for a
   * transient failure to open it, so the relay keeps it queued.
   */
  admit(bytes: Uint8Array): Promise<void> {
    const handled = this.inbound.then(() => this.admitOne(bytes))
    this.inbound = handled.catch(() => undefined)
    return handled
  }

  /** The accepted scanner and its propose, once there is one. */
  get acceptedPeer(): InviteRecord['accepted'] {
    return this.record.accepted ? { ...this.record.accepted } : undefined
  }

  get myVid(): string {
    return this.record.myVid
  }

  get exp(): number {
    return this.record.exp
  }

  /**
   * Send a document to the accepted scanner, in the TSP version its propose came in. Nothing goes out after the end
   * or before an acceptance: the ceremony has no one else to write to.
   */
  async send(document: Record<string, unknown>): Promise<void> {
    const peer = this.record.accepted
    if (this.ended || !peer) throw new Error(`${ENCOUNTER_LOG_PREFIX} inviter has no live scanner to send to`)
    await this.deps.sendDocument(peer.theirVid, document, peer.revision)
  }

  /** The ceremony moved the code on (`connecting`, `connected`), or ended it. */
  async advance(state: 'connecting' | 'connected'): Promise<void> {
    if (this.ended) return
    if (state === 'connected') return this.end('connected')
    await this.setState('connecting')
  }

  /** The person declined, or the ceremony failed. */
  fail(failure: SharedConnectInviteFailure): Promise<void> {
    return this.end('failed', failure)
  }

  /** The screen went away, or the person tapped Cancel. Safe in every state, any number of times. */
  cancel(): Promise<void> {
    return this.end('cancelled')
  }

  /**
   * The one way a code ends. The first call names the ending; every later call (expiry and cancel both firing, a
   * second cancel) returns the same promise and changes nothing.
   */
  end(state: SharedConnectInviteState, failure?: SharedConnectInviteFailure): Promise<void> {
    if (this.ending) return this.ending
    this.ended = state
    this.clearTimers()
    // Frames queued behind a start that never finished are released: each sees the end and is dropped unopened.
    this.markReady()
    this.ending = (async () => {
      this.record.state = state
      if (failure) this.record.failure = failure
      await this.write().catch(() => undefined)
      await this.deps.stopRelay().catch(() => undefined)
      if (live.get(this.record.enactment) === this) live.delete(this.record.enactment)
      this.log(`code ended: ${state}${failure ? ` (${failure})` : ''}`)
      this.notify(state)
      this.listeners.clear()
      this.ceremony = undefined
    })()
    return this.ending
  }

  // ---- inbound ------------------------------------------------------------------------------------------------

  private async admitOne(bytes: Uint8Array): Promise<void> {
    if (this.ended) return // after the end: dropped, unopened
    // Read on every frame, not only at the start: a code running while the switch is off (one rebuilt from its stored
    // record, say) answers nothing. The frame is dropped unopened, and the code ends.
    if (!isSharedConnectInviteEnabled()) {
      this.drop('frame (switched off)')
      await this.cancel()
      return
    }
    // The work budget: counted and written before the frame is opened, so neither a restart nor a write that fails
    // lets a frame be opened uncounted. Past it, dropped unopened, like every other drop.
    const r = this.record
    const handled = r.handled ?? 0
    if (handled >= SHARED_CONNECT_INVITE_MAX_FRAMES) {
      // Dropped unopened, like every other drop; and the code ends, so the screen can say "make a new code" instead
      // of showing a code that will never answer again. A prober sees the same silence either way.
      this.drop('frame (over the budget)')
      await this.end('failed', 'exhausted')
      return
    }
    r.handled = handled + 1
    if (!(await this.writeOrDrop())) {
      r.handled = handled
      return
    }
    const frame = await this.deps.open(bytes)
    // The code may have ended while the frame was opened (expiry, cancel, the switch): nothing more is written or sent.
    if (this.ended) return
    if (frame.kind === 'invite') return this.onInvite(frame)
    if (frame.kind === 'document') return this.onDocument(frame)
    // `none`: nothing for this code (an accept, a cancel, an unreadable frame). Dropped.
  }

  private async onInvite(frame: Extract<InboundFrame, { kind: 'invite' }>): Promise<void> {
    const r = this.record
    const known = r.invited.includes(frame.sender)
    const nowSeconds = Math.floor(this.deps.now() / 1000)
    const isAccepted = r.accepted?.theirVid === frame.sender
    const open = nowSeconds <= r.exp || (isAccepted && nowSeconds <= r.exp + SHARED_CONNECT_EXP_GRACE_MS / 1000)
    // A new scanner needs a free slot, and none is given once a propose was accepted (one connection per code).
    const newSlot = !known && r.accepted === undefined && r.invited.length < SHARED_CONNECT_INVITE_MAX_INVITES
    if (!open || !(known || newSlot)) return this.drop('invite')
    if (newSlot) {
      r.invited.push(frame.sender)
      // Recorded before it is answered: an answered invite is always a counted one. Unrecorded, it is not answered
      // and not counted either, so memory never holds a count the store does not.
      if (!(await this.writeOrDrop())) {
        r.invited = r.invited.filter((vid) => vid !== frame.sender)
        return
      }
    }
    if (this.ended) return
    await this.deps.sendAccept(frame.sender, frame.digest, frame.revision).catch(() => undefined)
    this.log(
      known ? 'invite answered again' : `invite answered (${r.invited.length} of ${SHARED_CONNECT_INVITE_MAX_INVITES})`
    )
  }

  private async onDocument(frame: Extract<InboundFrame, { kind: 'document' }>): Promise<void> {
    const r = this.record
    const d = frame.document
    if (d.type === propose.TYPE_URI) {
      // The same work for every propose, whatever the verdict: the proof is checked before the rule is read.
      const proofOk = await this.deps.verifyProof(d, frame.sender).catch(() => false)
      const verdict = proposeStanding({
        document: d,
        sender: frame.sender,
        myVid: r.myVid,
        enactment: r.enactment,
        exp: r.exp,
        nowSeconds: Math.floor(this.deps.now() / 1000),
        proofOk,
        related: r.invited.includes(frame.sender),
        accepted: r.accepted,
        graceSeconds: SHARED_CONNECT_EXP_GRACE_MS / 1000,
      })
      if (verdict === 'drop' || this.ended) return this.drop('propose')
      if (verdict === 'again') {
        await this.ceremony?.onProposalAgain(d)
        return
      }
      const before = r.state
      r.accepted = { theirVid: frame.sender, proposeId: String(d.id), revision: frame.revision }
      r.state = 'proposed'
      // Persisted before anything answers it: a restart, or a second propose racing this one, sees it spent.
      if (!(await this.writeOrDrop())) {
        r.accepted = undefined
        r.state = before
        return
      }
      this.log('propose accepted')
      this.notify('proposed')
      await this.ceremony?.onProposal(d, frame.sender)
      return
    }
    // Anything else belongs to the accepted thread, from the accepted scanner, or to nobody.
    const ceremony = d.ceremony as { enactment?: unknown } | undefined
    const onThread =
      r.accepted !== undefined &&
      frame.sender === r.accepted.theirVid &&
      d.threadId === r.accepted.proposeId &&
      ceremony?.enactment === r.enactment &&
      d.recipient === r.myVid
    if (!onThread || this.ended) return this.drop('document')
    await this.ceremony?.onDocument(d)
  }

  /** Every refusal ends here: a log line with a reason class, and nothing sent. */
  private drop(what: 'invite' | 'propose' | 'document' | 'frame (switched off)' | 'frame (over the budget)'): void {
    this.log(`dropped a ${what}`)
  }

  // ---- state, timers, writes ----------------------------------------------------------------------------------

  private armExpiry() {
    const at = this.record.exp * 1000 - this.deps.now()
    this.expiryTimer = this.deps.setTimer(() => void this.onExpiry(), Math.max(at, 0))
  }

  private async onExpiry() {
    this.expiryTimer = undefined
    if (this.ended) return
    if (this.record.state === 'minting' || this.record.state === 'waiting') return this.end('expired')
    // Accepted before `_exp`: the exchange may finish within the grace the scanner side keeps too.
    this.graceTimer = this.deps.setTimer(() => {
      this.graceTimer = undefined
      void (this.record.state === 'connecting' ? this.end('failed', 'unknown') : this.end('expired'))
    }, SHARED_CONNECT_EXP_GRACE_MS)
  }

  private clearTimers() {
    if (this.expiryTimer !== undefined) this.deps.clearTimer(this.expiryTimer)
    if (this.graceTimer !== undefined) this.deps.clearTimer(this.graceTimer)
    this.expiryTimer = undefined
    this.graceTimer = undefined
  }

  private async setState(state: SharedConnectInviteState) {
    this.record.state = state
    await this.write().catch(() => undefined)
    this.notify(state)
  }

  /** Queue a write of the record as it is now. The record's only writer. */
  private write(): Promise<void> {
    const snapshot = this.snapshot()
    const done = this.writes.then(() => this.deps.persist(snapshot))
    this.writes = done.catch(() => undefined)
    return done
  }

  /** Write, or drop the frame being handled if the write fails (nothing is answered on an unrecorded count). */
  private async writeOrDrop(): Promise<boolean> {
    try {
      await this.write()
      return true
    } catch {
      this.log('could not record the code; frame dropped')
      return false
    }
  }

  private notify(state: SharedConnectInviteState) {
    for (const listener of [...this.listeners]) {
      try {
        listener(state)
      } catch {
        // a watcher's failure is not the code's
      }
    }
  }

  private log(message: string) {
    this.agent.config.logger.info(`${ENCOUNTER_LOG_PREFIX} inviter ${message} (${didPrefix(this.record.myVid)})`)
  }
}

// ---- making a code --------------------------------------------------------------------------------------------

/** The steps that reach out, injectable so tests stay off the network. */
export interface CreateInviteDeps {
  resolveMediator: (agent: Agent, mediatorDid: string) => Promise<VtiMediatorEndpoints>
  createDid: typeof createEncounterDid
  tspIdentity: (agent: Agent, myVid: string) => Promise<TspSessionIdentity>
  /** Open the relay session as `myVid`; inbound frames go to `onTspFrame`. */
  openRelay: (
    agent: Agent,
    myVid: string,
    mediator: VtiMediatorEndpoints,
    handlers: {
      onTspFrame: (bytes: Uint8Array) => Promise<void>
      onMessage: (plaintext: DidCommV2PlaintextMessage) => Promise<void>
    }
  ) => Promise<InviterRelay>
  persist: (agent: Agent, record: InviteRecord) => Promise<void>
}

/** The relay surface the inviter uses. */
export interface InviterRelay {
  start(): Promise<void>
  stop(): Promise<void>
  sendTspFrame(bytes: Uint8Array): Promise<void>
}

const defaultCreateDeps: CreateInviteDeps = {
  resolveMediator: resolveVtiMediator,
  createDid: createEncounterDid,
  tspIdentity: tspSessionForManager,
  openRelay: async (agent, myVid, mediator, handlers) =>
    new VtiMediatorSession(agent, await vtiClientIdentityFromDid(agent, myVid), mediator, handlers) as InviterRelay,
  persist: saveInvite,
}

export type CreateInviteResult =
  | { kind: 'showing'; inviter: SharedConnectInviter; link: string; exp: number }
  /** The inviter is switched off: nothing was minted, logged in to or written. */
  | { kind: 'off' }
  | { kind: 'failed'; failure: Extract<SharedConnectInviteFailure, 'relay' | 'unknown'> }

/**
 * Make a code: mint the encounter DID on the inviter relay, keep the record, open the relay session as that DID,
 * and return the link to show. Throws nothing: a failure is `failed`, with nothing left behind.
 */
export async function createSharedConnectInvite(
  agent: Agent,
  options: {
    ttlSeconds?: number
    now?: () => number
    deps?: Partial<CreateInviteDeps>
    inviterDeps?: Partial<InviterDeps>
    /** The ceremony an accepted propose is handed to; the inverse ceremony by default. */
    ceremony?: (inviter: SharedConnectInviter) => InviterCeremony
  } = {}
): Promise<CreateInviteResult> {
  if (!isSharedConnectInviteEnabled()) return { kind: 'off' }
  const deps = { ...defaultCreateDeps, ...options.deps }
  const now = options.now ?? (() => Date.now())
  const ttl = Math.max(
    1,
    Math.min(Math.floor(options.ttlSeconds ?? SHARED_CONNECT_INVITE_TTL_SECONDS), SHARED_CONNECT_INVITE_TTL_SECONDS)
  )
  let mediator: VtiMediatorEndpoints
  let myVid: string
  let identity: TspSessionIdentity
  try {
    mediator = await deps.resolveMediator(agent, SHARED_CONNECT_INVITER_MEDIATOR_DID)
    myVid = await deps.createDid(agent, mediator, { tsp: true })
    identity = await deps.tspIdentity(agent, myVid)
  } catch (error) {
    agent.config.logger.debug(
      `${ENCOUNTER_LOG_PREFIX} inviter could not mint a code: ${error instanceof Error ? error.name : 'error'}`
    )
    return { kind: 'failed', failure: 'relay' }
  }
  const exp = Math.floor(now() / 1000) + ttl
  const record: InviteRecord = {
    enactment: newInviteEnactment((length) => agent.kms.randomBytes({ length })),
    myVid,
    relay: SHARED_CONNECT_INVITER_MEDIATOR_DID,
    exp,
    state: 'minting',
    invited: [],
    createdAt: new Date(now()).toISOString(),
  }
  const relayRef: { current?: InviterRelay } = {}
  const inviter = new SharedConnectInviter(agent, record, {
    now,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    persist: (r) => deps.persist(agent, r),
    open: (bytes) => openInviterFrame(identity, myVid, bytes),
    sendAccept: async (theirVid, digest, revision) => {
      const packed = await answerInviteOverTsp(identity, myVid, theirVid, digest, revision)
      await relayRef.current?.sendTspFrame(packed.bytes)
    },
    verifyProof: (document, signer) => verifyDocumentProof(agent, document, signer),
    sendDocument: async (theirVid, document, revision) => {
      const packed = await packTrustTaskForPeer(identity, myVid, theirVid, document, revision)
      if (!relayRef.current) throw new Error(`${ENCOUNTER_LOG_PREFIX} inviter relay is closed`)
      await relayRef.current.sendTspFrame(packed.bytes)
    },
    stopRelay: async () => {
      await relayRef.current?.stop()
      relayRef.current = undefined
    },
    ...options.inviterDeps,
  })
  inviter.attach((options.ceremony ?? ((i) => new SharedConnectInviterCeremony(agent, i)))(inviter))
  try {
    await inviter.start()
    // Switched off while the DID was minted: end here, before any relay login.
    if (!isSharedConnectInviteEnabled()) {
      await inviter.cancel()
      return { kind: 'off' }
    }
    relayRef.current = await deps.openRelay(agent, myVid, mediator, {
      onTspFrame: (bytes) => inviter.admit(bytes),
      // This code speaks TSP: a DIDComm message to it is not read, and not answered.
      onMessage: async () => undefined,
    })
    await relayRef.current.start()
    // Ended while the relay was opening (switched off, cancelled). If the end ran before the relay was handed back,
    // it had nothing to stop: stop it here. If after, the end already stopped it and cleared the handle.
    if (isTerminalInviteState(inviter.state)) {
      await relayRef.current?.stop().catch(() => undefined)
      relayRef.current = undefined
      return isSharedConnectInviteEnabled() ? { kind: 'failed', failure: 'unknown' } : { kind: 'off' }
    }
  } catch (error) {
    agent.config.logger.debug(
      `${ENCOUNTER_LOG_PREFIX} inviter could not open the relay: ${error instanceof Error ? error.name : 'error'}`
    )
    await inviter.end('failed', 'relay')
    return { kind: 'failed', failure: 'relay' }
  }
  await inviter.showing()
  return { kind: 'showing', inviter, link: buildSharedConnectLink({ from: myVid, id: record.enactment, exp }), exp }
}

/**
 * A code whose phone stopped (the app was closed while it showed) is never read again: mark it `cancelled`, so no
 * record says `waiting` for a code nobody listens on. Codes live in this process are left alone.
 */
export async function sweepStaleInvites(agent: Agent): Promise<number> {
  const records = await listKeyed<InviteRecord>(agent, RECORD_TYPE, RECORD_KIND)
  let swept = 0
  for (const record of records) {
    if (isTerminalInviteState(record.state) || live.has(record.enactment)) continue
    await saveInvite(agent, { ...record, state: 'cancelled' })
    swept += 1
  }
  return swept
}
