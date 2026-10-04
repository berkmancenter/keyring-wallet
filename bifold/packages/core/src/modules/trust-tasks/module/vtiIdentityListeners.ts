/**
 * A listener for every identity of this phone that the shared session is not
 * signed in as.
 *
 * `vtiAgent` holds one mediator session, signed in as one identity, and the
 * persona inbox serves the chosen community's identity on it. Whatever a
 * community sent any other identity this phone holds — a membership card, a
 * role, an invitation offer, a removal notice — waited at its mediator until
 * something signed in as that identity, which often never happened (IN-102).
 *
 * Each other identity now gets a listen-only session: its own socket, signed in
 * with its own borrowed keys, through the mediator its own DID document names.
 * It sends nothing; what arrives is kept as the inbox keeps it
 * (`keepForPersona`).
 *
 * A mediator keeps one live connection per DID, and the newest wins; three
 * takeovers inside five seconds and it refuses the newcomer (the mediator's
 * churn damper, `websocket_streaming.rs`). So a listener never competes with
 * the shared session: before the shared session signs in as an identity, that
 * identity's listener is stopped and its stop awaited (`vtiAgent`'s sign-in
 * guard), and it starts again only once the shared session has left that
 * identity — never on a timer while the shared session may still hold it.
 *
 * Delivery is at least once: a takeover re-pushes the whole undelivered inbox,
 * so a message may be seen by a listener and again by the shared session.
 * Keeping it is idempotent (a card is stored by id, a notice applied once, a
 * redeemed invitation code answers 404).
 *
 * @module trust-tasks/module/vtiIdentityListeners
 */
import type { Agent } from '@credo-ts/core'
import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'
import { useEffect } from 'react'
import { AppState, DeviceEventEmitter } from 'react-native'

import { VTI_PERSONA_KEYS_HELD_EVENT } from './communityChanged'
import { didPrefix } from './didPrefix'
import { releaseWarn } from './releaseLog'
import { vtaAgent } from './vtaAgent'
import { unwrapBindingEnvelope, vtiAgent } from './vtiAgent'
import { GenericRecordsIdentityStore, type VtiPersona } from './VtiIdentityStore'
import {
  advertisedMediatorDid,
  resolveVtiMediator,
  VtiMediatorSession,
  vtiClientIdentityFromPersona,
} from './VtiMediatorTransport'
import { keepForPersona } from './vtiPersonaInbox'
import { frameForm, tspSessionForPersona, unpackTrustTaskFromPeer } from './vtiTsp'

/** One listener's session, as the manager needs it. */
export interface ListenerSession {
  start(): Promise<void>
  stop(): Promise<void>
}

/** Opens a listen-only session for one identity. */
export type ListenerFactory = (persona: VtiPersona) => Promise<ListenerSession>

/**
 * Which identities get a listener: every identity of this phone with a
 * borrowed key-agreement key, for the linked agent, except the one the shared
 * session is signed in as or signing in as.
 */
export function listenerTargets(
  personas: VtiPersona[],
  shared: { did?: string; signingInAs?: string },
  vtaDid: string | undefined
): VtiPersona[] {
  if (!vtaDid) return []
  return personas.filter(
    (p) =>
      p.vtaDid === vtaDid && Boolean(p.kmsKeyIds?.keyAgreement) && p.did !== shared.did && p.did !== shared.signingInAs
  )
}

/** The shared session's identity, signed in or signing in. */
const sharedNow = () => {
  const { did, signingInAs, status } = vtiAgent.getState()
  return { did: vtiAgent.isConnected || status === 'connected' ? did : undefined, signingInAs }
}

/** How long a failed listener waits before it is tried again, doubling up to the cap. */
export const LISTENER_RETRY_MS = 15_000
export const LISTENER_RETRY_MAX_MS = 5 * 60_000

/**
 * The longest any one step of the listener manager may take. Reconciles run one
 * at a time, so a step that never finished held every later one, the 60 s
 * safety net included: on the 233 candidate a listener that failed once was
 * never tried again (17 min, Prague lane row 6).
 */
export const LISTENER_DEADLINES = { personasMs: 10_000, openMs: 30_000, startMs: 30_000, stopMs: 5_000 }
/** A reconcile that takes longer than this says so in the Release log, naming its step. */
export const RECONCILE_SLOW_MS = 10_000

class ListenerDeadline extends Error {
  constructor(step: string, ms: number) {
    super(`${step} took longer than ${Math.round(ms / 1000)} s`)
    this.name = 'ListenerDeadline'
  }
}

/** `work`, or a ListenerDeadline after `ms`; the timer never outlives the work. */
function withDeadline<T>(work: Promise<T>, ms: number, step: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ListenerDeadline(step, ms)), ms)
  })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

export interface IdentityListenersOptions {
  /** Fallback only: an identity is reached through the mediator its own DID document names. */
  mediatorDid?: string
  /** For tests: how a listener's session is opened. */
  open?: ListenerFactory
  /** For tests: the phone's identities. */
  personas?: () => Promise<VtiPersona[]>
  /** For tests: the linked agent's DID. */
  vtaDid?: () => string | undefined
  /** How often to reconcile even when nothing said to (a safety net). */
  intervalMs?: number
  now?: () => number
  /** For tests: the steps' deadlines ({@link LISTENER_DEADLINES}). */
  deadlines?: Partial<typeof LISTENER_DEADLINES>
  /** For tests: a failed listener's first wait ({@link LISTENER_RETRY_MS}). */
  retryMs?: number
}

/** Start the listeners; returns the function that stops them all. */
export function startIdentityListeners(agent: Agent, options: IdentityListenersOptions = {}): () => Promise<void> {
  const open = options.open ?? defaultListenerFactory(agent, options.mediatorDid)
  const personas = options.personas ?? (() => new GenericRecordsIdentityStore(agent).listPersonas())
  const vtaDidNow =
    options.vtaDid ??
    (() => {
      const link = vtaAgent.getState().link
      return link.kind === 'linked' ? link.vtaDid : undefined
    })
  const now = options.now ?? Date.now
  const deadline = { ...LISTENER_DEADLINES, ...(options.deadlines ?? {}) }
  /** A failed listener's own retry, at the end of its wait: it needs no other trigger. */
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** What the reconcile under way is doing, for the slow-reconcile line. */
  let step = 'idle'

  const running = new Map<string, { session?: ListenerSession; starting?: Promise<void> }>()
  const failures = new Map<string, { count: number; until: number }>()
  let stopped = false
  let paused = AppState.currentState === 'background'
  let reconciling: Promise<void> | undefined
  /** The identity the shared session last went for (its sign-in guard ran for it). */
  let sharedTarget: string | undefined
  let again = false

  const stopOne = async (did: string) => {
    const entry = running.get(did)
    if (!entry) return
    running.delete(did)
    // An open still under way finishes on its own and stops what it opened
    // (startOne sees it is no longer running); it is not waited on past the deadline.
    if (entry.starting)
      await withDeadline(entry.starting, deadline.stopMs, `stopping ${didPrefix(did)}`).catch(() => undefined)
    if (entry.session)
      await withDeadline(entry.session.stop(), deadline.stopMs, `stopping ${didPrefix(did)}`).catch(() => undefined)
  }

  const startOne = (persona: VtiPersona) => {
    const entry: { session?: ListenerSession; starting?: Promise<void> } = {}
    running.set(persona.did, entry)
    entry.starting = (async () => {
      try {
        const opening = open(persona)
        // A session that opens after its deadline is stopped, never left listening unseen.
        const session = await withDeadline(opening, deadline.openMs, `opening ${didPrefix(persona.did)}`).catch(
          (error) => {
            void opening.then((late) => late.stop()).catch(() => undefined)
            throw error
          }
        )
        // Stopped, or handed to the shared session, while it was opening.
        if (running.get(persona.did) !== entry) return void (await session.stop().catch(() => undefined))
        entry.session = session
        await withDeadline(session.start(), deadline.startMs, `starting ${didPrefix(persona.did)}`)
        failures.delete(persona.did)
        clearTimeout(retryTimers.get(persona.did))
        retryTimers.delete(persona.did)
        releaseWarn(`[VTI] listener for ${didPrefix(persona.did)} (${didPrefix(persona.communityDid)}): listening`)
      } catch (error) {
        const prior = failures.get(persona.did)?.count ?? 0
        const wait = Math.min((options.retryMs ?? LISTENER_RETRY_MS) * 2 ** prior, LISTENER_RETRY_MAX_MS)
        failures.set(persona.did, { count: prior + 1, until: now() + wait })
        if (prior === 0)
          releaseWarn(
            `[VTI] listener for ${didPrefix(persona.did)} did not open (${error instanceof Error ? error.message : String(error)}); retried in ${Math.round(wait / 1000)} s`
          )
        if (running.get(persona.did) === entry) running.delete(persona.did)
        if (entry.session) await withDeadline(entry.session.stop(), deadline.stopMs, 'stopping').catch(() => undefined)
        // Tried again at the end of its wait, whatever else happens or does not.
        clearTimeout(retryTimers.get(persona.did))
        if (!stopped)
          retryTimers.set(
            persona.did,
            setTimeout(() => {
              retryTimers.delete(persona.did)
              // The wait is over when its timer says so, whatever the clock reads now.
              const failed = failures.get(persona.did)
              if (failed) failures.set(persona.did, { ...failed, until: 0 })
              void reconcile()
            }, wait)
          )
      } finally {
        entry.starting = undefined
      }
    })()
  }

  const reconcileOnce = async () => {
    let all: VtiPersona[] = []
    if (!stopped && !paused) {
      step = 'reading identities'
      const read = await withDeadline(personas(), deadline.personasMs, step).catch((error) => {
        releaseWarn(`[VTI] listeners: identities not read (${error instanceof Error ? error.message : String(error)})`)
        return undefined
      })
      // Not read: keep the listeners as they are, rather than stopping them all.
      if (!read) return
      all = read
    }
    const wanted =
      stopped || paused ? [] : listenerTargets(all, sharedNow(), vtaDidNow()).filter((p) => p.did !== sharedTarget)
    const wantedDids = new Set(wanted.map((p) => p.did))
    step = 'stopping listeners no longer wanted'
    await Promise.all([...running.keys()].filter((did) => !wantedDids.has(did)).map(stopOne))
    step = 'starting listeners'
    if (stopped || paused) return
    for (const persona of wanted) {
      if (running.has(persona.did)) continue
      const failed = failures.get(persona.did)
      if (failed && now() < failed.until) continue
      startOne(persona)
    }
  }

  /** One reconcile at a time; a request made meanwhile runs once it is done. */
  const reconcile = (): Promise<void> => {
    if (reconciling) {
      again = true
      return reconciling
    }
    const started = Date.now()
    const slow = setTimeout(
      () => releaseWarn(`[VTI] listeners: a reconcile has run ${Math.round(RECONCILE_SLOW_MS / 1000)} s (${step})`),
      RECONCILE_SLOW_MS
    )
    reconciling = (async () => {
      do {
        again = false
        await reconcileOnce()
      } while (again)
    })().finally(() => {
      clearTimeout(slow)
      step = 'idle'
      reconciling = undefined
      const took = Date.now() - started
      if (took > RECONCILE_SLOW_MS) releaseWarn(`[VTI] listeners: a reconcile took ${Math.round(took / 1000)} s`)
    })
    return reconciling
  }

  // Before the shared session signs in as an identity, its listener steps
  // aside, and the sign-in waits for that (one live connection per DID).
  const stopGuard = vtiAgent.beforeSignIn(async (did) => {
    // Reserved for the shared session from here until it goes for another
    // identity: between its tries it is neither signed in nor signing in, and
    // a listener reopened in that gap (a keys-held retry) became a second live
    // connection for the same DID (233 candidate, 06:50:20Z).
    sharedTarget = did
    if (running.has(did)) {
      releaseWarn(`[VTI] listener for ${didPrefix(did)}: handing over to the shared session`)
      await stopOne(did)
    }
  })
  // The shared session moved: the identity it left gets its listener back.
  let lastShared = JSON.stringify(sharedNow())
  const stopWatchingShared = vtiAgent.subscribe(() => {
    const next = JSON.stringify(sharedNow())
    if (next === lastShared) return
    lastShared = next
    void reconcile()
  })
  const stopWatchingLink = vtaAgent.subscribe(() => void reconcile())
  // A new identity, or its keys back after an unlock. A listener that failed
  // because its key was not held yet is tried at once, not after its wait: on a
  // simulator it otherwise came up about 50 s after the keys did (233 build 2).
  const keysHeld = DeviceEventEmitter.addListener(VTI_PERSONA_KEYS_HELD_EVENT, (e?: { did?: string }) => {
    if (e?.did) failures.delete(e.did)
    else failures.clear()
    void reconcile()
  })
  // A socket frozen in the background looks like a duplicate when it resumes:
  // close them all before the app suspends, and open them again when it is back.
  const appState = AppState.addEventListener('change', (state) => {
    const wasPaused = paused
    paused = state === 'background'
    if (paused !== wasPaused) void reconcile()
  })
  const timer = setInterval(() => void reconcile(), options.intervalMs ?? 60_000)
  void reconcile()

  return async () => {
    stopped = true
    clearInterval(timer)
    for (const t of retryTimers.values()) clearTimeout(t)
    retryTimers.clear()
    stopGuard()
    stopWatchingShared()
    stopWatchingLink()
    keysHeld.remove()
    appState?.remove?.()
    await reconcile()
  }
}

/**
 * Keep what a listener received, as the shared session keeps it: a Trust Task
 * in the binding envelope is presented as the task itself first
 * (`unwrapBindingEnvelope`, as `vtiAgent.deliver` does). Without it a removal
 * notice reached a listener and matched nothing — its type was the envelope's —
 * so it was neither applied nor reported (233 candidate, Prague lane row).
 * What arrived and what failed are said in the Release log.
 */
export async function keepFromListener(
  agent: Agent,
  persona: VtiPersona,
  received: DidCommV2PlaintextMessage,
  via: 'didcomm' | 'tsp'
): Promise<void> {
  const who = didPrefix(persona.did)
  const message = unwrapBindingEnvelope(received)
  const kind = String(message.type ?? 'a message')
  releaseWarn(`[VTI] listener for ${who}: received ${kind} (${via})`)
  try {
    await keepForPersona(agent, persona, message)
  } catch (error) {
    releaseWarn(
      `[VTI] listener for ${who}: ${kind} not kept (${error instanceof Error ? error.message : String(error)})`
    )
    throw error
  }
}

/**
 * A listen-only session for one identity, opened the way the shared session
 * opens one (`vtiAgent.connectNow`): the mediator the identity's own document
 * names, else the configured one; the borrowed key-agreement key; and, when the
 * signing key is borrowed too, a TSP session to open frames with.
 */
export function defaultListenerFactory(agent: Agent, configuredMediatorDid: string | undefined): ListenerFactory {
  return async (persona) => {
    const kaKmsKeyId = persona.kmsKeyIds?.keyAgreement
    if (!kaKmsKeyId) throw new Error('the identity has no borrowed key-agreement key')
    const own = await advertisedMediatorDid(agent, persona.did).catch(() => undefined)
    const mediatorDid = own ?? configuredMediatorDid
    if (!mediatorDid) throw new Error('no mediator: the identity names none and none is configured')
    const mediator = await resolveVtiMediator(agent, mediatorDid)
    const identity = await vtiClientIdentityFromPersona(agent, persona.did, kaKmsKeyId)
    const tspSession = persona.kmsKeyIds?.signing ? await tspSessionForPersona(agent, persona) : undefined
    const who = didPrefix(persona.did)
    // What a listener receives, said in the Release log as the shared session
    // says it: without it a notice that never showed could not be told from a
    // notice that never came (233 two-community row, a removal).
    const keep = (plaintext: DidCommV2PlaintextMessage, via: 'didcomm' | 'tsp') =>
      keepFromListener(agent, persona, plaintext, via)
    return new VtiMediatorSession(agent, identity, mediator, {
      onError: (error) =>
        agent.config?.logger?.warn?.(`[VTI] listener for ${didPrefix(persona.did)}: ${error.message}`),
      onMessage: (plaintext: DidCommV2PlaintextMessage) => keep(plaintext, 'didcomm'),
      ...(tspSession
        ? {
            onTspFrame: async (bytes: Uint8Array) => {
              // Throwing withholds the acknowledgement: a frame this identity
              // cannot open stays on the mediator.
              let result: Awaited<ReturnType<typeof unpackTrustTaskFromPeer>>
              try {
                result = await unpackTrustTaskFromPeer(tspSession, bytes, persona.did)
              } catch (error) {
                releaseWarn(
                  `[VTI] listener for ${who}: TSP frame not opened (${error instanceof Error ? error.message.slice(0, 160) : String(error)}); ${frameForm(bytes)} frame, ${bytes.length} bytes, left on the mediator`
                )
                throw error
              }
              if (result) await keep(result.plaintext, 'tsp')
              else
                releaseWarn(`[VTI] listener for ${who}: TSP frame opened but carried no Trust Task envelope; ignored`)
            },
          }
        : {}),
    })
  }
}

/** Run the listeners while the app is unlocked and an agent exists. */
export function useVtiIdentityListeners(agent: Agent | undefined, mediatorDid: string | undefined): void {
  useEffect(() => {
    if (!agent) return
    const stop = startIdentityListeners(agent, { mediatorDid })
    return () => {
      void stop()
    }
  }, [agent, mediatorDid])
}
