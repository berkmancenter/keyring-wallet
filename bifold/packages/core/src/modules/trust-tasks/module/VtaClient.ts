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

import { TRUST_TASK_V2_ENVELOPE_TYPE, signDocumentProof } from '@bifold/trust-tasks'

import { importVtaKey, type VtaExportedKey } from './vtaKeys'
import {
  createVtiClientDid,
  resolveVtiMediator,
  vtiClientIdentityFromDid,
  VtiMediatorSession,
  type VtiClientIdentity,
  type VtiMediatorEndpoints,
} from './VtiMediatorTransport'
import type { VtiIdentityStore, VtiPersona } from './VtiIdentityStore'
import { VtiRefusal } from './vtiAgent'

const LOG_PREFIX = '[TrustTasks:VtaClient]'
const TASK_ERROR = 'https://trusttasks.org/spec/trust-task-error/'

/** The tasks this client speaks, by the URIs `vta-sdk` registers. */
export const VTA_TASK = {
  whoAmI: 'https://trusttasks.org/spec/auth/whoami/0.1',
  contextsList: 'https://trusttasks.org/spec/vta/contexts/list/1.0',
  contextsCreate: 'https://trusttasks.org/spec/vta/contexts/create/1.0',
  didsList: 'https://trusttasks.org/spec/vta/webvh/dids/list/1.0',
  didsCreate: 'https://trusttasks.org/spec/vta/webvh/dids/create/1.0',
  keysExportSecret: 'https://trusttasks.org/spec/keys/export-secret/0.1',
  serversList: 'https://trusttasks.org/spec/vta/webvh/servers/list/1.0',
} as const

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

/**
 * What a VTA's DID document tells a client: the mediator it is reached through.
 * A VTA's `#vta-didcomm` service names the mediator's DID as its endpoint; the
 * mediator's own document then carries the URLs.
 */
export async function resolveVtaMediator(agent: Agent, vtaDid: string): Promise<VtiMediatorEndpoints> {
  const doc = await agent.dids.resolveDidDocument(vtaDid)
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
  private queue: Promise<unknown> = Promise.resolve()

  private deliver(plaintext: DidCommV2PlaintextMessage): void {
    const pending = this.pending
    if (!pending || Date.now() < pending.sentAt) return
    this.pending = undefined
    pending.resolve(plaintext)
  }

  constructor(
    private readonly agent: Agent,
    readonly vtaDid: string,
    private readonly store: VtiIdentityStore,
    private readonly options: { onError?: (error: Error) => void } = {}
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
    const session = new VtiMediatorSession(this.agent, this.identity, this.mediator, {
      onError: (error) => this.options.onError?.(error),
      onMessage: (plaintext) => this.deliver(plaintext),
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
    const run = async (): Promise<T> => {
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

      const body = answer.body as { type?: string; payload?: unknown } | undefined
      if (String(body?.type ?? '').startsWith(TASK_ERROR)) {
        const p = body?.payload as { code?: string; message?: string } | undefined
        throw new VtiRefusal(p?.code ?? 'unknown', p?.message ?? `the VTA refused ${type}`)
      }
      return (body?.payload ?? body) as T
    }
    // Chain behind whatever is in flight, but do not let one failure poison the next.
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
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
    if (existing?.kmsKeyIds?.keyAgreement) return existing

    await this.connect()
    const contexts = await this.listContexts()
    const contextId = contexts[0]?.id ?? 'vta'
    const servers = await this.listServers()
    const label = options.label ?? `keyring-${Date.now().toString(36)}`
    const minted = existing
      ? ({ did: existing.did, contextId: existing.contextId, signingKeyId: existing.vtaKeyIds.signing, kaKeyId: existing.vtaKeyIds.keyAgreement } as VtaMintedDid)
      : await this.mintPersona(
          servers[0]
            ? { contextId, serverId: servers[0].id, label }
            : { contextId, didUrl: `${options.personaBaseUrl ?? ''}/${label}`, label }
        )
    const borrowed = await this.borrowKey(minted.kaKeyId)
    const persona: VtiPersona = {
      communityDid: options.communityDid,
      vtaDid: this.vtaDid,
      did: minted.did,
      contextId: minted.contextId ?? contextId,
      vtaKeyIds: { signing: minted.signingKeyId, keyAgreement: minted.kaKeyId },
      kmsKeyIds: { keyAgreement: borrowed.keyId },
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
