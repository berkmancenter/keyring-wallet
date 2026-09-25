/**
 * vtiAgent — the wallet's side of a VTI agent, held outside React.
 *
 * A VTA or a VTC is reached over one authenticated socket (see
 * `VtiMediatorTransport`), and that socket has to outlive any one screen: the
 * agent card, a community and an application all talk to the same session. So
 * the session lives here, and screens subscribe.
 *
 * Two legs share the socket. The **community leg** (`ask`) is DIDComm v2:
 * a VTC or a VTA reads the plaintext body as a Trust Task document. The
 * **peer leg** (`send`, applicant ↔ vetter) is either DIDComm v2 or TSP
 * Rev 3, decided at build time (`vtiTsp.setPeerLegCarriage`); a TSP frame
 * that arrives is opened whenever the session holds a TSP identity, whatever
 * the build sends, and is handed to the same inbox as a DIDComm plaintext
 * would be, so nothing above this controller knows which carriage a document
 * took.
 *
 * @module trust-tasks/module/vtiAgent
 */

import type { Agent } from '@credo-ts/core'
import { utils } from '@credo-ts/core'
import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'
import { tsp, TRUST_TASK_V2_ENVELOPE_TYPE } from '@bifold/trust-tasks'

import { signDocumentProof } from '../documentProof'
import type { VtiPersona } from './VtiIdentityStore'
import {
  advertisedMediatorDid,
  advertisedTspMediatorDid,
  createVtiClientDid,
  resolveVtiMediator,
  resolveDidDocumentRetrying,
  vtiClientIdentityFromDid,
  vtiClientIdentityFromPersona,
  VtiMediatorSession,
  type VtiClientIdentity,
  type VtiMediatorEndpoints,
} from './VtiMediatorTransport'
import {
  frameForm,
  getPeerLegCarriage,
  LOG_PREFIX as TSP_LOG_PREFIX,
  greetPeerOverTsp,
  packTrustTaskForPeer,
  tspSessionForPersona,
  unpackTrustTaskFromPeer,
  type PeerLegCarriage,
  type PeerRevisionRecord,
  type TspPeerRevisionStore,
  type TspSessionIdentity,
} from './vtiTsp'
import { communityTarget } from './vtiCommunityLink'
import { chooseCarriage, type Carriage } from './tspCapability'

const MANIFEST = 'https://trusttasks.org/spec/vtc/join-requests/manifest/0.2'
const SUBMIT = 'https://trusttasks.org/spec/vtc/join-requests/submit/0.2'
const TASK_ERROR = 'https://trusttasks.org/spec/trust-task-error/'
const WITHDRAW = 'https://trusttasks.org/spec/vtc/join-requests/withdraw/0.1'
const SUPPLEMENT = 'https://trusttasks.org/spec/vtc/join-requests/supplement/0.1'
const STATUS = 'https://trusttasks.org/spec/vtc/join-requests/status/0.1'
const SELF_REMOVE = 'https://trusttasks.org/spec/vtc/members/self-remove/0.1'
const VETTERS_PROFILE = 'https://trusttasks.org/spec/vtc/vetting/vetters/profile/0.1'
const PROBLEM_REPORT = 'https://didcomm.org/report-problem/2.0/problem-report'
/**
 * The community tasks this controller signs. Those whose specifications
 * declare the document `proof` REQUIRED — a VTC refuses them unsigned
 * (`proofRequired`) since vti #1672, over every carriage — and the vetter
 * profile, whose proof is RECOMMENDED so a published profile stays
 * attributable to its vetter after the transport has closed
 * (vtc/vetting/vetters/profile/0.1 spec.md:26-28), and which openvtc signs
 * (`publish_profile` → `sign_and_send`, openvtc vetting_actions.rs:1731-1760,
 * :1097-1110).
 *
 * The manifest stays unsigned. Its proof is RECOMMENDED too, but the spec's
 * own privacy analysis is why not: an unproofed read discloses no applicant
 * identifier, and a proof "converts an anonymous read into an attributable
 * one" of someone merely considering applying (vtc/join-requests/manifest/0.2
 * spec.md:26-28, :326-329). openvtc signs it; Keyring does not, on purpose.
 */
const SIGNED_TASKS = new Set([SUBMIT, STATUS, WITHDRAW, SUPPLEMENT, SELF_REMOVE, VETTERS_PROFILE])

/**
 * The community tasks `ask` may send twice: reads, which change nothing, so a
 * second copy costs the community one more lookup and nothing else.
 *
 * - `MANIFEST` — `vtc/join-requests/manifest/0.2`, the published criteria.
 * - `STATUS` — `vtc/join-requests/status/0.1`, where the applicant's request stands.
 *
 * Everything else `ask` sends changes state and is a WRITE: `SUBMIT`,
 * `SUPPLEMENT`, `WITHDRAW`, `SELF_REMOVE` above, and the vetter profile publish
 * (`vtc/vetting/vetters/profile/0.1`, `VETTING.vettersProfile` in vtiVetting).
 * A task this list does not name is a write too, so that a task added later is
 * never re-sent by default. A write the community received and has not yet
 * answered — a submit it deferred, say — sent again is a second submit, and
 * reads as `requestAlreadyOpen`.
 */
export const VTI_READ_TASKS: ReadonlySet<string> = new Set([MANIFEST, STATUS])

/** Whether `type` is a read `ask` may send again over DIDComm after TSP silence (see `VTI_READ_TASKS`). */
export function isVtiReadTask(type: string): boolean {
  return VTI_READ_TASKS.has(type)
}

/**
 * How long an ask whose answer clock ran out keeps waiting for that answer.
 * A late answer that arrives in that time is kept, and the next identical ask
 * (or `takeHeldAnswer`) is given it instead of sending again. Modelled on
 * vtaAgent's `GRANT_HOLD_MS`.
 */
export const VTI_ANSWER_HOLD_MS = 60000

/** A task's name without the host and the version: `vtc/join-requests/submit`. */
const taskName = (type: string) => type.replace(/^https?:\/\/[^/]+\/(spec\/)?/, '').replace(/\/[\d.]+$/, '')

/**
 * A request that went out and has had no answer yet — not a refusal, and not
 * proof that the community never got it. A submit the community received and
 * deferred looks exactly like this until its answer arrives, so a screen should
 * say the request was sent and is waiting on the community, and should not
 * invite the person to send it again: an identical ask made within
 * `VTI_ANSWER_HOLD_MS` waits for this one's answer rather than re-sending it.
 */
export class VtiSentNoAnswer extends Error {
  constructor(
    /** The Trust Task type that was sent. */
    readonly taskType: string,
    /** The request's `threadId` — what the community's answer threads on. Absent when the ask was not recorded. */
    readonly requestId: string | undefined,
    /** When it was first sent (ms since the epoch). */
    readonly sentAt: number | undefined,
    readonly communityDid?: string
  ) {
    super(`vtiAgent: sent ${taskName(taskType)}; the community has not answered yet`)
    this.name = 'VtiSentNoAnswer'
  }
}

/**
 * A DIDComm message carrying a Trust Task in the binding envelope, presented
 * as the task itself: the envelope's `type` swapped for the document's own.
 * Since vti #1687 a VTC takes Trust Tasks over DIDComm only in the envelope,
 * and binding §5 has it reply in one too — which it does not yet (it replies
 * typed as the document), so both shapes have to read the same downstream.
 */
export function unwrapBindingEnvelope(plaintext: DidCommV2PlaintextMessage): DidCommV2PlaintextMessage {
  if (plaintext.type !== TRUST_TASK_V2_ENVELOPE_TYPE) return plaintext
  const inner = (plaintext.body as { type?: unknown } | undefined)?.type
  return typeof inner === 'string' && inner ? { ...plaintext, type: inner } : plaintext
}

/**
 * A community refusing, in its own terms. `code` is the framework's — e.g.
 * `taskFailed` for a business-rule conflict such as an application that is
 * already open — and belongs behind a Details control rather than in the
 * sentence a person reads.
 */
export class VtiRefusal extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** The framework's `details`, when the refusal carries any (a consent challenge does). */
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'VtiRefusal'
  }
}

/**
 * What a join-request refusal means for the applicant, read from its code.
 *
 * The codes are declared per task (`vtc/join-requests/withdraw:notFound`,
 * `…/supplement:alreadyDecided`, `…/supplement:notAwaitingEvidence`), so the
 * meaning is the part after the colon — never the prose, which a community
 * may word as it likes. `alreadyDecided` means an outcome stands and the
 * applicant should be shown it; `notFound` means there is nothing open to act
 * on; `notAwaitingEvidence` means the request is queued for a decision the
 * community owes, so supplying more changes nothing.
 */
export type JoinRequestRefusal = 'notFound' | 'alreadyDecided' | 'notAwaitingEvidence' | 'requestAlreadyOpen'

/**
 * Why a community refused a member's request to leave, from its code:
 * `notMember` — the caller is not (or no longer) a member, so there is nothing
 * to remove; `lastAdmin` — leaving would leave the community without an admin.
 */
export const selfRemoveRefusal = (refusal: unknown): 'notMember' | 'lastAdmin' | undefined => {
  if (!(refusal instanceof VtiRefusal)) return undefined
  const reason = refusal.code.split(':').pop() ?? ''
  if (reason === 'notMember') return 'notMember'
  if (/last.?admin/i.test(reason)) return 'lastAdmin'
  return undefined
}

/** A join request's state, as the community's status task states it (`join-requests/status/0.1`). */
export interface JoinRequestStatus {
  requestId?: string
  status: 'pending' | 'deferred' | 'approved' | 'rejected' | 'withdrawn' | (string & {})
  /** While `deferred`: what the applicant must supply. */
  needs?: string[]
  /** While `deferred`: the evidence to present next. */
  presentationDefinition?: unknown
  /** While `rejected`: a stable code, the decider's words when there were any, and when it was decided. */
  code?: string
  reason?: string
  decidedAt?: string
}

export const joinRequestRefusal = (refusal: unknown): JoinRequestRefusal | undefined => {
  if (!(refusal instanceof VtiRefusal)) return undefined
  const reason = refusal.code.split(':').pop()
  return reason === 'notFound' ||
    reason === 'alreadyDecided' ||
    reason === 'notAwaitingEvidence' ||
    reason === 'requestAlreadyOpen'
    ? reason
    : undefined
}

/**
 * The applicant's request that is still open, when a submit is refused
 * because one is (`vtc/join-requests/submit:requestAlreadyOpen`, vti #1592).
 *
 * The refusal's `details` names it: `requestId` is what withdraw and supplement
 * take, and `status` says who the request is waiting on — `deferred` waits on
 * the applicant (supply what was asked, or withdraw), `pending` on the
 * community (it will move on its own). A status the client does not know is
 * passed through as it came, so a screen can still offer withdraw.
 */
export interface OpenJoinRequest {
  requestId: string
  status: 'pending' | 'deferred' | (string & {})
}

export const openJoinRequestOf = (refusal: unknown): OpenJoinRequest | undefined => {
  if (joinRequestRefusal(refusal) !== 'requestAlreadyOpen') return undefined
  const details = (refusal as VtiRefusal).details as { requestId?: unknown; status?: unknown } | undefined
  if (typeof details?.requestId !== 'string' || !details.requestId) return undefined
  return { requestId: details.requestId, status: typeof details.status === 'string' ? details.status : 'pending' }
}

/** A refusal arrives as a document in its own right, not as a verdict. */
const refusalOf = (plaintext: DidCommV2PlaintextMessage): VtiRefusal | undefined => {
  if (!String(plaintext.type ?? '').startsWith(TASK_ERROR)) return undefined
  const payload = (plaintext.body as { payload?: { code?: string; message?: string; details?: unknown } } | undefined)
    ?.payload
  return new VtiRefusal(
    payload?.code ?? 'unknown',
    payload?.message ?? 'The community refused the request.',
    payload?.details
  )
}

/** A DIDComm problem-report, presented as the trust-task-error `refusalOf` reads. */
const problemReportAsRefusal = (plaintext: DidCommV2PlaintextMessage): DidCommV2PlaintextMessage => {
  const report = (plaintext.body ?? {}) as { code?: unknown; comment?: unknown }
  return {
    ...plaintext,
    type: `${TASK_ERROR}problem-report`,
    body: {
      payload: {
        code: typeof report.code === 'string' ? report.code : 'problem-report',
        message: typeof report.comment === 'string' ? report.comment : 'The community could not read the request.',
      },
    },
  }
}

/** How far the connection has got, in the words the Connecting screen uses. */
export type VtiAgentStatus = 'disconnected' | 'resolving' | 'authenticating' | 'connected' | 'failed'

export interface VtiAgentState {
  status: VtiAgentStatus
  /** The DID this wallet presents to a community — its member identity. */
  did?: string
  /** The mediator's host, which is what a person can recognise. */
  host?: string
  error?: string
  /** What this session sends on the peer leg, and whether it can open TSP. */
  peerLeg?: PeerLegCarriage
  tspReady?: boolean
  /** What each peer was observed to speak (diagnostic; never fed back into packing). */
  peerRevisions?: PeerRevisionRecord[]
}

/** A community's published join criteria, as a manifest states them. */
export interface VtiCriterion {
  id?: string
  description?: string
  /** Per-criterion digest — what an applicant is held to (manifest/0.2). */
  requirementsDigest?: string
  /** The vetting requirement object, when the criterion needs peer vetting. */
  vetting?: {
    version?: string
    statementType?: string
    minStatements?: number
    acceptedMethods?: string[]
    requiredClaims?: string[]
    maxStatementAge?: string
    eligibleVetters?: Record<string, unknown>
    independence?: Record<string, unknown>
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface VtiManifest {
  communityDid?: string
  criteria: VtiCriterion[]
  requirementsDigest?: string
  /**
   * What the community calls itself. Optional and often absent: a community
   * publishes none until its admin sets one, so a screen must read well
   * without it.
   */
  branding?: {
    displayName?: string
    accentColor?: string
    logoUrl?: string
    [key: string]: unknown
  }
}

/** What a community decided, and what it is still waiting for. */
export interface VtiVerdict {
  requestId?: string
  effect: string
  needs: string[]
  /** Everything the verdict carried — an `allow` brings the membership card here. */
  with?: Record<string, unknown>
}

type Listener = () => void

/**
 * One request `ask` sent, until it is answered or its hold runs out.
 *
 * Correlated the way the VTC threads its answer, which differs by carriage:
 * over DIDComm the reply's `thid` is the request MESSAGE's id (vtc-service
 * `envelope_task_handler`: `thid = msg.id`), over TSP there is no message and
 * the reply document's `threadId` is the request document's `threadId`
 * (Trust Tasks SPEC §4.9, which `handle_tsp` returns as-is). `correlation`
 * holds every id either can carry: the document's `threadId` and `id`, and
 * each DIDComm message id it was sent under.
 */
interface AskEntry {
  /** The request document's `threadId`. */
  id: string
  did: string
  communityDid: string
  type: string
  /** The payload as sent, so a repeat of the same ask can be recognised. */
  payloadKey: string
  write: boolean
  correlation: Set<string>
  /** First send, and the latest one (the stale-redelivery guard reads the latest). */
  sentAt: number
  lastSentAt: number
  /** Callers waiting on it now. */
  waiters: ((plaintext: DidCommV2PlaintextMessage) => void)[]
  /** Set when the answer clock ran out: until then a late answer is kept. */
  heldUntil?: number
  /** A late answer, kept for the next caller. */
  answer?: DidCommV2PlaintextMessage
}

const hostOf = (endpoint?: string) => {
  if (!endpoint) return undefined
  const match = /^[a-z]+:\/\/([^/]+)/i.exec(endpoint)
  return match?.[1]
}

class VtiAgentController {
  private state: VtiAgentState = { status: 'disconnected' }
  private listeners = new Set<Listener>()
  private session?: VtiMediatorSession
  private mediator?: VtiMediatorEndpoints
  private agent?: Agent
  /**
   * The requests in flight, and those whose clock ran out still held for a
   * late answer, by the request's `threadId`. Each is answered by a message
   * that threads on it (see `AskEntry`) and whose type is the request's
   * `#response` or a trust-task-error, or by a DIDComm problem-report threaded
   * on it. One slot matched by type used to hold them: a status poll asked
   * during a submit took the submit's slot, and the submit's answer was lost.
   * Measured on the Eucalyptus train, a community also sends unsolicited
   * messages right after a verdict — the credentials, over
   * `credential-exchange/issue` — so "first message after send" is no longer
   * a reply. Those go to the inbox.
   */
  private readonly asks = new Map<string, AskEntry>()
  /** How long `ask` waits for an answer when the caller names no time. */
  answerTimeoutMs = 30000
  private inbox: ((plaintext: DidCommV2PlaintextMessage) => void | Promise<void>)[] = []
  private tsp?: TspSessionIdentity
  /** The persona this session speaks as, when it is one: its borrowed signing key signs what a spec requires. */
  private persona?: VtiPersona
  /**
   * §4.2: the envelope chosen for each peer, decided once per session and kept.
   * Deciding per message would let one unreachable peer flap a session between
   * two envelope formats; the plan asks for a session-scoped choice, logged.
   */
  private readonly carriageByPeer = new Map<string, Carriage>()
  /**
   * How each peer last reached us, by its DID (the DIDComm sender, the TSP
   * sender, and the document's issuer). A reply goes back the same way: a
   * peer that wrote over DIDComm reads DIDComm, whatever its DID document
   * advertises. Measured 2026-09-24: an openvtc vetter opened a session over
   * DIDComm from a persona that advertises TSPTransport; Keyring answered with
   * TSP frames, five times, and the vetter never saw the card.
   */
  private readonly inboundCarriage = new Map<string, Carriage>()

  private noteInbound(plaintext: DidCommV2PlaintextMessage, carriage: Carriage, sender?: string): void {
    const issuer = (unwrapBindingEnvelope(plaintext).body as { issuer?: unknown } | undefined)?.issuer
    for (const did of [sender, plaintext.from, issuer]) {
      if (typeof did === 'string' && did.startsWith('did:')) this.inboundCarriage.set(did, carriage)
    }
  }

  /** How `peerDid` last reached us, if it has — what a reply to it should use. */
  inboundCarriageOf(peerDid: string): Carriage | undefined {
    return this.inboundCarriage.get(peerDid)
  }

  /**
   * Can this session START a TSP conversation with a peer it has no
   * relationship with?
   *
   * Holding a TSP identity is necessary and not sufficient. Rev 3 requires an
   * introduction before any traffic, and a peer that does not get one drops
   * what follows without answering — so choosing TSP without being able to
   * form a relationship produces silence, which is strictly worse than the
   * DIDComm we would otherwise have used. `tsp.CODEC_FORMS_RELATIONSHIPS`
   * carries that fact from the codec that knows it.
   */
  private canInitiateTsp(): boolean {
    return Boolean(this.tsp) && tsp.CODEC_FORMS_RELATIONSHIPS
  }

  /**
   * Relationships this wallet has already opened (§7.2.2), keyed by OUR DID
   * and the peer's: one invite per pair. The relationship is recorded on the
   * peer's side on arrival, and a second invite would be a fresh relationship,
   * not a repeat. Keyed by the pair because the controller reconnects as
   * different identities — a persona left and a new one made — and a greeting
   * one identity sent does not introduce another: measured 2026-09-22, a new
   * persona's join went out over TSP unannounced and the community discarded
   * it ("no relationship with …"), so the phone heard nothing.
   */
  private readonly greeted = new Set<string>()

  /** The mediator this session rides, kept because an invite must be ROUTED
   *  through it — a mediator refuses direct delivery unless configured for it. */
  private mediatorDid?: string

  /**
   * Send the invite that makes a peer willing to accept our traffic, once.
   *
   * A failure here is logged and not thrown: the send that follows is what
   * reports the outcome, and the peer may already know us from an earlier
   * session, in which case the invite was never needed.
   */
  private async ensureGreeted(toDid: string): Promise<void> {
    const session = this.session
    const did = this.state.did
    if (!session || !did || !this.tsp || !this.agent) return
    const pair = `${did} ${toDid}`
    if (this.greeted.has(pair)) return
    this.greeted.add(pair)
    try {
      // §5.3.3: a hop list ends at the destination's OWN VID, not its
      // intermediary's — so the path back to us is our mediator, then us.
      // Advertising the mediator alone is the Rev 2 shape, and a Rev 3 peer
      // cannot route an accept over it: the VTC logged "a routed message
      // requires at least one onward hop" and never answered the invite.
      // Upstream's own `form_relationship_routed` sends exactly this pair.
      const route = this.mediatorDid ? [this.mediatorDid, did] : []
      const invite = await greetPeerOverTsp(this.tsp, did, toDid, route)
      await session.sendTspFrame(invite.bytes)
      this.agent.config.logger.info(
        `${TSP_LOG_PREFIX} greeted ${toDid} with an XRFI invite (${invite.bytes.length} bytes, route ${route.length})`
      )
    } catch (error) {
      this.agent.config.logger.warn(`${TSP_LOG_PREFIX} could not greet ${toDid}: ${error}`)
    }
  }
  private peerRevisionStore?: TspPeerRevisionStore

  /**
   * Receive what the community sends that is not an answer (credentials,
   * statements). Return the work that stores it: the mediator is told the
   * message was taken only once every handler's promise has settled, and a
   * handler that rejects withholds that, so the message is delivered again.
   */
  onInbound(handler: (plaintext: DidCommV2PlaintextMessage) => void | Promise<void>): () => void {
    this.inbox.push(handler)
    return () => {
      this.inbox = this.inbox.filter((h) => h !== handler)
    }
  }

  private async deliver(received: DidCommV2PlaintextMessage): Promise<void> {
    const plaintext = unwrapBindingEnvelope(received)
    this.dropExpiredHolds()
    const entry = this.askAnswered(plaintext)
    if (entry) {
      this.settle(
        entry,
        String(plaintext.type ?? '') === PROBLEM_REPORT ? problemReportAsRefusal(plaintext) : plaintext
      )
      return
    }
    // Every handler runs, whatever another does: one handler's failure must
    // not lose the message for the others. Any failure then fails the
    // delivery, so the session withholds the ack and the message comes back —
    // which is why a handler must be safe to run twice on one message.
    const results = await Promise.allSettled(this.inbox.map(async (handler) => handler(plaintext)))
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failed.length > 0) {
      const reason = failed[0].reason
      throw new Error(
        `vtiAgent: ${failed.length} inbound handler(s) failed on ${String(plaintext.type ?? '')}; left on the mediator for redelivery: ${
          reason instanceof Error ? reason.message : String(reason)
        }`
      )
    }
  }

  /**
   * The ask `plaintext` answers, if any.
   *
   * By thread first: the reply document's `threadId` (TSP, and the body of a
   * DIDComm reply — SPEC §4.9 has a response carry the request's), the
   * DIDComm `thid` (vtc-service threads it on the request message's id) or
   * `pthid`. A reply that names a thread no ask holds is not an answer — it
   * belongs to an ask already settled or dropped — and goes to the inbox.
   *
   * By type only when the reply names no thread at all. The VTC sends one:
   * a request body that does not parse is refused with an unrouted
   * trust-task-error whose `threadId` is null (vtc-service
   * `trust_tasks/helpers.rs` `body_parse_error_response`), and over TSP there
   * is no DIDComm `thid` to stand in for it (`handle_tsp` sends the document
   * bare). Such a reply goes to the oldest ask it could answer, waiting ones
   * first, and only if it is not older than that ask's send: a reply older
   * than the request is a re-delivery of a stale message (a poll draining the
   * queue), never the answer — created_time is seconds. A problem-report is
   * never matched by type: it answers only the request it threads on.
   */
  private askAnswered(plaintext: DidCommV2PlaintextMessage): AskEntry | undefined {
    const type = String(plaintext.type ?? '')
    const answersTask = (entry: AskEntry) => type === `${entry.type}#response` || type.startsWith(TASK_ERROR)
    const threadId = (plaintext.body as { threadId?: unknown } | undefined)?.threadId
    const threads = [threadId, plaintext.thid, plaintext.pthid].filter(
      (id): id is string => typeof id === 'string' && id.length > 0
    )
    if (threads.length) {
      for (const entry of this.asks.values()) {
        if (!threads.some((id) => entry.correlation.has(id))) continue
        // A refusal at the DIDComm layer — a malformed or unsupported message —
        // comes as a problem-report threaded on the request (vti #1687 threads
        // it), never as a Trust Task. Unanswered, it read as "the community did
        // not answer" and hid the community's own reason; present it as the
        // refusal it is.
        if (answersTask(entry) || type === PROBLEM_REPORT) return entry
      }
      return undefined
    }
    if (type === PROBLEM_REPORT) return undefined
    const fresh = (entry: AskEntry) =>
      typeof plaintext.created_time !== 'number' || plaintext.created_time * 1000 >= entry.lastSentAt - 5000
    const candidates = [...this.asks.values()]
      .filter((entry) => !entry.answer && answersTask(entry) && fresh(entry))
      .sort((a, b) => a.sentAt - b.sentAt)
    return candidates.find((entry) => entry.waiters.length) ?? candidates[0]
  }

  /** Hand an answer to whoever waits on the ask, or keep it for the next caller. */
  private settle(entry: AskEntry, answer: DidCommV2PlaintextMessage): void {
    if (entry.waiters.length) {
      this.asks.delete(entry.id)
      for (const resolve of entry.waiters.splice(0)) resolve(answer)
      return
    }
    entry.answer = answer
    this.agent?.config.logger.info(
      `vtiAgent: ${entry.communityDid} answered ${taskName(entry.type)} after its clock ran out — kept for the next caller`
    )
    this.listeners.forEach((listener) => listener())
  }

  private dropExpiredHolds(now = Date.now()): void {
    for (const [id, entry] of this.asks) {
      if (entry.heldUntil !== undefined && now >= entry.heldUntil && !entry.waiters.length) this.asks.delete(id)
    }
  }

  /**
   * Wait up to `timeoutMs` for the ask's answer. When the clock runs out the
   * ask is held for `VTI_ANSWER_HOLD_MS` rather than forgotten: its answer, if
   * it comes in that time, is kept (`settle`).
   */
  private waitFor(entry: AskEntry, timeoutMs: number): Promise<DidCommV2PlaintextMessage | undefined> {
    if (entry.answer) {
      this.asks.delete(entry.id)
      return Promise.resolve(entry.answer)
    }
    entry.heldUntil = undefined
    return new Promise((resolve) => {
      const waiter = (plaintext: DidCommV2PlaintextMessage) => {
        clearTimeout(timer)
        resolve(plaintext)
      }
      const timer = setTimeout(() => {
        entry.waiters = entry.waiters.filter((w) => w !== waiter)
        if (!entry.waiters.length) entry.heldUntil = Date.now() + VTI_ANSWER_HOLD_MS
        resolve(undefined)
      }, timeoutMs)
      entry.waiters.push(waiter)
    })
  }

  /**
   * A late answer to an ask whose clock ran out, if one arrived within
   * `VTI_ANSWER_HOLD_MS` — taken once. `requestId` narrows it to one request
   * (`VtiSentNoAnswer.requestId`); without it, the latest held answer to
   * `type` from that community. An identical `ask` takes it the same way.
   */
  takeHeldAnswer(communityDid: string, type: string, requestId?: string): DidCommV2PlaintextMessage | undefined {
    this.dropExpiredHolds()
    const held = [...this.asks.values()]
      .filter(
        (entry) =>
          entry.answer &&
          entry.communityDid === communityDid &&
          entry.type === type &&
          (!requestId || entry.id === requestId)
      )
      .sort((a, b) => b.sentAt - a.sentAt)[0]
    if (!held) return undefined
    this.asks.delete(held.id)
    return held.answer
  }

  /**
   * The error for an `ask` that came back unanswered: the latest such request
   * of `type` to that community, as `VtiSentNoAnswer`. For callers of `ask`,
   * which returns undefined on silence.
   */
  sentNoAnswer(communityDid: string, type: string): VtiSentNoAnswer {
    const entry = [...this.asks.values()]
      .filter((e) => e.communityDid === communityDid && e.type === type && !e.waiters.length)
      .sort((a, b) => b.sentAt - a.sentAt)[0]
    return new VtiSentNoAnswer(type, entry?.id, entry?.sentAt, communityDid)
  }

  getState = (): VtiAgentState => this.state

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private set(next: Partial<VtiAgentState>) {
    this.state = { ...this.state, ...next }
    this.listeners.forEach((listener) => listener())
  }

  /**
   * Resolve the mediator a VTI agent advertises, mint this wallet's member DID,
   * log in and hold the socket. Idempotent while the socket is open.
   */
  /**
   * A community whose TSP endpoint is behind another mediator than ours is
   * asked over DIDComm from the start. Across two mediators a TSP
   * relationship has not once completed (VTI-Q15: the Farm to storm's
   * first-vtc, and the Farm to a Farm Full Stack's own mediator — the invite is
   * stored for the community and nothing comes back), and waiting out a TSP
   * timeout first made a first Join look like a hang. On one mediator (the lab)
   * TSP is kept, and `ask`'s TSP→DIDComm fallback stays as the safety net
   * for reads (a write is never sent twice; see `VTI_READ_TASKS`).
   */
  private async preferDidcommAcrossMediators(communityDid: string): Promise<void> {
    if (!this.agent || this.carriageByPeer.has(communityDid) || !this.mediatorDid) return
    const theirs = await advertisedTspMediatorDid(this.agent, communityDid).catch(() => undefined)
    if (theirs && theirs !== this.mediatorDid) {
      this.carriageByPeer.set(communityDid, 'didcomm')
      this.agent.config.logger.info(
        `${TSP_LOG_PREFIX} ${communityDid} speaks TSP through ${theirs}, not our mediator — using DIDComm (VTI-Q15)`
      )
    }
  }

  /** The connect in flight, so a second caller waits for it instead of racing it. */
  private connecting?: Promise<void>

  /**
   * Open (or keep) the session as `identity` or `persona`.
   *
   * Serialised: a call made while another is in flight waits for it, then
   * re-checks — the persona inbox and a join can both ask for the same
   * persona, and two sockets for one DID end with the mediator closing one
   * (`w.websocket.duplicate-channel`).
   *
   * The mediator is the one the persona's own DID document names, when it
   * names one; `mediatorDid` is the fallback for an identity that advertises
   * none (a fresh did:peer) and for a persona whose document cannot be read.
   */
  async connect(
    agent: Agent,
    mediatorDid: string | undefined,
    options: {
      identity?: VtiClientIdentity
      /**
       * Connect as a persona: the DIDComm identity is derived from its
       * borrowed key-agreement key, and — so the peer leg can carry TSP —
       * its TSP identity from both borrowed keys. Preferred over `identity`
       * for anything that will talk to a vetter or an applicant.
       */
      persona?: VtiPersona
      /** Where to record what each peer speaks; in memory when absent. */
      peerRevisionStore?: TspPeerRevisionStore
    } = {}
  ): Promise<void> {
    while (this.connecting) await this.connecting.catch(() => undefined)
    const attempt = this.connectNow(agent, mediatorDid, options)
    this.connecting = attempt
    try {
      await attempt
    } finally {
      if (this.connecting === attempt) this.connecting = undefined
    }
  }

  private async connectNow(
    agent: Agent,
    configuredMediatorDid: string | undefined,
    options: { identity?: VtiClientIdentity; persona?: VtiPersona; peerRevisionStore?: TspPeerRevisionStore }
  ): Promise<void> {
    this.agent = agent
    const wantedDid = options.persona?.did ?? options.identity?.did
    if (this.session?.isOpen && (!wantedDid || wantedDid === this.state.did)) return
    if (this.session) await this.disconnect()
    try {
      this.set({ status: 'resolving', error: undefined })
      const own = options.persona
        ? await advertisedMediatorDid(agent, options.persona.did).catch(() => undefined)
        : undefined
      const mediatorDid = own ?? configuredMediatorDid
      if (!mediatorDid) throw new Error('vtiAgent: no mediator — the persona names none and none is configured')
      if (own && configuredMediatorDid && own !== configuredMediatorDid) {
        agent.config.logger.info(
          `vtiAgent: ${options.persona?.did} is reached through its own mediator ${own}, not the configured one`
        )
      }
      const mediator = await resolveVtiMediator(agent, mediatorDid)
      this.mediator = mediator
      this.mediatorDid = mediatorDid
      this.set({ status: 'authenticating', host: hostOf(mediator.wsEndpoint) })

      // Under §2.4 B the identity a community sees is a persona the VTA minted
      // and whose key the phone borrowed; the phone-minted did:peer is what the
      // proof-of-transport used, and stays as the fallback when no persona is given.
      let identity = options.identity
      let tspSession: TspSessionIdentity | undefined
      if (options.persona) {
        const kaKmsKeyId = options.persona.kmsKeyIds?.keyAgreement
        if (!kaKmsKeyId) throw new Error('vtiAgent: the persona has no borrowed key-agreement key')
        identity = await vtiClientIdentityFromPersona(agent, options.persona.did, kaKmsKeyId)
        // A persona without a borrowed signing key can still ride DIDComm; it
        // just cannot sign a TSP frame, and says so in the state.
        if (options.persona.kmsKeyIds?.signing) {
          tspSession = await tspSessionForPersona(agent, options.persona)
        }
      }
      identity ??= await vtiClientIdentityFromDid(agent, await createVtiClientDid(agent, mediator))
      const did = identity.did
      this.tsp = tspSession
      this.persona = options.persona
      this.peerRevisionStore = options.peerRevisionStore ?? this.peerRevisionStore
      const session = new VtiMediatorSession(agent, identity, mediator, {
        onError: (error) => this.set({ error: error.message }),
        onMessage: (plaintext) => {
          this.noteInbound(plaintext, 'didcomm')
          return this.deliver(plaintext)
        },
        ...(tspSession ? { onTspFrame: (bytes: Uint8Array) => this.receiveTspFrame(bytes, did) } : {}),
      })
      await session.start()
      // Discard any stale backlog the mediator flushes on live delivery before
      // a request could have a reply (see VtaClient.connect).
      await new Promise((resolve) => setTimeout(resolve, 2000))
      this.session = session
      const peerLeg = getPeerLegCarriage()
      if (peerLeg === 'tsp' && !tspSession) {
        agent.config.logger.warn(
          `${TSP_LOG_PREFIX} peer leg is wired for TSP but this session has no TSP identity; sending DIDComm`
        )
      }
      this.set({
        status: 'connected',
        did,
        peerLeg: peerLeg === 'tsp' && tspSession ? 'tsp' : 'didcomm',
        tspReady: Boolean(tspSession),
        peerRevisions: (await this.peerRevisionStore?.list().catch(() => undefined)) ?? this.state.peerRevisions ?? [],
      })
    } catch (error) {
      this.set({ status: 'failed', error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  async disconnect(): Promise<void> {
    await this.session?.stop()
    this.session = undefined
    // What this session asked can no longer be answered on it. A caller still
    // waiting runs out its own clock, as before.
    this.asks.clear()
    this.tsp = undefined
    this.persona = undefined
    this.set({ status: 'disconnected', did: undefined, error: undefined, peerLeg: undefined, tspReady: undefined })
  }

  /**
   * A TSP frame from the socket: open it as the persona, record the revision
   * the peer spoke, and deliver the Trust Task exactly as a DIDComm plaintext
   * would be. Throwing here withholds the acknowledgement, so a frame this
   * wallet could not open stays on the mediator rather than being lost.
   */
  private async receiveTspFrame(bytes: Uint8Array, myDid: string): Promise<void> {
    const tspSession = this.tsp
    const agent = this.agent
    if (!tspSession || !agent) throw new Error(`${TSP_LOG_PREFIX} no TSP identity on this session`)
    const result = await unpackTrustTaskFromPeer(tspSession, bytes, myDid)
    if (!result) {
      agent.config.logger.info(`${TSP_LOG_PREFIX} TSP frame opened but carried no Trust Task envelope; ignored`)
      return
    }
    const { plaintext, unpacked } = result
    const peeked = tsp.peekRevision(bytes)
    const record = await this.peerRevisionStore
      ?.observe(unpacked.sender, unpacked.revision, peeked.minor)
      .catch(() => undefined)
    agent.config.logger.info(
      `${TSP_LOG_PREFIX} received ${unpacked.revision} ${frameForm(bytes)} frame from ${unpacked.sender} (${bytes.length} bytes, type ${plaintext.type})`
    )
    if (record) {
      const others = (this.state.peerRevisions ?? []).filter((r) => r.vid !== record.vid)
      this.set({ peerRevisions: [...others, record] })
    }
    this.noteInbound(plaintext, 'tsp', unpacked.sender)
    await this.deliver(plaintext)
  }

  get isConnected(): boolean {
    return this.session?.isOpen === true
  }

  /** The DID this session presents. */
  get did(): string | undefined {
    return this.state.did
  }

  /** What this session will put on the wire for the next `send`. */
  get peerLeg(): PeerLegCarriage {
    return this.state.peerLeg ?? 'didcomm'
  }

  /**
   * Send one Trust Task document to a peer without waiting — the reply, if
   * any, reaches the inbox threaded on the document's id. For the peer path
   * (applicant ↔ vetter) where a human answers minutes later. The document is
   * signed by the caller when the spec requires it (every vetting task does).
   *
   * On a build wired for TSP the document travels as a TSP Rev 3 direct
   * message in the Trust Tasks TSP binding envelope; otherwise as a DIDComm
   * v2 plaintext. The reply comes back the way the peer's build sends.
   */
  async send(
    toDid: string,
    type: string,
    document: Record<string, unknown>,
    options: { thid?: string; expiresInSec?: number } = {}
  ): Promise<void> {
    const session = this.session
    const did = this.state.did
    if (!session || !did) throw new Error('vtiAgent: not connected')
    // Two ways to end up on TSP for a peer leg, and they are not the same
    // thing. `peerLeg` is OUR setting — the wallet-to-wallet carriage toggle,
    // used where the peer is another wallet whose did:peer document advertises
    // no transports at all, so there is nothing to read. §4.2's rule applies to
    // a peer that publishes a document: if it advertises TSPTransport and we
    // hold a TSP identity, we speak TSP whether or not the toggle is on.
    //
    // Both apply only when we start the conversation. A peer that has already
    // written to us is answered the way it wrote (`inboundCarriage`).
    const inbound = this.inboundCarriage.get(toDid)
    const capable =
      inbound !== undefined
        ? inbound === 'tsp'
        : this.peerLeg === 'tsp' ||
          (this.agent
            ? (await chooseCarriage(this.agent, toDid, this.canInitiateTsp(), { decided: this.carriageByPeer })) ===
              'tsp'
            : false)
    if (capable && this.tsp && this.agent) {
      await this.ensureGreeted(toDid)
      const packed = await packTrustTaskForPeer(this.tsp, did, toDid, {
        ...document,
        type: String(document.type ?? type),
      })
      await session.sendTspFrame(packed.bytes)
      this.agent.config.logger.info(
        `${TSP_LOG_PREFIX} sent ${packed.revision} ${frameForm(packed.bytes)} frame to ${toDid} (${packed.bytes.length} bytes, type ${type})`
      )
      return
    }
    const now = Math.floor(Date.now() / 1000)
    await session.sendTo(toDid, {
      id: `urn:uuid:${utils.uuid()}`,
      typ: 'application/didcomm-plain+json',
      type,
      from: did,
      to: [toDid],
      ...(options.thid ? { thid: options.thid } : {}),
      created_time: now,
      expires_time: now + (options.expiresInSec ?? 900),
      body: document,
    })
  }

  /**
   * Send one Trust Task document and wait for the community's answer. The VTC
   * reads the DIDComm body as a whole document where a VTA takes a bare
   * payload — measured in `tsp-reference/ref-20`.
   *
   * Undefined means the request WAS sent and nothing answered it in time (a
   * failure to send throws); `sentNoAnswer` names it for the caller. The ask
   * is then held for `VTI_ANSWER_HOLD_MS`: an answer arriving in that time is
   * kept, and the same ask made again — same session, community, task and
   * payload — takes that answer, or, for a write, waits on the request already
   * sent rather than sending a second one.
   */
  async ask(
    communityDid: string,
    type: string,
    payload: Record<string, unknown>,
    timeoutMs = this.answerTimeoutMs
  ): Promise<DidCommV2PlaintextMessage | undefined> {
    const session = this.session
    const did = this.state.did
    if (!session || !did) throw new Error('vtiAgent: not connected')

    this.dropExpiredHolds()
    const write = !isVtiReadTask(type)
    const payloadKey = JSON.stringify(payload)
    const earlier = [...this.asks.values()].find(
      (e) => e.did === did && e.communityDid === communityDid && e.type === type && e.payloadKey === payloadKey
    )
    if (earlier?.answer) return this.waitFor(earlier, timeoutMs)
    if (earlier && write) {
      this.agent?.config.logger.info(
        `vtiAgent: ${taskName(type)} was already sent to ${communityDid} and is unanswered — waiting on it, not sending it again`
      )
      return this.waitFor(earlier, timeoutMs)
    }

    const threadId = `urn:uuid:${utils.uuid()}`
    // Registered before anything is sent, so an answer that comes back at once
    // finds it, and an identical write asked meanwhile waits on this one.
    const entry: AskEntry = {
      id: threadId,
      did,
      communityDid,
      type,
      payloadKey,
      write,
      correlation: new Set([threadId]),
      sentAt: Date.now(),
      lastSentAt: Date.now(),
      waiters: [],
    }
    this.asks.set(threadId, entry)
    try {
      return await this.sendAsk(session, did, entry, payload, timeoutMs)
    } catch (error) {
      // Nothing to hold for a request that did not go out.
      this.asks.delete(threadId)
      throw error
    }
  }

  /** `ask`'s sending half: one document, over TSP or DIDComm, and the wait for its answer. */
  private async sendAsk(
    session: VtiMediatorSession,
    did: string,
    entry: AskEntry,
    payload: Record<string, unknown>,
    timeoutMs: number
  ): Promise<DidCommV2PlaintextMessage | undefined> {
    const { communityDid, type, write, id: threadId } = entry
    // One document for either carriage, addressed and dated as the framework
    // requires (`issuer`, `recipient`, `issuedAt`), and signed as the persona
    // when the task's specification declares the proof REQUIRED.
    const document = await this.taskDocument(communityDid, type, payload, threadId)
    entry.correlation.add(String(document.id))
    entry.sentAt = entry.lastSentAt = Date.now()

    // §4.2 on the ecosystem leg. Unlike `send()` there is no toggle here on
    // purpose: a community publishes a resolvable document, so its own
    // advertisement is the whole answer and a local flag could only contradict
    // it. The reply arrives through `deliver()` either way — `receiveTspFrame`
    // presents an opened TSP envelope as the same plaintext shape — so nothing
    // downstream of `ask` needs to know which envelope carried it.
    if (this.agent && this.tsp) {
      await this.preferDidcommAcrossMediators(communityDid)
      const carriage = await chooseCarriage(this.agent, communityDid, this.canInitiateTsp(), {
        decided: this.carriageByPeer,
      })
      if (carriage === 'tsp') {
        await this.ensureGreeted(communityDid)
        const packed = await packTrustTaskForPeer(this.tsp, did, communityDid, document)
        await session.sendTspFrame(packed.bytes)
        this.agent.config.logger.info(
          `${TSP_LOG_PREFIX} asked ${communityDid} ${type} over ${packed.revision} ${frameForm(packed.bytes)} (${packed.bytes.length} bytes)`
        )
        const viaTsp = await this.waitFor(entry, timeoutMs)
        if (viaTsp) return viaTsp
        // A community can advertise TSPTransport and not answer it — measured
        // on the VTA Farm's first-vtc (VTI-Q15): its mediator stores the frame
        // and nothing comes back. Keep DIDComm for this community for the rest
        // of the session.
        this.carriageByPeer.set(communityDid, 'didcomm')
        // A write is not sent again: silence is not proof the community did not
        // get it — a submit it received and deferred is silent until it
        // answers — and a second copy is a second submit (`requestAlreadyOpen`)
        // or a second withdraw. It stays held for its late answer.
        if (write) {
          this.agent.config.logger.warn(
            `${TSP_LOG_PREFIX} ${communityDid} did not answer ${type} over TSP in ${timeoutMs}ms — a write, so not sent again over DIDComm`
          )
          return undefined
        }
        // A read is asked once more over DIDComm.
        this.agent.config.logger.warn(
          `${TSP_LOG_PREFIX} ${communityDid} did not answer ${type} over TSP in ${timeoutMs}ms — asking over DIDComm`
        )
      }
    }

    // Over DIDComm a Trust Task rides the binding envelope — its `type` is the
    // envelope's, the document is the body. A VTC refuses the task typed as
    // itself since vti #1687 (VTI-42), and served the envelope before it.
    const now = Math.floor(Date.now() / 1000)
    const messageId = `urn:uuid:${utils.uuid()}`
    // The VTC threads its DIDComm reply, and any problem-report, on this id.
    entry.correlation.add(messageId)
    entry.lastSentAt = Date.now()
    await session.sendTo(communityDid, {
      id: messageId,
      typ: 'application/didcomm-plain+json',
      type: TRUST_TASK_V2_ENVELOPE_TYPE,
      from: did,
      to: [communityDid],
      thid: threadId,
      created_time: now,
      expires_time: now + 300,
      body: document,
    })
    return this.waitFor(entry, timeoutMs)
  }

  /**
   * The Trust Task document `ask` sends: from this session's DID to the
   * community, dated, and — for a task whose specification declares the proof
   * REQUIRED — signed with the persona's borrowed key under the verification
   * method its DID document names, exactly as a vetting task is signed. A VTC
   * checks that the proof's key belongs to the document's `issuer`, so the
   * issuer is the persona and nothing else.
   *
   * A session that is not a persona (a phone-minted did:peer) has no key a
   * community could resolve, and a persona without a borrowed signing key
   * cannot sign: either sends the document unsigned and says so, because a
   * community before vti #1672 still accepts it and one after refuses it with
   * `proofRequired` — an answer the caller already surfaces — rather than
   * the wallet failing silently before asking.
   */
  private async taskDocument(
    communityDid: string,
    type: string,
    payload: Record<string, unknown>,
    threadId: string
  ): Promise<Record<string, unknown>> {
    const document: Record<string, unknown> = {
      id: `urn:uuid:${utils.uuid()}`,
      type,
      threadId,
      issuer: this.state.did,
      recipient: communityDid,
      issuedAt: new Date().toISOString(),
      payload,
    }
    if (!SIGNED_TASKS.has(type)) return document
    const persona = this.persona
    const agent = this.agent
    if (!agent || !persona || persona.did !== this.state.did || !persona.kmsKeyIds?.signing) {
      agent?.config.logger.warn(`vtiAgent: ${type} needs a proof and this session cannot sign one; sending it unsigned`)
      return document
    }
    return signDocumentProof(agent, document, persona.did, {
      kmsKeyId: persona.kmsKeyIds.signing,
      verificationMethodId: persona.vtaKeyIds.signing,
    })
  }

  /**
   * What a community asks of an applicant, in its own words.
   *
   * `agent` is the caller's: a phone that has opened no community session yet
   * — a fresh one on its first Join — has given this controller none, and
   * without one the REST read below was skipped, so the manifest (and the
   * name the community publishes) could not be read before a session existed,
   * the one moment the REST read is for (Farm gate, 2026-09-23).
   */
  async fetchManifest(communityDid: string, agent?: Agent): Promise<VtiManifest> {
    const withAgent = agent ?? this.agent
    // Packing to the community resolves its document; warm that resolution
    // patiently so a tunnel's rate limit does not surface as a failed send.
    if (withAgent) await resolveDidDocumentRetrying(withAgent, communityDid)
    // A community answers the join manifest over REST with no session at all
    // (`POST {VTCRest}/v1/trust-tasks`), which is how an applicant can read
    // what is asked of them on a first join — before any channel exists — and
    // the fast path when one does. A community may switch that off, and a
    // wallet with a live session can always ask over DIDComm, so a failure
    // here is not an error: it falls through.
    const overRest = await this.manifestOverRest(communityDid, withAgent)
    if (overRest) return overRest
    const answer = await this.ask(communityDid, MANIFEST, {})
    // Each unanswered ask names its task and request (`VtiSentNoAnswer`):
    // three callers used to share one sentence, and a failed join could not
    // say which request went unanswered.
    if (!answer) throw this.sentNoAnswer(communityDid, MANIFEST)
    const refusal = refusalOf(answer)
    if (refusal) throw refusal
    const payload = (answer.body as { payload?: VtiManifest } | undefined)?.payload
    // Reading the manifest is how the app learns what a community calls
    // itself. Teaching the target here rather than at each screen means a
    // published name cannot be missed by whichever screen happened to fetch.
    communityTarget.publishedName(communityDid, payload?.branding?.displayName)
    return {
      communityDid: payload?.communityDid,
      criteria: payload?.criteria ?? [],
      requirementsDigest: payload?.requirementsDigest,
      branding: payload?.branding,
    }
  }

  /**
   * The manifest over the community's REST endpoint, which its DID document
   * advertises as a `VTCRest` service. Communities minted before vti #1615
   * publish it without the API's version prefix (VTI-15) and later ones with
   * it, so `/v1` is added only when it is missing. Returns undefined for
   * anything that is not a usable manifest — a community that has turned the
   * public read off, a network that is not there, an error document — so the
   * caller can fall back to asking over DIDComm.
   */
  private async manifestOverRest(communityDid: string, agent: Agent | undefined): Promise<VtiManifest | undefined> {
    if (!agent) return undefined
    try {
      const doc = await agent.dids.resolveDidDocument(communityDid)
      const service = doc.service?.find((s) => s.type === 'VTCRest')
      const base = typeof service?.serviceEndpoint === 'string' ? service.serviceEndpoint : undefined
      if (!base) return undefined
      const now = new Date().toISOString()
      const response = await fetch(vtcRestUrl(base, 'trust-tasks'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: `urn:uuid:${utils.uuid()}`,
          type: MANIFEST,
          threadId: `urn:uuid:${utils.uuid()}`,
          payload: {},
          issuer: this.state.did ?? communityDid,
          recipient: communityDid,
          issuedAt: now,
        }),
      })
      if (!response.ok) return undefined
      const body = (await response.json()) as { type?: string; payload?: VtiManifest } | undefined
      if (String(body?.type ?? '').startsWith(TASK_ERROR)) return undefined
      const payload = body?.payload
      if (!payload?.criteria) return undefined
      communityTarget.publishedName(communityDid, payload.branding?.displayName)
      return {
        communityDid: payload.communityDid,
        criteria: payload.criteria ?? [],
        requirementsDigest: payload.requirementsDigest,
        branding: payload.branding,
      }
    } catch {
      return undefined
    }
  }

  /** The verdict a submit or a supplement carries — deliberately the same shape. */
  private verdictOf(answer: DidCommV2PlaintextMessage | undefined, communityDid: string, type: string): VtiVerdict {
    if (!answer) throw this.sentNoAnswer(communityDid, type)
    const refusal = refusalOf(answer)
    if (refusal) throw refusal
    const payload = (
      answer.body as
        | {
            payload?: {
              requestId?: string
              verdict?: { effect?: string; with?: { needs?: string[] } & Record<string, unknown> }
            }
          }
        | undefined
    )?.payload
    return {
      requestId: payload?.requestId,
      effect: payload?.verdict?.effect ?? 'unstated',
      needs: payload?.verdict?.with?.needs ?? [],
      with: payload?.verdict?.with,
    }
  }

  private presentation(credentials?: unknown[]) {
    return {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiablePresentation'],
      holder: this.state.did,
      verifiableCredential: credentials ?? [],
    }
  }

  /**
   * Answer a deferral in place (`vtc/join-requests/supplement/0.1`) rather
   * than submitting again, which a community refuses while a request is open
   * (VTI-04). The presentation REPLACES the one on the request — the community
   * evaluates this one alone — so it must carry every statement, not only the
   * ones gathered since. Refusals surface as `VtiRefusal`; read them with
   * `joinRequestRefusal`.
   */
  async supplement(
    communityDid: string,
    options: { credentials?: unknown[]; requestId?: string; requirementsDigest?: string } = {}
  ): Promise<VtiVerdict> {
    const answer = await this.ask(communityDid, SUPPLEMENT, {
      vp: this.presentation(options.credentials),
      ...(options.requestId ? { requestId: options.requestId } : {}),
      ...(options.requirementsDigest ? { extensions: { requirementsDigest: options.requirementsDigest } } : {}),
    })
    return this.verdictOf(answer, communityDid, SUPPLEMENT)
  }

  /**
   * Ask where the applicant's own join request stands
   * (`vtc/join-requests/status/0.1`) — a read, never a resubmit. The id is
   * optional: without it the community resolves the request from who signs the
   * poll, which is how a request whose first answer was lost is found again.
   * Undefined when the community holds no such request (`notFound`); other
   * refusals surface as `VtiRefusal`.
   */
  async status(communityDid: string, options: { requestId?: string } = {}): Promise<JoinRequestStatus | undefined> {
    const answer = await this.ask(communityDid, STATUS, options.requestId ? { requestId: options.requestId } : {})
    if (!answer) throw this.sentNoAnswer(communityDid, STATUS)
    const refusal = refusalOf(answer)
    if (refusal) {
      if (joinRequestRefusal(refusal) === 'notFound') return undefined
      throw refusal
    }
    const payload = ((answer.body as { payload?: Record<string, unknown> } | undefined)?.payload ?? {}) as Record<
      string,
      unknown
    >
    const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
    const status = text(payload.status)
    if (!status) throw new Error('vtiAgent: the status answer names no status')
    return {
      requestId: text(payload.requestId),
      status,
      ...(Array.isArray(payload.needs)
        ? { needs: payload.needs.filter((n): n is string => typeof n === 'string') }
        : {}),
      ...(payload.presentationDefinition !== undefined
        ? { presentationDefinition: payload.presentationDefinition }
        : {}),
      // The refusal members mean a decision was taken: only ever with `rejected`.
      ...(status === 'rejected'
        ? { code: text(payload.code), reason: text(payload.reason), decidedAt: text(payload.decidedAt) }
        : {}),
    }
  }

  /**
   * Leave the community (`vtc/members/self-remove/0.1`, proof required). The
   * caller is the only target. `disposition` chooses what the community keeps
   * — `purge` erases the member's record, `tombstone` keeps a marker with no
   * personal data — and omitting it uses the community's default; the answer
   * says which was applied. Refusals surface as `VtiRefusal`; read them with
   * `selfRemoveRefusal`.
   */
  async selfRemove(
    communityDid: string,
    options: { disposition?: 'purge' | 'tombstone' } = {}
  ): Promise<{ did?: string; disposition: 'purge' | 'tombstone' | 'historical' | (string & {}); removed: boolean }> {
    const answer = await this.ask(
      communityDid,
      SELF_REMOVE,
      options.disposition ? { disposition: options.disposition } : {}
    )
    if (!answer) throw this.sentNoAnswer(communityDid, SELF_REMOVE)
    const refusal = refusalOf(answer)
    if (refusal) throw refusal
    const payload = (answer.body as { payload?: { did?: string; disposition?: string; removed?: boolean } } | undefined)
      ?.payload
    return {
      did: payload?.did,
      disposition: payload?.disposition ?? options.disposition ?? 'policydefault',
      removed: payload?.removed !== false,
    }
  }

  /**
   * Close the applicant's own open request (`vtc/join-requests/withdraw/0.1`),
   * which frees them to apply again. The id is optional by design: without it
   * the community resolves the request from who is asking.
   */
  async withdraw(
    communityDid: string,
    options: { requestId?: string; reason?: string } = {}
  ): Promise<{ requestId?: string; status: string }> {
    const answer = await this.ask(communityDid, WITHDRAW, {
      ...(options.requestId ? { requestId: options.requestId } : {}),
      ...(options.reason ? { reason: options.reason } : {}),
    })
    if (!answer) throw this.sentNoAnswer(communityDid, WITHDRAW)
    const refusal = refusalOf(answer)
    if (refusal) throw refusal
    const payload = (answer.body as { payload?: { requestId?: string; status?: string } } | undefined)?.payload
    return { requestId: payload?.requestId, status: payload?.status ?? 'withdrawn' }
  }

  /**
   * Apply. With no credentials in hand the honest presentation is an empty one:
   * the community answers `requestMore` naming what it still needs, rather than
   * the wallet guessing at requirements it cannot yet meet.
   *
   * `registryConsent` is the person's answer to "list me in the community's
   * public member directory" (VTI-Q14): the community publishes a member only
   * while it is true (vti #1682, #1691). Off unless the person turned it on.
   */
  async apply(
    communityDid: string,
    manifest: VtiManifest,
    options: { credentials?: unknown[]; requirementsDigest?: string; registryConsent?: boolean } = {}
  ): Promise<VtiVerdict> {
    // The presentation is unsigned: the community takes the holder from the
    // sealed envelope's sender (VTI-9), so what matters is that the
    // credentials inside name that same DID as their subject.
    const answer = await this.ask(communityDid, SUBMIT, {
      vp: this.presentation(options.credentials),
      registryConsent: options.registryConsent === true,
      // The community's `select_criterion` reads this digest to decide WHICH
      // criterion the applicant gathered against, and records
      // `applicant_digest_matches: false` when it is absent — which its policy
      // may weigh. With more than one vetting criterion an absent digest means
      // gathering against one and being judged against another, so send the
      // digest of the criterion this application was actually built for and
      // fall back to the manifest's only when there is nothing better.
      extensions: (() => {
        const digest = options.requirementsDigest ?? manifest.requirementsDigest
        return digest ? { requirementsDigest: digest } : {}
      })(),
    })
    return this.verdictOf(answer, communityDid, SUBMIT)
  }
}

export const vtiAgent = new VtiAgentController()

/**
 * A path under a community's REST API, from the `VTCRest` endpoint its DID
 * document advertises: with or without the `/v1` prefix (vti #1615 added it to
 * newly minted communities; older ones omit it), never doubled.
 */
export function vtcRestUrl(base: string, path: string): string {
  const root = base.replace(/\/+$/, '')
  return `${/\/v1$/.test(root) ? root : `${root}/v1`}/${path.replace(/^\/+/, '')}`
}
