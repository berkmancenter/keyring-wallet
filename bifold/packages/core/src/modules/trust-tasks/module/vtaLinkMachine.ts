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
 *   without a QR (plan §5.1 fallback): notLinked ─keyShown─▶ showingKey
 *   ─granted─▶ linking — the admin pastes the key into their own console.
 *
 *   linked carries one connection sub-state:
 *       online ⇄ offline(since, reason) ⇄ reconnecting(attempt, nextRetryAt, since)
 *
 * Pure: a reducer and two helpers, no I/O, so every transition is a unit
 * test. An event that does not apply to the current state leaves it as it is
 * — a late reply from an abandoned attempt cannot move the machine.
 *
 * @module trust-tasks/module/vtaLinkMachine
 */

export type VtaConnection =
  | { kind: 'online' }
  | { kind: 'reconnecting'; attempt: number; nextRetryAt: number; since: number }
  | { kind: 'offline'; since: number; reason?: string }

export interface VtaIdentityOfAgent {
  vtaDid: string
  label: string
}

export type VtaLinkState =
  | { kind: 'notLinked'; lastError?: VtaLinkFailure }
  | ({ kind: 'confirming'; offerUrl: string; exp: number } & VtaIdentityOfAgent)
  | ({ kind: 'submitting'; offerUrl: string; exp: number } & VtaIdentityOfAgent)
  | ({ kind: 'awaitingGrant'; offerUrl: string; exp: number; code: string } & VtaIdentityOfAgent)
  | ({ kind: 'showingKey'; did: string; checking: boolean; notYet?: boolean } & VtaIdentityOfAgent)
  | ({ kind: 'linking'; step: 'connecting' | 'rotating' } & VtaIdentityOfAgent)
  | ({ kind: 'linked'; linkedAt: string; connection: VtaConnection } & VtaIdentityOfAgent)
  | ({ kind: 'revoked'; reason: string } & VtaIdentityOfAgent)

/** Why a link attempt ended, in a form a screen can word for a person. */
export interface VtaLinkFailure {
  reason: 'expired' | 'refused' | 'unreachable' | 'rejected' | 'failed'
  detail?: string
}

export type VtaLinkEvent =
  | { type: 'restored'; link?: VtaIdentityOfAgent & { linkedAt: string }; now: number }
  | ({ type: 'offerScanned'; offerUrl: string; exp: number } & VtaIdentityOfAgent)
  | { type: 'confirmed' }
  | { type: 'cancelled' }
  | { type: 'submitted'; code: string }
  | { type: 'granted' }
  | { type: 'rotating' }
  | { type: 'linked'; linkedAt: string }
  | { type: 'failed'; failure: VtaLinkFailure }
  | { type: 'sessionOpened' }
  | { type: 'sessionDropped'; reason?: string; now: number }
  | { type: 'retryScheduled'; attempt: number; nextRetryAt: number }
  | { type: 'accessRevoked'; reason: string }
  | { type: 'relink' }
  | ({ type: 'keyShown'; did: string } & VtaIdentityOfAgent)
  | { type: 'grantCheckStarted' }
  | { type: 'grantNotYet' }

export const initialLinkState: VtaLinkState = { kind: 'notLinked' }

export function reduceLink(state: VtaLinkState, event: VtaLinkEvent): VtaLinkState {
  switch (event.type) {
    case 'restored':
      // Only at start-up: the persisted link comes back offline until a
      // session proves otherwise; nothing live is ever restored.
      if (state.kind !== 'notLinked') return state
      return event.link
        ? {
            kind: 'linked',
            vtaDid: event.link.vtaDid,
            label: event.link.label,
            linkedAt: event.link.linkedAt,
            connection: { kind: 'offline', since: event.now },
          }
        : state

    case 'offerScanned':
      // A new offer replaces an unfinished attempt, never a working link.
      if (state.kind === 'linked' || state.kind === 'linking') return state
      return { kind: 'confirming', vtaDid: event.vtaDid, label: event.label, offerUrl: event.offerUrl, exp: event.exp }

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
        ? { kind: 'showingKey', vtaDid: event.vtaDid, label: event.label, did: event.did, checking: false }
        : state

    case 'grantCheckStarted':
      return state.kind === 'showingKey' ? { ...state, checking: true, notYet: false } : state

    case 'grantNotYet':
      return state.kind === 'showingKey' ? { ...state, checking: false, notYet: true } : state

    case 'submitted':
      return state.kind === 'submitting' ? { ...state, kind: 'awaitingGrant', code: event.code } : state

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
            connection: { kind: 'online' },
          }
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
      // Keep the moment it first went away: "Offline since" is about the
      // person's view, not about the latest failed retry.
      return state.connection.kind !== 'online'
        ? state
        : { ...state, connection: { kind: 'offline', since: event.now, reason: event.reason } }

    case 'retryScheduled':
      return state.kind === 'linked' && state.connection.kind !== 'online'
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

    case 'accessRevoked':
      return state.kind === 'linked' || state.kind === 'linking'
        ? { kind: 'revoked', vtaDid: state.vtaDid, label: state.label, reason: event.reason }
        : state

    case 'relink':
      return state.kind === 'revoked' || state.kind === 'notLinked' ? { kind: 'notLinked' } : state
  }
}

/** Reconnect backoff: 1 s, 2 s, 4 s … capped at 30 s. */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(30000, 1000 * 2 ** Math.max(0, attempt))
}

/**
 * Whether the app-wide "agent offline" banner shows. A brief drop does not
 * flash it: only a connection that has not been online for `thresholdMs`.
 */
export function showsOfflineBanner(state: VtaLinkState, now: number, thresholdMs = 5000): boolean {
  if (state.kind !== 'linked' || state.connection.kind === 'online') return false
  return now - state.connection.since >= thresholdMs
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
