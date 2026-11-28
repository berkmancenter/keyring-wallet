/**
 * The agent chat's carrier (docs/plans/agent-connect-plan.md §3.5, §2.4, §2.5; backlog 2 fb-C1): what replaces the
 * Credo send for a chat whose peer is an agent `K_a`.
 *
 * **Sending.** From Keyring's `chatDid` (`K_c`, `./chatIdentity.ts`), an authcrypt DIDComm v2 message to the agent's
 * current key (`agentDid`), wrapped in an **authcrypt** `routing/2.0/forward` with `next` = `K_a`, posted to **the
 * owner's own mediator** (P0, §3.5) over a {@link VtiMediatorSession} signed in as `chatDid` (`sendTo`, which
 * authcrypts the inner message and calls `forward`). The session packs every frame to the mediator with `chatDid`'s
 * key as sender, so an anoncrypt outer forward is never sent: the mailbox's configuration refuses one
 * (`block_anonymous_outer_envelope`, measured 400 `w.m.message.anonymous`, §2.4).
 *
 * **The self-grant.** On the wallet mailbox's configuration a new account holds `SEND_FORWARDED_CHANGE`, not
 * `SEND_FORWARDED` (§2.5), so `chatDid` switches its own forwarding on with a signed `messaging/account/update` once
 * per session, after signing in and before its first send. As the wallet mailbox does (`walletMailbox.ts`), the grant
 * is asked again at every session's open and never remembered across them: the right lives in the mediator's account,
 * which a restore of its store can roll back. A refused self-grant is {@link CarrierResult} `closedMediator`, and
 * nothing is sent.
 *
 * **Results.** Every send ends in one code, each with its own copy in §6: `sent`; `closedMediator` (403
 * `e.p.authorization.send` or `send_forwarded`, or the self-grant refused); `paced` (503 `e.p.limits.queue.peer`,
 * honouring `Retry-After`: until then a send is answered `paced` without touching the network, never retried at
 * once); `unreachable` (no mediator to send through, the sign-in failed, the agent has no account there yet, or the
 * transport failed), with its reason.
 *
 * **Receiving.** {@link AgentChatCarrier.onMessage} delivers what arrives for a `chatDid` on its session. The handlers
 * are awaited before the session acknowledges the message, so a handler that throws leaves it queued at the mediator
 * for the next drain (`VtiMediatorSession`'s persist-before-ack).
 *
 * **Where the chat's events live (decided in fb-C1).** The chat module stores an agent chat's events under
 * `chatConnectionId`, so its storage and `mergeByTime` run unchanged; this carrier replaces only the Credo send. A
 * message is the caller's to record (as an outgoing event under `chatConnectionId`) before it is handed to `send`, and
 * a resend passes the same `id`: a send cannot be taken back, so its record goes first.
 *
 * **Not here.** `chatDid` is never announced to the agent (§11 Q7 is open), and nothing is signed as a chat or control
 * envelope (fb-C2). How a refusal reaches this carrier: `VtiMediatorSession` sends on its socket and, today, only logs
 * the mediator's problem-report about a forward, so a refused forward does not yet reject `sendTo`; the mapping below
 * reads a refusal from whatever the session rejects with (an HTTP status and `Retry-After`, or the mediator's code in a
 * problem-report's words), ready for the session change that surfaces them.
 *
 * **Who calls it (not wired here; fb-C1 writes no existing file).** One carrier per app is built beside the
 * connected-agents services (fb-W1's `ConnectedAgentsRoot`, or fb-C3 where it first sends), and closed with them.
 * `open(record)` must run for every `active` record when they start, or the agent's replies sit at the mediator until
 * the first send; fb-C4's `useAgentChat` calls `send` and listens through `onMessage`.
 *
 * @module connected-agents/chat/carrier
 */

import { type Agent, utils } from '@credo-ts/core'
import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'
import { signDocumentProof, wireTimestamp } from '@bifold/trust-tasks'

import { didPrefix } from '../../trust-tasks/module/didPrefix'
import {
  advertisedMediatorDid,
  resolveVtiMediator,
  vtiClientIdentityFromDid,
  type VtiClientIdentity,
  type VtiMediatorEndpoints,
  VtiMediatorSession,
} from '../../trust-tasks/module/VtiMediatorTransport'
import {
  mailboxAccountKey,
  MEDIATOR_ACCOUNT_UPDATE,
  MEDIATOR_ASK_ERROR_FORMAT,
} from '../../trust-tasks/module/walletMailbox'
import type { AgentConnectionStore } from '../store'
import type { AgentConnection } from '../types'
import { type ChatIdentityKms, ensureChatIdentity } from './chatIdentity'

export const LOG_PREFIX = '[ConnectedAgents:ChatCarrier]'

const PLAIN = 'application/didcomm-plain+json'

/**
 * How long a `paced` send waits when the 503 carries no `Retry-After`: the starter mediator's own value (§2.4, measured
 * `Retry-After: 30`). Only that refusal carries the header there, so this is a fallback for a mediator that omits it.
 */
export const DEFAULT_RETRY_AFTER_SECONDS = 30

/** The mediator's codes this carrier reads (§2.4, §3.5). */
export const MEDIATOR_CODES = {
  send: 'e.p.authorization.send',
  sendForwarded: 'e.p.authorization.send_forwarded',
  queuePeer: 'e.p.limits.queue.peer',
  deliveryRefused: 'e.p.delivery.refused',
  notSelfManageable: 'authorization.acl.not_self_manageable',
} as const

/** Why a send is `unreachable`. */
export type UnreachableReason =
  /** No mediator is known for this agent's chat (the record names none and the owner's VTA advertises none). */
  | 'noMediator'
  /** `chatDid` could not sign in at the mediator, or the mediator could not be resolved. */
  | 'signIn'
  /** 403 `e.p.delivery.refused`: the agent has no account at the mediator yet (§2.4); a later send may reach it. */
  | 'recipientUnknown'
  /** The send or the self-grant failed without a refusal from the mediator (a closed socket, no answer in time). */
  | 'transport'

/** The outcome of one {@link AgentChatCarrier.send}; each has its own copy in §6, never a generic failure line. */
export type CarrierResult =
  | { result: 'sent'; id: string }
  | {
      result: 'closedMediator'
      /** What refused: the self-grant, or the send itself. */
      refused: 'selfGrant' | 'send'
      /** The mediator's code where it gave one. */
      code?: string
    }
  | {
      result: 'paced'
      /** Epoch ms before which no send to this agent is attempted. */
      retryAt: number
      /** How long from now that is, in ms. */
      retryAfterMs: number
    }
  | { result: 'unreachable'; reason: UnreachableReason; detail?: string }

/**
 * Whether the send that ended in `result` may be offered again (backlog 2's common rule: a refusal spends the action,
 * the words and the control both). Only `unreachable` leaves it offered. `closedMediator` and `paced` are the
 * mediator's refusals: the copy offers no retry and the control that sent it is not left live. `paced` names when a
 * new send may go; this carrier answers `paced` itself until then, and never sends the refused message again.
 * `unreachable` includes 403 `e.p.delivery.refused` (`recipientUnknown`): the plan retries that one (§2.4, §3.5),
 * since the agent has not signed in at the mediator yet, which is not a refusal of this phone.
 */
export const sendOfferedAgain = (result: CarrierResult): boolean => result.result === 'unreachable'

/** A chat message as handed to the carrier: `from`, `to` and `typ` are the carrier's; an `id` is kept on a resend. */
export type AgentChatPlaintext = {
  id?: string
  type: string
  thid?: string
  pthid?: string
  created_time?: number
  expires_time?: number
  lang?: string
  attachments?: DidCommV2PlaintextMessage['attachments']
  body?: Record<string, unknown>
}

/** An inbound message for a `chatDid`, decrypted. `record` is the agent connection holding that `chatDid`, if any. */
export type AgentChatInbound = {
  chatDid: string
  record?: AgentConnection
  plaintext: DidCommV2PlaintextMessage
}

export type AgentChatHandler = (message: AgentChatInbound) => void | Promise<void>

/** What the carrier needs of a mediator session: {@link VtiMediatorSession} in the app, a fake in tests. */
export interface ChatMediatorSession {
  start(): Promise<void>
  stop(): Promise<void>
  /** Authcrypt `plaintext` to `peerDid` and forward it, authcrypted, through the mediator with `next` = `peerDid`. */
  sendTo(peerDid: string, plaintext: DidCommV2PlaintextMessage): Promise<void>
  /** A signed Trust Task document to the mediator itself; resolves with its answer, rejects with its refusal. */
  ask(document: Record<string, unknown>): Promise<DidCommV2PlaintextMessage>
}

export interface AgentChatCarrierDeps {
  agent: Agent
  store: AgentConnectionStore
  kms: ChatIdentityKms
  /**
   * The mediator an agent's chat runs through: the owner's own (P0, §3.5). Default {@link ownerMediatorOf}: the
   * record's `mediatorDid`, else the DIDComm mediator the owner's VTA advertises.
   */
  mediatorFor?: (record: AgentConnection) => Promise<string | undefined>
  resolveMediator?: (agent: Agent, mediatorDid: string) => Promise<VtiMediatorEndpoints>
  identityOf?: (agent: Agent, did: string) => Promise<VtiClientIdentity>
  makeSession?: (
    agent: Agent,
    identity: VtiClientIdentity,
    mediator: VtiMediatorEndpoints,
    onMessage: (plaintext: DidCommV2PlaintextMessage) => Promise<void>
  ) => ChatMediatorSession
  /** Signs the self-grant for `did` (eddsa-jcs-2022, proof purpose `authentication`). Default `signDocumentProof`. */
  signForMediator?: (document: Record<string, unknown>, did: string) => Promise<Record<string, unknown>>
  now?: () => number
}

/** The mediator of the owner's own: the record's `mediatorDid`, else the one the owner's VTA advertises (P0, §3.5). */
export const ownerMediatorOf =
  (agent: Agent) =>
  async (record: AgentConnection): Promise<string | undefined> =>
    record.mediatorDid ?? (await advertisedMediatorDid(agent, record.vtaDid))

/** A refusal read from what a session rejected with. */
export type MediatorRefusal = { status?: number; code?: string; retryAfterSeconds?: number }

/** An error a session may reject with to carry the mediator's refusal. */
export class MediatorRefusalError extends Error {
  public constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
    public readonly retryAfterSeconds?: number
  ) {
    super(message)
    this.name = 'MediatorRefusalError'
  }
}

// The codes, longest first where one is the prefix of another (`send` of `send_forwarded`). Matched with or without
// the `e.p.` scope, since a problem-report's words carry the code as the mediator wrote it.
const CODE_PATTERNS: [string, RegExp][] = [
  [MEDIATOR_CODES.sendForwarded, /(?:e\.p\.)?authorization\.send_forwarded\b/],
  [MEDIATOR_CODES.send, /(?:e\.p\.)?authorization\.send(?![\w.])/],
  [MEDIATOR_CODES.queuePeer, /(?:e\.p\.)?limits\.queue\.peer\b/],
  [MEDIATOR_CODES.deliveryRefused, /(?:e\.p\.)?delivery\.refused\b/],
  [MEDIATOR_CODES.notSelfManageable, /authorization\.acl\.not_self_manageable\b/],
]

const codeIn = (text: string): string | undefined => CODE_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0]

const numberOf = (value: unknown): number | undefined => {
  const n = typeof value === 'string' ? Number(value.trim()) : value
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined
}

/**
 * The mediator's refusal in what a session rejected with, if it carries one: an HTTP status (`status` or
 * `statusCode`), a code (`code`, or one of {@link MEDIATOR_CODES} in the message), and `Retry-After` in seconds
 * (`retryAfterSeconds`, `retryAfter`, or a `retry-after` header). Undefined for an error that says none of these.
 */
export function mediatorRefusalOf(error: unknown): MediatorRefusal | undefined {
  if (!error || typeof error !== 'object') return undefined
  const e = error as {
    status?: unknown
    statusCode?: unknown
    code?: unknown
    message?: unknown
    retryAfterSeconds?: unknown
    retryAfter?: unknown
    headers?: unknown
  }
  const status = numberOf(e.status) ?? numberOf(e.statusCode)
  const message = typeof e.message === 'string' ? e.message : ''
  const code = (typeof e.code === 'string' ? (codeIn(e.code) ?? e.code) : undefined) ?? codeIn(message)
  const headers = e.headers as { get?: (name: string) => unknown } | Record<string, unknown> | undefined
  const header =
    headers && typeof (headers as { get?: unknown }).get === 'function'
      ? (headers as { get: (name: string) => unknown }).get('retry-after')
      : (headers as Record<string, unknown> | undefined)?.['retry-after']
  const retryAfterSeconds = numberOf(e.retryAfterSeconds) ?? numberOf(e.retryAfter) ?? numberOf(header)
  if (status === undefined && code === undefined) return undefined
  return { status, code, retryAfterSeconds }
}

type Classified =
  | { result: 'closedMediator'; code?: string; lostGrant: boolean }
  | { result: 'paced'; retryAfterSeconds: number }
  | { result: 'unreachable'; reason: UnreachableReason }

/** A failed send, as a result. Exported for the tests of the mapping (§2.4's cases). */
export function classifySendFailure(error: unknown): Classified {
  const refusal = mediatorRefusalOf(error)
  if (!refusal) return { result: 'unreachable', reason: 'transport' }
  const { status, code } = refusal
  if (code === MEDIATOR_CODES.queuePeer || (status === 503 && code === undefined)) {
    return { result: 'paced', retryAfterSeconds: refusal.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS }
  }
  if (code === MEDIATOR_CODES.deliveryRefused) return { result: 'unreachable', reason: 'recipientUnknown' }
  if (code === MEDIATOR_CODES.sendForwarded || code === MEDIATOR_CODES.notSelfManageable) {
    // The forwarding right is gone (a mediator's store rolled back): the next session asks for it again.
    return { result: 'closedMediator', code, lostGrant: true }
  }
  if (code === MEDIATOR_CODES.send || (status === 403 && code === undefined)) {
    return { result: 'closedMediator', code: code ?? (status === 403 ? 'http 403' : undefined), lostGrant: false }
  }
  return { result: 'unreachable', reason: 'transport' }
}

/** One signed-in session for one `chatDid` at one mediator. */
type Line = {
  chatDid: string
  mediatorDid: string
  session: ChatMediatorSession
  /** The self-grant, asked once per session; a promise so two first sends ask once. Cleared when it did not hold. */
  grant?: Promise<SelfGrantOutcome>
}

type SelfGrantOutcome = { granted: true } | { granted: false; refused: boolean; code?: string; detail?: string }

const isRefusalWords = (message: string): boolean => /\brefused\b/.test(message) || codeIn(message) !== undefined

/**
 * The carrier for every agent chat on this phone. One session per `chatDid` and mediator, opened on the first send or
 * {@link AgentChatCarrier.open}, kept until {@link AgentChatCarrier.close}.
 */
export class AgentChatCarrier {
  private readonly lines = new Map<string, Line>()
  private readonly opening = new Map<string, Promise<Line>>()
  private readonly handlers = new Set<AgentChatHandler>()
  /** Per `chatDid` and agent key: epoch ms before which a send is answered `paced`. */
  private readonly pacedUntil = new Map<string, number>()
  private closed = false

  public constructor(private readonly deps: AgentChatCarrierDeps) {}

  private get now(): number {
    return (this.deps.now ?? Date.now)()
  }

  /**
   * Send `plaintext` to `record`'s agent. Makes the chat identity first if the record has none (never announcing it,
   * §11 Q7), signs in, self-grants once per session, then sends. Never throws for a mediator's refusal or a transport
   * failure: each is a {@link CarrierResult}. Throws only when the record is gone (`AgentChatRecordMissing`).
   */
  public async send(record: AgentConnection, plaintext: AgentChatPlaintext): Promise<CarrierResult> {
    const { chatDid } = await ensureChatIdentity(this.deps.store, record, this.deps.kms)
    const pacingKey = `${chatDid}|${record.agentDid}`
    const until = this.pacedUntil.get(pacingKey)
    if (until !== undefined) {
      if (until > this.now) return { result: 'paced', retryAt: until, retryAfterMs: until - this.now }
      this.pacedUntil.delete(pacingKey)
    }

    const opened = await this.lineFor(record, chatDid)
    if ('result' in opened) return opened
    const line = opened

    const grant = await this.selfGrant(line)
    if (!grant.granted) {
      if (grant.refused) return { result: 'closedMediator', refused: 'selfGrant', code: grant.code }
      return { result: 'unreachable', reason: 'transport', detail: grant.detail }
    }

    const id = plaintext.id ?? `urn:uuid:${utils.uuid()}`
    const message: DidCommV2PlaintextMessage = {
      typ: PLAIN,
      created_time: Math.floor(this.now / 1000),
      ...plaintext,
      id,
      from: chatDid,
      to: [record.agentDid],
    }
    try {
      await line.session.sendTo(record.agentDid, message)
      return { result: 'sent', id }
    } catch (error) {
      const outcome = classifySendFailure(error)
      this.deps.agent.config.logger.info(
        `${LOG_PREFIX} a send to ${didPrefix(record.agentDid)} from ${didPrefix(chatDid)} ended ${outcome.result}: ${(error as Error)?.message ?? String(error)}`
      )
      if (outcome.result === 'paced') {
        const retryAt = this.now + outcome.retryAfterSeconds * 1000
        this.pacedUntil.set(pacingKey, retryAt)
        return { result: 'paced', retryAt, retryAfterMs: retryAt - this.now }
      }
      if (outcome.result === 'closedMediator') {
        if (outcome.lostGrant) line.grant = undefined
        return { result: 'closedMediator', refused: 'send', code: outcome.code }
      }
      return { result: 'unreachable', reason: outcome.reason, detail: (error as Error)?.message }
    }
  }

  /**
   * Sign `record`'s `chatDid` in at its mediator so what the agent sends is received, without sending anything. Makes
   * the chat identity if the record has none. Resolves `'open'`, or the `unreachable` result that stopped it.
   */
  public async open(record: AgentConnection): Promise<'open' | Extract<CarrierResult, { result: 'unreachable' }>> {
    const { chatDid } = await ensureChatIdentity(this.deps.store, record, this.deps.kms)
    const opened = await this.lineFor(record, chatDid)
    return 'result' in opened ? opened : 'open'
  }

  /** Deliver every inbound message for a `chatDid` to `handler`. Returns the unsubscribe. */
  public onMessage(handler: AgentChatHandler): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  /** Sign every chat identity out. A closed carrier opens no session again. */
  public async close(): Promise<void> {
    this.closed = true
    const lines = [...this.lines.values()]
    this.lines.clear()
    await Promise.all(lines.map((line) => line.session.stop().catch(() => undefined)))
  }

  private async lineFor(
    record: AgentConnection,
    chatDid: string
  ): Promise<Line | Extract<CarrierResult, { result: 'unreachable' }>> {
    let mediatorDid: string | undefined
    try {
      mediatorDid = await (this.deps.mediatorFor ?? ownerMediatorOf(this.deps.agent))(record)
    } catch (error) {
      return { result: 'unreachable', reason: 'noMediator', detail: (error as Error)?.message }
    }
    if (!mediatorDid) return { result: 'unreachable', reason: 'noMediator' }
    if (this.closed) return { result: 'unreachable', reason: 'signIn', detail: 'the carrier is closed' }
    const key = `${chatDid}|${mediatorDid}`
    const kept = this.lines.get(key)
    if (kept) return kept
    let opening = this.opening.get(key)
    if (!opening) {
      opening = this.openLine(chatDid, mediatorDid).finally(() => this.opening.delete(key))
      this.opening.set(key, opening)
    }
    try {
      return await opening
    } catch (error) {
      this.deps.agent.config.logger.info(
        `${LOG_PREFIX} ${didPrefix(chatDid)} could not sign in at ${didPrefix(mediatorDid)}: ${(error as Error)?.message}`
      )
      return { result: 'unreachable', reason: 'signIn', detail: (error as Error)?.message }
    }
  }

  private async openLine(chatDid: string, mediatorDid: string): Promise<Line> {
    const { agent } = this.deps
    const mediator = await (this.deps.resolveMediator ?? resolveVtiMediator)(agent, mediatorDid)
    const identity = await (this.deps.identityOf ?? vtiClientIdentityFromDid)(agent, chatDid)
    const onMessage = (plaintext: DidCommV2PlaintextMessage) => this.deliver(chatDid, plaintext)
    const session = this.deps.makeSession
      ? this.deps.makeSession(agent, identity, mediator, onMessage)
      : new VtiMediatorSession(agent, identity, mediator, {
          onMessage,
          onError: (error) => agent.config.logger.warn(`${LOG_PREFIX} chat session: ${error.message}`),
          // The chat listens for the agent's replies; a socket that closes under it reopens on its own.
          keepOpen: true,
        })
    try {
      await session.start()
    } catch (error) {
      await session.stop().catch(() => undefined)
      throw error
    }
    if (this.closed) {
      await session.stop().catch(() => undefined)
      throw new Error('the carrier closed while signing in')
    }
    const line: Line = { chatDid, mediatorDid, session }
    this.lines.set(`${chatDid}|${mediatorDid}`, line)
    return line
  }

  /** The self-grant for `line`, asked once per session; a failure that did not hold is asked again next time. */
  private selfGrant(line: Line): Promise<SelfGrantOutcome> {
    if (!line.grant) {
      const asked = this.askSelfGrant(line)
      line.grant = asked
      void asked.then((outcome) => {
        if (!outcome.granted && line.grant === asked) line.grant = undefined
      })
    }
    return line.grant
  }

  /**
   * `messaging/account/update` with `acl.sendForwarded: true`, signed by `chatDid` for `authentication`, naming the
   * account by the sha256 of `chatDid`. Granted only when the answer shows the right on (the mailbox's own reading,
   * `walletMailbox.ts`); any other answer, and the mediator's refusal, is refused; no answer is a transport failure.
   */
  private async askSelfGrant(line: Line): Promise<SelfGrantOutcome> {
    const document = {
      id: `urn:uuid:${utils.uuid()}`,
      type: MEDIATOR_ACCOUNT_UPDATE,
      issuer: line.chatDid,
      recipient: line.mediatorDid,
      issuedAt: wireTimestamp(),
      ...MEDIATOR_ASK_ERROR_FORMAT,
      payload: { did: mailboxAccountKey(line.chatDid), acl: { sendForwarded: true } },
    }
    let answer: DidCommV2PlaintextMessage
    try {
      const signed = this.deps.signForMediator
        ? await this.deps.signForMediator(document, line.chatDid)
        : await signDocumentProof(this.deps.agent, document, line.chatDid, { proofPurpose: 'authentication' })
      answer = await line.session.ask(signed)
    } catch (error) {
      const message = (error as Error)?.message ?? String(error)
      const refusal = mediatorRefusalOf(error)
      if (refusal?.code || refusal?.status === 403 || isRefusalWords(message)) {
        return { granted: false, refused: true, code: refusal?.code ?? codeIn(message) }
      }
      return { granted: false, refused: false, detail: message }
    }
    const body = (answer.body ?? {}) as { type?: unknown; payload?: unknown }
    const payload = body.payload as
      | { account?: { acl?: { sendForwarded?: unknown } }; acl?: { sendForwarded?: unknown }; code?: unknown }
      | undefined
    const acl = payload?.account?.acl ?? payload?.acl
    if (acl?.sendForwarded === true) return { granted: true }
    const said = [payload?.code, body.type].find((v): v is string => typeof v === 'string')
    this.deps.agent.config.logger.info(
      `${LOG_PREFIX} the self-grant for ${didPrefix(line.chatDid)} at ${didPrefix(line.mediatorDid)} was not confirmed: ${said ?? 'untyped answer'}`
    )
    return { granted: false, refused: true, code: said ? (codeIn(said) ?? said) : undefined }
  }

  /** Hand an inbound message to every handler, awaited; a handler that throws withholds the acknowledgement. */
  private async deliver(chatDid: string, plaintext: DidCommV2PlaintextMessage): Promise<void> {
    if (plaintext.to && plaintext.to.length > 0 && !plaintext.to.includes(chatDid)) {
      this.deps.agent.config.logger.info(
        `${LOG_PREFIX} a message on ${didPrefix(chatDid)}'s session is addressed elsewhere; dropped`
      )
      return
    }
    if (this.handlers.size === 0) {
      // Left queued at the mediator for when a handler listens: nothing here may take it.
      throw new Error(`${LOG_PREFIX} no handler is listening for ${didPrefix(chatDid)}`)
    }
    const record = (await this.deps.store.list()).find((r) => r.chatDid === chatDid)
    for (const handler of [...this.handlers]) {
      await handler({ chatDid, record, plaintext })
    }
  }
}
