/**
 * VtaClient — the phone as the manager of a personal VTA.
 *
 * Under §2.4 B of `community_vetting_subtask.md` every Keyring user has a VTA
 * of their own, and Keyring is its manager the way upstream's terminal client
 * and browser plugin are: it enrols once, then asks the agent to mint personas,
 * releases their keys for the moments the phone must act as one, and answers
 * the agent's questions. This is that surface, over the same DIDComm v2
 * transport the community leg uses (`VtiMediatorTransport`): a VTA advertises
 * the same kind of mediator a VTC does.
 *
 * What the wire looks like, measured against `vta-service` 0.28 at
 * `53a7cde4`: a Trust Task to a VTA travels as a DIDComm message of the
 * framework's **binding envelope type** whose body IS the Trust Task document
 * (`vta-service/src/messaging/handlers.rs`, `handle_trust_task`), and the
 * authcrypt sender is the authenticated caller — its ACL entry decides what it
 * may ask. The reply is a framework result or error document in a message of
 * the same envelope type.
 *
 * Deliberately separate from `vtiAgent` (the phone ↔ community leg): the two
 * present different identities — the manager identity here, a persona there —
 * and either can exist without the other.
 *
 * @module trust-tasks/module/VtaClient
 */

import type { Agent } from '@credo-ts/core'
import { chooseAgentLabel, verifiedAgentName, vtaNameFrom, type AgentLabel, type AgentNameDocument } from './agentLabel'
import { utils } from '@credo-ts/core'
import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'

import { TRUST_TASK_V2_ENVELOPE_TYPE, signCompactJws, signDocumentProof, tsp } from '@bifold/trust-tasks'

import { importVtaKey, type VtaExportedKey } from './vtaKeys'
import {
  createVtiClientDid,
  resolveVtiMediator,
  resolveDidDocumentRetrying,
  vtiClientIdentityFromDid,
  VtiMediatorSession,
  type VtiClientIdentity,
  type VtiMediatorEndpoints,
} from './VtiMediatorTransport'
import type { VtiIdentityStore, VtiManagerIdentity, VtiMintRequest, VtiPersona } from './VtiIdentityStore'
import { VtiRefusal } from './vtiAgent'
import { isDigestMultibase } from './vettingShape'
import { chooseCarriage, type Carriage } from './tspCapability'
import { packTrustTaskForPeer, tspSessionForManager, unpackTrustTaskFromPeer, type TspSessionIdentity } from './vtiTsp'

const LOG_PREFIX = '[TrustTasks:VtaClient]'
const TASK_ERROR = 'https://trusttasks.org/spec/trust-task-error/'
const PROBLEM_REPORT = 'https://didcomm.org/report-problem/2.0/problem-report'

/** The tasks this client speaks, by the URIs `vta-sdk` registers. */
export const VTA_TASK = {
  whoAmI: 'https://trusttasks.org/spec/auth/whoami/0.1',
  configShow: 'https://trusttasks.org/spec/config/show/0.1',
  contextsList: 'https://trusttasks.org/spec/vta/contexts/list/1.0',
  contextsCreate: 'https://trusttasks.org/spec/vta/contexts/create/1.0',
  didsList: 'https://trusttasks.org/spec/vta/webvh/dids/list/1.0',
  didsCreate: 'https://trusttasks.org/spec/vta/webvh/dids/create/1.0',
  keysExportSecret: 'https://trusttasks.org/spec/keys/export-secret/0.1',
  serversList: 'https://trusttasks.org/spec/vta/webvh/servers/list/1.0',
  consentRequest: 'https://trusttasks.org/spec/task-consent/request/0.1',
  consentDecision: 'https://trusttasks.org/spec/task-consent/decision/0.1',
  consentGranted: 'https://trusttasks.org/spec/task-consent/granted/0.1',
  aclSwapKey: 'https://trusttasks.org/spec/acl/swap-key/0.1',
  // The canonical ACL family (vta-sdk trust_tasks.rs:222-260), each gated by
  // `require_manage()` (vta-service trust_tasks/acl.rs:27-55, 57-84, 207-234).
  aclList: 'https://trusttasks.org/spec/acl/list/0.1',
  aclGrant: 'https://trusttasks.org/spec/acl/grant/0.1',
  aclRevoke: 'https://trusttasks.org/spec/acl/revoke/0.1',
  aclUpdate: 'https://trusttasks.org/spec/acl/update/0.1',
} as const

/** What a VTA sends an approver: the request document's payload (`consent_request.rs`). */
export interface VtaConsentRequest {
  challenge: string
  taskType: string
  payloadDigest: string
  requester: string
  approverSet: string
  minApprovals: number
  excludeRequester?: boolean
  expiresAt: string
  sideEffects?: unknown
  exposure?: unknown
  effects?: unknown
  subject?: string
  origin?: string
  [key: string]: unknown
}

export interface VtaWhoAmI {
  /** The VTA answers `roles` (array) and `scopes` (`ctx:<id>`), per its whoami spec. */
  roles?: string[]
  scopes?: string[]
  capabilities?: string[]
  role?: string
  contexts?: string[]
  [key: string]: unknown
}

export interface VtaContext {
  id: string
  name?: string
  did?: string
  [key: string]: unknown
}

/** `vta/webvh/dids/create/1.0`'s answer — the persona, and the VTA's ids for its keys. */
export interface VtaMintedDid {
  did: string
  contextId: string
  serverId?: string
  scid: string
  signingKeyId: string
  kaKeyId: string
  didDocument?: unknown
  [key: string]: unknown
}

/**
 * One row of a VTA's access list, as the canonical `AclEntry` spells it
 * (vta-sdk protocols/acl_management/entry.rs:174-233; the published schema is
 * `acl/_shared/0.1/acl-entry`). Only what Keyring reads is typed; the rest of a
 * row is ignored. `scopes` absent or empty on an admin row means unrestricted:
 * the agent's full administrator (vti-common acl/mod.rs:868-870).
 */
export interface VtaAclEntry {
  subject: string
  role: string
  scopes?: string[]
  label?: string
  /** RFC 3339; absent means the row never expires. */
  expiresAt?: string
  createdAt?: string
  createdBy?: string
}

/** The schema's bound on an entry's label (acl-entry.schema.json `label.maxLength`). */
const ACL_LABEL_MAX = 256

/** Read an `AclEntry` off the wire, keeping only the members Keyring uses; undefined if it is not one. */
function aclEntryFrom(value: unknown): VtaAclEntry | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.subject !== 'string' || typeof raw.role !== 'string') return undefined
  const text = (key: string) => (typeof raw[key] === 'string' ? { [key]: raw[key] as string } : {})
  return {
    subject: raw.subject,
    role: raw.role,
    ...(Array.isArray(raw.scopes) ? { scopes: raw.scopes.filter((s): s is string => typeof s === 'string') } : {}),
    ...text('label'),
    ...text('expiresAt'),
    ...text('createdAt'),
    ...text('createdBy'),
  }
}

/** The `{entry}` wrapper that `acl/grant` and `acl/revoke` answer with. */
function answeredEntry(task: string, answer: unknown): VtaAclEntry {
  const entry = aclEntryFrom((answer as { entry?: unknown } | undefined)?.entry)
  if (!entry) throw new Error(`${LOG_PREFIX} the VTA's answer to ${task} carries no entry`)
  return entry
}

const nowSec = () => Math.floor(Date.now() / 1000)

const CONSENT_REQUIRED = 'auth:consent_required'

/**
 * The consent challenge inside a refusal, when that is what the refusal is.
 *
 * The challenge normally rides in `details`, but a VTA drops `details` that
 * exceed the framework's size bound and sends the code alone — which one signed
 * request per approver reaches at three approvers (2026-09-21, "error `details`
 * exceeds the framework bound and was dropped"). The task is still held, so a
 * bare `auth:consent_required` is read as held too: there is nothing to relay
 * and no digest to wait on, but re-submitting still collects the grant.
 */
export function consentPendingOf(
  error: unknown
): { payloadDigest?: string; requests: Record<string, unknown>[]; omitted?: number } | undefined {
  if (!(error instanceof VtiRefusal)) return undefined
  const details = error.details as
    | {
        reason?: string
        payloadDigest?: string
        consentRequestsOmitted?: number
        consentRequests?: (Record<string, unknown> & { payload?: { payloadDigest?: string } })[]
      }
    | undefined
  if (details?.reason === CONSENT_REQUIRED) {
    const requests = details.consentRequests ?? []
    // Since vti #1680 the challenge's core members — `payloadDigest` among them
    // — are always in `details`; only the signed requests are dropped when they
    // do not fit, and `consentRequestsOmitted` counts them. Read the digest from
    // `details` first, so the grant can still be waited on precisely.
    const omitted = typeof details.consentRequestsOmitted === 'number' ? details.consentRequestsOmitted : undefined
    return {
      payloadDigest: details.payloadDigest ?? requests[0]?.payload?.payloadDigest,
      requests,
      ...(omitted !== undefined ? { omitted } : {}),
    }
  }
  if (details === undefined && (error.code === CONSENT_REQUIRED || error.message.includes(CONSENT_REQUIRED))) {
    return { requests: [] }
  }
  return undefined
}

/**
 * What a VTA's DID document tells a client: the mediator it is reached through.
 * A VTA's `#vta-didcomm` service names the mediator's DID as its endpoint; the
 * mediator's own document then carries the URLs.
 */
export async function resolveVtaMediator(agent: Agent, vtaDid: string): Promise<VtiMediatorEndpoints> {
  const doc = await resolveDidDocumentRetrying(agent, vtaDid)
  const services = (doc.service ?? []) as { type?: string; serviceEndpoint?: unknown }[]
  const endpoints = services
    .filter((s) => String(s.type) === 'DIDCommMessaging')
    .flatMap((s) => (Array.isArray(s.serviceEndpoint) ? s.serviceEndpoint : [s.serviceEndpoint]))
  const mediatorDid = endpoints
    .map((e) => (typeof e === 'string' ? e : (e as { uri?: string })?.uri))
    .find((uri) => typeof uri === 'string' && uri.startsWith('did:'))
  if (!mediatorDid) throw new Error(`${LOG_PREFIX} ${vtaDid} advertises no DIDComm mediator`)
  return resolveVtiMediator(agent, mediatorDid)
}

/**
 * The agent has nowhere to publish a new identity: no DID-hosting server is
 * registered with it, and the app names no serverless base URL. Only the
 * agent's operator can fix this, so it is not worth retrying.
 */
export class PersonaHostMissing extends Error {
  constructor(readonly vtaDid?: string) {
    super(`${LOG_PREFIX} the agent has no DID host to publish a new identity on`)
    this.name = 'PersonaHostMissing'
  }
}

/**
 * A swap whose outcome could not be settled: neither the key the phone signed
 * in with nor the successor it sent is accepted by the VTA right now, or the
 * VTA could not be asked. Both keys stay recorded — either may be the live one
 * — and the next connect asks again.
 */
export class ManagerKeyUnresolved extends Error {
  constructor(
    readonly vtaDid: string,
    readonly current: string,
    readonly next: string,
    /** Whether the VTA refused both keys outright, rather than one of them going unanswered. */
    readonly refusedBoth: boolean,
    /** What each probe got, for the log. */
    readonly detail: string
  ) {
    // Worded for the link machine's reading of a connect failure: only the
    // VTA's refusal of both keys reads as access revoked ("not in ACL"); a key
    // that went unanswered reads as a dropped session, which is retried.
    super(
      refusedBoth
        ? `${LOG_PREFIX} ${vtaDid} accepts neither of this phone's keys after a key swap (not in ACL); both are kept`
        : `${LOG_PREFIX} could not ask ${vtaDid} which of this phone's keys it knows after a key swap; both are kept and the next connect asks again`
    )
    this.name = 'ManagerKeyUnresolved'
  }
}

/**
 * The VTA's refusal of a sender it holds no live grant for. An envelope from a
 * DID not in the ACL, or whose entry has lapsed, is refused before dispatch as
 * a trust-task error `permissionDenied` whose reason is the ACL's own
 * `forbidden: DID not in ACL: <did>` / `forbidden: ACL entry expired: <did>`
 * (vta-service `messaging/auth.rs` `auth_for_trust_task_envelope`,
 * `trust_tasks/mod.rs` `reject_trust_task(PermissionDenied)`, vti-common
 * `acl/mod.rs` `check_acl_entry`); the reason travels as the error's
 * `message`. Read from the ACL's own words rather than the code alone, since
 * `permissionDenied` also covers policy refusals that say nothing about which
 * key the VTA knows. For a probe this is conclusive: the key is not (or no
 * longer) on the ACL.
 */
const NOT_ON_ACL = /not in (the )?ACL|ACL entry expired/i
function refusedAsNotOnAcl(error: unknown): boolean {
  return error instanceof VtiRefusal && NOT_ON_ACL.test(error.message)
}

/**
 * Harness-only: what to do with the answer to the next `acl/swap-key`.
 * `drop` — let the VTA perform the swap, then discard its answer as if the
 * socket had dropped, and recover in place. `drop-and-stop` — the same, but
 * leave the successor pending and fail, as an app killed mid-swap would, so a
 * relaunch's connect is what recovers. Honoured only in a `__DEV__` build; a
 * release build never drops an answer whatever is set.
 */
export type VtaSwapTestHook = 'drop' | 'drop-and-stop' | undefined
let swapTestHook: VtaSwapTestHook

/** Build-time wiring for the e2e harness, like `setPeerLegCarriage`: called once from the app's container. */
export function setVtaSwapTestHook(mode: string | undefined): void {
  swapTestHook = mode === 'drop' || mode === 'drop-and-stop' ? mode : undefined
}

/** The hook in force: always undefined outside a `__DEV__` build. */
export function activeSwapTestHook(): VtaSwapTestHook {
  return typeof __DEV__ !== 'undefined' && __DEV__ ? swapTestHook : undefined
}

type Probe = { kind: 'live' } | { kind: 'refused'; detail: string } | { kind: 'unknown'; detail: string }

export class VtaClient {
  private session?: VtiMediatorSession
  private mediator?: VtiMediatorEndpoints
  private identity?: VtiClientIdentity
  /**
   * Tasks are fully serialised (one in flight), so there is at most one reply
   * to wait for. The only thing to guard against is a stale message the mediator
   * redelivers at connect time — measured: a queued refusal of an earlier
   * unsigned `whoami` "answered" a later signed one. A message that arrived
   * before the current request was sent cannot be its reply, so it is dropped.
   * This does not depend on how the VTA threads a reply, which the framework
   * derives from its own result document rather than echoing our thread id.
   */
  private pending?: { resolve: (plaintext: DidCommV2PlaintextMessage) => void; sentAt: number }
  /** The manager's TSP identity, when this build and this wallet can supply one. */
  private tsp?: TspSessionIdentity
  /** §4.2's per-peer decision, taken once per session. */
  private readonly carriageByPeer = new Map<string, Carriage>()
  /** Whether the VTA has been greeted (§7.2.2) this session. */
  private greeted = false
  private queue: Promise<unknown> = Promise.resolve()

  private deliver(plaintext: DidCommV2PlaintextMessage): void {
    // A granted notice answers a wait, never a task.
    const body = plaintext.body as { type?: string; payload?: { payloadDigest?: string } } | undefined
    if (body?.type === VTA_TASK.consentGranted) {
      const digest = body.payload?.payloadDigest
      const wake = digest ? this.grantWaiters.get(digest) : undefined
      if (wake) {
        this.grantWaiters.delete(digest as string)
        wake()
      }
      this.options.onInbound?.(plaintext)
      return
    }
    const pending = this.pending
    // A reply older than the request is a re-delivery of a stale message (a
    // poll draining the queue), never the answer — created_time is seconds.
    const stale =
      typeof plaintext.created_time === 'number' && plaintext.created_time * 1000 < (pending?.sentAt ?? 0) - 5000
    if (!pending || stale) {
      this.options.onInbound?.(plaintext)
      return
    }
    this.pending = undefined
    pending.resolve(plaintext)
  }

  /** Grants this client is waiting for, by the payload digest the VTA names. */
  private grantWaiters = new Map<string, () => void>()

  constructor(
    private readonly agent: Agent,
    readonly vtaDid: string,
    private readonly store: VtiIdentityStore,
    private readonly options: {
      onError?: (error: Error) => void
      /** Anything the VTA sends that is not the answer to a task — a consent request, a granted notice. */
      onInbound?: (plaintext: DidCommV2PlaintextMessage) => void
      /** A task was held for an approver's consent; the wait is on. */
      onConsentPending?: (info: { taskType: string; payloadDigest?: string }) => void
      /** How long to wait for approvers before giving up on a held task. */
      consentWaitMs?: number
      /** How long a fresh session drains the mediator's backlog before the first send. */
      connectDrainMs?: number
      /** How long to wait for the answer to `acl/swap-key`. */
      swapTimeoutMs?: number
      /** How long each `whoami` asked while settling a swap waits for its answer. */
      probeTimeoutMs?: number
    } = {}
  ) {}

  /** The DID this phone presents to its VTA — enrolled on the VTA's ACL. */
  get managerDid(): string | undefined {
    return this.identity?.did
  }

  get isConnected(): boolean {
    return this.session?.isOpen === true
  }

  /**
   * Mint the manager identity if this phone has none for this VTA yet. Minting
   * is separate from connecting because enrolment sits between them: the VTA's
   * operator has to admit this DID before a session can be opened.
   */
  async ensureManagerIdentity(): Promise<string> {
    const existing = await this.store.getManager(this.vtaDid)
    if (existing) return existing.did
    this.mediator ??= await resolveVtaMediator(this.agent, this.vtaDid)
    const did = await createVtiClientDid(this.agent, this.mediator)
    await this.store.setManager({ vtaDid: this.vtaDid, did, createdAt: new Date().toISOString() })
    return did
  }

  async connect(): Promise<void> {
    if (this.session?.isOpen) return
    this.mediator ??= await resolveVtaMediator(this.agent, this.vtaDid)
    const did = await this.ensureManagerIdentity()
    // A swap this phone never saw the end of — the answer was lost, or the app
    // was killed while waiting for it — is settled before anything signs as
    // either key; settling leaves the session open as the key the VTA knows.
    const record = await this.store.getManager(this.vtaDid)
    if (record?.pendingNext) {
      this.agent.config.logger.info(
        `${LOG_PREFIX} a key swap is pending on connect (${record.pendingNext.did}); asking the VTA which key it knows`
      )
      await this.resolvePendingSwap(record)
      return
    }
    await this.openAs(did)
  }

  /** Open the session as `did`. */
  private async openAs(did: string): Promise<void> {
    this.mediator ??= await resolveVtaMediator(this.agent, this.vtaDid)
    this.identity = await vtiClientIdentityFromDid(this.agent, did)
    // Best effort: a wallet whose manager key cannot back TSP ports simply
    // stays on DIDComm, and §4.2 says so rather than failing the connect.
    // A temporary did:key stays on DIDComm: TSP delivery to a just-granted
    // key is not exercised upstream either (the VTA plugin leads with DIDComm
    // for its ephemeral did:key), and the key lasts only until the swap.
    this.tsp = did.startsWith('did:key:')
      ? undefined
      : await tspSessionForManager(this.agent, did).catch(() => undefined)
    this.greeted = false
    this.carriageByPeer.clear()
    const session = new VtiMediatorSession(this.agent, this.identity, this.mediator, {
      onError: (error) => this.options.onError?.(error),
      onMessage: (plaintext) => this.deliver(plaintext),
      // The VTA answers the way it was asked, so a request sent over TSP comes
      // back over TSP. Opened here and handed to the same `deliver` a DIDComm
      // reply reaches — unpacking presents the document in the plaintext shape
      // every caller already reads.
      ...(this.tsp
        ? {
            onTspFrame: async (bytes: Uint8Array) => {
              const opened = await unpackTrustTaskFromPeer(this.tsp as TspSessionIdentity, bytes, did)
              if (opened) this.deliver(opened.plaintext)
            },
          }
        : {}),
    })
    await session.start()
    this.session = session
    // Live delivery flushes whatever the mediator has queued for this DID —
    // and this DID is persisted, so that backlog can include stale replies from
    // earlier sessions. No reply to any request of ours can exist yet, so a
    // short drain with nothing pending discards the backlog before the first send.
    await new Promise((resolve) => setTimeout(resolve, this.options.connectDrainMs ?? 2000))
  }

  async disconnect(): Promise<void> {
    await this.session?.stop()
    this.session = undefined
    this.pending = undefined
  }

  /**
   * Send one Trust Task and wait for the VTA's answer. The document is the
   * DIDComm body; the message type is the framework's binding envelope, which is
   * what the VTA routes on. Serialised: the VTA answers on the same socket and a
   * reply carries no correlation a client can rely on, so one at a time.
   */
  async task<T = unknown>(
    type: string,
    payload: Record<string, unknown>,
    timeoutMs = 30000,
    /** Members beside `payload` on the signed document itself — e.g. `idempotencyKey`. */
    documentExtras: Record<string, unknown> = {},
    /** Called once the task has left the phone — the moment `timeoutMs` starts. */
    onSent?: () => void
  ): Promise<T> {
    const run = (): Promise<T> => this.sendTask<T>(type, payload, timeoutMs, documentExtras, onSent)
    // Chain behind whatever is in flight, but do not let one failure poison the next.
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next.catch(async (error: unknown) => {
      // A task the policy holds for consent is refused with
      // `details.reason = "auth:consent_required"` and the signed requests the
      // approvers were sent (policy_gate.rs). The grant that consent produces
      // is single-use and consumed by re-submitting the same payload.
      const pending = consentPendingOf(error)
      const waitMs = this.options.consentWaitMs ?? 180000
      if (!pending || waitMs <= 0) throw error
      this.options.onConsentPending?.({ taskType: type, payloadDigest: pending.payloadDigest })
      if (pending.omitted) {
        // Those approvers are reached only by the VTA's own push (vti #1680);
        // there is nothing of theirs for this phone to relay.
        this.agent.config.logger.info(
          `${LOG_PREFIX} ${type} is held for consent; ${pending.omitted} signed request(s) did not fit and were omitted`
        )
      }
      // The VTA can push a consent request only to a did:key approver
      // ("did:webvh … not wired yet → relay fallback", step_up.rs); for any
      // other approver it says "the approver learns of this request only if
      // the requester relays it" — and hands us the VTA-signed requests in the
      // refusal for exactly that. A CLI cannot relay; a phone can.
      await this.relayConsentRequests(pending.requests)
      // Then wait for the grant. The granted notice is route-gated the same
      // way, so do not rely on it alone: re-submit periodically on THIS client
      // (its session routes replies to it) — a re-submit while consent is
      // still pending is refused again, and the first one after the approval
      // consumes the grant.
      const deadline = Date.now() + waitMs
      let lastError: unknown = error
      while (Date.now() < deadline) {
        await this.awaitGrant(pending.payloadDigest, Math.min(8000, deadline - Date.now())).catch(() => undefined)
        try {
          return await this.sendTask<T>(type, payload, timeoutMs, documentExtras)
        } catch (retryError) {
          lastError = retryError
          if (!consentPendingOf(retryError)) throw retryError
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError))
    })
  }

  /** One send and its matched answer — no queue, no consent handling. */
  private async sendTask<T>(
    type: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
    documentExtras: Record<string, unknown> = {},
    onSent?: () => void
  ): Promise<T> {
    {
      const session = this.session
      const did = this.identity?.did
      if (!session || !did) throw new Error(`${LOG_PREFIX} not connected`)

      // A VTA's specifications require a proof on the document — measured as
      // "document refused by its specification's policy reason=ProofRequired"
      // on `auth/whoami/0.1` — where the community's join tasks did not. The
      // manager identity signs (eddsa-jcs-2022, the wallet's existing signer),
      // and it is the same DID the envelope is sealed from, which the VTA
      // checks (VTI-10).
      const threadId = `urn:uuid:${utils.uuid()}`
      const document = await signDocumentProof(
        this.agent,
        {
          id: `urn:uuid:${utils.uuid()}`,
          type,
          threadId,
          payload,
          issuer: did,
          recipient: this.vtaDid,
          issuedAt: new Date().toISOString(),
          // Covered by the proof like everything else on the document.
          ...documentExtras,
        },
        did
      )
      const sentAt = Date.now()
      const reply = new Promise<DidCommV2PlaintextMessage>((resolve) => {
        this.pending = { resolve, sentAt }
      })
      // §4.2 on the VTA leg: read what the VTA advertises and speak TSP when it
      // offers it and this wallet can introduce itself. A VTA built without the
      // `tsp` feature advertises nothing, and this stays on DIDComm.
      const carriage = await chooseCarriage(
        this.agent,
        this.vtaDid,
        Boolean(this.tsp) && tsp.CODEC_FORMS_RELATIONSHIPS,
        { decided: this.carriageByPeer }
      )
      if (carriage === 'tsp' && this.tsp) {
        if (!this.greeted) {
          this.greeted = true
          // Our mediator, then us: §5.3.3 ends a hop list at our own VID.
          const route = [this.mediator!.did, did]
          const invite = await tsp.packInviteRev3(did, this.vtaDid, this.tsp.identity, this.tsp.resolver, { route })
          await session.sendTspFrame(invite.bytes)
          this.agent.config.logger.info(`${LOG_PREFIX} greeted ${this.vtaDid} with an XRFI invite`)
        }
        const packed = await packTrustTaskForPeer(this.tsp, did, this.vtaDid, document)
        await session.sendTspFrame(packed.bytes)
        this.agent.config.logger.info(`${LOG_PREFIX} asked ${this.vtaDid} ${type} over ${packed.revision}`)
      } else
        await session.sendTo(this.vtaDid, {
          id: `urn:uuid:${utils.uuid()}`,
          typ: 'application/didcomm-plain+json',
          type: TRUST_TASK_V2_ENVELOPE_TYPE,
          from: did,
          to: [this.vtaDid],
          thid: threadId,
          created_time: nowSec(),
          expires_time: nowSec() + 300,
          body: document,
        })
      onSent?.()
      const answer = await Promise.race([
        reply,
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs)),
      ])
      this.pending = undefined
      if (!answer) throw new Error(`${LOG_PREFIX} the VTA did not answer ${type}`)

      // An auth/ACL refusal never reaches the task handler: the VTA answers
      // with a DIDComm problem-report (`app_err_to_response`, handlers.rs),
      // not a trust-task-error. Treat it as the refusal it is.
      if (answer.type === PROBLEM_REPORT) {
        const p = answer.body as { code?: string; comment?: string } | undefined
        throw new VtiRefusal(p?.code ?? 'problem-report', p?.comment ?? `the VTA refused ${type}`)
      }
      const body = answer.body as { type?: string; payload?: unknown } | undefined
      if (String(body?.type ?? '').startsWith(TASK_ERROR)) {
        const p = body?.payload as { code?: string; message?: string; details?: unknown } | undefined
        throw new VtiRefusal(p?.code ?? 'unknown', p?.message ?? `the VTA refused ${type}`, p?.details)
      }
      return (body?.payload ?? body) as T
    }
  }

  /** Forward the VTA-signed consent requests to the approvers they name, over the same session. */
  private async relayConsentRequests(requests: Record<string, unknown>[]): Promise<void> {
    const session = this.session
    const did = this.identity?.did
    if (!session || !did) return
    for (const request of requests) {
      const recipient = typeof request.recipient === 'string' ? request.recipient : undefined
      if (!recipient) continue
      try {
        await session.sendTo(recipient, {
          id: `urn:uuid:${utils.uuid()}`,
          typ: 'application/didcomm-plain+json',
          type: TRUST_TASK_V2_ENVELOPE_TYPE,
          from: did,
          to: [recipient],
          created_time: nowSec(),
          expires_time: nowSec() + 900,
          body: request,
        })
      } catch (relayError) {
        this.options.onError?.(relayError instanceof Error ? relayError : new Error(String(relayError)))
      }
    }
  }

  private awaitGrant(payloadDigest: string | undefined, waitMs: number): Promise<void> {
    if (!payloadDigest) return new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 5000)))
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.grantWaiters.delete(payloadDigest)
        reject(new Error(`${LOG_PREFIX} no approver consented within ${Math.round(waitMs / 1000)}s`))
      }, waitMs)
      this.grantWaiters.set(payloadDigest, () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  /**
   * An approver's answer to a consent request it was sent — signed by this client's identity.
   *
   * `payloadDigest` is echoed from the request, and the decision schema types
   * it as the framework's `DigestMultibase` (task-consent/decision/0.1
   * payload.schema.json:15-18; framework 0.3: `z`/`u` multibase, at least 16
   * characters). A VTA always sends one — the salted `wire_digest`, a
   * base58btc SHA-256 multihash (vta-policy consent.rs:73-94, :126-131; put in
   * the request at vta-service consent_request.rs:97) — so a value that is not
   * one did not come from a VTA, and nothing is signed over it.
   */
  decideConsent(
    request: Pick<VtaConsentRequest, 'challenge' | 'payloadDigest'>,
    decision: 'approve' | 'deny',
    reason?: string
  ) {
    if (!isDigestMultibase(request.payloadDigest))
      return Promise.reject(
        new Error(`${LOG_PREFIX} the consent request's payloadDigest is not a digestMultibase; not deciding it`)
      )
    return this.task<{ status?: string }>(VTA_TASK.consentDecision, {
      challenge: request.challenge,
      payloadDigest: request.payloadDigest,
      decision,
      ...(reason ? { reason } : {}),
    })
  }

  /** `timeoutMs` bounds the wait for the VTA's answer, counted from the send (`onSent`). */
  whoAmI(timeoutMs?: number, onSent?: () => void) {
    return this.task<VtaWhoAmI>(VTA_TASK.whoAmI, {}, timeoutMs, {}, onSent)
  }

  /**
   * Move this phone's grant from the key it is signed in with onto a fresh
   * long-lived one, the way `pnm` does after its first connect: the admin
   * granted the temporary key for an hour, and a swap does not carry that
   * expiry over (`operations::acl::swap_acl`). The new key proves it consents
   * with a VP-JWT addressed to this VTA (`vta-sdk` `AclSwapPresentation`); the
   * session then reopens as the new key. Returns the new manager DID.
   *
   * The new key is recorded as pending before the swap is sent. The VTA moves
   * the grant and retires the old key in one request, so if its answer never
   * arrives the phone cannot tell from its side which key the VTA now knows —
   * and throwing the new one away would lock the phone out of its own agent.
   * Any failure is therefore settled by asking the VTA ({@link resolvePendingSwap}):
   * the new key is adopted if the VTA accepts it; otherwise the old one is kept
   * and this throws, as before. `pnm` has no such step: its new key lives only
   * in memory until the swap answers (`vta-sdk` `session.rs`
   * `rotate_key_over_client`).
   */
  async rotateManagerKey(reason = 'keyring: rotate the linking key onto a long-lived one'): Promise<string> {
    const current = this.identity?.did
    if (!this.session?.isOpen || !current) throw new Error(`${LOG_PREFIX} rotate needs an open session`)
    this.mediator ??= await resolveVtaMediator(this.agent, this.vtaDid)
    const next = await createVtiClientDid(this.agent, this.mediator)
    const record: VtiManagerIdentity = {
      ...((await this.store.getManager(this.vtaDid)) ?? { createdAt: new Date().toISOString() }),
      vtaDid: this.vtaDid,
      did: current,
      pendingNext: { did: next, createdAt: new Date().toISOString() },
    }
    await this.store.setManager(record)
    this.agent.config.logger.info(`${LOG_PREFIX} recorded ${next} as the pending successor before the key swap`)
    const issuedAt = nowSec()
    try {
      const linkProof = await signCompactJws(this.agent, next, {
        iss: next,
        aud: this.vtaDid,
        iat: issuedAt,
        exp: issuedAt + 300,
        nonce: utils.uuid(),
        vp: { type: ['VerifiablePresentation', 'AclSwapRequest'], holder: next },
      })
      await this.task(
        VTA_TASK.aclSwapKey,
        { currentSubject: current, newSubject: next, linkProof, reason },
        this.options.swapTimeoutMs ?? 30000
      )
      if (activeSwapTestHook()) {
        throw new Error(`${LOG_PREFIX} the VTA did not answer ${VTA_TASK.aclSwapKey} (answer dropped by the e2e hook)`)
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      if (activeSwapTestHook() === 'drop-and-stop') {
        // As if the app died here: the successor stays pending for the next connect.
        await this.disconnect()
        throw error
      }
      this.agent.config.logger.warn(`${LOG_PREFIX} key swap did not complete (${detail}); asking the VTA`)
      await this.disconnect()
      const live = await this.resolvePendingSwap(record)
      if (live === next) return next
      throw error
    }
    await this.store.setManager({
      vtaDid: this.vtaDid,
      did: next,
      createdAt: new Date().toISOString(),
      stage: 'permanent',
    })
    await this.disconnect()
    await this.connect()
    return next
  }

  /**
   * Settle a swap whose outcome the phone did not see, by asking the VTA which
   * key it accepts. Returns the key adopted, with the session open as it.
   *
   * The order follows how the VTA swaps (`operations::acl::swap_acl`): it
   * writes the successor's entry before it deletes the old one, and nothing
   * after the write undoes it. So whether the successor is on the ACL is the
   * one decisive fact — if it is, the swap went through (the old entry is gone,
   * or at worst lingers with its one-hour expiry while the successor's is
   * permanent), and it is adopted; if it is not, the swap never wrote anything
   * and the old key must still be live, which a second `whoami` confirms before
   * the successor is dropped. A key is only ever dropped on the VTA's own word
   * that the other one is live; anything short of that keeps both and throws
   * {@link ManagerKeyUnresolved}.
   */
  async resolvePendingSwap(record?: VtiManagerIdentity): Promise<string> {
    const manager = record ?? (await this.store.getManager(this.vtaDid))
    if (!manager?.pendingNext) {
      if (!manager) throw new Error(`${LOG_PREFIX} no manager identity for ${this.vtaDid}`)
      if (!this.session?.isOpen) await this.openAs(manager.did)
      return manager.did
    }
    const current = manager.did
    const next = manager.pendingNext.did
    const log = this.agent.config.logger

    const asNext = await this.probeAs(next)
    if (asNext.kind === 'live') {
      await this.store.setManager({
        vtaDid: this.vtaDid,
        did: next,
        createdAt: manager.pendingNext.createdAt,
        stage: 'permanent',
      })
      log.info(`${LOG_PREFIX} the VTA knows the swapped-in key; adopted ${next}`)
      return next
    }
    const asCurrent = await this.probeAs(current)
    if (asCurrent.kind === 'live') {
      if (asNext.kind === 'refused') {
        // The VTA's word on both: the swap never happened.
        const kept: VtiManagerIdentity = { ...manager }
        delete kept.pendingNext
        await this.store.setManager(kept)
        log.info(`${LOG_PREFIX} the key swap did not happen; kept ${current}`)
      } else {
        // The old key works, but whether the successor was also written is
        // unknown — keep it pending, and ask again on the next connect.
        log.warn(`${LOG_PREFIX} kept ${current}; could not ask as ${next} (${asNext.detail})`)
      }
      return current
    }
    await this.disconnect()
    const detail = `as ${next}: ${asNext.kind} (${asNext.detail}); as ${current}: ${asCurrent.kind} (${asCurrent.detail})`
    log.warn(`${LOG_PREFIX} key swap unresolved, both keys kept — ${detail}`)
    throw new ManagerKeyUnresolved(
      this.vtaDid,
      current,
      next,
      asNext.kind === 'refused' && asCurrent.kind === 'refused',
      detail
    )
  }

  /** One `whoami` as `did` on a fresh session: live, refused as not on the ACL, or unknown. */
  private async probeAs(did: string): Promise<Probe> {
    await this.disconnect()
    try {
      await this.openAs(did)
      await this.whoAmI(this.options.probeTimeoutMs ?? 20000)
      return { kind: 'live' }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return refusedAsNotOnAcl(error) ? { kind: 'refused', detail } : { kind: 'unknown', detail }
    }
  }

  /**
   * The agent's access list: `acl/list/0.1` with no filter. The answer is
   * `{entries, truncated, cursor?, redactedFields?}` (vta-sdk
   * acl_management/list.rs:77-93); this VTA returns every entry in one page and
   * says so with `truncated: false` (vta-service operations/acl.rs:1034-1057).
   * Only rows the caller may audit come back. The request's `role` filter is
   * not applied by the trust-task handler (it passes only `scope` and
   * `direction`, trust_tasks/acl.rs:42-48), so callers filter here.
   */
  async listAcl(): Promise<VtaAclEntry[]> {
    const answer = await this.task<{ entries?: unknown; truncated?: unknown }>(VTA_TASK.aclList, {})
    if (answer?.truncated === true) {
      this.agent.config.logger.warn(
        `${LOG_PREFIX} ${this.vtaDid} answered a partial access list; showing the first page`
      )
    }
    const entries = Array.isArray(answer?.entries) ? answer.entries : []
    return entries.map(aclEntryFrom).filter((e): e is VtaAclEntry => e !== undefined)
  }

  /**
   * Make `did` a full administrator of this agent: `acl/grant/0.1` with an
   * admin entry that names no scopes (unrestricted) and no expiry (permanent).
   * The payload is `{entry}` (vta-sdk acl_management/create.rs:24-43); the
   * entry refuses unknown members (entry.rs:175-176), so only `subject`,
   * `role` and `label` are sent. Only a super-admin may create an unrestricted
   * admin (vti-common acl/mod.rs:1081-1112), and a subject already on the list
   * is refused as a conflict (vta-service operations/acl.rs:391-395). Answers
   * the entry the VTA now holds.
   */
  async grantAdmin(did: string, options: { label?: string } = {}): Promise<VtaAclEntry> {
    const label = options.label?.trim().slice(0, ACL_LABEL_MAX)
    const answer = await this.task(VTA_TASK.aclGrant, {
      entry: { subject: did, role: 'admin', ...(label ? { label } : {}) },
    })
    return answeredEntry(VTA_TASK.aclGrant, answer)
  }

  /**
   * Remove `did` from this agent's access list: `acl/revoke/0.1`, full
   * removal, so no `scopes` (vta-sdk acl_management/delete.rs:23-45; a scoped
   * revoke is refused, operations/acl.rs:1104-1126). The VTA refuses a caller
   * removing itself (operations/acl.rs:792-796). Answers the entry as it stood.
   */
  async revokeSubject(did: string): Promise<VtaAclEntry> {
    const answer = await this.task(VTA_TASK.aclRevoke, { subject: did })
    return answeredEntry(VTA_TASK.aclRevoke, answer)
  }

  /**
   * Set the human-readable label of an access-list entry: `acl/update/0.1`
   * with `{subject, label}` (vta-sdk acl_management/update.rs:36-51; omitted
   * members are left unchanged). An admin may relabel any entry it can see,
   * its own included (vta-service operations/acl.rs:517-545).
   */
  async labelAclEntry(did: string, label: string): Promise<VtaAclEntry> {
    const answer = await this.task(VTA_TASK.aclUpdate, { subject: did, label: label.trim().slice(0, ACL_LABEL_MAX) })
    return answeredEntry(VTA_TASK.aclUpdate, answer)
  }

  async listContexts(): Promise<VtaContext[]> {
    const result = await this.task<{ contexts?: VtaContext[] } | VtaContext[]>(VTA_TASK.contextsList, {})
    return Array.isArray(result) ? result : (result.contexts ?? [])
  }

  createContext(id: string, name: string) {
    return this.task<VtaContext>(VTA_TASK.contextsCreate, { id, name })
  }

  /**
   * What to call this agent beside its DID (VTI-Q20): its verified agent name,
   * else the operator's `vta_name` from `config/show/0.1`, else undefined — a
   * caller then shows the host. Never throws: a label is a nicety, and an agent
   * that cannot be asked, or a name that does not check out, is simply no label.
   */
  async agentLabel(
    options: { fetchImpl?: Parameters<typeof verifiedAgentName>[2] } = {}
  ): Promise<AgentLabel | undefined> {
    const [verifiedName, vtaName] = await Promise.all([
      this.agent.dids
        .resolveDidDocument(this.vtaDid)
        .then((doc) => verifiedAgentName(this.vtaDid, doc as AgentNameDocument, options.fetchImpl))
        .catch(() => undefined),
      this.task(VTA_TASK.configShow, { keys: ['vta_name'] })
        .then(vtaNameFrom)
        .catch(() => undefined),
    ])
    return chooseAgentLabel(verifiedName, vtaName)
  }

  /** The DID-hosting servers this VTA is registered with — where a persona can be minted. */
  async listServers(): Promise<{ id: string; did?: string; label?: string }[]> {
    const result = await this.task<{ servers?: { id: string }[] } | { id: string }[]>(VTA_TASK.serversList, {})
    return Array.isArray(result) ? result : (result.servers ?? [])
  }

  async listDids(contextId?: string): Promise<VtaMintedDid[]> {
    const result = await this.task<{ dids?: VtaMintedDid[] } | VtaMintedDid[]>(
      VTA_TASK.didsList,
      contextId ? { contextId } : {}
    )
    return Array.isArray(result) ? result : (result.dids ?? [])
  }

  /**
   * Mint a persona: a `did:webvh` on a DID-hosting server the VTA is registered
   * with, advertising the VTA's mediator so a community can reach it. The keys
   * stay in the VTA; the answer carries their ids.
   */
  mintPersona(options: {
    contextId: string
    serverId?: string
    didUrl?: string
    label?: string
    idempotencyKey?: string
  }) {
    if (!options.serverId && !options.didUrl) {
      throw new Error(`${LOG_PREFIX} mintPersona needs a registered server id or a serverless DID URL`)
    }
    return this.task<VtaMintedDid>(
      VTA_TASK.didsCreate,
      {
        contextId: options.contextId,
        ...(options.serverId ? { serverId: options.serverId } : {}),
        // Serverless: the VTA mints and serves the log itself at this URL.
        ...(options.didUrl ? { url: options.didUrl } : {}),
        label: options.label,
        addMediatorService: true,
        setPrimary: false,
      },
      30000,
      // A mint whose answer is lost still succeeds at the VTA; retried with the
      // same key within 24 h the VTA returns that first mint instead of minting
      // an orphan (VTI-Q17, answered by the maintainers 2026-09-23).
      options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}
    )
  }

  /**
   * The persona for a community, kept in the identity store: reused when the
   * phone already holds one with its key-agreement key borrowed, otherwise
   * minted on the first registered DID-hosting server (or serverlessly at
   * `personaBaseUrl`), its key borrowed, and the whole recorded. Connects if
   * it must; the caller owns disconnecting.
   */
  async ensurePersona(options: { communityDid: string; label?: string; personaBaseUrl?: string }): Promise<VtiPersona> {
    const existing = await this.store.getPersona(options.communityDid)
    if (existing?.kmsKeyIds?.keyAgreement && existing.kmsKeyIds.signing) return existing

    await this.connect()
    const contexts = await this.listContexts()
    const contextId = contexts[0]?.id ?? 'vta'
    const servers = await this.listServers()
    const label = options.label ?? `keyring-${Date.now().toString(36)}`
    // A persona is a did:webvh, and one has to be served from somewhere: a
    // DID-hosting server the VTA is registered with, or — serverlessly — a base
    // URL the VTA itself serves. With neither, the serverless branch below
    // would mint at "/<label>": a DID no one can resolve, which a community
    // then fails to reach with no word of why. Refuse before minting instead,
    // and say what the agent is missing. A store build bakes no base URL, so
    // this is the case for any tester whose agent has no DID host.
    if (!existing && !servers[0] && !options.personaBaseUrl) {
      throw new PersonaHostMissing(this.vtaDid)
    }
    const minted = existing
      ? ({
          did: existing.did,
          contextId: existing.contextId,
          signingKeyId: existing.vtaKeyIds.signing,
          kaKeyId: existing.vtaKeyIds.keyAgreement,
        } as VtaMintedDid)
      : await this.mintOnce(
          options.communityDid,
          servers[0]
            ? { contextId, serverId: servers[0].id, label }
            : { contextId, didUrl: `${options.personaBaseUrl ?? ''}/${label}`, label }
        )
    const borrowed = await this.borrowKey(minted.kaKeyId)
    // The signing key too: a vetting card, an eligibility presentation and a
    // vetting statement are all signed as the persona (D19).
    const signing = await this.borrowKey(minted.signingKeyId)
    const persona: VtiPersona = {
      communityDid: options.communityDid,
      vtaDid: this.vtaDid,
      did: minted.did,
      contextId: minted.contextId ?? contextId,
      vtaKeyIds: { signing: minted.signingKeyId, keyAgreement: minted.kaKeyId },
      kmsKeyIds: { keyAgreement: borrowed.keyId, signing: signing.keyId },
      label,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    }
    await this.store.setPersona(persona)
    await this.store.clearMintKey?.(options.communityDid)
    return persona
  }

  /**
   * One mint per community until a persona is recorded for it: every retry — a
   * tap on Try again, or after a restart — re-sends the first attempt's key AND
   * request. The VTA answers a keyed retry with the first mint only when the
   * payload is the same, and refuses any difference for 24 h ("idempotency key
   * reused for a different request", vta-service trust_tasks/idempotency.rs);
   * up to 224 a retry rebuilt the request with a new label, so one mint that
   * reached the VTA without its persona being recorded blocked that community
   * on the phone for a day.
   *
   * A key saved without its request (before this) cannot be re-sent unchanged.
   * On that refusal the attempt starts over once with a new key: the first
   * mint, if it happened, stays on the VTA unused.
   */
  private async mintOnce(communityDid: string, fresh: VtiMintRequest): Promise<VtaMintedDid> {
    const savedKey = await this.store.getMintKey?.(communityDid)
    const savedRequest = savedKey ? await this.store.getMintRequest?.(communityDid) : undefined
    const request = savedRequest ?? fresh
    const key = savedKey ?? `urn:uuid:${utils.uuid()}`
    await this.store.setMintKey?.(communityDid, key, request)
    try {
      return await this.mintPersona({ ...request, idempotencyKey: key })
    } catch (error) {
      if (
        !/idempotency key reused for a different request/i.test(error instanceof Error ? error.message : String(error))
      )
        throw error
      this.agent.config?.logger?.warn?.(
        `${LOG_PREFIX} the VTA holds a different mint under this community's key; starting the mint over with a new key`
      )
      const again = `urn:uuid:${utils.uuid()}`
      await this.store.setMintKey?.(communityDid, again, fresh)
      return this.mintPersona({ ...fresh, idempotencyKey: again })
    }
  }

  /** Borrow one of the VTA's keys into the wallet's KMS; returns the KMS key id. */
  async borrowKey(vtaKeyId: string): Promise<{ keyId: string; curve: 'Ed25519' | 'X25519' }> {
    const exported = await this.task<VtaExportedKey>(VTA_TASK.keysExportSecret, { keyId: vtaKeyId })
    return importVtaKey(this.agent, exported)
  }
}
