/**
 * The agent chat's control messages and the VDC acceptance (plan §3.4, §3.9, §7.9; backlog 2, fb-C3).
 *
 * The six control types of the vectors (`connected-agents/vectors/control-messages.json`, version 1), each signed and
 * checked as an envelope (`./envelope.ts`, fb-C2) and carried by the chat carrier (`./carrier.ts`, fb-C1):
 *
 * | Type | Direction | What Keyring does |
 * |---|---|---|
 * | `keyring/agent/settings/1.0` | to the agent | {@link AgentControl.sendSettings}, on a change of `answersOthers`; newest wins |
 * | `keyring/agent/room-offer/1.0` | to the agent | {@link AgentControl.sendRoomOffer} (P1 rooms: built, no caller yet) |
 * | `keyring/agent/revoked/1.0` | to the agent | {@link AgentControl.tellAgent}, `revokeAgentConnection`'s `tellAgent`; intent first |
 * | `keyring/agent/vdc-grant/1.0` | to the agent | {@link AgentControl.sendVdcGrant}, the stored `vdcGrant`; intent first |
 * | `keyring/agent/vdc-acceptance/1.0` | from the agent | checked with `verifyVdcPair`; on `ok` stored as `vdcAcceptance` |
 * | `keyring/agent/heartbeat/1.0` | from the agent | records `lastHeartbeatAt` |
 *
 * **On the wire.** One DIDComm v2 plaintext per envelope: its `type` is the envelope's `type`, its `id` the envelope's
 * `id` (so a resend keeps both), and its `body` the signed envelope itself. The receiver checks the envelope, never
 * the DIDComm members around it (decided here; the plugin reads the same, recorded in the PR).
 *
 * **Intent before the send.** The revoked message and the grant cannot be taken back, so each is written as an intent
 * record (one per agent and type, in keyed records) before it is signed and handed to the carrier, and marked sent
 * after the carrier answers `sent`. A crash between the two leaves an intent not marked sent, which
 * {@link AgentControl.resendPending} sends again with the same envelope `id`; a copy the agent already had is
 * `repeated` there and does nothing. A re-issued grant is a new document with a new `id`; a resend of one grant keeps
 * its `id`. The settings and the room offer need no intent: the newest wins, and a lost one is replaced by the next.
 *
 * **Newest wins.** For the two state types the receiver refuses a document not newer than the last it applied, and an
 * envelope's `issuedAt` is in whole seconds. So two settings sent within one second would make the second
 * `olderState`: each state send is stamped at least one second after the last of its type sent to that agent.
 *
 * **Receiving.** {@link AgentControl.start} listens on the carrier. Each inbound message's `body` goes through
 * `receiveEnvelope` with the record's `chatDid` as receiver and its `agentDid` as issuer, so its id is recorded before
 * anything acts. An act that throws releases the id and the carrier withholds the acknowledgement, leaving the message
 * at the mediator for the next drain; a refusal returns and keeps it spent.
 *
 * - **The acceptance** (step 7.9, the release gate's condition): `verifyVdcPair({ grant, acceptance, ownerPersonaDid,
 *   agentDid, entryExpiresAt, verify })` against the stored grant. On `ok` the acceptance is stored with
 *   `store.update`, only while the record still holds that same grant. **Decided in the brief:** a refused acceptance is
 *   recorded as its reason ({@link AgentControl.lastAcceptanceRefusal}) and leaves the record as it was.
 * - **Liveness:** a heartbeat records `lastHeartbeatAt`; a chat reply, and an acceptance that is stored, record
 *   `lastReplyAt` (a refused acceptance writes nothing on the record). Each is the document's `issuedAt`, never later than the receiver's now and never
 *   moved back, so a heartbeat drained late from the mediator's queue does not read as fresh. {@link connectionState}
 *   is `notConnected` when neither came within 20 minutes (the plugin beats every 10).
 * - **Chat** (`keyring/chat/1.0`) is handed to the listeners of {@link AgentControl.onChat} (fb-C4's hook). With none
 *   listening it throws, so the message stays queued, as the carrier does with no handler.
 * - A type Keyring only sends (settings, room offer, revoked, grant) arriving here is `notForKeyring`, and nothing acts.
 *
 * `lastHeartbeatAt` and `lastReplyAt` are written onto the agent's record beside §3.11's members ({@link ChatLiveness});
 * `types.ts` is not this part's to edit, so they are declared here, and every other writer spreads the record and keeps
 * them.
 *
 * **Who calls it (not wired here; fb-C3 writes no existing file).** One `AgentControl` per app, built beside the
 * carrier and started with the connected-agents services (fb-W1's `ConnectedAgentsRoot` / `connectedAgentsServices`),
 * stopped with them:
 * - `tellAgent` is `useRevokeDeps()`'s `tellAgent` (fb-W1's hook, in `ConnectedAgentsProvider.tsx`);
 * - `sendVdcGrant(id)` must run after the driver stores a connection's grant (`driver.ts`) and after each re-issue
 *   (`reissueDueGrants`, `vdcReissue.ts`, for every id in its `reissued`);
 * - `sendSettings(id)` after each change of `answersOthers`;
 * - `resendPending()`, the repair, at app start: `services.reconcile`, as its own step, after `reconcileAgents`;
 * - `sendRoomOffer` has no caller until P1's rooms.
 *
 * @module connected-agents/chat/control
 */
import type { Agent } from '@credo-ts/core'
import { taskDigestMultibase } from '@bifold/trust-tasks'

import { verifyDocumentProof } from '../../trust-tasks/documentProof'
import { deleteKeyed, getKeyed, listKeyed, putKeyed, withKeyLock } from '../../trust-tasks/module/keyedRecords'
import type { AgentConnectionStore } from '../store'
import type { AgentConnection } from '../types'
import { type VdcProblem, type VdcProofVerifier, verifyVdcPair } from '../vdc'
import type { AgentChatCarrier, AgentChatInbound, CarrierResult } from './carrier'
import { type ChatIdentityKms, ensureChatIdentity } from './chatIdentity'
import {
  buildEnvelope,
  ENVELOPE_TYPE,
  envelopeBaseType,
  type EnvelopeRefusal,
  type EnvelopeType,
  newEnvelopeId,
  receiveEnvelope,
  type SignedEnvelope,
  signEnvelope,
  type UnsignedEnvelope,
} from './envelope'
import type { SeenIdStore } from './seenIds'

export const LOG_PREFIX = '[ConnectedAgents:ChatControl]'

/** "Not connected right now" after this long with neither a heartbeat nor a reply (the plugin beats every 10 min). */
export const LIVENESS_WINDOW_MS = 20 * 60 * 1000

/** How far apart two state documents of one type to one agent are stamped: the envelope's `issuedAt` resolution. */
const STATE_STEP_MS = 1000

const RECORD_TYPE = 'keyring/agent-control'
const INTENT = 'intent'
const LAST_SENT = 'last-sent'
const ACCEPTANCE_REFUSAL = 'acceptance-refusal'

/**
 * The acceptance's type, spelled out: the release gate (`__tests__/releaseGate.test.ts`) counts step 7.9 as wired only
 * in a file whose code (not its comments) names this type and calls `verifyVdcPair`. A test holds it equal to
 * `ENVELOPE_TYPE.vdcAcceptance`.
 */
export const VDC_ACCEPTANCE_TYPE = 'keyring/agent/vdc-acceptance/1.0'

/** The base type (without its version) of each control type, as `envelopeBaseType` gives it. */
const BASE = {
  chat: envelopeBaseType(ENVELOPE_TYPE.chat),
  settings: envelopeBaseType(ENVELOPE_TYPE.settings),
  roomOffer: envelopeBaseType(ENVELOPE_TYPE.roomOffer),
  revoked: envelopeBaseType(ENVELOPE_TYPE.revoked),
  vdcGrant: envelopeBaseType(ENVELOPE_TYPE.vdcGrant),
  vdcAcceptance: envelopeBaseType(VDC_ACCEPTANCE_TYPE),
  heartbeat: envelopeBaseType(ENVELOPE_TYPE.heartbeat),
} as const

/** What the chat adds to an agent's record (§3.11 has `lastSeenAt`; the brief names these two). ISO instants. */
export type ChatLiveness = {
  /** The `issuedAt` of the newest heartbeat accepted, capped at its receipt. */
  lastHeartbeatAt?: string
  /** The `issuedAt` of the newest other document accepted from the agent (a chat reply, the acceptance), capped. */
  lastReplyAt?: string
}

export type LiveAgentConnection = AgentConnection & ChatLiveness

/** Whether the agent has been heard from lately: §6's "Not connected right now" is `notConnected`. */
export type ChatConnectionState = 'connected' | 'notConnected'

/**
 * `connected` when a heartbeat or a reply came within the last 20 minutes at `now`, else `notConnected` (also when
 * neither ever came). A time ahead of `now` counts as now.
 */
export function connectionState(record: LiveAgentConnection, now: number | Date): ChatConnectionState {
  const at = typeof now === 'number' ? now : now.getTime()
  const heard = Math.max(instant(record.lastHeartbeatAt), instant(record.lastReplyAt))
  return heard !== -Infinity && at - Math.min(heard, at) <= LIVENESS_WINDOW_MS ? 'connected' : 'notConnected'
}

const instant = (iso: string | undefined): number => {
  const ms = iso === undefined ? NaN : Date.parse(iso)
  return Number.isFinite(ms) ? ms : -Infinity
}

/** What this part needs of the carrier: {@link AgentChatCarrier} in the app, a fake in tests. */
export type ControlCarrier = Pick<AgentChatCarrier, 'send' | 'onMessage'>

export interface AgentControlDeps {
  /** Signs as `chatDid` and resolves the agent's `did:key`. */
  agent: Agent
  store: AgentConnectionStore
  kms: ChatIdentityKms
  carrier: ControlCarrier
  /** Keyring's seen ids and applied state, as receiver (`KeyedSeenIdStore` in the app). */
  seen: SeenIdStore
  /** The VDC proofs' check. Default: `verifyDocumentProof` for `assertionMethod` by the expected controller. */
  verifyVdc?: VdcProofVerifier
  now?: () => number
}

/** A send's outcome: the carrier's result, and the envelope id it carried. */
export type ControlSendResult = CarrierResult & { envelopeId: string }

/** Why a send was not attempted: no record, or (for the grant) no grant stored or the agent not `active`. */
export type ControlSendSkipped = { result: 'noRecord' } | { result: 'noGrant' } | { result: 'notActive' }

/** A room offer's members (the vectors' `room-offer`): P1 rooms. */
export type RoomOffer = {
  roomId: string
  hostDid: string
  tier: string
  handleToMention?: string
  contexts?: string[]
}

/** Why an acceptance was refused: `verifyVdcPair`'s reason, or the record's state. */
export type AcceptanceRefusalReason =
  | VdcProblem
  /** The record holds no grant to accept. */
  | 'noGrant'
  /** The record is not `active` (revoking, revoked, expired, or still pairing). */
  | 'notActive'
  /** The record's grant changed (a re-issue) while the acceptance was checked: it accepts the grant before. */
  | 'grantMoved'

/** A refused acceptance as recorded: its reason, the envelope that carried it, and when. */
export type AcceptanceRefusal = { agentId: string; envelopeId: string; reason: AcceptanceRefusalReason; at: string }

/** What one inbound message came to. */
export type ControlReceipt =
  | { result: 'noRecord'; chatDid: string }
  | { result: 'refused'; agentId: string; refusal: EnvelopeRefusal; detail: string }
  | { result: 'heartbeat'; agentId: string; at: string }
  | { result: 'accepted'; agentId: string }
  | { result: 'acceptanceRefused'; agentId: string; reason: AcceptanceRefusalReason }
  | { result: 'chat'; agentId: string }
  | { result: 'notForKeyring'; agentId: string; type: string }

/** A `keyring/chat/1.0` envelope from an agent, checked; for fb-C4. */
export type AgentChatEnvelope = { agentId: string; record: LiveAgentConnection; envelope: SignedEnvelope }
export type AgentChatListener = (message: AgentChatEnvelope) => void | Promise<void>
export type ControlListener = (receipt: ControlReceipt) => void

/** An intent: what Keyring is about to send, written before the send. One per agent and type. */
interface ControlIntent extends Record<string, unknown> {
  agentId: string
  type: EnvelopeType
  id: string
  payload: Record<string, unknown>
  /** For the grant: the digest of the grant this intent carries, so a re-issue is a new document. */
  grantDigest?: string
  writtenAt: string
  sentAt?: string
}

interface LastSent extends Record<string, unknown> {
  at: number
}

const intentKey = (agentId: string, base: string) => `${agentId} ${base}`
const iso = (ms: number) => new Date(ms).toISOString()

/**
 * The control messages for every connected agent on this phone: the sends, the intents and their repair, and the
 * receiving side for the carrier.
 */
export class AgentControl {
  private readonly chatListeners = new Set<AgentChatListener>()
  private readonly listeners = new Set<ControlListener>()
  private unsubscribe?: () => void

  public constructor(private readonly deps: AgentControlDeps) {}

  private get now(): number {
    return (this.deps.now ?? Date.now)()
  }

  // ---- receiving -------------------------------------------------------------------------------------------------

  /** Listen on the carrier. Idempotent; {@link stop} ends it. */
  public start(): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.deps.carrier.onMessage((inbound) => this.receive(inbound).then(() => undefined))
  }

  public stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }

  /** Hand every checked chat envelope to `listener` (fb-C4). Returns the unsubscribe. */
  public onChat(listener: AgentChatListener): () => void {
    this.chatListeners.add(listener)
    return () => {
      this.chatListeners.delete(listener)
    }
  }

  /** Every inbound message's {@link ControlReceipt}, refusals included (fb-C4 reads `versionMismatch` here). */
  public onReceipt(listener: ControlListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * One inbound message: checked as an envelope from the record's agent to its `chatDid`, then acted on by type.
   * Throws only when the act throws (a store failure, or chat with no listener), which releases the id and leaves the
   * message queued.
   */
  public async receive(inbound: AgentChatInbound): Promise<ControlReceipt> {
    const record = inbound.record
    if (!record || record.chatDid !== inbound.chatDid) {
      // Nobody here to verify it against: dropped (and acknowledged), never acted on.
      return this.emit({ result: 'noRecord', chatDid: inbound.chatDid })
    }
    const nowMs = this.now
    const { check, acted } = await receiveEnvelope(
      this.deps.agent,
      inbound.plaintext.body,
      { receiver: inbound.chatDid, issuer: record.agentDid, seen: this.deps.seen, now: new Date(nowMs) },
      (envelope) => this.act(record, envelope, nowMs)
    )
    if (check.result !== 'ok') {
      this.deps.agent.config.logger.info(`${LOG_PREFIX} refused a document from ${record.id}: ${check.result}`)
      return this.emit({ result: 'refused', agentId: record.id, refusal: check.result, detail: check.detail })
    }
    return this.emit(acted as ControlReceipt)
  }

  private emit(receipt: ControlReceipt): ControlReceipt {
    for (const listener of [...this.listeners]) {
      try {
        listener(receipt)
      } catch {
        // A listener's failure is its own; the message was handled.
      }
    }
    return receipt
  }

  private async act(record: AgentConnection, envelope: SignedEnvelope, nowMs: number): Promise<ControlReceipt> {
    const base = envelopeBaseType(envelope.type)
    const heardAt = iso(Math.min(Date.parse(envelope.issuedAt), nowMs))
    if (base === BASE.heartbeat) {
      await this.heard(record.id, 'lastHeartbeatAt', heardAt)
      return { result: 'heartbeat', agentId: record.id, at: heardAt }
    }
    if (base === BASE.vdcAcceptance) {
      const receipt = await this.acceptance(record, envelope)
      // A refused acceptance leaves the record as it was (decided in the brief), its liveness included.
      if (receipt.result === 'accepted') await this.heard(record.id, 'lastReplyAt', heardAt)
      return receipt
    }
    if (base === BASE.chat) {
      if (this.chatListeners.size === 0) throw new Error(`${LOG_PREFIX} no chat listener for ${record.id}`)
      const current = ((await this.deps.store.get(record.id)) ?? record) as LiveAgentConnection
      for (const listener of [...this.chatListeners]) {
        await listener({ agentId: record.id, record: current, envelope })
      }
      await this.heard(record.id, 'lastReplyAt', heardAt)
      return { result: 'chat', agentId: record.id }
    }
    // The rest are the types Keyring only sends (`receiveEnvelope` refuses one it does not know, `unknownType`).
    return { result: 'notForKeyring', agentId: record.id, type: envelope.type }
  }

  /** Move a liveness time forward, never back. */
  private async heard(id: string, member: keyof ChatLiveness, at: string): Promise<void> {
    await this.deps.store.update(id, (r) => {
      const live = r as LiveAgentConnection
      if (instant(live[member]) >= Date.parse(at)) return r
      const next: LiveAgentConnection = { ...live, [member]: at }
      return next
    })
  }

  /** The acceptance (step 7.9): verified as a pair with the stored grant; stored on `ok`, else recorded as refused. */
  private async acceptance(record: AgentConnection, envelope: SignedEnvelope): Promise<ControlReceipt> {
    const refuse = async (reason: AcceptanceRefusalReason): Promise<ControlReceipt> => {
      const refusal: AcceptanceRefusal = { agentId: record.id, envelopeId: envelope.id, reason, at: iso(this.now) }
      await putKeyed(this.deps.agent, RECORD_TYPE, ACCEPTANCE_REFUSAL, record.id, refusal)
      this.deps.agent.config.logger.info(`${LOG_PREFIX} the VDC acceptance from ${record.id} was refused: ${reason}`)
      return { result: 'acceptanceRefused', agentId: record.id, reason }
    }
    // The record as it stands now, not as the carrier read it on delivery.
    const current = (await this.deps.store.get(record.id)) ?? record
    if (current.state !== 'active') return refuse('notActive')
    const grant = current.vdcGrant
    if (!grant) return refuse('noGrant')
    const acceptance = envelope.payload.vdc
    const check = await verifyVdcPair({
      grant,
      acceptance,
      ownerPersonaDid: current.ownerPersonaDid,
      agentDid: current.agentDid,
      entryExpiresAt: current.expiresAt,
      verify: this.deps.verifyVdc ?? this.defaultVdcVerifier,
    })
    if (!check.ok) return refuse(check.reason)
    const digest = taskDigestMultibase(grant)
    let stored = false
    await this.deps.store.update(current.id, (r) => {
      if (r.state !== 'active' || !r.vdcGrant || taskDigestMultibase(r.vdcGrant) !== digest) return r
      stored = true
      return { ...r, vdcAcceptance: acceptance as Record<string, unknown> }
    })
    if (!stored) return refuse('grantMoved')
    await deleteKeyed(this.deps.agent, RECORD_TYPE, ACCEPTANCE_REFUSAL, record.id).catch(() => undefined)
    return { result: 'accepted', agentId: record.id }
  }

  private readonly defaultVdcVerifier: VdcProofVerifier = (credential, controller) =>
    verifyDocumentProof(this.deps.agent, credential, controller, { proofPurpose: 'assertionMethod' })

  /** The last refused acceptance from agent `id` since the last one stored, if any. */
  public lastAcceptanceRefusal(id: string): Promise<AcceptanceRefusal | undefined> {
    return getKeyed<AcceptanceRefusal>(this.deps.agent, RECORD_TYPE, ACCEPTANCE_REFUSAL, id)
  }

  // ---- sending ---------------------------------------------------------------------------------------------------

  /**
   * Sign an envelope of `type` from the record's `chatDid` (made if absent, never announced) to its `agentDid`, and
   * hand it to the carrier. `id` is kept on a resend. Used by the sends below and by fb-C4's chat.
   */
  public async sendEnvelope(
    record: AgentConnection,
    type: EnvelopeType,
    payload: Record<string, unknown>,
    options: { id?: string; at?: number } = {}
  ): Promise<ControlSendResult> {
    const { chatDid } = await ensureChatIdentity(this.deps.store, record, this.deps.kms)
    const current = (await this.deps.store.get(record.id)) ?? { ...record, chatDid }
    const unsigned: UnsignedEnvelope = buildEnvelope({
      type,
      recipient: current.agentDid,
      payload,
      id: options.id,
      now: new Date(options.at ?? this.now),
    })
    const signed = await signEnvelope(this.deps.agent, unsigned, chatDid)
    const result = await this.deps.carrier.send(current, { id: signed.id, type: signed.type, body: { ...signed } })
    return { ...result, envelopeId: signed.id }
  }

  /** `keyring/agent/settings/1.0` with the record's `answersOthers` and handle: after each change of the setting. */
  public async sendSettings(
    id: string,
    options: { locale?: string } = {}
  ): Promise<ControlSendResult | ControlSendSkipped> {
    return this.sendState(id, ENVELOPE_TYPE.settings, (record) => ({
      answersOthers: record.answersOthers,
      handle: record.handle,
      ...(options.locale ? { locale: options.locale } : {}),
    }))
  }

  /** `keyring/agent/room-offer/1.0` (P1 rooms): built, with no caller yet. */
  public async sendRoomOffer(id: string, offer: RoomOffer): Promise<ControlSendResult | ControlSendSkipped> {
    return this.sendState(id, ENVELOPE_TYPE.roomOffer, () => ({ ...offer }))
  }

  /**
   * A state type to the agent, stamped at least one second after the last of its type sent to it, so the agent's
   * "newest wins" never takes it for older. One at a time per agent and type.
   */
  private sendState(
    id: string,
    type: EnvelopeType,
    payloadOf: (record: AgentConnection) => Record<string, unknown>
  ): Promise<ControlSendResult | ControlSendSkipped> {
    const key = intentKey(id, envelopeBaseType(type))
    return withKeyLock(`${RECORD_TYPE}|${LAST_SENT}-send|${key}`, async () => {
      const record = await this.deps.store.get(id)
      if (!record) return { result: 'noRecord' as const }
      const last = await getKeyed<LastSent>(this.deps.agent, RECORD_TYPE, LAST_SENT, key)
      const at = Math.max(Math.floor(this.now / STATE_STEP_MS) * STATE_STEP_MS, (last?.at ?? -Infinity) + STATE_STEP_MS)
      // Stamped before the send: a send that fails still used this second, and the next is later.
      await putKeyed(this.deps.agent, RECORD_TYPE, LAST_SENT, key, { at } satisfies LastSent)
      return this.sendEnvelope(record, type, payloadOf(record), { at })
    })
  }

  /**
   * `keyring/agent/revoked/1.0`, for `revokeAgentConnection`'s deps: the intent is written before the send. A second
   * call for the same agent (a retried revoke, the repair) sends the same document again, with its `id`.
   * `revokeAgentConnection` treats it as best effort; the repair sends an intent the carrier did not take.
   */
  public readonly tellAgent = async (record: { id: string }): Promise<void> => {
    await this.sendRevoked(record.id)
  }

  public async sendRevoked(id: string): Promise<ControlSendResult | ControlSendSkipped> {
    return this.sendWithIntent(id, ENVELOPE_TYPE.revoked, (_record, existing) => ({
      id: existing?.id ?? newEnvelopeId(),
      payload: existing?.payload ?? { revokedAt: iso(this.now) },
    }))
  }

  /**
   * `keyring/agent/vdc-grant/1.0` with the record's stored `vdcGrant`: after connect and after each re-issue, to an
   * `active` agent only. The intent is written first. A grant already sent or intended keeps its envelope `id`; a re-issued grant (another
   * digest) is a new document with a new `id`.
   */
  public async sendVdcGrant(id: string): Promise<ControlSendResult | ControlSendSkipped> {
    return this.sendWithIntent(id, ENVELOPE_TYPE.vdcGrant, (record, existing) => {
      // Never to an agent being revoked, revoked or expired: a grant intent left from before is dropped by the repair.
      if (record.state !== 'active') return { result: 'notActive' }
      if (!record.vdcGrant) return { result: 'noGrant' }
      const grantDigest = taskDigestMultibase(record.vdcGrant)
      return {
        id: existing && existing.grantDigest === grantDigest ? existing.id : newEnvelopeId(),
        payload: { vdc: record.vdcGrant },
        grantDigest,
      }
    })
  }

  /**
   * Write the intent (under one lock per agent and type), then sign and send it, then mark it sent. The send runs
   * outside the intent's lock: the record is written before it, so a crash in the send leaves an intent to repair.
   */
  private async sendWithIntent(
    id: string,
    type: EnvelopeType,
    plan: (
      record: AgentConnection,
      existing: ControlIntent | undefined
    ) => Pick<ControlIntent, 'id' | 'payload' | 'grantDigest'> | ControlSendSkipped
  ): Promise<ControlSendResult | ControlSendSkipped> {
    const key = intentKey(id, envelopeBaseType(type))
    const prepared = await withKeyLock(`${RECORD_TYPE}|${INTENT}-write|${key}`, async () => {
      const record = await this.deps.store.get(id)
      if (!record) return { result: 'noRecord' as const }
      const existing = await getKeyed<ControlIntent>(this.deps.agent, RECORD_TYPE, INTENT, key)
      const planned = plan(record, existing)
      if ('result' in planned) return planned
      const kept = existing !== undefined && existing.id === planned.id
      const intent: ControlIntent = {
        agentId: id,
        type,
        id: planned.id,
        payload: planned.payload,
        ...(planned.grantDigest ? { grantDigest: planned.grantDigest } : {}),
        writtenAt: kept ? existing.writtenAt : iso(this.now),
        // A new document is not sent yet; the same one already sent stays sent until this send answers.
        ...(kept && existing.sentAt ? { sentAt: existing.sentAt } : {}),
      }
      await putKeyed(this.deps.agent, RECORD_TYPE, INTENT, key, intent)
      return { record, intent }
    })
    if ('result' in prepared) return prepared
    const { record, intent } = prepared
    const result = await this.sendEnvelope(record, type, intent.payload, { id: intent.id })
    if (result.result === 'sent') {
      await withKeyLock(`${RECORD_TYPE}|${INTENT}-write|${key}`, async () => {
        const now = await getKeyed<ControlIntent>(this.deps.agent, RECORD_TYPE, INTENT, key)
        // Only the intent this send carried: a re-issue written meanwhile stays unsent.
        if (now?.id === intent.id)
          await putKeyed(this.deps.agent, RECORD_TYPE, INTENT, key, { ...now, sentAt: iso(this.now) })
      })
    } else {
      this.deps.agent.config.logger.info(`${LOG_PREFIX} ${type} to ${id} not sent (${result.result}); kept to resend`)
    }
    return result
  }

  /**
   * The repair: send again every intent the carrier has not taken (a crash between the intent and the send, or a send
   * that was not `sent`). A grant intent whose grant was re-issued since sends the current grant instead. An intent
   * whose record is gone is dropped. Must run at app start (`services.reconcile`, after `reconcileAgents`).
   */
  public async resendPending(): Promise<{ sent: string[]; pending: string[]; dropped: string[] }> {
    const outcome = { sent: [] as string[], pending: [] as string[], dropped: [] as string[] }
    const intents = await listKeyed<ControlIntent>(this.deps.agent, RECORD_TYPE, INTENT)
    for (const intent of intents) {
      if (intent.sentAt) continue
      const label = `${intent.agentId} ${intent.type}`
      const base = envelopeBaseType(intent.type)
      let result: ControlSendResult | ControlSendSkipped
      try {
        if (base === BASE.vdcGrant) result = await this.sendVdcGrant(intent.agentId)
        else if (base === BASE.revoked) result = await this.sendRevoked(intent.agentId)
        else continue
      } catch (error) {
        this.deps.agent.config.logger.info(`${LOG_PREFIX} resending ${label} failed: ${(error as Error)?.message}`)
        outcome.pending.push(label)
        continue
      }
      if (result.result === 'noRecord' || result.result === 'noGrant' || result.result === 'notActive') {
        await deleteKeyed(this.deps.agent, RECORD_TYPE, INTENT, intentKey(intent.agentId, base))
        outcome.dropped.push(label)
      } else if (result.result === 'sent') outcome.sent.push(label)
      else outcome.pending.push(label)
    }
    return outcome
  }

  /** The intent for agent `id` and `type`, if any: for the views' "not told yet" and for tests. */
  public intentFor(id: string, type: EnvelopeType): Promise<ControlIntent | undefined> {
    return getKeyed<ControlIntent>(this.deps.agent, RECORD_TYPE, INTENT, intentKey(id, envelopeBaseType(type)))
  }
}

export type { ControlIntent }
