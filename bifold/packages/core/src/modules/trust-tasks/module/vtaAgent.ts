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
import { DeviceEventEmitter, Platform } from 'react-native'

import type { EnrolmentOffer } from '@bifold/trust-tasks'

import { agentGoneVerdict, type AgentGoneWhy } from './agentGone'
import { didPrefix } from './didPrefix'
import { releaseWarn } from './releaseLog'
import {
  AGENT_HOST_QR_LIFETIME_MS,
  AgentHostConnectionError,
  connectWithAgentHost,
  type AgentHostDeps,
  type AgentHostOffer,
} from './agentHostConnection'
import type { AgentLabel } from './agentLabel'
import { classifyDid, type DidResolverAgent } from './classifyDid'
import { VTI_PERSONA_KEYS_HELD_EVENT } from './communityChanged'
import { setCurrentAgentDid } from './currentAgent'
import { checkConsentRequest, consentMatchCode, consentOutcome, type ConsentOutcome } from './consentCheck'
import type { StepUpRequest } from './stepUp'
import {
  ManagerKeyUnresolved,
  SwapDoneSignInFailed,
  VTA_TASK,
  VtaClient,
  resolveVtaMediator,
  type VtaAclEntry,
  type VtaConsentRequest,
} from './VtaClient'
import { GenericRecordsCommunityStore, type VtiCommunityStore } from './VtiCommunityStore'
import { GenericRecordsIdentityStore, type VtiIdentityStore } from './VtiIdentityStore'
import { GenericRecordsVtaLinkStore, type VtaLinkStore } from './VtaLinkStore'
import { createVtiTemporaryDidKey } from './VtiMediatorTransport'
import {
  AGENT_DEVICE_TASK,
  clearThisDeviceWake,
  listAgentDevices,
  registerThisDevice,
  removeAgentDevice,
  renameThisDevice,
  setThisDeviceWake,
  type AgentDevice,
  type PushPlatform,
  type WakeChannel,
  type WakeHandle,
} from './vtaDevices'
import {
  agentVersion,
  rotateEachPersona,
  rotatePersonaKeys,
  rotationSupport,
  type RotationSupport,
} from './vtaRotation'
import { EnrolmentError, submitEnrolment, waitForGrant } from './vtaEnrolment'
import { migratePersonaKeys } from './vtaKeyMigration'
import { forgetKeyCopy } from './vtaKeys'
import {
  initialLinkState,
  reconnectDelayMs,
  reduceLink,
  type VtaLinkEvent,
  type VtaLinkFailure,
  type VtaLinkState,
} from './vtaLinkMachine'
import {
  DeviceActionRefused,
  DeviceCannotOwn,
  OwnerCheckNotConfigured,
  OwnerNotConfirmed,
  deviceRefusalOf,
  looksLikeDid,
  type ConfirmOwner,
  type DeviceCanOwn,
  type DeviceRefusalReason,
} from './vtaOwner'

export interface VtiApproval extends VtaConsentRequest {
  /** The request document's id. */
  id: string
  receivedAt: string
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'failed'
  error?: string
  /** The code to compare with the screen that asked (vta-sdk `match_code`); none for a digest that is not one. */
  matchCode?: string
  /** What approving would do: the dry-run effects, else the task's consequences, else unknown. */
  outcome?: ConsentOutcome
  /**
   * How the request fared against `ConsentRequest::verify`: `verified`, or why
   * not. Log-only for now — a request that fails is still listed.
   */
  requestCheck?: 'verified' | string
}

export interface VtaAgentState {
  status: 'disconnected' | 'connecting' | 'connected' | 'failed'
  vtaDid?: string
  managerDid?: string
  approvals: VtiApproval[]
  /** A task of ours the VTA is holding for someone else's consent. */
  awaitingConsentFor?: string
  /**
   * The agent asks this phone to confirm it is the person before it does a
   * task (a step-up): its own reason, shown as sent, and the task. Answered
   * with `answerStepUp`; the owner check follows a confirmation.
   */
  stepUpAsk?: { id: string; reason: string; taskType?: string }
  error?: string
  /**
   * Whether this phone is linked to an agent, and how that link is doing
   * right now — the one state the agent screens read (plan §4.2). `status`
   * above stays for the screens that predate linking.
   */
  link: VtaLinkState
  /** Whether the first-link introduction has been seen (plan §4.1). */
  introSeen: boolean
  /**
   * Reconnecting stopped after {@link MAX_RECONNECT_TRIES} tries in a row: the
   * agent screen says the agent didn't answer, with Try again (`tryAgainNow`),
   * instead of a loop out of sight. Cleared by any sign-in that works.
   */
  reconnectGaveUp?: boolean
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
  /** The linked agent was created from this phone ("Create my agent"): it belongs to this phone. */
  ownsAgent?: boolean
  /** Every agent this phone is linked to, oldest first; `link` is the current one's. */
  agents?: ReadonlyArray<{ vtaDid: string; label: string; owner?: boolean }>
  /** "Add another agent" is under way: the current agent was left until it ends. */
  addingAgent?: boolean
  /** An agent was just added: the person chooses to use it or keep the one before. */
  addedAgent?: { from: string; added: string }
  /**
   * A switch to this agent is under way. It leaves the current agent and signs
   * in to the next, which took about 20 s on the several-agents device check,
   * with nothing on screen meanwhile.
   */
  switchingTo?: string
  /**
   * Requests for this phone's decision from the agents that are not current,
   * as last seen by a look at each (several agents, step 3), with whether the
   * look reached it. Carried into `approvals` when the person switches to it.
   */
  otherRequests?: Readonly<Record<string, { approvals: VtiApproval[]; reachable: boolean; at: number }>>
  /**
   * Whether the saved link has been read at start-up (`restore`). Until then
   * `link` reads "not linked" on every phone, linked or not, so a screen that
   * acts on "not linked" waits for this first: a notification tap that cold-
   * started the app opened Requests before the read, which took the phone for
   * an unlinked one and left for My Agent (233, Android).
   */
  linkRestored?: boolean
}

/**
 * One device that runs the agent: an admin row of its access list. `thisPhone`
 * marks this phone's own key. Every admin row is shown — a backup added from
 * this phone is an equal of it (plan §4, D3).
 */
export interface VtaDevice {
  did: string
  role: string
  label?: string
  thisPhone: boolean
  /** RFC 3339; absent means the device never lapses. */
  expiresAt?: string
  /** RFC 3339, when the agent added it. */
  createdAt?: string
  /** Who added it: a DID, or the agent's own marker such as `cli:import-did`. */
  createdBy?: string
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
  /** For tests: a look's quiet window and its most (LOOK_QUIET_MS, LOOK_MAX_MS). */
  lookQuietMs?: number
  lookMaxMs?: number
  /** For tests: the client a look at another agent signs in with. */
  lookClient?: (
    agent: Agent,
    vtaDid: string,
    store: VtiIdentityStore,
    options: { onInbound: (plaintext: DidCommV2PlaintextMessage) => void }
  ) => Pick<VtaClient, 'connect' | 'disconnect' | 'task'>
  /** Whether the agent's address exists: its DID host says `notFound`, it resolves (`found`), or no one could tell. */
  agentAddress?: (agent: Agent, vtaDid: string) => Promise<'notFound' | 'found' | 'unknown'>
  identityStore?: (agent: Agent) => VtiIdentityStore
  communityStore?: (agent: Agent) => Pick<VtiCommunityStore, 'forgetCommunity'>
  enrol?: {
    submit: typeof submitEnrolment
    waitForGrant: typeof waitForGrant
  }
  now?: () => number
  /** How long "I've been added" waits for an answer; tests shorten it. */
  grantCheckDeadlineMs?: number
  /** How long signing in may take in a grant check; see GRANT_CONNECT_DEADLINE_MS. */
  grantConnectDeadlineMs?: number
  /**
   * Ask the person to confirm an owner act now — biometrics or passcode, not
   * only the app unlock (plan §3). Owner acts go ahead only on `ok: true`.
   * Unset, every owner act refuses with {@link OwnerCheckNotConfigured}.
   */
  confirmOwner?: ConfirmOwner
  /**
   * How long an owner act (adding a device) may take once the owner has
   * confirmed: signing in plus the agent's answer. Past it the act gives up
   * as `noAnswer` instead of leaving the screen waiting (IN-53). Tests shorten it.
   */
  ownerActDeadlineMs?: number
  /**
   * Whether this phone has a screen lock or biometrics, so an owner key made
   * on it is protected (plan §3). Unset, "Create my agent" refuses with
   * {@link OwnerCheckNotConfigured}.
   */
  deviceCanOwn?: DeviceCanOwn
  /** This phone's name, for the label of its own access entry ("Keyring — <name>"). */
  deviceName?: () => Promise<string> | string
  /** An agent host's automatic connection: its waits, for tests (fetch is `fetch` above). */
  agentHost?: Pick<AgentHostDeps, 'sleep' | 'now'>
  /** How long to wait between sign-in tries once a host says the agent is ready; tests shorten it. */
  hostSignInRetryMs?: number
}

/**
 * Once an agent host says the agent is ready for this phone (`awaiting_mobile`),
 * signing in is tried this many times, HOST_SIGN_IN_RETRY_MS apart: the agent
 * has just restarted with this phone on its access list and may take a moment
 * to answer.
 */
export const HOST_SIGN_IN_TRIES = 24
export const HOST_SIGN_IN_RETRY_MS = 5000

/** Why an automatic connection stopped, as a link failure: the reason the older screens know, and the host's own. */
function hostFailure(error: AgentHostConnectionError): VtaLinkFailure {
  const reason: VtaLinkFailure['reason'] =
    error.reason === 'expired' || error.reason === 'timedOut'
      ? 'expired'
      : error.reason === 'unreachable' || error.reason === 'busy' || error.reason === 'unavailable'
        ? 'unreachable'
        : error.reason === 'taken' || error.reason === 'notAccepted'
          ? 'refused'
          : 'failed'
  // The host's own words go behind Details only for a failed setup, which its doc calls safe to display.
  const detail = error.hostError ? `${error.message}: ${error.hostError}` : error.message
  return { reason, hostReason: error.reason, detail }
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
  if (isUnsettledSwap(error)) return error.refusedBoth
  return ACCESS_REVOKED.test(error instanceof Error ? error.message : String(error))
}

/** A key swap the VTA could not be asked about, or refused both keys of. */
function isUnsettledSwap(error: unknown): error is ManagerKeyUnresolved {
  return typeof ManagerKeyUnresolved === 'function' && error instanceof ManagerKeyUnresolved
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
/** How long a background sign-in may take before it counts as a drop and is retried (IN-53). */
export const SESSION_CONNECT_DEADLINE_MS = 30000
/** How long Unlink waits on the agent to hear it (wake cleared, sessions ended), from when it is told, before it unlinks anyway. */
export const UNLINK_TELL_DEADLINE_MS = 5000
/** The most Unlink waits in all, from the tap, whether or not the telling left the phone. */
export const UNLINK_TELL_QUEUE_MS = 10000
/**
 * Signing in and the agent's answer to an owner act (adding a device): the
 * grant's own reply wait is 30 s once sent, and signing in comes before it.
 */
export const OWNER_ACT_DEADLINE_MS = 45000
/** Reconnect tries in a row (1 s, 2 s, 4 s, 8 s, 16 s apart) before the agent screen says it didn't answer. */
export const MAX_RECONNECT_TRIES = 5

/** How long the step-up card waits for the person; unanswered, nothing is sent. */
export const STEP_UP_ASK_TIMEOUT_MS = 120_000

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

/**
 * What a manager session keeps of a message it receives with no request of
 * ours waiting: a consent request (a request for this phone's decision) and a
 * consent-granted notice. Everything else is ignored. One function for the
 * live session and for a look at another agent (several agents, step 3), so
 * neither keeps or drops anything the other would not.
 */
export function keepManagerMessage(
  plaintext: DidCommV2PlaintextMessage,
  now: number
): { approval: VtiApproval } | { granted: true } | undefined {
  const body = plaintext.body as { id?: string; type?: string; payload?: VtaConsentRequest } | undefined
  if (body?.type === VTA_TASK.consentRequest && body.payload?.challenge) {
    return {
      approval: {
        ...body.payload,
        id: String(body.id ?? body.payload.challenge),
        receivedAt: new Date(now).toISOString(),
        status: 'pending',
        matchCode: consentMatchCode(body.payload.payloadDigest),
        outcome: consentOutcome(body.payload),
      },
    }
  }
  if (body?.type === VTA_TASK.consentGranted) return { granted: true }
  return undefined
}

/**
 * The requests still waiting at `now`: pending, and not past an expiry that can
 * be read (the rule `waitingRequests` uses; kept here, as that module imports this one).
 */
function stillWaiting(approvals: VtiApproval[], now: number): VtiApproval[] {
  return approvals.filter((a) => {
    if (a.status !== 'pending') return false
    const expiry = Date.parse(String(a.expiresAt ?? ''))
    return !Number.isFinite(expiry) || expiry > now
  })
}

/** A look at another agent: how long after the last message it ends, and at most. */
export const LOOK_QUIET_MS = 3_000
export const LOOK_MAX_MS = 12_000

/**
 * Tell an agent this phone is leaving it: stop waking it (`device/set-wake`
 * with no handle), then end its sessions (`auth/revoke-session`, all). Best-
 * effort: a refusal or a silence changes nothing. `sent` runs when the first
 * task leaves the phone, so a deadline can count from there.
 */
export async function tellAgentLeaving(
  client: Pick<VtaClient, 'task'>,
  sent: () => void = () => undefined
): Promise<void> {
  await client.task(AGENT_DEVICE_TASK.setWake, {}, UNLINK_TELL_DEADLINE_MS, {}, sent).catch(() => undefined)
  await client
    .task(VTA_TASK.revokeSession, { all: true, reason: 'Unlinked on this phone' }, UNLINK_TELL_DEADLINE_MS)
    .catch(() => undefined)
}

export class VtaAgentController {
  private state: VtaAgentState = {
    status: 'disconnected',
    approvals: [],
    link: initialLinkState,
    introSeen: true,
    activity: [],
    linkRestored: false,
  }
  private listeners = new Set<Listener>()
  private current?: { client: VtaClient; vtaDid: string; store: VtiIdentityStore; agent: Agent }
  /** The agent the app handed over at restore; the app builds a new one after every lock. */
  private agent?: Agent
  /** A grant check's question still open after it gave up waiting (GRANT_HOLD_MS). */
  private heldAnswer?: { vtaDid: string; answer: Promise<unknown>; until: number }
  private deps: VtaAgentDeps = {}
  private restored = false
  private offer?: EnrolmentOffer
  /** A scanned agent-host QR waiting for the person to confirm. Holds a credential: never logged. */
  private hostOffer?: AgentHostOffer
  /** Bumped by every new attempt and every cancel, so a late reply from an abandoned one moves nothing. */
  private attemptToken = 0
  private reconnectAttempt = 0
  private retryTimer?: ReturnType<typeof setTimeout>
  private reconnecting = false
  private opening?: { client: VtaClient; done: Promise<void> }
  /** The VTA whose client an unlock just retired; its replacement opens quietly. */
  private handedOver?: string
  /** Identities whose keys moved into memory in this run; their stored copies go at the next (plan part E). */
  private readonly switchedThisRun = new Set<string>()
  /** Agents whose name is being read, or was read, in this app run. */
  private namesAsked = new Set<string>()
  /** The agent the current link attempt is creating from this phone ("Create my agent"), if it is one. */
  private ownerFor?: string
  /** The agent that was current when "Add another agent" began: the way back. */
  private addingFrom?: string
  /** The look at the other agents under way, if any. */
  private looking?: Promise<void>

  /** Replace I/O for tests; production uses the defaults. */
  configure(deps: VtaAgentDeps) {
    this.deps = deps
  }

  /**
   * How the app confirms the owner and checks the phone can hold an owner key
   * (biometrics or passcode). Only these two are set; the rest of the wiring is
   * kept. Left unset, an owner act refuses with {@link OwnerCheckNotConfigured}
   * rather than skipping the check.
   */
  /** How the app names this phone in its own access entry. Only this is set; the rest is kept. */
  setDeviceName(deviceName: () => Promise<string> | string) {
    this.deps = { ...this.deps, deviceName }
  }

  setOwnerChecks(checks: { confirmOwner: ConfirmOwner; deviceCanOwn: DeviceCanOwn }) {
    this.deps = { ...this.deps, confirmOwner: checks.confirmOwner, deviceCanOwn: checks.deviceCanOwn }
  }

  private linkStore(agent: Agent) {
    return this.deps.linkStore?.(agent) ?? new GenericRecordsVtaLinkStore(agent)
  }

  private identityStore(agent: Agent) {
    return this.deps.identityStore?.(agent) ?? new GenericRecordsIdentityStore(agent)
  }

  private communityStore(agent: Agent) {
    return this.deps.communityStore?.(agent) ?? new GenericRecordsCommunityStore(agent)
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
    // The stores answer "this community's identity" for the agent this phone
    // acts with: the linked one, or the one that removed it (whose identities
    // the person can still erase).
    const { link } = this.state
    setCurrentAgentDid(link.kind === 'linked' || link.kind === 'revoked' ? link.vtaDid : undefined)
    this.listeners.forEach((l) => l())
  }

  /** The one client for this VTA; created on first use, kept for the app's life. */
  client(agent: Agent, vtaDid: string, store?: VtiIdentityStore): VtaClient {
    // Never a client built for another agent: after a lock the app makes a new
    // one, and the old one's in-memory keys and session are gone with it.
    if (this.current?.vtaDid === vtaDid && this.current.agent === agent) return this.current.client
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
      onStepUp: (request, context) => this.askStepUp(request, context),
    })
    // The client replaced for the agent an unlock handed over keeps what the
    // screen shows: the new session opens quietly behind it.
    const handedOver = (this.current?.agent !== agent ? this.current?.vtaDid : undefined) ?? this.handedOver
    this.handedOver = undefined
    this.current = { client, vtaDid, store: identityStore, agent }
    if (handedOver !== vtaDid) this.set({ vtaDid, status: 'disconnected', approvals: [] })
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
    // One session per client: a screen asking while the app reopens it after
    // an unlock waits for that one instead of opening a second.
    if (this.opening?.client === client) return this.opening.done
    // A session reopened behind a connected screen (after an unlock, or a
    // drop) does not take the screen over with "Signing in".
    if (this.state.status !== 'connected') this.set({ status: 'connecting', error: undefined })
    const done = (async () => {
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
    })()
    this.opening = { client, done }
    try {
      await done
    } finally {
      if (this.opening?.done === done) this.opening = undefined
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
    // Called again only when the app hands over its agent anew: after every
    // unlock (the app shut its agent down at the lock, dropping every
    // identity's in-memory keys, and restarted it or built a new one).
    if (this.restored) {
      await this.adoptAgent(agent)
      return
    }
    this.restored = true
    this.agent = agent
    const link = await this.linkStore(agent)
      .get()
      .catch(() => undefined)
    this.dispatch({ type: 'restored', link, now: this.now() })
    this.set({ introSeen: !link || Boolean(link.introSeenAt), ownsAgent: link?.owner === true, linkRestored: true })
    await this.refreshAgents(agent)
    if (link) void this.ensureOnline(agent)
  }

  /** Read the list of linked agents into the state (the switcher's rows). */
  private async refreshAgents(agent: Agent): Promise<void> {
    const store = this.linkStore(agent)
    let links = await Promise.resolve(store.list?.()).catch(() => undefined)
    if (!links) {
      const one = await store.get().catch(() => undefined)
      links = one ? [one] : []
    }
    this.set({ agents: links.map(({ vtaDid, label, owner }) => ({ vtaDid, label, ...(owner ? { owner } : {}) })) })
  }

  /**
   * Stop acting with the current agent: its session closes and what was live
   * for it goes, but nothing stored is forgotten (switching, adding another).
   */
  private async leaveCurrent(): Promise<void> {
    this.attemptToken++
    this.offer = undefined
    this.hostOffer = undefined
    this.ownerFor = undefined
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    this.reconnectAttempt = 0
    await this.reset()
    this.set({
      status: 'disconnected',
      vtaDid: undefined,
      managerDid: undefined,
      approvals: [],
      awaitingConsentFor: undefined,
      error: undefined,
      reconnectGaveUp: false,
      ownsAgent: false,
    })
    this.dispatch({ type: 'unlinked' })
  }

  /** Bring the store's current agent up as this phone's agent: its link, then a session. */
  private async takeUpCurrent(agent: Agent, options: { not?: string } = {}): Promise<void> {
    const found = await this.linkStore(agent)
      .get()
      .catch(() => undefined)
    // Never the agent just unlinked, even when its record failed to go.
    const link = found && found.vtaDid !== options.not ? found : undefined
    if (link) this.dispatch({ type: 'restored', link, now: this.now() })
    this.set({ introSeen: !link || Boolean(link.introSeenAt), ownsAgent: link?.owner === true })
    await this.refreshAgents(agent)
    if (link) void this.ensureOnline(agent)
  }

  /**
   * Act with another linked agent (several agents, step 2): the current one's
   * session closes, the other becomes current and connects. Only the current
   * agent is connected; the others' messages wait at their mediators.
   */
  async useAgent(agent: Agent, vtaDid: string): Promise<void> {
    const link = this.state.link
    if (link.kind === 'linked' && link.vtaDid === vtaDid) return
    if (this.state.switchingTo) {
      releaseWarn(
        `[VTI] agent switch: to ${didPrefix(vtaDid)} not started, one to ${didPrefix(this.state.switchingTo)} is under way`
      )
      return
    }
    const started = this.now()
    releaseWarn(`[VTI] agent switch: to ${didPrefix(vtaDid)}`)
    this.set({ switchingTo: vtaDid })
    try {
      await this.switchTo(agent, vtaDid)
      releaseWarn(`[VTI] agent switch: to ${didPrefix(vtaDid)} done in ${this.now() - started} ms`)
    } catch (e) {
      releaseWarn(`[VTI] agent switch: to ${didPrefix(vtaDid)} failed (${(e as Error)?.message ?? e})`)
      throw e
    } finally {
      this.set({ switchingTo: undefined })
    }
  }

  private async switchTo(agent: Agent, vtaDid: string): Promise<void> {
    const link = this.state.link
    // Requests are acknowledged where they were seen, so the mediator will not
    // deliver them again: the leaving agent's waiting ones are kept as its
    // "other" requests, and the one switched to brings its looked-at ones in.
    const now = this.now()
    const leaving = link.kind === 'linked' || link.kind === 'revoked' ? link.vtaDid : undefined
    const others = { ...(this.state.otherRequests ?? {}) }
    if (leaving) {
      others[leaving] = { approvals: stillWaiting(this.state.approvals, now), reachable: true, at: now }
    }
    const carried = stillWaiting(others[vtaDid]?.approvals ?? [], now)
    delete others[vtaDid]
    await this.linkStore(agent).use?.(vtaDid)
    await this.leaveCurrent()
    this.set({ addedAgent: undefined, otherRequests: others })
    await this.takeUpCurrent(agent)
    if (carried.length) {
      const have = new Set(this.state.approvals.map((a) => a.id))
      this.set({ approvals: [...carried.filter((a) => !have.has(a.id)), ...this.state.approvals] })
    }
  }

  /**
   * Look at every linked agent that is not current, for requests that wait on
   * this phone (several agents, step 3): sign in as this phone's manager there,
   * keep what arrives as the live session keeps it (`keepManagerMessage`) until
   * it has been quiet for {@link LOOK_QUIET_MS}, and close. One look at a time.
   */
  async lookAtOtherAgents(agent: Agent): Promise<void> {
    if (this.looking) return this.looking
    this.looking = (async () => {
      const store = this.linkStore(agent)
      const links = (await Promise.resolve(store.list?.()).catch(() => undefined)) ?? []
      const current = this.state.link.kind === 'linked' ? this.state.link.vtaDid : undefined
      for (const { vtaDid } of links.filter((l) => l.vtaDid !== current)) {
        const seen = await this.lookAt(agent, vtaDid)
        const now = this.now()
        const before = this.state.otherRequests?.[vtaDid]?.approvals ?? []
        const byId = new Map([...before, ...(seen ?? [])].map((a) => [a.id, a]))
        this.set({
          otherRequests: {
            ...(this.state.otherRequests ?? {}),
            [vtaDid]: { approvals: stillWaiting([...byId.values()], now), reachable: seen !== undefined, at: now },
          },
        })
      }
    })().finally(() => {
      this.looking = undefined
    })
    return this.looking
  }

  /** One look: the requests seen, or undefined when the agent could not be reached. */
  private async lookAt(agent: Agent, vtaDid: string): Promise<VtiApproval[] | undefined> {
    const seen: VtiApproval[] = []
    // Time since the last message, counted in the look's own sleeps: not the
    // clock, which a phone (or a test) can move under it.
    let sinceLast = 0
    const client = (this.deps.lookClient ?? ((a, did, store, options) => new VtaClient(a, did, store, options)))(
      agent,
      vtaDid,
      this.identityStore(agent),
      {
        onInbound: (plaintext: DidCommV2PlaintextMessage) => {
          sinceLast = 0
          const kept = keepManagerMessage(plaintext, this.now())
          if (kept && 'approval' in kept && !seen.some((a) => a.id === kept.approval.id)) seen.push(kept.approval)
        },
      }
    )
    try {
      await client.connect()
      const quiet = this.deps.lookQuietMs ?? LOOK_QUIET_MS
      const most = this.deps.lookMaxMs ?? LOOK_MAX_MS
      const step = Math.min(250, quiet)
      for (let waited = 0; sinceLast < quiet && waited < most; waited += step) {
        await new Promise((resolve) => setTimeout(resolve, step))
        sinceLast += step
      }
      return seen
    } catch {
      return undefined
    } finally {
      await client.disconnect().catch(() => undefined)
    }
  }

  /**
   * "Add another agent": the current agent is left (not forgotten) so the link
   * flow can run for a new one. A link that succeeds makes the new agent current
   * and asks the person which to keep; one that is cancelled goes back.
   */
  async startAddingAgent(): Promise<void> {
    const link = this.state.link
    if (link.kind !== 'linked' && link.kind !== 'revoked') return
    this.addingFrom = link.vtaDid
    await this.leaveCurrent()
    this.set({ addingAgent: true, addedAgent: undefined })
  }

  /**
   * Unlink one of several agents (several agents, step 4). The current one
   * unlinks as always, and the next comes up. Another is told first, best-
   * effort, through a session of its own (only the current agent is connected),
   * within the same deadline as an unlink of the current one; then this phone
   * forgets its link, its own key for it and what a look found there. As with
   * any unlink, the agent keeps this phone's key on its list until removed from
   * another device (VTI-Q23), and identities and memberships stay recorded.
   */
  async unlinkAgent(agent: Agent, vtaDid: string): Promise<void> {
    const link = this.state.link
    if ((link.kind === 'linked' || link.kind === 'revoked') && link.vtaDid === vtaDid) return this.unlink(agent)
    const client = (this.deps.lookClient ?? ((a, did, store, options) => new VtaClient(a, did, store, options)))(
      agent,
      vtaDid,
      this.identityStore(agent),
      { onInbound: () => undefined }
    )
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, UNLINK_TELL_QUEUE_MS)
    })
    await Promise.race([
      (async () => {
        await client.connect()
        await tellAgentLeaving(client)
      })().catch(() => undefined),
      deadline,
    ])
    clearTimeout(timer)
    await client.disconnect().catch(() => undefined)
    await Promise.resolve(this.linkStore(agent).remove?.(vtaDid)).catch(() => undefined)
    await Promise.resolve(this.identityStore(agent).forgetManager?.(vtaDid)).catch(() => undefined)
    this.namesAsked.delete(vtaDid)
    const others = { ...(this.state.otherRequests ?? {}) }
    delete others[vtaDid]
    this.set({ otherRequests: others })
    await this.refreshAgents(agent)
  }

  /** The person keeps the agent just added: the question is answered. */
  acknowledgeAdded(): void {
    this.set({ addedAgent: undefined })
  }

  /** Back to the agent that was current before "Add another agent". */
  async stopAddingAgent(agent: Agent): Promise<void> {
    const from = this.addingFrom
    this.addingFrom = undefined
    this.set({ addingAgent: false })
    if (from) await this.useAgent(agent, from)
  }

  /**
   * The app handed over its agent again after an unlock (#10): locking shut the
   * agent down and dropped every identity's in-memory keys, and unlocking
   * either restarted the same agent or built a new one — both happen. The
   * session belonged to the agent before the lock, so it is closed, and a
   * session is opened on the agent now in use, which fetches every identity's
   * keys into its memory. Without this nothing reconnected, and no identity
   * could sign or message until the app was killed. Unlocking is the commonest
   * thing a person does, so a link that was online stays shown online while
   * this happens; only a reopen that fails counts as a drop.
   */
  private async adoptAgent(agent: Agent): Promise<void> {
    const before = this.agent
    this.agent = agent
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    const previous = this.current
    // A screen may already have built a client for a NEW agent (its effects
    // can run first): that one is current, not a leftover, and is kept.
    if (previous && !(previous.agent === agent && before !== agent)) {
      this.current = undefined
      this.handedOver = previous.vtaDid
      await previous.client.disconnect().catch(() => undefined)
    }
    await this.ensureOnline(agent, { reopen: true })
  }

  /** A scanned or pasted enrolment offer: ask the person before anything is minted. */
  scanOffer(offer: EnrolmentOffer) {
    this.offer = offer
    this.hostOffer = undefined
    this.ownerFor = undefined
    this.dispatch({ type: 'offerScanned', vtaDid: offer.vta, label: offer.label, offerUrl: offer.url, exp: offer.exp })
  }

  cancelLink() {
    this.attemptToken++
    this.offer = undefined
    this.hostOffer = undefined
    this.ownerFor = undefined
    this.dispatch({ type: 'cancelled' })
    // Adding another agent, given up: back to the one before.
    if (this.addingFrom && this.agent) void this.stopAddingAgent(this.agent)
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
    await this.tellAgentBeforeUnlink()
    this.attemptToken++
    this.offer = undefined
    this.ownerFor = undefined
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
      ownsAgent: false,
    })
    this.dispatch({ type: 'unlinked' })
    this.note('unlinked')
    // Another linked agent is now current (the store's oldest): it comes up.
    await this.takeUpCurrent(agent, { not: vtaDid })
  }

  /**
   * Before the local unlink, tell a reachable agent (A6, upstream alignment):
   * stop waking this phone (`device/set-wake`, empty), then end this phone's
   * sessions (`auth/revoke-session/0.2`, `all`). Best-effort and bounded by
   * {@link UNLINK_TELL_DEADLINE_MS}: offline, nothing is sent; a refusal or a
   * silence changes nothing, and the phone unlinks either way.
   */
  private async tellAgentBeforeUnlink(): Promise<void> {
    const link = this.state.link
    const client = this.current?.client
    if (link.kind !== 'linked' || link.connection.kind !== 'online' || !client) return
    // What was queued or in flight (an app just started runs whoami …
    // device/list) is pointless once the phone unlinks, and went first: the
    // telling waited behind it past its deadline and never reached the agent
    // (227 gate, U4). Dropped, the telling is sent at once; offline, it fails
    // at once and the phone unlinks without waiting.
    client.dropQueued()
    // The deadline counts from when the agent is told, not from the tap; at
    // most UNLINK_TELL_QUEUE_MS in all, sent or not. Timers, not clock readings.
    const timers: ReturnType<typeof setTimeout>[] = []
    let giveUp: () => void = () => undefined
    const deadline = new Promise<void>((resolve) => {
      giveUp = resolve
      timers.push(setTimeout(resolve, UNLINK_TELL_QUEUE_MS))
    })
    const tell = tellAgentLeaving(client, () => {
      timers.push(setTimeout(giveUp, UNLINK_TELL_DEADLINE_MS))
    })
    await Promise.race([tell, deadline])
    timers.forEach((timer) => clearTimeout(timer))
  }

  /**
   * The person chose to erase this phone's copy of its agent (#10), after the
   * agent stopped accepting it — or at any time. Only this phone's data for
   * that agent goes: for each identity this phone minted through it, the
   * borrowed key copies, the identity record, and the community's membership,
   * invitations and delivered credentials; then everything {@link unlink}
   * forgets. Contacts, DIDComm connections and the wallet's own credentials
   * stay. The agent holds every identity's keys, so linking again (or another
   * device) loses nothing. Never erases on its own: a refusal alone may be a
   * mistake or a restore, so the person decides. Never throws; a record that
   * fails to go is left, and the phone is unlinked either way.
   */
  async eraseThisPhonesCopy(agent: Agent): Promise<void> {
    const vtaDid = this.state.link.kind === 'notLinked' ? undefined : this.state.link.vtaDid
    if (vtaDid) {
      const identities = this.identityStore(agent)
      const communities = this.communityStore(agent)
      const personas = await identities.listPersonas().catch(() => [])
      for (const persona of personas.filter((p) => p.vtaDid === vtaDid)) {
        for (const keyId of Object.values(persona.kmsKeyIds ?? {})) {
          if (keyId) await forgetKeyCopy(agent, keyId)
        }
        await communities.forgetCommunity(persona.communityDid, persona.did).catch(() => undefined)
        await identities.forgetPersona(persona.communityDid, persona.vtaDid).catch(() => undefined)
      }
    }
    await this.unlink(agent)
  }

  /**
   * A scanned agent-host QR (`{ vta_did, callback_url }`): ask the person
   * before anything is minted or sent, showing the agent and the host's site.
   * The callback is kept out of the state the screens read.
   */
  scanHostOffer(offer: AgentHostOffer) {
    this.hostOffer = offer
    this.offer = undefined
    this.ownerFor = undefined
    this.dispatch({
      type: 'offerScanned',
      vtaDid: offer.vtaDid,
      label: offer.vtaDid.split(':')[3] ?? offer.vtaDid,
      offerUrl: offer.host,
      exp: this.now() + AGENT_HOST_QR_LIFETIME_MS,
      via: 'host',
    })
  }

  /**
   * The person agreed to an agent host's automatic connection: this phone's
   * did:key — the form a host's Admin DID takes — goes to the callback, the
   * phone waits while the host sets the agent up, then signs in and rotates
   * as every link does, and tells the host it connected. A phone with no
   * screen lock is refused first, as for "Create my agent": it becomes an
   * administrator, and the agent is remembered as its own.
   */
  private async confirmHostOffer(agent: Agent): Promise<void> {
    const offer = this.hostOffer
    if (!offer || this.state.link.kind !== 'confirming') return
    const token = ++this.attemptToken
    const live = () => token === this.attemptToken
    this.dispatch({ type: 'confirmed' })
    const identities = this.identityStore(agent)
    const label = offer.vtaDid.split(':')[3] ?? offer.vtaDid
    try {
      const canOwn = this.deps.deviceCanOwn
      if (canOwn && !(await canOwn())) throw new DeviceCannotOwn()
      this.ownerFor = offer.vtaDid
      if (await this.resumeEarlierLink(agent, offer.vtaDid, label, identities, live)) return
      if (!live()) return
      await connectWithAgentHost(offer, {
        ...(this.deps.fetch ? { fetch: this.deps.fetch } : {}),
        ...this.deps.agentHost,
        shouldStop: () => !live(),
        adminDid: async () => {
          await resolveVtaMediator(agent, offer.vtaDid)
          const did = await createVtiTemporaryDidKey(agent)
          await identities.setManager({
            vtaDid: offer.vtaDid,
            did,
            createdAt: new Date(this.now()).toISOString(),
            stage: 'temporary',
          })
          return did
        },
        onAccepted: (accepted) => {
          if (!live()) return
          this.dispatch({ type: 'submitted', code: '' })
          this.dispatch({
            type: 'hostStage',
            step: accepted.status === 'provisioning' ? 'creating' : 'connecting',
            now: this.now(),
          })
        },
        onStatus: (status) => {
          if (live()) {
            this.dispatch({
              type: 'hostStage',
              step: status === 'provisioning' ? 'creating' : 'connecting',
              now: this.now(),
            })
          }
        },
        link: async () => {
          if (!live()) throw new AgentHostConnectionError('cancelled')
          const client = await this.signInOnceReady(agent, offer.vtaDid, identities, live)
          if (!live()) throw new AgentHostConnectionError('cancelled')
          this.dispatch({ type: 'granted' })
          await this.finishLink(agent, offer.vtaDid, label, identities, live, client)
        },
        warn: (message) => agent.config?.logger?.warn?.(`[TrustTasks:VtaAgent] ${message}`),
      })
    } catch (error) {
      if (!live()) return
      if (error instanceof AgentHostConnectionError && error.reason === 'cancelled') return
      const failure =
        error instanceof AgentHostConnectionError
          ? hostFailure(error)
          : error instanceof DeviceCannotOwn
            ? { reason: 'refused' as const, detail: 'no screen lock', hostReason: 'needsScreenLock' as const }
            : { reason: 'failed' as const, detail: error instanceof Error ? error.message : String(error) }
      this.ownerFor = undefined
      this.set({ status: 'failed', error: failure.detail })
      this.dispatch({ type: 'failed', failure })
    } finally {
      if (live()) this.hostOffer = undefined
    }
  }

  /**
   * Sign in as the temporary key once a host says the agent is ready. The
   * agent has just restarted with this phone on its access list, so a
   * refusal or silence is tried again, a few seconds apart, before giving up.
   */
  private async signInOnceReady(
    agent: Agent,
    vtaDid: string,
    identities: VtiIdentityStore,
    live: () => boolean
  ): Promise<VtaClient> {
    const wait = this.deps.agentHost?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
    let last: unknown
    for (let attempt = 0; attempt < HOST_SIGN_IN_TRIES; attempt++) {
      if (!live()) throw new AgentHostConnectionError('cancelled')
      // The first try is "connecting this phone"; a retry says which try it is.
      this.dispatch(
        attempt === 0
          ? { type: 'hostStage', step: 'connecting', now: this.now() }
          : { type: 'hostStage', step: 'signingIn', attempt: attempt + 1, of: HOST_SIGN_IN_TRIES, now: this.now() }
      )
      await this.reset()
      const client = this.client(agent, vtaDid, identities)
      this.set({ status: 'connecting', error: undefined })
      try {
        const connected = await withDeadline(
          client.connect(),
          this.deps.grantConnectDeadlineMs ?? GRANT_CONNECT_DEADLINE_MS
        )
        if (connected) {
          await client.whoAmI()
          return client
        }
        last = new Error('the agent did not answer')
      } catch (error) {
        last = error
      }
      await wait(this.deps.hostSignInRetryMs ?? HOST_SIGN_IN_RETRY_MS)
    }
    await this.reset()
    throw last instanceof Error ? last : new Error(String(last))
  }

  /**
   * The person agreed to link: submit the temporary key, wait for the admin,
   * then sign in as that key and rotate onto a long-lived one. Every step
   * moves the machine; the screen only renders it.
   */
  async confirmOffer(agent: Agent): Promise<void> {
    if (this.hostOffer) return this.confirmHostOffer(agent)
    const offer = this.offer
    if (!offer || this.state.link.kind !== 'confirming') return
    const token = ++this.attemptToken
    const live = () => token === this.attemptToken
    this.dispatch({ type: 'confirmed' })
    const identities = this.identityStore(agent)
    const enrol = this.deps.enrol ?? { submit: submitEnrolment, waitForGrant }
    try {
      if (await this.resumeEarlierLink(agent, offer.vta, offer.label, identities, live)) return
      if (!live()) return
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
   * A fresh link attempt for an agent this phone left a key swap unsettled
   * with — the swap's answer was lost, and the app never settled it. The agent
   * may hold the successor key, and minting a new temporary key would
   * overwrite the only record of it, so the agent is asked first (a connect
   * settles a pending swap). If it knows one of this phone's keys the phone is
   * linked again with it, no new grant needed: true. If it refused both, the
   * record holds nothing live and the attempt goes on as a new link: false.
   * If it could not be asked, the attempt fails rather than risk the key.
   *
   * A pending swap with a different agent is left alone: the identity store
   * keeps one record per agent, so it waits there for that agent to be linked
   * again. The phone cannot take the key off that agent's ACL (VTI-Q23); only
   * its admin can.
   */
  private async resumeEarlierLink(
    agent: Agent,
    vtaDid: string,
    label: string,
    identities: VtiIdentityStore,
    live: () => boolean
  ): Promise<boolean> {
    const record = await Promise.resolve(identities.getManager?.(vtaDid)).catch(() => undefined)
    if (!record?.pendingNext) return false
    await this.reset()
    const client = this.client(agent, vtaDid, identities)
    this.set({ status: 'connecting', error: undefined })
    try {
      await client.connect()
    } catch (error) {
      await this.reset()
      if (isUnsettledSwap(error) && error.refusedBoth) return false
      const detail = error instanceof Error ? error.message : String(error)
      throw new EnrolmentError(detail, 'unreachable')
    }
    if (!live()) return true
    // Settled: rotate only a temporary key the VTA confirmed it kept (the swap
    // never happened). A successor still pending is never replaced by a new
    // one — rotating would overwrite it — and the next connect asks again.
    const settled = await Promise.resolve(identities.getManager(vtaDid)).catch(() => undefined)
    const rotate = settled?.stage === 'temporary' && !settled.pendingNext
    this.dispatch({ type: 'resumed', vtaDid, label })
    await this.finishLink(agent, vtaDid, label, identities, live, client, rotate)
    return true
  }

  /**
   * The granted key signs in, rotates onto a long-lived one, and the agent is
   * remembered — the same for a scanned offer and for a key pasted by hand.
   * Assumes the machine is in `linking` (it dispatched `granted`).
   *
   * The link is remembered before the swap is sent: the agent granted this
   * phone, and the swap only moves that grant to another of its keys. So an
   * answer lost to a dropped socket or a killed app leaves a linked phone
   * whose next connect settles which key the agent holds — never an unlinked
   * one whose agent holds a key it will not use again.
   */
  private async finishLink(
    agent: Agent,
    vtaDid: string,
    label: string,
    identities: VtiIdentityStore,
    live: () => boolean,
    signedIn?: VtaClient,
    rotate = true
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
    const linkedAt = new Date(this.now()).toISOString()
    const links = this.linkStore(agent)
    const owner = this.ownerFor === vtaDid
    this.ownerFor = undefined
    await links.set({ vtaDid, label, linkedAt, ...(owner ? { owner: true } : {}) })
    // The agent just linked is the one this phone acts with: the store keeps
    // every linked agent, and a link no longer replaces another one's record.
    await links.use?.(vtaDid)
    this.set({ ownsAgent: owner })
    if (this.addingFrom && this.addingFrom !== vtaDid) {
      this.set({ addingAgent: false, addedAgent: { from: this.addingFrom, added: vtaDid } })
    } else if (this.state.addingAgent) {
      this.set({ addingAgent: false })
    }
    this.addingFrom = undefined
    await this.refreshAgents(agent)
    if (rotate) {
      this.dispatch({ type: 'rotating' })
      try {
        await client.rotateManagerKey()
      } catch (error) {
        // Swapped, but the new key's sign-in failed: linked, and it reconnects (below).
        const swapDone = error instanceof SwapDoneSignInFailed
        if (!swapDone && !(await this.swapStillOpen(error, identities, vtaDid))) {
          // Settled on the VTA's word that the swap never happened (or it was
          // refused outright): the attempt failed, as before, and is forgotten.
          await links.clear().catch(() => undefined)
          throw error
        }
        // The swap's outcome is not known yet. Linked, offline: the next
        // connect asks the VTA which key it holds, and this screen does not
        // say "didn't answer" about a request the agent may well have done.
        const reason = error instanceof Error ? error.message : String(error)
        await this.reset()
        this.set({ introSeen: false, status: 'disconnected', vtaDid, error: reason })
        this.reconnectAttempt = 0
        this.dispatch({ type: 'linked', linkedAt, connection: { kind: 'offline', since: this.now(), reason } })
        void this.ensureOnline(agent)
        return
      }
      // The new key has never spoken to the VTA; a round trip gives it a reply route (VTI-24).
      await client.whoAmI().catch(() => undefined)
      // In the background: a slow or silent answer must not hold the link up.
      void this.labelOwnEntry(agent, client)
    }
    this.set({ introSeen: false })
    this.reconnectAttempt = 0
    this.set({ status: 'connected', vtaDid, managerDid: client.managerDid })
    this.dispatch({ type: 'linked', linkedAt })
    this.learnAgentName(client, vtaDid)
  }

  /** Whether this phone still speaks to `vtaDid` with the temporary key its link began with. */
  private async onTemporaryKey(agent: Agent, vtaDid: string): Promise<boolean> {
    const record = await Promise.resolve(this.identityStore(agent).getManager?.(vtaDid)).catch(() => undefined)
    return record?.stage === 'temporary'
  }

  /**
   * Name this phone's own access entry after the swap, "Keyring — <device
   * name>", so an agent's admin sees which entry is which (a host's own grant
   * carries no label, and the swap keeps whatever label the entry had). Best
   * effort: a refusal leaves the entry unnamed and the link as it is.
   */
  private async labelOwnEntry(agent: Agent, client: VtaClient): Promise<void> {
    // Nothing here may fail the link: every step, the name included, is caught.
    try {
      const did = client.managerDid
      if (!did) return
      // Platforms answer "unknown" when they will not say (Android 12+ without
      // BLUETOOTH_CONNECT; emulators): that is no name.
      const raw = String((await this.deps.deviceName?.()) ?? '').trim()
      const name = raw.toLowerCase() === 'unknown' ? '' : raw
      await client.labelAclEntry(did, name ? `Keyring — ${name}` : 'Keyring')
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      agent.config?.logger?.warn?.(`[TrustTasks:VtaAgent] could not label this phone's access entry: ${detail}`)
    }
  }

  /**
   * Whether a failed rotation left the successor pending: the VTA could not
   * be asked, or it was asked and the answer did not settle it. Refused both
   * keys is settled — nothing live is left to link with.
   */
  private async swapStillOpen(error: unknown, identities: VtiIdentityStore, vtaDid: string): Promise<boolean> {
    if (isUnsettledSwap(error)) return !error.refusedBoth
    const record = await Promise.resolve(identities.getManager?.(vtaDid)).catch(() => undefined)
    return Boolean(record?.pendingNext)
  }

  /**
   * Linking without a QR (plan §5.1 fallback): the person names their agent,
   * the phone mints its temporary key and shows it, and the admin pastes it
   * into their own console — upstream's Grant access form, or the Farm's
   * admin-DID step. Nothing is submitted anywhere by the phone.
   */
  async startManualLink(agent: Agent, vtaDid: string, label: string, opts: { via?: 'scan' } = {}): Promise<void> {
    return this.beginManualLink(agent, vtaDid, label, false, opts.via)
  }

  /**
   * "Create my agent" (own_agent_subtask.md §1): the person created the agent
   * on the Farm and brought its address here; the phone makes its owner code
   * — today's temporary key — for the Farm's Admin DID box. It is the manual
   * link from here on (`showingKey`, then `checkManualGrant`, then the swap
   * onto a long-term key), with two differences: a phone with no screen lock
   * or biometrics is refused before any key is made ({@link DeviceCannotOwn}),
   * and the finished link is remembered as this phone's own (`ownsAgent`).
   */
  async startCreateAgent(agent: Agent, vtaDid: string, label: string = vtaDid): Promise<void> {
    if (this.state.link.kind !== 'notLinked') return
    const canOwn = this.deps.deviceCanOwn
    if (!canOwn) throw new OwnerCheckNotConfigured('deviceCanOwn')
    if (!(await canOwn())) throw new DeviceCannotOwn()
    return this.beginManualLink(agent, vtaDid, label, true)
  }

  private async beginManualLink(
    agent: Agent,
    vtaDid: string,
    label: string,
    owner: boolean,
    via?: 'scan'
  ): Promise<void> {
    if (this.state.link.kind !== 'notLinked') return
    this.ownerFor = owner ? vtaDid : undefined
    const token = ++this.attemptToken
    const live = () => token === this.attemptToken
    try {
      if (await this.resumeEarlierLink(agent, vtaDid, label, this.identityStore(agent), live)) return
      if (!live()) return
      // The agent must be reachable before a key is shown for it; the key
      // itself is a did:key, the only form the Farm's Admin DID field takes.
      await resolveVtaMediator(agent, vtaDid)
      const did = await createVtiTemporaryDidKey(agent)
      await this.identityStore(agent).setManager({
        vtaDid,
        did,
        createdAt: new Date(this.now()).toISOString(),
        stage: 'temporary',
      })
      if (token !== this.attemptToken) return
      this.dispatch({ type: 'keyShown', vtaDid, label, did, ...(via ? { via } : {}) })
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

  /** The linked agent's address, for the QR a backup phone scans (plan §4); undefined before a link. */
  agentAddress(): string | undefined {
    const link = this.state.link
    return link.kind === 'linked' ? link.vtaDid : undefined
  }

  /**
   * The devices that run this agent: its admin rows, this phone's marked.
   * Signs in if it must. Refuses with {@link DeviceActionRefused}.
   */
  async listDevices(agent: Agent): Promise<VtaDevice[]> {
    const vtaDid = this.linkedAgent()
    const client = await this.signedIn(agent, vtaDid)
    const mine = await this.phoneKeys(agent, vtaDid)
    const entries = await client.listAcl().catch((error: unknown) => {
      throw this.refused(error)
    })
    return entries.filter((entry) => entry.role === 'admin').map((entry) => deviceFrom(entry, mine))
  }

  /**
   * Make another device a full administrator of this agent (plan §4): the
   * backup phone's code, scanned or pasted. Refuses this phone's own code and
   * anything that is not a DID before asking anyone; then asks the person to
   * confirm ({@link OwnerNotConfirmed} if not, nothing sent); then sends
   * `acl/grant/0.1`. Answers the device as the agent now holds it.
   */
  async addBackupDevice(agent: Agent, did: string, label?: string): Promise<VtaDevice> {
    const vtaDid = this.linkedAgent()
    if (!looksLikeDid(did)) throw new DeviceActionRefused('notADid')
    let mine = await this.phoneKeys(agent, vtaDid)
    if (mine.includes(did)) throw new DeviceActionRefused('thisPhone')
    await this.confirmOwner('Add a backup device to your agent')
    return this.withinOwnerDeadline(async () => {
      const client = await this.signedIn(agent, vtaDid)
      mine = await this.phoneKeys(agent, vtaDid)
      if (mine.includes(did)) throw new DeviceActionRefused('thisPhone')
      const entry = await client.grantAdmin(did, { label }).catch((error: unknown) => {
        throw this.refused(error)
      })
      return deviceFrom(entry, mine)
    })
  }

  /**
   * An owner act, bounded: signing in has no deadline of its own (resolving the
   * agent's mediator and opening the session), so an agent that cannot be
   * reached kept "Add as backup" spinning for minutes (IN-53, a Farm-hosted
   * agent on 226). Past the deadline it is `noAnswer` — "Your agent didn't
   * answer. Check the list before trying again." — since the act may still land.
   */
  private async withinOwnerDeadline<T>(act: () => Promise<T>): Promise<T> {
    const ms = this.deps.ownerActDeadlineMs ?? OWNER_ACT_DEADLINE_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new DeviceActionRefused('noAnswer')), ms)
    })
    try {
      return await Promise.race([act(), late])
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Take a device off this agent: `acl/revoke/0.1`. Never this phone — it is
   * refused here before anything is asked, and the agent refuses a caller
   * removing itself anyway (vta-service operations/acl.rs:792-796). Asks the
   * person to confirm first; nothing is sent without it.
   */
  async removeDevice(agent: Agent, did: string): Promise<void> {
    const vtaDid = this.linkedAgent()
    if (!looksLikeDid(did)) throw new DeviceActionRefused('notADid')
    if ((await this.phoneKeys(agent, vtaDid)).includes(did)) throw new DeviceActionRefused('thisPhone')
    await this.confirmOwner('Remove a device from your agent')
    const client = await this.signedIn(agent, vtaDid)
    if ((await this.phoneKeys(agent, vtaDid)).includes(did)) throw new DeviceActionRefused('thisPhone')
    await client.revokeSubject(did).catch((error: unknown) => {
      throw this.refused(error)
    })
  }

  /**
   * Every device that runs this agent with its device binding where it has one
   * (#10, {@link listAgentDevices}), this phone's own keys marked. Signs in if
   * it must. Refuses with {@link DeviceActionRefused}.
   */
  async agentDevices(agent: Agent): Promise<AgentDevice[]> {
    const vtaDid = this.linkedAgent()
    const client = await this.signedIn(agent, vtaDid)
    const mine = await this.phoneKeys(agent, vtaDid)
    const devices = await listAgentDevices(client).catch((error: unknown) => {
      throw this.refused(error)
    })
    return devices.map((d) => ({ ...d, isThisPhone: mine.includes(d.did) }))
  }

  /**
   * Remove a device from this agent (#10, {@link removeAgentDevice}): a
   * registered device is wiped and then revoked, one with no binding revoked. Never this phone,
   * refused before anything is asked; the person confirms first and nothing is
   * sent without it.
   */
  async removeAgentDevice(agent: Agent, device: AgentDevice): Promise<{ mode: 'wiped' | 'revoked' }> {
    const vtaDid = this.linkedAgent()
    if ((await this.phoneKeys(agent, vtaDid)).includes(device.did)) throw new DeviceActionRefused('thisPhone')
    await this.confirmOwner('Remove a device from your agent')
    const client = await this.signedIn(agent, vtaDid)
    if ((await this.phoneKeys(agent, vtaDid)).includes(device.did)) throw new DeviceActionRefused('thisPhone')
    return removeAgentDevice(client, { ...device, isThisPhone: false }).catch((error: unknown) => {
      throw this.refused(error)
    })
  }

  /**
   * Register this phone on its agent with the name the person chose (#10). The
   * agent refuses a second registration, so a phone already registered — by
   * the presence loop with the default name, say — gets the chosen name by a
   * heartbeat instead: either way the agent ends with this name.
   */
  async registerThisDevice(agent: Agent, displayName: string): Promise<void> {
    const client = await this.signedIn(agent, this.linkedAgent())
    const claimed = await registerThisDevice(client, { displayName, platform: Platform.OS }).catch((error: unknown) => {
      throw this.refused(error)
    })
    if (claimed === 'alreadyRegistered') {
      await renameThisDevice(client, displayName).catch((error: unknown) => {
        throw this.refused(error)
      })
    }
  }

  /**
   * A signed-in client for the presence loop (#10, `vtaPresence`) while this
   * phone is linked; undefined when it is not. Refuses like any other call when
   * the agent cannot be reached — the loop logs that and tries again.
   */
  async presencePort(agent: Agent): Promise<VtaClient | undefined> {
    const vtaDid = this.agentAddress()
    if (!vtaDid) return undefined
    return this.signedIn(agent, vtaDid)
  }

  /**
   * A presence tick that failed. The agent answers a phone another device
   * removed with "DID not in ACL" (a signed permissionDenied, vta-service
   * messaging/auth.rs), which moves the link to removed, as a refused owner
   * act does; anything else — no answer, the network — is tried next tick.
   */
  presenceFailed(error: unknown): void {
    this.refused(error)
  }

  /**
   * Tell this phone's agent how to wake it: the handle a push gateway gave for
   * its push token (push notifications plan §4.4). The agent provisions the
   * gateway itself; the phone signs nothing there.
   */
  async setThisDeviceWake(
    agent: Agent,
    wake: WakeHandle,
    opts: { pushPlatform?: PushPlatform; suggestedTriggers?: string[] } = {}
  ): Promise<WakeChannel> {
    const client = await this.signedIn(agent, this.linkedAgent())
    return setThisDeviceWake(client, wake, opts).catch((error: unknown) => {
      throw this.refused(error)
    })
  }

  /** Stop this phone's agent waking it: sent before the phone unlinks (plan §8). */
  async clearThisDeviceWake(agent: Agent): Promise<WakeChannel> {
    const client = await this.signedIn(agent, this.linkedAgent())
    return clearThisDeviceWake(client).catch((error: unknown) => {
      throw this.refused(error)
    })
  }

  /** Rename this phone on its agent (#10): a heartbeat carrying the new name. */
  async renameThisDevice(agent: Agent, displayName: string): Promise<void> {
    const client = await this.signedIn(agent, this.linkedAgent())
    await renameThisDevice(client, displayName).catch((error: unknown) => {
      throw this.refused(error)
    })
  }

  /**
   * Whether rotating a persona's keys is safe on this agent (#10, lost phone):
   * `yes` from vta-service 0.43.0, `unknown` when the agent does not say or
   * reports 0.42.x, `agentTooOld` before that. Never throws.
   */
  async canRotatePersonaKeys(agent: Agent): Promise<RotationSupport> {
    const vtaDid = this.agentAddress()
    if (!vtaDid) return 'unknown'
    return rotationSupport(await agentVersion(agent, vtaDid))
  }

  /**
   * Rotate one persona's keys on the agent after a lost phone (#10), then take
   * fresh copies for this phone. The person confirms first; nothing is sent
   * without it.
   */
  async rotatePersonaKeys(agent: Agent, personaDid: string): Promise<void> {
    const vtaDid = this.linkedAgent()
    await this.confirmOwner("Replace this identity's keys")
    const client = await this.signedIn(agent, vtaDid)
    const store = this.identityStore(agent)
    const persona = (await store.listPersonas()).find((p) => p.did === personaDid)
    if (!persona) throw new DeviceActionRefused('failed', `no persona ${personaDid} on this phone`)
    await rotatePersonaKeys(client, store, persona).catch((error: unknown) => {
      throw this.refused(error)
    })
  }

  /**
   * Rotate the keys of every identity this phone holds on the linked agent,
   * behind one owner check rather than one per identity. Carries on past an
   * identity the agent refuses and answers each outcome, worded as a
   * {@link DeviceRefusalReason}.
   */
  async rotateAllPersonaKeys(agent: Agent): Promise<{
    rotated: string[]
    unpublished: string[]
    failed: { did: string; reason: DeviceRefusalReason }[]
  }> {
    const vtaDid = this.linkedAgent()
    await this.confirmOwner("Replace your identities' keys")
    const client = await this.signedIn(agent, vtaDid)
    const store = this.identityStore(agent)
    const personas = (await store.listPersonas()).filter((p) => p.vtaDid === vtaDid)
    const { rotated, unpublished, failed } = await rotateEachPersona(client, store, personas, (did, keys) =>
      resolvesWithKeys(agent, did, keys)
    )
    return {
      rotated,
      unpublished,
      failed: failed.map(({ did, error }) => ({ did, reason: this.refused(error).reason })),
    }
  }

  /**
   * With a session open, fetch into memory the keys of every identity this
   * phone holds through that agent (#10, plan part C): memory is empty after a
   * restart or a lock, and nothing signs as a persona until its keys are back.
   * Never throws; an identity whose keys cannot be fetched is tried again at
   * the next session, or when it is next used.
   */
  private async holdPersonaKeys(agent: Agent, vtaDid: string): Promise<void> {
    // An install from before memory-only custody moves its stored copies first
    // (plan part E); a persona whose agent will not hand its keys over keeps
    // its stored copy and moves at a later session.
    try {
      const client = this.client(agent, vtaDid)
      const { switched, moved, removed, waiting } = await migratePersonaKeys(
        { borrowKey: (id) => client.borrowKey(id), forgetKeyCopy: (id) => forgetKeyCopy(agent, id) },
        this.identityStore(agent),
        vtaDid,
        this.switchedThisRun
      )
      // Ids only, never key material: the upgrade's one destructive step is
      // visible in the device log.
      const log = agent.config?.logger
      if (switched.length > 0) {
        log?.warn?.(
          `[VTA] key migration: ${switched.length} identities now use in-memory keys; their stored copies are removed at the next launch (${switched.join(', ')})`
        )
      }
      if (moved.length > 0) {
        log?.warn?.(
          `[VTA] key migration: removed ${removed.length} stored identity key copies (ids: ${removed.join(', ')}) for ${moved.join(', ')}`
        )
      }
      for (const { did, error } of waiting) {
        agent.config?.logger?.warn?.(
          `[VTA] ${did} keeps its stored keys for now: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    } catch (e) {
      agent.config?.logger?.warn?.(
        `[VTA] moving identities' keys into memory: ${e instanceof Error ? e.message : String(e)}`
      )
    }
    const personas = await Promise.resolve(this.identityStore(agent).listPersonas?.())
      .then((all) => (all ?? []).filter((p) => p.vtaDid === vtaDid))
      .catch(() => [])
    for (const persona of personas) {
      try {
        await this.client(agent, vtaDid).holdPersonaKeys(persona)
        DeviceEventEmitter.emit(VTI_PERSONA_KEYS_HELD_EVENT, { did: persona.did })
      } catch (e) {
        agent.config?.logger?.warn?.(
          `[VTA] fetching ${persona.did}'s keys into memory: ${e instanceof Error ? e.message : String(e)}`
        )
      }
    }
  }

  /** The agent this phone is linked to, or a refusal a screen words as "no agent yet". */
  private linkedAgent(): string {
    const vtaDid = this.agentAddress()
    if (!vtaDid) throw new DeviceActionRefused('notLinked')
    return vtaDid
  }

  /** The session with the linked agent, opened if it must be. */
  private async signedIn(agent: Agent, vtaDid: string): Promise<VtaClient> {
    try {
      await this.connect(agent, vtaDid)
    } catch (error) {
      if (connectFailureRevokes(error)) throw this.refused(error)
      throw new DeviceActionRefused('unreachable', error instanceof Error ? error.message : String(error))
    }
    return this.client(agent, vtaDid)
  }

  /** Every key of this phone's the agent might hold: the recorded one, a pending successor, the one signed in. */
  private async phoneKeys(agent: Agent, vtaDid: string): Promise<string[]> {
    const record = await Promise.resolve(this.identityStore(agent).getManager?.(vtaDid)).catch(() => undefined)
    const signedInAs = this.current?.vtaDid === vtaDid ? this.current.client.managerDid : undefined
    return [record?.did, record?.pendingNext?.did, signedInAs].filter((d): d is string => Boolean(d))
  }

  /** The answer to the step-up card on screen now, if it is still there. */
  private stepUpAnswer?: { id: string; answer: (choice: 'approve' | 'deny') => void }

  /**
   * The agent asks for a step-up. The person first sees its reason, as sent,
   * on a card in the app (the 228 lab check: on Android the owner check right
   * after an act's own check passed without a prompt, so a reason that lived
   * only in that prompt was never seen). Confirmed, the owner check runs;
   * cancelled there, or "Don't allow" on the card, is a signed no. Nothing is
   * sent for a check that failed or a card left unanswered.
   */
  private async askStepUp(request: StepUpRequest, context: { taskType?: string } = {}): Promise<'approve' | 'deny'> {
    const confirm = this.deps.confirmOwner
    if (!confirm) throw new OwnerCheckNotConfigured('confirmOwner')
    const id = `step-up-${request.challenge.slice(0, 12)}-${this.now()}`
    const choice = await new Promise<'approve' | 'deny' | undefined>((resolve) => {
      const timer = setTimeout(() => resolve(undefined), STEP_UP_ASK_TIMEOUT_MS)
      this.stepUpAnswer = {
        id,
        answer: (c) => {
          clearTimeout(timer)
          resolve(c)
        },
      }
      this.set({
        stepUpAsk: { id, reason: request.reason, ...(context.taskType ? { taskType: context.taskType } : {}) },
      })
    })
    if (this.stepUpAnswer?.id === id) this.stepUpAnswer = undefined
    if (this.state.stepUpAsk?.id === id) this.set({ stepUpAsk: undefined })
    if (choice === undefined) throw new OwnerNotConfirmed('cancelled', 'the extra check was not answered')
    if (choice === 'deny') return 'deny'
    let answer: Awaited<ReturnType<ConfirmOwner>> | undefined
    try {
      answer = await confirm(request.reason)
    } catch (error) {
      throw new OwnerNotConfirmed('failed', error instanceof Error ? error.message : String(error))
    }
    if (answer?.ok === true) return 'approve'
    if (answer?.reason === 'cancelled') return 'deny'
    throw new OwnerNotConfirmed(answer?.reason ?? 'failed')
  }

  /** The person answered the step-up card `id`; an answer for a card no longer shown is ignored. */
  answerStepUp(id: string, choice: 'approve' | 'deny'): void {
    if (this.stepUpAnswer?.id !== id) return
    this.stepUpAnswer.answer(choice)
  }

  /** The owner check, first thing in every owner act. Throws unless the person confirmed. */
  private async confirmOwner(reason: string): Promise<void> {
    const confirm = this.deps.confirmOwner
    if (!confirm) throw new OwnerCheckNotConfigured('confirmOwner')
    let answer: Awaited<ReturnType<ConfirmOwner>> | undefined
    try {
      answer = await confirm(reason)
    } catch (error) {
      throw new OwnerNotConfirmed('failed', error instanceof Error ? error.message : String(error))
    }
    if (answer?.ok !== true) throw new OwnerNotConfirmed(answer?.reason ?? 'failed')
  }

  /** An owner act's failure, worded; an agent that no longer knows this phone also moves the link. */
  private refused(error: unknown): DeviceActionRefused {
    const refusal = deviceRefusalOf(error)
    if (refusal.reason === 'accessRevoked' && this.state.link.kind === 'linked') {
      this.dispatch({ type: 'accessRevoked', reason: refusal.detail ?? refusal.message })
    }
    return refusal
  }

  /**
   * Bring a linked phone back online: now, when the app returns to the
   * foreground or the network changes, and on a backoff after a drop.
   */
  async ensureOnline(given: Agent, options: { reopen?: boolean } = {}): Promise<void> {
    // A retry scheduled before the app replaced its agent still carries the old one.
    const agent = this.agent ?? given
    const link = this.state.link
    if (link.kind !== 'linked' || this.reconnecting) return
    // Online already, unless the session it was online on is gone (reopen).
    if (link.connection.kind === 'online' && !options.reopen) return
    this.reconnecting = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    try {
      await this.signInWithin(agent, link.vtaDid)
      this.reconnectAttempt = 0
      if (this.state.reconnectGaveUp) this.set({ reconnectGaveUp: false })
      this.dispatch({ type: 'sessionOpened' })
      void this.noteReached(agent, link.vtaDid)
      void this.holdPersonaKeys(agent, link.vtaDid)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      if (isUnsettledSwap(error) && error.refusedBoth && (await this.onTemporaryKey(agent, link.vtaDid))) {
        // A first link whose swap answer was lost, and the VTA now refuses
        // both keys: the temporary one expired, and the successor was never
        // written. The link never finished, so this is "link again", with the
        // VTA's words under Details, not a revocation of a working link and
        // not a retry that can never succeed. A later swap from a permanent
        // key refused both ways is a revocation, read as one below.
        await this.linkStore(agent)
          .clear()
          .catch(() => undefined)
        await this.reset()
        this.set({ status: 'disconnected', managerDid: undefined })
        this.dispatch({ type: 'linkLost', failure: { reason: 'failed', detail: reason } })
        return
      }
      if (connectFailureRevokes(error)) {
        this.dispatch({ type: 'accessRevoked', reason })
        return
      }
      this.dispatch({ type: 'sessionDropped', reason, now: this.now() })
      this.scheduleReconnect(agent)
      // Beside the retry, never in front of it: the lookup can take seconds.
      void this.markIfGone(agent, link.vtaDid)
    } finally {
      this.reconnecting = false
    }
  }

  /** The agent answered: keep when, and forget any "not found" seen before (agentGone.ts). */
  private async noteReached(agent: Agent, vtaDid: string): Promise<void> {
    const store = this.linkStore(agent)
    const link = await store.get().catch(() => undefined)
    if (!link || link.vtaDid !== vtaDid) return
    const now = this.now()
    // One write an hour is plenty for a threshold counted in days.
    const fresh = link.lastOnlineAt !== undefined && now - link.lastOnlineAt < 60 * 60 * 1000
    if (fresh && link.notFoundAt === undefined) return
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { notFoundAt: _forgotten, ...rest } = link
    await store.set({ ...rest, lastOnlineAt: now }).catch(() => undefined)
  }

  /** A gone agent is said once, with a way on (a new agent), and retrying stops. */
  private async markIfGone(agent: Agent, vtaDid: string): Promise<void> {
    const why = await this.goneFor(agent, vtaDid)
    const link = this.state.link
    if (!why || link.kind !== 'linked' || link.vtaDid !== vtaDid) return
    this.dispatch({ type: 'agentGone', why, now: this.now() })
    if (this.state.link.kind === 'linked' && this.state.link.connection.kind === 'gone' && this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = undefined
    }
  }

  /**
   * After a failed sign-in: is the agent gone for good? Its address is looked
   * up, what that says is kept with the link, and the thresholds decide.
   */
  private async goneFor(agent: Agent, vtaDid: string): Promise<AgentGoneWhy | undefined> {
    const store = this.linkStore(agent)
    const link = await store.get().catch(() => undefined)
    if (!link || link.vtaDid !== vtaDid) return undefined
    const lookUp = this.deps.agentAddress ?? agentAddressOf
    const address = await lookUp(agent, vtaDid).catch(() => 'unknown' as const)
    const verdict = agentGoneVerdict(link, {
      notFound: address === 'unknown' ? undefined : address === 'notFound',
      now: this.now(),
    })
    if (verdict.notFoundAt !== link.notFoundAt) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { notFoundAt: _previous, ...rest } = link
      await store
        .set(verdict.notFoundAt !== undefined ? { ...rest, notFoundAt: verdict.notFoundAt } : rest)
        .catch(() => undefined)
    }
    return verdict.gone
  }

  /**
   * Sign in, bounded. Signing in has no deadline of its own (resolving the
   * agent's mediator, opening the session), and while one is in flight every
   * other attempt returns at once (`reconnecting`): one that never settled
   * kept the phone from its agent for good, through foregrounds, unlocks and
   * retries, with nothing in the log (IN-53, 226). Past the deadline the
   * half-open client is let go and it counts as a drop, so the usual retry
   * follows.
   */
  private async signInWithin(agent: Agent, vtaDid: string): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // The sign-in in flight is shared by every caller (`opening`): let it
        // go, or the next attempt would wait on the same one.
        const stuck = this.opening
        if (stuck) {
          this.opening = undefined
          void stuck.client.disconnect().catch(() => undefined)
        }
        reject(new Error(`the VTA did not answer: signing in took over ${SESSION_CONNECT_DEADLINE_MS / 1000} s`))
      }, SESSION_CONNECT_DEADLINE_MS)
    })
    try {
      await Promise.race([this.connect(agent, vtaDid), late])
    } finally {
      clearTimeout(timer)
    }
  }

  /** "Try again" after reconnecting stopped: a fresh set of tries, starting now. */
  async tryAgainNow(agent: Agent): Promise<void> {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    this.reconnectAttempt = 0
    this.set({ reconnectGaveUp: false })
    await this.ensureOnline(agent)
  }

  private scheduleReconnect(agent: Agent) {
    if (this.retryTimer || this.state.link.kind !== 'linked') return
    const attempt = ++this.reconnectAttempt
    if (attempt > MAX_RECONNECT_TRIES) {
      this.set({ reconnectGaveUp: true })
      return
    }
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
    const kept = keepManagerMessage(plaintext, Date.now())
    if (kept && 'approval' in kept) {
      const { approval } = kept
      if (this.state.approvals.some((a) => a.id === approval.id)) return
      this.set({ approvals: [approval, ...this.state.approvals] })
      void this.checkRequest(approval.id, plaintext.body as unknown as Record<string, unknown>)
      return
    }
    if (kept && 'granted' in kept) this.set({ awaitingConsentFor: undefined })
  }

  /** Check a consent request against the linked agent and this phone, and log the verdict (log-only). */
  private async checkRequest(id: string, doc: Record<string, unknown>) {
    const current = this.current
    const approver = current?.client.managerDid
    if (!current || !approver) return
    const log = current.agent.config?.logger
    const verdict = await checkConsentRequest(current.agent, doc, { vtaDid: current.vtaDid, approver }).catch(() => ({
      ok: false as const,
      reason: 'proof' as const,
    }))
    const requestCheck = verdict.ok ? 'verified' : verdict.reason
    if (verdict.ok) log?.info?.(`[TrustTasks:VtaAgent] consent request ${id} verified`)
    else
      log?.warn?.(
        `[TrustTasks:VtaAgent] consent request ${id} did not pass the check (${verdict.reason}); listed anyway`
      )
    this.update(id, { requestCheck })
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

function deviceFrom(entry: VtaAclEntry, mine: string[]): VtaDevice {
  return {
    did: entry.subject,
    role: entry.role,
    ...(entry.label ? { label: entry.label } : {}),
    thisPhone: mine.includes(entry.subject),
    ...(entry.expiresAt ? { expiresAt: entry.expiresAt } : {}),
    ...(entry.createdAt ? { createdAt: entry.createdAt } : {}),
    ...(entry.createdBy ? { createdBy: entry.createdBy } : {}),
  }
}

export const vtaAgent = new VtaAgentController()

/** The agent's address, looked up once more: bounded, so a failed sign-in is not held up by it. */
async function agentAddressOf(agent: Agent, vtaDid: string): Promise<'notFound' | 'found' | 'unknown'> {
  const kind = await classifyDid(agent as unknown as DidResolverAgent, vtaDid, { timeoutMs: 10_000 })
  if (kind.kind !== 'unresolvable') return 'found'
  return kind.reason === 'notFound' ? 'notFound' : 'unknown'
}

/**
 * Whether `did` resolves, fresh from its host, with every key in `keys` — asked
 * a few times, since a DID host may serve an update a moment after it takes it.
 */
async function resolvesWithKeys(agent: Agent, did: string, keys: string[], attempts = 3, delayMs = 3000) {
  if (keys.length === 0) return false
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    const result = await agent.dids.resolve(did, { useCache: false, persistInCache: false }).catch(() => undefined)
    const published = new Set(
      (result?.didDocument?.verificationMethod ?? []).map((m) => m.publicKeyMultibase).filter(Boolean)
    )
    if (keys.every((k) => published.has(k))) return true
  }
  return false
}
