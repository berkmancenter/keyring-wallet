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
import { utils } from '@credo-ts/core'
import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'

import { TRUST_TASK_V2_ENVELOPE_TYPE, signDocumentProof, tsp } from '@bifold/trust-tasks'

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
import type { VtiIdentityStore, VtiPersona } from './VtiIdentityStore'
import { VtiRefusal } from './vtiAgent'
import { chooseCarriage, type Carriage } from './tspCapability'
import {
  packTrustTaskForPeer,
  tspSessionForManager,
  unpackTrustTaskFromPeer,
  type TspSessionIdentity,
} from './vtiTsp'

const LOG_PREFIX = '[TrustTasks:VtaClient]'
const TASK_ERROR = 'https://trusttasks.org/spec/trust-task-error/'
const PROBLEM_REPORT = 'https://didcomm.org/report-problem/2.0/problem-report'

/** The tasks this client speaks, by the URIs `vta-sdk` registers. */
export const VTA_TASK = {
  whoAmI: 'https://trusttasks.org/spec/auth/whoami/0.1',
  contextsList: 'https://trusttasks.org/spec/vta/contexts/list/1.0',
  contextsCreate: 'https://trusttasks.org/spec/vta/contexts/create/1.0',
  didsList: 'https://trusttasks.org/spec/vta/webvh/dids/list/1.0',
  didsCreate: 'https://trusttasks.org/spec/vta/webvh/dids/create/1.0',
  keysExportSecret: 'https://trusttasks.org/spec/keys/export-secret/0.1',
  serversList: 'https://trusttasks.org/spec/vta/webvh/servers/list/1.0',
  consentRequest: 'https://trusttasks.org/spec/task-consent/request/0.1',
  consentDecision: 'https://trusttasks.org/spec/task-consent/decision/0.1',
  consentGranted: 'https://trusttasks.org/spec/task-consent/granted/0.1',
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

const nowSec = () => Math.floor(Date.now() / 1000)

/** The consent challenge inside a refusal, when that is what the refusal is. */
function consentPendingOf(error: unknown): { payloadDigest?: string; requests: Record<string, unknown>[] } | undefined {
  if (!(error instanceof VtiRefusal)) return undefined
  const details = error.details as
    | { reason?: string; consentRequests?: (Record<string, unknown> & { payload?: { payloadDigest?: string } })[] }
    | undefined
  if (details?.reason !== 'auth:consent_required') return undefined
  const requests = details.consentRequests ?? []
  return { payloadDigest: requests[0]?.payload?.payloadDigest, requests }
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
    this.identity = await vtiClientIdentityFromDid(this.agent, did)
    // Best effort: a wallet whose manager key cannot back TSP ports simply
    // stays on DIDComm, and §4.2 says so rather than failing the connect.
    this.tsp = await tspSessionForManager(this.agent, did).catch(() => undefined)
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
    await new Promise((resolve) => setTimeout(resolve, 2000))
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
  async task<T = unknown>(type: string, payload: Record<string, unknown>, timeoutMs = 30000): Promise<T> {
    const run = (): Promise<T> => this.sendTask<T>(type, payload, timeoutMs)
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
          return await this.sendTask<T>(type, payload, timeoutMs)
        } catch (retryError) {
          lastError = retryError
          if (!consentPendingOf(retryError)) throw retryError
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError))
    })
  }

  /** One send and its matched answer — no queue, no consent handling. */
  private async sendTask<T>(type: string, payload: Record<string, unknown>, timeoutMs: number): Promise<T> {
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

  /** An approver's answer to a consent request it was sent — signed by this client's identity. */
  decideConsent(
    request: Pick<VtaConsentRequest, 'challenge' | 'payloadDigest'>,
    decision: 'approve' | 'deny',
    reason?: string
  ) {
    return this.task<{ status?: string }>(VTA_TASK.consentDecision, {
      challenge: request.challenge,
      payloadDigest: request.payloadDigest,
      decision,
      ...(reason ? { reason } : {}),
    })
  }

  whoAmI() {
    return this.task<VtaWhoAmI>(VTA_TASK.whoAmI, {})
  }

  async listContexts(): Promise<VtaContext[]> {
    const result = await this.task<{ contexts?: VtaContext[] } | VtaContext[]>(VTA_TASK.contextsList, {})
    return Array.isArray(result) ? result : (result.contexts ?? [])
  }

  createContext(id: string, name: string) {
    return this.task<VtaContext>(VTA_TASK.contextsCreate, { id, name })
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
  mintPersona(options: { contextId: string; serverId?: string; didUrl?: string; label?: string }) {
    if (!options.serverId && !options.didUrl) {
      throw new Error(`${LOG_PREFIX} mintPersona needs a registered server id or a serverless DID URL`)
    }
    return this.task<VtaMintedDid>(VTA_TASK.didsCreate, {
      contextId: options.contextId,
      ...(options.serverId ? { serverId: options.serverId } : {}),
      // Serverless: the VTA mints and serves the log itself at this URL.
      ...(options.didUrl ? { url: options.didUrl } : {}),
      label: options.label,
      addMediatorService: true,
      setPrimary: false,
    })
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
    const minted = existing
      ? ({
          did: existing.did,
          contextId: existing.contextId,
          signingKeyId: existing.vtaKeyIds.signing,
          kaKeyId: existing.vtaKeyIds.keyAgreement,
        } as VtaMintedDid)
      : await this.mintPersona(
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
    return persona
  }

  /** Borrow one of the VTA's keys into the wallet's KMS; returns the KMS key id. */
  async borrowKey(vtaKeyId: string): Promise<{ keyId: string; curve: 'Ed25519' | 'X25519' }> {
    const exported = await this.task<VtaExportedKey>(VTA_TASK.keysExportSecret, { keyId: vtaKeyId })
    return importVtaKey(this.agent, exported)
  }
}
