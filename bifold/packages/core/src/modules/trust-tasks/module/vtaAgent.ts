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

import type { AgentLabel } from './agentLabel'
import { ManagerKeyUnresolved, VTA_TASK, VtaClient, resolveVtaMediator, type VtaConsentRequest } from './VtaClient'
import { GenericRecordsIdentityStore, type VtiIdentityStore } from './VtiIdentityStore'
import { GenericRecordsVtaLinkStore, type VtaLinkStore } from './VtaLinkStore'
import { createVtiClientDid } from './VtiMediatorTransport'
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
  /** Whether the first-link introduction has been seen (plan §4.1). */
  introSeen: boolean
  /** What the agent did, newest first, in this session — the agent screen's "What your agent did". */
  activity: VtaActivity[]
  /**
   * What each agent is called, by VTA DID, once read: its verified agent name,
   * else its operator's `vta_name` (`VtaClient.agentLabel`). Absent until then,
   * and a screen shows the host meanwhile — a name is never waited for. The
   * source is kept because only an `agentName` is verified; a `vta_name` is
   * whatever the operator typed.
   */
  agentNames?: Readonly<Record<string, AgentLabel>>
}

export interface VtaActivity {
  at: number
  kind: 'linked' | 'reconnected' | 'wentOffline' | 'revoked' | 'approved' | 'denied' | 'unlinked'
}

const ACTIVITY_LIMIT = 20

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
  /** How long "I've been added" waits for an answer; tests shorten it. */
  grantCheckDeadlineMs?: number
  /** How long signing in may take in a grant check; see GRANT_CONNECT_DEADLINE_MS. */
  grantConnectDeadlineMs?: number
}

/** A refusal that means the agent no longer accepts this phone at all. */
const ACCESS_REVOKED = /not in (the )?ACL|unauthori[sz]ed|forbidden|revoked/i

/**
 * Does a failed connect mean the VTA no longer knows this phone (relink), or
 * only that it could not be reached (retry)? A swap left unsettled says so by
 * its type: both keys refused is revoked; either unanswered is reachability,
 * so both keys are kept and the next connect asks again. Anything else is
 * read from the VTA's words.
 */
export function connectFailureRevokes(error: unknown): boolean {
  if (typeof ManagerKeyUnresolved === 'function' && error instanceof ManagerKeyUnresolved) return error.refusedBoth
  return ACCESS_REVOKED.test(error instanceof Error ? error.message : String(error))
}

/**
 * How long "I've been added" waits for the agent's answer before it says so,
 * counted from when the question is sent — not from the tap, which also pays
 * for signing in (GRANT_CONNECT_DEADLINE_MS).
 *
 * An agent that answers says everything it has to say quickly: a first task,
 * the greeting that precedes it included, came back in 1.76 s, and later ones
 * in under a second (measured against a VTA on 2026-09-22). Ten seconds is
 * about five times that worst honest case — slow enough that a sluggish agent
 * still wins the race, short enough that the person waits through a pause
 * rather than a silence.
 *
 * It exists because an answer can be lost rather than late: a reply produced
 * before the transport's relationship is ready never arrives, and then nothing
 * ever settles this. Without a deadline the screen spins for as long as the
 * person is willing to watch it.
 */
export const GRANT_CHECK_DEADLINE_MS = 10000

/**
 * How long signing in to the agent may take before a grant check gives up.
 * Separate from the answer's deadline on purpose: connecting is DID
 * resolution, a challenge and a socket on the phone's side, and on a slow
 * phone it took most of a shared 10 s budget, so an answer that came back in
 * time was thrown away (Android, 2026-09-24: connect ≈5.5 s, answer ≈4.3 s).
 */
export const GRANT_CONNECT_DEADLINE_MS = 30000

/** Matches VtaClient's own "no answer in time" — a silence, not a refusal. */
const NO_ANSWER = /the VTA did not answer/

/**
 * How long a grant check that got no answer keeps its question open. An
 * answer that arrives in that time settles the next "I've been added" at once,
 * instead of that tap signing in and asking all over again — which, on the
 * slow link that made the first one late, would be late too.
 */
export const GRANT_HOLD_MS = 60000

const TIMED_OUT = Symbol('timedOut')

/**
 * Run `work` against a deadline: true if it finished in time, false if the
 * deadline won. A failure still throws, so a refusal keeps its meaning.
 */
export async function withDeadline(work: Promise<unknown>, ms = GRANT_CHECK_DEADLINE_MS): Promise<boolean> {
  // Work abandoned at the deadline may still fail later; that failure is
  // nobody's news now, and without a handler it would surface as an unhandled
  // rejection.
  void work.catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const finished = Promise.race([
      work.then(() => undefined),
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms)
      }),
    ])
    return (await finished) !== TIMED_OUT
  } finally {
    if (timer) clearTimeout(timer)
  }
}

type Listener = () => void

export class VtaAgentController {
  private state: VtaAgentState = {
    status: 'disconnected',
    approvals: [],
    link: initialLinkState,
    introSeen: true,
    activity: [],
  }
  private listeners = new Set<Listener>()
  private current?: { client: VtaClient; vtaDid: string; store: VtiIdentityStore }
  /** A grant check's question still open after it gave up waiting (GRANT_HOLD_MS). */
  private heldAnswer?: { vtaDid: string; answer: Promise<unknown>; until: number }
  private deps: VtaAgentDeps = {}
  private restored = false
  private offer?: EnrolmentOffer
  /** Bumped by every new attempt and every cancel, so a late reply from an abandoned one moves nothing. */
  private attemptToken = 0
  private reconnectAttempt = 0
  private retryTimer?: ReturnType<typeof setTimeout>
  private reconnecting = false
  /** Agents whose name is being read, or was read, in this app run. */
  private namesAsked = new Set<string>()

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
    const previous = this.state.link
    const next = reduceLink(previous, event)
    if (next === previous) return
    this.set({ link: next })
    // The activity list records what changed for the person, not every retry.
    const wasOnline = previous.kind === 'linked' && previous.connection.kind === 'online'
    const isOnline = next.kind === 'linked' && next.connection.kind === 'online'
    if (event.type === 'linked') this.note('linked')
    else if (event.type === 'accessRevoked') this.note('revoked')
    else if (wasOnline && !isOnline) this.note('wentOffline')
    else if (!wasOnline && isOnline && previous.kind === 'linked') this.note('reconnected')
  }

  private note(kind: VtaActivity['kind']) {
    this.set({ activity: [{ at: this.now(), kind }, ...this.state.activity].slice(0, ACTIVITY_LIMIT) })
  }

  /** The person dismissed the first-link introduction; it does not come back on its own. */
  async markIntroSeen(agent: Agent): Promise<void> {
    this.set({ introSeen: true })
    const store = this.linkStore(agent)
    const link = await store.get().catch(() => undefined)
    if (link) await store.set({ ...link, introSeenAt: new Date(this.now()).toISOString() })
  }

  /** "What is my agent?" — show the introduction again. */
  showIntro() {
    this.set({ introSeen: false })
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
      if (this.state.status !== 'connected')
        this.set({ status: 'connected', managerDid: client.managerDid, error: undefined })
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
      this.learnAgentName(client, vtaDid)
    } catch (error) {
      this.set({ status: 'failed', error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  /**
   * Ask the agent what it is called, once per agent per app run, in the
   * background: nothing waits on it, and a failure is simply no name. An agent
   * that gave none is asked again on the next session, since "none" can also
   * mean it could not be reached.
   */
  private learnAgentName(client: VtaClient, vtaDid: string) {
    if (this.namesAsked.has(vtaDid)) return
    this.namesAsked.add(vtaDid)
    void Promise.resolve()
      .then(() => client.agentLabel())
      .then((found) => {
        if (!found) this.namesAsked.delete(vtaDid)
        else this.set({ agentNames: { ...this.state.agentNames, [vtaDid]: found } })
      })
      .catch(() => this.namesAsked.delete(vtaDid))
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
    this.set({ introSeen: !link || Boolean(link.introSeenAt) })
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
   * The person unlinks this phone from its agent. Everything is local: the
   * session is closed, the stored link and this phone's manager identity for
   * the agent are forgotten, and pending approvals are dropped, so nothing
   * here can act for the agent again. The agent keeps this phone's key on its
   * ACL until its owner removes it — a VTA refuses a client's request to
   * delete its own entry (VTI-Q23) — so the screen says so, and an agent that
   * cannot be reached changes nothing. Community identities and memberships
   * stay recorded: they are held by that agent, and linking it again brings
   * them back. Never throws; a store that fails to clear is retried at the
   * next unlink, and the phone is unlinked either way.
   */
  async unlink(agent: Agent): Promise<void> {
    const vtaDid = this.state.link.kind === 'notLinked' ? undefined : this.state.link.vtaDid
    this.attemptToken++
    this.offer = undefined
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    this.reconnectAttempt = 0
    await this.reset()
    await this.linkStore(agent)
      .clear()
      .catch(() => undefined)
    if (vtaDid) {
      await Promise.resolve(this.identityStore(agent).forgetManager?.(vtaDid)).catch(() => undefined)
      this.namesAsked.delete(vtaDid)
    }
    this.set({
      status: 'disconnected',
      vtaDid: undefined,
      managerDid: undefined,
      approvals: [],
      awaitingConsentFor: undefined,
      error: undefined,
    })
    this.dispatch({ type: 'unlinked' })
    this.note('unlinked')
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
      await this.finishLink(agent, offer.vta, offer.label, identities, live)
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
   * The granted key signs in, rotates onto a long-lived one, and the agent is
   * remembered — the same for a scanned offer and for a key pasted by hand.
   * Assumes the machine is in `linking` (it dispatched `granted`).
   */
  private async finishLink(
    agent: Agent,
    vtaDid: string,
    label: string,
    identities: VtiIdentityStore,
    live: () => boolean,
    signedIn?: VtaClient
  ): Promise<void> {
    let client = signedIn
    if (!client) {
      // A fresh client: whatever session an earlier link left must not be reused.
      await this.reset()
      client = this.client(agent, vtaDid, identities)
      this.set({ status: 'connecting', error: undefined })
      await client.connect()
      await client.whoAmI()
    }
    if (!live()) return
    this.dispatch({ type: 'rotating' })
    await client.rotateManagerKey()
    // The new key has never spoken to the VTA; a round trip gives it a reply route (VTI-24).
    await client.whoAmI().catch(() => undefined)
    const linkedAt = new Date(this.now()).toISOString()
    await this.linkStore(agent).set({ vtaDid, label, linkedAt })
    this.set({ introSeen: false })
    this.reconnectAttempt = 0
    this.set({ status: 'connected', vtaDid, managerDid: client.managerDid })
    this.dispatch({ type: 'linked', linkedAt })
    this.learnAgentName(client, vtaDid)
  }

  /**
   * Linking without a QR (plan §5.1 fallback): the person names their agent,
   * the phone mints its temporary key and shows it, and the admin pastes it
   * into their own console — upstream's Grant access form, or the Farm's
   * admin-DID step. Nothing is submitted anywhere by the phone.
   */
  async startManualLink(agent: Agent, vtaDid: string, label: string): Promise<void> {
    if (this.state.link.kind !== 'notLinked') return
    const token = ++this.attemptToken
    try {
      const mediator = await resolveVtaMediator(agent, vtaDid)
      const did = await createVtiClientDid(agent, mediator)
      await this.identityStore(agent).setManager({
        vtaDid,
        did,
        createdAt: new Date(this.now()).toISOString(),
        stage: 'temporary',
      })
      if (token !== this.attemptToken) return
      this.dispatch({ type: 'keyShown', vtaDid, label, did })
    } catch (error) {
      if (token !== this.attemptToken) return
      const detail = error instanceof Error ? error.message : String(error)
      this.dispatch({ type: 'failed', failure: { reason: 'unreachable', detail } })
    }
  }

  /**
   * "I've been added": try to sign in as the shown key. A refusal because the
   * key is not in the agent's access list yet leaves the key showing, marked
   * not yet; an agent that says nothing within the deadline leaves it showing
   * too, marked unanswered; anything else ends the attempt.
   */
  async checkManualGrant(agent: Agent): Promise<void> {
    const link = this.state.link
    if (link.kind !== 'showingKey' || link.checking) return
    const token = this.attemptToken
    const live = () => token === this.attemptToken
    const identities = this.identityStore(agent)
    this.dispatch({ type: 'grantCheckStarted' })
    try {
      // Two deadlines, not one. The agent is given its full time to answer,
      // counted from when the question leaves the phone; getting signed in is
      // bounded separately. A question that outlives its deadline is held
      // open, and the next tap waits on it rather than asking again.
      const answerMs = this.deps.grantCheckDeadlineMs ?? GRANT_CHECK_DEADLINE_MS
      let answer = this.takeHeldAnswer(link.vtaDid)
      if (!answer) {
        await this.reset()
        const fresh = this.client(agent, link.vtaDid, identities)
        const connected = await withDeadline(
          fresh.connect(),
          this.deps.grantConnectDeadlineMs ?? GRANT_CONNECT_DEADLINE_MS
        )
        if (!live()) return
        if (!connected) {
          this.attemptToken++
          await this.reset()
          this.dispatch({ type: 'grantNoAnswer' })
          return
        }
        let sent: () => void = () => undefined
        const sending = new Promise<void>((resolve) => (sent = resolve))
        answer = fresh.whoAmI(GRANT_HOLD_MS, sent)
        void answer.catch(() => undefined)
        // The clock starts at the send; the bound here is only a backstop for
        // work that hangs before it can send.
        await withDeadline(Promise.race([sending, answer]), answerMs * 3).catch(() => undefined)
      }
      let silent = false
      const answered = await withDeadline(answer, answerMs).catch((error: unknown) => {
        if (!NO_ANSWER.test(error instanceof Error ? error.message : String(error))) throw error
        silent = true
        return false
      })
      if (!live()) return
      if (!answered) {
        // Hand the attempt on, so an answer that arrives after we have given
        // up on it cannot move the screen under the person later; it waits
        // for the next tap instead, unless the client itself stopped waiting.
        this.attemptToken++
        if (silent) await this.reset()
        else this.heldAnswer = { vtaDid: link.vtaDid, answer, until: this.now() + GRANT_HOLD_MS }
        this.dispatch({ type: 'grantNoAnswer' })
        return
      }
      const client = this.client(agent, link.vtaDid, identities)
      this.dispatch({ type: 'granted' })
      await this.finishLink(agent, link.vtaDid, link.label, identities, live, client)
    } catch (error) {
      if (!live()) return
      const detail = error instanceof Error ? error.message : String(error)
      if (this.state.link.kind === 'showingKey' && ACCESS_REVOKED.test(detail)) {
        await this.reset()
        this.dispatch({ type: 'grantNotYet' })
        return
      }
      this.set({ status: 'failed', error: detail })
      this.dispatch({ type: 'failed', failure: { reason: 'failed', detail } })
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
      if (connectFailureRevokes(error)) {
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

  /** The held question for this agent, if it is still worth waiting on; taken once. */
  private takeHeldAnswer(vtaDid: string): Promise<unknown> | undefined {
    const held = this.heldAnswer
    this.heldAnswer = undefined
    if (!held || held.vtaDid !== vtaDid || this.now() >= held.until || this.current?.vtaDid !== vtaDid) return
    return held.answer
  }

  /** Drop the current client and its session, and any held question with them. */
  private async reset() {
    this.heldAnswer = undefined
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
      this.note(decision === 'approve' ? 'approved' : 'denied')
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
