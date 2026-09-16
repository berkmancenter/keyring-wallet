/**
 * vtiAgent — the wallet's side of a VTI agent, held outside React.
 *
 * A VTA or a VTC is reached over one authenticated socket (see
 * `VtiMediatorTransport`), and that socket has to outlive any one screen: the
 * agent card, a community and an application all talk to the same session. So
 * the session lives here, and screens subscribe.
 *
 * Deliberately small. Membership is the only ceremony wired up so far —
 * manifest, apply, verdict — which is what `community_vetting_subtask.md` calls
 * P4/P5. The vetting ceremony (ticket, session, card, statement) comes later
 * and will hang off the same session.
 *
 * @module trust-tasks/module/vtiAgent
 */

import type { Agent } from '@credo-ts/core'
import { utils } from '@credo-ts/core'
import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'

import {
  createVtiClientDid,
  resolveVtiMediator,
  vtiClientIdentityFromDid,
  VtiMediatorSession,
  type VtiMediatorEndpoints,
} from './VtiMediatorTransport'

const MANIFEST = 'https://trusttasks.org/spec/vtc/join-requests/manifest/0.2'
const SUBMIT = 'https://trusttasks.org/spec/vtc/join-requests/submit/0.2'
const TASK_ERROR = 'https://trusttasks.org/spec/trust-task-error/'

/**
 * A community refusing, in its own terms. `code` is the framework's — e.g.
 * `taskFailed` for a business-rule conflict such as an application that is
 * already open — and belongs behind a Details control rather than in the
 * sentence a person reads.
 */
export class VtiRefusal extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'VtiRefusal'
  }
}

/** A refusal arrives as a document in its own right, not as a verdict. */
const refusalOf = (plaintext: DidCommV2PlaintextMessage): VtiRefusal | undefined => {
  if (!String(plaintext.type ?? '').startsWith(TASK_ERROR)) return undefined
  const payload = (plaintext.body as { payload?: { code?: string; message?: string } } | undefined)?.payload
  return new VtiRefusal(payload?.code ?? 'unknown', payload?.message ?? 'The community refused the request.')
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
}

/** A community's published join criteria, as a manifest states them. */
export interface VtiCriterion {
  id?: string
  description?: string
}

export interface VtiManifest {
  communityDid?: string
  criteria: VtiCriterion[]
  requirementsDigest?: string
}

/** What a community decided, and what it is still waiting for. */
export interface VtiVerdict {
  requestId?: string
  effect: string
  needs: string[]
}

type Listener = () => void

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
  /** One inbound handler at a time: each leg waits for its own answer. */
  private awaiting?: (plaintext: DidCommV2PlaintextMessage) => void

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
  async connect(agent: Agent, mediatorDid: string): Promise<void> {
    if (this.session?.isOpen) return
    try {
      this.set({ status: 'resolving', error: undefined })
      const mediator = await resolveVtiMediator(agent, mediatorDid)
      this.mediator = mediator
      this.set({ status: 'authenticating', host: hostOf(mediator.wsEndpoint) })

      const did = await createVtiClientDid(agent, mediator)
      const identity = await vtiClientIdentityFromDid(agent, did)
      const session = new VtiMediatorSession(agent, identity, mediator, {
        onError: (error) => this.set({ error: error.message }),
        onMessage: (plaintext) => this.awaiting?.(plaintext),
      })
      await session.start()
      this.session = session
      this.set({ status: 'connected', did })
    } catch (error) {
      this.set({ status: 'failed', error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  async disconnect(): Promise<void> {
    await this.session?.stop()
    this.session = undefined
    this.awaiting = undefined
    this.set({ status: 'disconnected', did: undefined, error: undefined })
  }

  get isConnected(): boolean {
    return this.session?.isOpen === true
  }

  /**
   * Send one Trust Task document and wait for the community's answer. The VTC
   * reads the DIDComm body as a whole document where a VTA takes a bare
   * payload — measured in `tsp-reference/ref-20`.
   */
  private async ask(
    communityDid: string,
    type: string,
    payload: Record<string, unknown>,
    timeoutMs = 30000
  ): Promise<DidCommV2PlaintextMessage | undefined> {
    const session = this.session
    const did = this.state.did
    if (!session || !did) throw new Error('vtiAgent: not connected')

    const answer = new Promise<DidCommV2PlaintextMessage>((resolve) => {
      this.awaiting = resolve
    })
    const now = Math.floor(Date.now() / 1000)
    await session.sendTo(communityDid, {
      id: `urn:uuid:${utils.uuid()}`,
      typ: 'application/didcomm-plain+json',
      type,
      from: did,
      to: [communityDid],
      created_time: now,
      expires_time: now + 300,
      body: {
        id: `urn:uuid:${utils.uuid()}`,
        type,
        payload,
        issuer: did,
        recipient: communityDid,
        issuedAt: new Date().toISOString(),
      },
    })
    const result = await Promise.race([
      answer,
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs)),
    ])
    this.awaiting = undefined
    return result
  }

  /** What a community asks of an applicant, in its own words. */
  async fetchManifest(communityDid: string): Promise<VtiManifest> {
    const answer = await this.ask(communityDid, MANIFEST, {})
    if (!answer) throw new Error('vtiAgent: the community did not answer')
    const refusal = refusalOf(answer)
    if (refusal) throw refusal
    const payload = (answer.body as { payload?: VtiManifest } | undefined)?.payload
    return {
      communityDid: payload?.communityDid,
      criteria: payload?.criteria ?? [],
      requirementsDigest: payload?.requirementsDigest,
    }
  }

  /**
   * Apply. With no credentials in hand the honest presentation is an empty one:
   * the community answers `requestMore` naming what it still needs, rather than
   * the wallet guessing at requirements it cannot yet meet.
   */
  async apply(communityDid: string, manifest: VtiManifest): Promise<VtiVerdict> {
    const answer = await this.ask(communityDid, SUBMIT, {
      vp: {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiablePresentation'],
        holder: this.state.did,
        verifiableCredential: [],
      },
      registryConsent: false,
      extensions: manifest.requirementsDigest ? { requirementsDigest: manifest.requirementsDigest } : {},
    })
    if (!answer) throw new Error('vtiAgent: the community did not answer')
    const refusal = refusalOf(answer)
    if (refusal) throw refusal
    const payload = (
      answer.body as
        | { payload?: { requestId?: string; verdict?: { effect?: string; with?: { needs?: string[] } } } }
        | undefined
    )?.payload
    return {
      requestId: payload?.requestId,
      effect: payload?.verdict?.effect ?? 'unstated',
      needs: payload?.verdict?.with?.needs ?? [],
    }
  }
}

export const vtiAgent = new VtiAgentController()
