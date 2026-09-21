/**
 * vtaAgent — the phone's one session with its own VTA, shared by every screen.
 *
 * `VtaClient` is a session; this is the controller around it: one client per
 * VTA for the whole app (so a granted notice reaches the task that waits for
 * it, whichever screen sent it), the consent requests the VTA pushes to this
 * phone as an approver, and the state a screen subscribes to. The shape
 * mirrors `vtiAgent` on the community leg.
 *
 * @module trust-tasks/module/vtaAgent
 */

import type { Agent } from '@credo-ts/core'
import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'

import type { EnrolmentOffer } from '@bifold/trust-tasks'

import { VTA_TASK, VtaClient, type VtaConsentRequest } from './VtaClient'
import { GenericRecordsIdentityStore, type VtiIdentityStore } from './VtiIdentityStore'
import { GenericRecordsVtaLinkStore, type VtaLinkStore } from './VtaLinkStore'
import { EnrolmentError, submitEnrolment, waitForGrant } from './vtaEnrolment'
import { initialLinkState, reconnectDelayMs, reduceLink, type VtaLinkEvent, type VtaLinkState } from './vtaLinkMachine'

export interface VtiApproval extends VtaConsentRequest {
  /** The request document's id. */
  id: string
  receivedAt: string
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'failed'
  error?: string
}

export interface VtaAgentState {
  status: 'disconnected' | 'connecting' | 'connected' | 'failed'
  vtaDid?: string
  managerDid?: string
  approvals: VtiApproval[]
  /** A task of ours the VTA is holding for someone else's consent. */
  awaitingConsentFor?: string
  error?: string
  /**
   * Whether this phone is linked to an agent, and how that link is doing
   * right now — the one state the agent screens read (plan §4.2). `status`
   * above stays for the screens that predate linking.
   */
  link: VtaLinkState
}

/** What the controller needs from outside, replaceable in tests. */
export interface VtaAgentDeps {
  fetch?: typeof fetch
  linkStore?: (agent: Agent) => VtaLinkStore
  identityStore?: (agent: Agent) => VtiIdentityStore
  enrol?: {
    submit: typeof submitEnrolment
    waitForGrant: typeof waitForGrant
  }
  now?: () => number
}

/** A refusal that means the agent no longer accepts this phone at all. */
const ACCESS_REVOKED = /not in (the )?ACL|unauthori[sz]ed|forbidden|revoked/i

type Listener = () => void

export class VtaAgentController {
  private state: VtaAgentState = { status: 'disconnected', approvals: [], link: initialLinkState }
  private listeners = new Set<Listener>()
  private current?: { client: VtaClient; vtaDid: string; store: VtiIdentityStore }
  private deps: VtaAgentDeps = {}
  private restored = false
  private offer?: EnrolmentOffer
  /** Bumped by every new attempt and every cancel, so a late reply from an abandoned one moves nothing. */
  private attemptToken = 0
  private reconnectAttempt = 0
  private retryTimer?: ReturnType<typeof setTimeout>
  private reconnecting = false

  /** Replace I/O for tests; production uses the defaults. */
  configure(deps: VtaAgentDeps) {
    this.deps = deps
  }

  private linkStore(agent: Agent) {
    return this.deps.linkStore?.(agent) ?? new GenericRecordsVtaLinkStore(agent)
  }

  private identityStore(agent: Agent) {
    return this.deps.identityStore?.(agent) ?? new GenericRecordsIdentityStore(agent)
  }

  private now() {
    return (this.deps.now ?? Date.now)()
  }

  private dispatch(event: VtaLinkEvent) {
    const next = reduceLink(this.state.link, event)
    if (next !== this.state.link) this.set({ link: next })
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = () => this.state

  private set(next: Partial<VtaAgentState>) {
    this.state = { ...this.state, ...next }
    this.listeners.forEach((l) => l())
  }

  /** The one client for this VTA; created on first use, kept for the app's life. */
  client(agent: Agent, vtaDid: string, store?: VtiIdentityStore): VtaClient {
    if (this.current?.vtaDid === vtaDid) return this.current.client
    const identityStore = store ?? this.identityStore(agent)
    const client = new VtaClient(agent, vtaDid, identityStore, {
      onError: (error) => {
        this.set({ error: error.message })
        // A socket that went away while linked is a drop, not a failure to
        // show: go offline quietly and let the backoff bring it back.
        if (this.state.link.kind === 'linked' && !client.isConnected) {
          this.dispatch({ type: 'sessionDropped', reason: error.message, now: this.now() })
          this.scheduleReconnect(agent)
        }
      },
      onInbound: (plaintext) => this.inbound(plaintext),
      onConsentPending: ({ taskType }) => this.set({ awaitingConsentFor: taskType }),
    })
    this.current = { client, vtaDid, store: identityStore }
    this.set({ vtaDid, status: 'disconnected', approvals: [] })
    return client
  }

  /** Open the manager session — needed to be reachable as an approver. */
  async connect(agent: Agent, vtaDid: string): Promise<void> {
    const client = this.client(agent, vtaDid)
    if (client.isConnected) {
      // Opened by a caller that used the client directly (the Developer
      // probe does): the state has to say so, or a screen gated on it
      // never sees the session that is already there.
      if (this.state.status !== 'connected') this.set({ status: 'connected', managerDid: client.managerDid, error: undefined })
      return
    }
    this.set({ status: 'connecting', error: undefined })
    try {
      await client.connect()
      // Say hello to the VTA so it caches a reply route for this DID. Without a
      // round-trip the VTA has never seen this approver and drops a consent
      // request to it as "no mediator route" (VTI-24). whoami is the cheapest
      // authenticated call and is what makes the approver reachable.
      await client.whoAmI().catch(() => undefined)
      this.set({ status: 'connected', managerDid: client.managerDid })
    } catch (error) {
      this.set({ status: 'failed', error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  /**
   * Read the persisted link once, at start-up. A linked phone comes back
   * offline and reconnects on its own; nothing live is restored.
   */
  async restore(agent: Agent): Promise<void> {
    if (this.restored) return
    this.restored = true
    const link = await this.linkStore(agent)
      .get()
      .catch(() => undefined)
    this.dispatch({ type: 'restored', link, now: this.now() })
    if (link) void this.ensureOnline(agent)
  }

  /** A scanned or pasted enrolment offer: ask the person before anything is minted. */
  scanOffer(offer: EnrolmentOffer) {
    this.offer = offer
    this.dispatch({ type: 'offerScanned', vtaDid: offer.vta, label: offer.label, offerUrl: offer.url, exp: offer.exp })
  }

  cancelLink() {
    this.attemptToken++
    this.offer = undefined
    this.dispatch({ type: 'cancelled' })
  }

  /** After a failure or a revocation, back to a phone with no agent. */
  relink() {
    this.dispatch({ type: 'relink' })
  }

  /**
   * The person agreed to link: submit the temporary key, wait for the admin,
   * then sign in as that key and rotate onto a long-lived one. Every step
   * moves the machine; the screen only renders it.
   */
  async confirmOffer(agent: Agent): Promise<void> {
    const offer = this.offer
    if (!offer || this.state.link.kind !== 'confirming') return
    const token = ++this.attemptToken
    const live = () => token === this.attemptToken
    this.dispatch({ type: 'confirmed' })
    const identities = this.identityStore(agent)
    const enrol = this.deps.enrol ?? { submit: submitEnrolment, waitForGrant }
    try {
      const { code } = await enrol.submit(agent, offer, identities, { fetch: this.deps.fetch })
      if (!live()) return
      this.dispatch({ type: 'submitted', code })
      await enrol.waitForGrant(offer, { fetch: this.deps.fetch, shouldStop: () => !live() })
      if (!live()) return
      this.dispatch({ type: 'granted' })

      // A fresh client: whatever session an earlier link left must not be reused.
      await this.reset()
      const client = this.client(agent, offer.vta, identities)
      this.set({ status: 'connecting', error: undefined })
      await client.connect()
      await client.whoAmI()
      if (!live()) return
      this.dispatch({ type: 'rotating' })
      await client.rotateManagerKey()
      // The new key has never spoken to the VTA; a round trip gives it a reply route (VTI-24).
      await client.whoAmI().catch(() => undefined)
      const linkedAt = new Date(this.now()).toISOString()
      await this.linkStore(agent).set({ vtaDid: offer.vta, label: offer.label, linkedAt })
      this.reconnectAttempt = 0
      this.set({ status: 'connected', vtaDid: offer.vta, managerDid: client.managerDid })
      this.dispatch({ type: 'linked', linkedAt })
    } catch (error) {
      if (!live()) return
      const detail = error instanceof Error ? error.message : String(error)
      this.set({ status: 'failed', error: detail })
      this.dispatch({
        type: 'failed',
        failure: { reason: error instanceof EnrolmentError ? error.reason : 'failed', detail },
      })
    } finally {
      if (live()) this.offer = undefined
    }
  }

  /**
   * Bring a linked phone back online: now, when the app returns to the
   * foreground or the network changes, and on a backoff after a drop.
   */
  async ensureOnline(agent: Agent): Promise<void> {
    const link = this.state.link
    if (link.kind !== 'linked' || link.connection.kind === 'online' || this.reconnecting) return
    this.reconnecting = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    try {
      await this.connect(agent, link.vtaDid)
      this.reconnectAttempt = 0
      this.dispatch({ type: 'sessionOpened' })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      if (ACCESS_REVOKED.test(reason)) {
        this.dispatch({ type: 'accessRevoked', reason })
        return
      }
      this.dispatch({ type: 'sessionDropped', reason, now: this.now() })
      this.scheduleReconnect(agent)
    } finally {
      this.reconnecting = false
    }
  }

  private scheduleReconnect(agent: Agent) {
    if (this.retryTimer || this.state.link.kind !== 'linked') return
    const attempt = ++this.reconnectAttempt
    const delay = reconnectDelayMs(attempt - 1)
    this.dispatch({ type: 'retryScheduled', attempt, nextRetryAt: this.now() + delay })
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      void this.ensureOnline(agent)
    }, delay)
  }

  /** Drop the current client and its session. */
  private async reset() {
    const current = this.current
    this.current = undefined
    await current?.client.disconnect().catch(() => undefined)
  }

  private inbound(plaintext: DidCommV2PlaintextMessage) {
    const body = plaintext.body as { id?: string; type?: string; payload?: VtaConsentRequest } | undefined
    if (body?.type === VTA_TASK.consentRequest && body.payload?.challenge) {
      const id = String(body.id ?? body.payload.challenge)
      if (this.state.approvals.some((a) => a.id === id)) return
      const approval: VtiApproval = { ...body.payload, id, receivedAt: new Date().toISOString(), status: 'pending' }
      this.set({ approvals: [approval, ...this.state.approvals] })
      return
    }
    if (body?.type === VTA_TASK.consentGranted) {
      this.set({ awaitingConsentFor: undefined })
    }
  }

  /** Answer a consent request; the decision is signed by this phone's manager identity. */
  async decide(id: string, decision: 'approve' | 'deny', reason?: string): Promise<void> {
    const client = this.current?.client
    const approval = this.state.approvals.find((a) => a.id === id)
    if (!client || !approval) return
    try {
      await client.decideConsent(approval, decision, reason)
      this.update(id, { status: decision === 'approve' ? 'approved' : 'denied' })
    } catch (error) {
      this.update(id, { status: 'failed', error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  private update(id: string, patch: Partial<VtiApproval>) {
    this.set({ approvals: this.state.approvals.map((a) => (a.id === id ? { ...a, ...patch } : a)) })
  }
}

export const vtaAgent = new VtaAgentController()
