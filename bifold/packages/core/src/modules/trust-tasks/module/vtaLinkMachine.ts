/**
 * vtaLinkMachine — the one state every screen reads about this phone and its
 * agent (plan §4.2).
 *
 *   notLinked ─scan─▶ confirming ─confirm─▶ submitting ─code─▶ awaitingGrant
 *       ▲                  │ cancel             │ failed           │ granted
 *       │                  ▼                    ▼                  ▼
 *       ├──────────── notLinked(lastError) ◀── linking ◀───────────┘
 *       │                                         │ rotated
 *       └──── relink ◀── revoked ◀── linked ◀─────┘
 *
 *   an agent host's automatic connection waits in awaitingGrant (via host)
 *   and names where it has got to: hostStage creating → connecting →
 *   signingIn(try n of 24), each with the time it began (VtaLink shows it).
 *
 *   without a QR (plan §5.1 fallback): notLinked ─keyShown─▶ showingKey
 *   ─granted─▶ linking — the admin pastes the key into their own console.
 *
 *   an earlier link's key swap still unsettled for this agent: notLinked /
 *   confirming / submitting ─resumed─▶ linking — the agent already knows this
 *   phone, so no new grant is asked for.
 *
 *   a key swap the agent refused both keys of (the temporary key expired
 *   before the swap settled): linked / linking ─linkLost─▶ notLinked(lastError)
 *   — the link never finished, so it is "link again", not "revoked".
 *
 *   linked carries one connection sub-state:
 *       online ⇄ offline(since, reason) ⇄ reconnecting(attempt, nextRetryAt, since)
 *       offline / reconnecting / connecting ─agentGone─▶ gone(why) ─sessionOpened─▶ online
 *
 * Pure: a reducer and two helpers, no I/O, so every transition is a unit
 * test. An event that does not apply to the current state leaves it as it is
 * — a late reply from an abandoned attempt cannot move the machine.
 *
 * @module trust-tasks/module/vtaLinkMachine
 */

import type { AgentGoneWhy } from './agentGone'
import type { HostLinkFailure } from './agentHostConnection'

export type VtaConnection =
  | { kind: 'online' }
  /**
   * Not yet online since the app started: the saved link is back and the
   * first session is still being opened (IN-48). Failed start-up attempts
   * stay here; `connectionShown` turns it into offline once
   * `STARTUP_GRACE_MS` has passed.
   */
  | { kind: 'connecting'; since: number; reason?: string }
  | { kind: 'reconnecting'; attempt: number; nextRetryAt: number; since: number }
  | { kind: 'offline'; since: number; reason?: string }
  /**
   * The agent is gone for good (agentGone.ts): its address does not exist, or
   * it has not been reached for days. Retrying stops; reaching it again (a
   * foreground, "Try again") still brings it back online.
   */
  | { kind: 'gone'; since: number; why: AgentGoneWhy }

export interface VtaIdentityOfAgent {
  vtaDid: string
  label: string
}

export type VtaLinkState =
  | { kind: 'notLinked'; lastError?: VtaLinkFailure }
  | ({ kind: 'confirming'; offerUrl: string; exp: number; via?: 'host' } & VtaIdentityOfAgent)
  | ({ kind: 'submitting'; offerUrl: string; exp: number; via?: 'host' } & VtaIdentityOfAgent)
  /** `host`: an agent host's automatic connection — no code to compare; the host sets the agent up. */
  | ({
      kind: 'awaitingGrant'
      offerUrl: string
      exp: number
      code: string
      via?: 'host'
      /** Where the host's setup has got to, once the phone knows (`hostStage`). */
      stage?: HostSetupStage
    } & VtaIdentityOfAgent)
  | ({
      kind: 'showingKey'
      did: string
      checking: boolean
      notYet?: boolean
      noAnswer?: boolean
      /** `scan`: the agent's address was scanned or pasted — usually another phone's "Add another phone" code (#30). */
      via?: 'scan'
    } & VtaIdentityOfAgent)
  | ({ kind: 'linking'; step: 'connecting' | 'rotating' } & VtaIdentityOfAgent)
  | ({ kind: 'linked'; linkedAt: string; connection: VtaConnection } & VtaIdentityOfAgent)
  | ({ kind: 'revoked'; reason: string; cause: RevocationCause } & VtaIdentityOfAgent)

/**
 * Why the agent stopped accepting this phone. `wiped` only when the agent said
 * so ("device has been wiped", which it answers a wiped device signing in over
 * REST); anything else — no longer on its access list, which is also what a
 * removed phone hears once its entry is revoked — is `notInAcl`. Neither erases
 * anything by itself: the person chooses (#10).
 */
export type RevocationCause = 'wiped' | 'notInAcl'

export function revocationCause(reason: string): RevocationCause {
  return /has been wiped/i.test(reason) ? 'wiped' : 'notInAcl'
}

/**
 * Where an agent host's setup has got to, for the screen to name.
 * `creating`: the host says `provisioning`. `connecting`: it says the agent is
 * ready for this phone (`awaiting_mobile`) and the first sign-in is under way.
 * `signingIn`: that sign-in is being tried again (`attempt` of `of`), as the
 * agent may take a moment to answer after its restart. `since`: when this step
 * began, so the screen can say how long it has taken.
 */
export interface HostSetupStage {
  step: 'creating' | 'connecting' | 'signingIn'
  since: number
  attempt?: number
  of?: number
}

/** Why a link attempt ended, in a form a screen can word for a person. */
export interface VtaLinkFailure {
  reason: 'expired' | 'refused' | 'unreachable' | 'rejected' | 'failed'
  detail?: string
  /** An agent host's automatic connection stopped: why, in its own words for a screen (agentHostConnection.ts). */
  hostReason?: HostLinkFailure
}

export type VtaLinkEvent =
  | { type: 'restored'; link?: VtaIdentityOfAgent & { linkedAt: string }; now: number }
  | ({ type: 'offerScanned'; offerUrl: string; exp: number; via?: 'host' } & VtaIdentityOfAgent)
  | { type: 'confirmed' }
  | { type: 'cancelled' }
  | { type: 'submitted'; code: string }
  /** An agent host's setup moved on (VtaAgentController, agentHostConnection). */
  | { type: 'hostStage'; step: HostSetupStage['step']; attempt?: number; of?: number; now: number }
  | { type: 'granted' }
  | { type: 'rotating' }
  /**
   * `connection` defaults to online. A first link whose key-swap answer was
   * lost is linked offline: the phone is linked from the grant on, and which
   * of its two keys the agent holds is settled by the next connect.
   */
  | { type: 'linked'; linkedAt: string; connection?: VtaConnection }
  | ({ type: 'resumed' } & VtaIdentityOfAgent)
  | { type: 'linkLost'; failure: VtaLinkFailure }
  | { type: 'failed'; failure: VtaLinkFailure }
  | { type: 'sessionOpened' }
  | { type: 'sessionDropped'; reason?: string; now: number }
  | { type: 'retryScheduled'; attempt: number; nextRetryAt: number }
  /** The agent was found gone for good (agentGone.ts). Never from online. */
  | { type: 'agentGone'; why: AgentGoneWhy; now: number }
  | { type: 'accessRevoked'; reason: string }
  | { type: 'relink' }
  /** The person unlinked this phone from its agent: from any state, back to no agent. */
  | { type: 'unlinked' }
  | ({ type: 'keyShown'; did: string; via?: 'scan' } & VtaIdentityOfAgent)
  | { type: 'grantCheckStarted' }
  | { type: 'grantNotYet' }
  | { type: 'grantNoAnswer' }

export const initialLinkState: VtaLinkState = { kind: 'notLinked' }

export function reduceLink(state: VtaLinkState, event: VtaLinkEvent): VtaLinkState {
  switch (event.type) {
    case 'restored':
      // Only at start-up: the persisted link comes back connecting until a
      // session proves it online; nothing live is ever restored.
      if (state.kind !== 'notLinked') return state
      return event.link
        ? {
            kind: 'linked',
            vtaDid: event.link.vtaDid,
            label: event.link.label,
            linkedAt: event.link.linkedAt,
            connection: { kind: 'connecting', since: event.now },
          }
        : state

    case 'offerScanned':
      // A new offer replaces an unfinished attempt, never a working link.
      if (state.kind === 'linked' || state.kind === 'linking') return state
      return {
        kind: 'confirming',
        vtaDid: event.vtaDid,
        label: event.label,
        offerUrl: event.offerUrl,
        exp: event.exp,
        ...(event.via ? { via: event.via } : {}),
      }

    case 'confirmed':
      return state.kind === 'confirming' ? { ...state, kind: 'submitting' } : state

    case 'cancelled':
      return state.kind === 'confirming' ||
        state.kind === 'submitting' ||
        state.kind === 'awaitingGrant' ||
        state.kind === 'showingKey'
        ? { kind: 'notLinked' }
        : state

    case 'keyShown':
      return state.kind === 'notLinked'
        ? {
            kind: 'showingKey',
            vtaDid: event.vtaDid,
            label: event.label,
            did: event.did,
            checking: false,
            ...(event.via ? { via: event.via } : {}),
          }
        : state

    case 'grantCheckStarted':
      return state.kind === 'showingKey' ? { ...state, checking: true, notYet: false, noAnswer: false } : state

    case 'grantNotYet':
      return state.kind === 'showingKey' ? { ...state, checking: false, notYet: true, noAnswer: false } : state

    // The agent said nothing within the deadline. The key stays on screen and
    // the person can try again — a silence is not a refusal, so it must not
    // read like one, and it must not read like nothing at all either.
    case 'grantNoAnswer':
      return state.kind === 'showingKey' ? { ...state, checking: false, notYet: false, noAnswer: true } : state

    case 'submitted':
      return state.kind === 'submitting' ? { ...state, kind: 'awaitingGrant', code: event.code } : state

    case 'hostStage': {
      if (state.kind !== 'awaitingGrant' || state.via !== 'host') return state
      const was = state.stage
      // A repeat of the same step (each poll says `provisioning` again) changes
      // nothing, so the screen's snapshot stays the same object.
      if (was && was.step === event.step && was.attempt === event.attempt) return state
      const since = was && was.step === event.step ? was.since : event.now
      return {
        ...state,
        stage: {
          step: event.step,
          since,
          ...(event.attempt !== undefined ? { attempt: event.attempt } : {}),
          ...(event.of !== undefined ? { of: event.of } : {}),
        },
      }
    }

    case 'granted':
      return state.kind === 'awaitingGrant' || state.kind === 'showingKey'
        ? { kind: 'linking', step: 'connecting', vtaDid: state.vtaDid, label: state.label }
        : state

    case 'rotating':
      return state.kind === 'linking' ? { ...state, step: 'rotating' } : state

    case 'linked':
      return state.kind === 'linking'
        ? {
            kind: 'linked',
            vtaDid: state.vtaDid,
            label: state.label,
            linkedAt: event.linkedAt,
            connection: event.connection ?? { kind: 'online' },
          }
        : state

    case 'resumed':
      return state.kind === 'notLinked' || state.kind === 'confirming' || state.kind === 'submitting'
        ? { kind: 'linking', step: 'connecting', vtaDid: event.vtaDid, label: event.label }
        : state

    case 'linkLost':
      return state.kind === 'linked' || state.kind === 'linking'
        ? { kind: 'notLinked', lastError: event.failure }
        : state

    case 'failed':
      return state.kind === 'notLinked' ||
        state.kind === 'submitting' ||
        state.kind === 'awaitingGrant' ||
        state.kind === 'showingKey' ||
        state.kind === 'linking'
        ? { kind: 'notLinked', lastError: event.failure }
        : state

    case 'sessionOpened':
      return state.kind === 'linked' ? { ...state, connection: { kind: 'online' } } : state

    case 'sessionDropped':
      if (state.kind !== 'linked') return state
      // A failed start-up attempt is still connecting; the clock decides when
      // that reads as offline (connectionShown).
      if (state.connection.kind === 'connecting') {
        return { ...state, connection: { ...state.connection, reason: event.reason } }
      }
      // Keep the moment it first went away: "Offline since" is about the
      // person's view, not about the latest failed retry.
      return state.connection.kind !== 'online'
        ? state
        : { ...state, connection: { kind: 'offline', since: event.now, reason: event.reason } }

    case 'retryScheduled':
      return state.kind === 'linked' &&
        state.connection.kind !== 'online' &&
        state.connection.kind !== 'connecting' &&
        state.connection.kind !== 'gone'
        ? {
            ...state,
            connection: {
              kind: 'reconnecting',
              attempt: event.attempt,
              nextRetryAt: event.nextRetryAt,
              since: state.connection.since,
            },
          }
        : state

    case 'agentGone':
      return state.kind === 'linked' && state.connection.kind !== 'online'
        ? { ...state, connection: { kind: 'gone', since: event.now, why: event.why } }
        : state

    case 'accessRevoked':
      return state.kind === 'linked' || state.kind === 'linking'
        ? {
            kind: 'revoked',
            vtaDid: state.vtaDid,
            label: state.label,
            reason: event.reason,
            cause: revocationCause(event.reason),
          }
        : state

    case 'relink':
      return state.kind === 'revoked' || state.kind === 'notLinked' ? { kind: 'notLinked' } : state

    case 'unlinked':
      return state.kind === 'notLinked' ? state : { kind: 'notLinked' }
  }
}

/** Reconnect backoff: 1 s, 2 s, 4 s … capped at 30 s. */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(30000, 1000 * 2 ** Math.max(0, attempt))
}

/**
 * How long a start-up connect may take before it reads as offline. On an
 * emulator a relaunch took ~33 s from agent start to its first persona login
 * (226 gate §10), so this is not the 5 s a drop gets.
 */
export const STARTUP_GRACE_MS = 30_000

/**
 * The connection as a person should see it at `now`: a start-up connect is
 * "connecting" for `STARTUP_GRACE_MS`, then offline since the app started.
 * Every other state is shown as it is.
 */
export function connectionShown(connection: VtaConnection, now: number): VtaConnection {
  if (connection.kind !== 'connecting' || now - connection.since < STARTUP_GRACE_MS) return connection
  return connection.reason === undefined
    ? { kind: 'offline', since: connection.since }
    : { kind: 'offline', since: connection.since, reason: connection.reason }
}

/**
 * Whether the app-wide "agent offline" banner shows. A brief drop does not
 * flash it: only a connection that has not been online for `thresholdMs`,
 * and never a start-up connect still within its grace.
 */
export function showsOfflineBanner(state: VtaLinkState, now: number, thresholdMs = 5000): boolean {
  if (state.kind !== 'linked') return false
  const shown = connectionShown(state.connection, now)
  // Gone has its own card, which says more than "offline" can.
  if (shown.kind === 'online' || shown.kind === 'connecting' || shown.kind === 'gone') return false
  return now - shown.since >= thresholdMs
}

/**
 * The VTA the phone works with: the one the person linked by QR, else the one
 * a build names (`config.vti.vtaDid`). Store builds leave the latter unset so
 * testers link their own, so a screen that reads only the build's value finds
 * no agent at all — every screen resolves it here.
 */
export function resolveVtaDid(state: VtaLinkState, configured?: string): string | undefined {
  return state.kind === 'linked' ? state.vtaDid : configured
}
