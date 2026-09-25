/**
 * vtaOwner — what owning an agent from this phone needs beyond linking it
 * (own_agent_subtask.md §2–§4): the owner checks the app plugs in, the errors
 * the device screens word, and how the agent's refusals of an owner act read.
 *
 * An owner act is a change to who else may run the agent — adding a backup
 * device (`acl/grant/0.1`) or removing one (`acl/revoke/0.1`). The phone's key
 * is a software key in the wallet (plan §3, D1), so every owner act needs a
 * fresh confirmation by the person at that moment, not only the app unlock.
 * The confirmation itself (biometrics or passcode) belongs to the app; the
 * controller only takes it through `configure()`, and refuses loudly when it
 * was never given one, so nothing silently skips it.
 *
 * @module trust-tasks/module/vtaOwner
 */

import { consentPendingOf } from './VtaClient'
import { VtiRefusal } from './vtiAgent'

/** Why the person did not confirm: cancelled is silent on screen; failed and unavailable are worded. */
export type OwnerNotConfirmedReason = 'cancelled' | 'failed' | 'unavailable'

/** The answer of the app's owner check. Owner acts go ahead only on `ok: true`. */
export interface OwnerConfirmation {
  ok: boolean
  reason?: OwnerNotConfirmedReason
}

/** Ask the person to confirm an owner act, now (biometrics or passcode). `reason` is the prompt's text. */
export type ConfirmOwner = (reason: string) => Promise<OwnerConfirmation>

/** Whether this phone can hold an owner key at all: a screen lock or biometrics is set up. */
export type DeviceCanOwn = () => Promise<boolean>

/** The app never plugged in an owner check. A wiring fault, never shown as the person's doing. */
export class OwnerCheckNotConfigured extends Error {
  constructor(readonly check: 'confirmOwner' | 'deviceCanOwn') {
    super(`owner check not configured: ${check}`)
    this.name = 'OwnerCheckNotConfigured'
  }
}

/** The person did not confirm an owner act; nothing was sent. */
export class OwnerNotConfirmed extends Error {
  constructor(
    readonly reason: OwnerNotConfirmedReason,
    readonly detail?: string
  ) {
    super(
      reason === 'cancelled'
        ? 'Cancelled.'
        : reason === 'unavailable'
          ? 'This phone cannot confirm it is you right now.'
          : "Keyring couldn't confirm it's you."
    )
    this.name = 'OwnerNotConfirmed'
  }
}

/** Creating an agent on a phone with no screen lock or biometrics: refused before any key is made. */
export class DeviceCannotOwn extends Error {
  constructor() {
    super('To protect your agent, turn on a screen lock or biometrics first.')
    this.name = 'DeviceCannotOwn'
  }
}

/**
 * Why a device action did not happen, for the screen to word.
 *
 * - `notLinked` — this phone has no agent to act on.
 * - `notADid` — what was scanned or pasted is not a device code.
 * - `thisPhone` — the device named is this phone (refused here, or by the agent,
 *   which never lets a caller remove itself).
 * - `alreadyAdded` — the agent already holds that device.
 * - `notFound` — the agent holds no such device.
 * - `notPermitted` — the agent will not let this phone do that (it is not the
 *   agent's full owner).
 * - `accessRevoked` — the agent no longer knows this phone at all.
 * - `stepUpRequired` — the agent's operator requires a re-authentication for
 *   this act that Keyring cannot give yet.
 * - `awaitingApproval` — the agent holds the act for someone else's approval,
 *   which did not come in time.
 * - `noAnswer` — the agent said nothing in time; the act may or may not have
 *   happened, so the list is worth reading again.
 * - `unreachable` — Keyring could not sign in to the agent.
 * - `failed` — anything else; the agent's words are in `detail`.
 */
export type DeviceRefusalReason =
  | 'notLinked'
  | 'notADid'
  | 'thisPhone'
  | 'alreadyAdded'
  | 'notFound'
  | 'notPermitted'
  | 'accessRevoked'
  | 'stepUpRequired'
  | 'awaitingApproval'
  | 'noAnswer'
  | 'unreachable'
  | 'failed'

const PLAIN_WORDS: Record<DeviceRefusalReason, string> = {
  notLinked: 'This phone has no agent yet.',
  notADid: "That isn't a device code. Scan or paste the code the other phone shows.",
  thisPhone: 'That is this phone.',
  alreadyAdded: 'That device is already added.',
  notFound: "Your agent doesn't have that device.",
  notPermitted: "Your agent doesn't let this phone do that.",
  accessRevoked: "Your agent doesn't accept this phone any more.",
  stepUpRequired: 'Your agent asks for an extra check that Keyring cannot give yet.',
  awaitingApproval: 'Your agent is waiting for someone else to approve this.',
  noAnswer: "Your agent didn't answer. Check the list before trying again.",
  unreachable: "Keyring couldn't reach your agent. Check your connection and try again.",
  failed: "Your agent couldn't do that.",
}

/** A device action that did not happen. `message` is plain words; `detail` keeps the agent's own. */
export class DeviceActionRefused extends Error {
  constructor(
    readonly reason: DeviceRefusalReason,
    readonly detail?: string
  ) {
    super(PLAIN_WORDS[reason])
    this.name = 'DeviceActionRefused'
  }
}

/** A DID is what a device code is; anything else is refused before the owner is asked. */
export function looksLikeDid(value: string): boolean {
  return /^did:[a-z0-9]+:\S+$/.test(value)
}

/** The VTA's refusal of a sender it holds no live grant for (VtaClient's NOT_ON_ACL). */
const NOT_ON_ACL = /not in (the )?ACL|ACL entry expired/i
/** `delete_acl`'s self-delete refusal (vta-service operations/acl.rs:792-796). */
const SELF_DELETE = /cannot delete your own ACL entry/i
/** `create_acl`'s duplicate refusal (vta-service operations/acl.rs:391-395). */
const ALREADY_EXISTS = /already exists/i
/** Matches VtaClient's own "no answer in time". */
const NO_ANSWER = /the VTA did not answer/
const STEP_UP_REQUIRED = 'auth:step_up_required'

/**
 * Read a failed `acl/grant/0.1` or `acl/revoke/0.1` as a reason a screen can
 * word. The VTA's codes, at ed672fff (vta-service trust_tasks/helpers.rs:114-155):
 * a `Forbidden` is `permissionDenied` with the error's text as its message;
 * `NotFound` and `Conflict` are `taskFailed` with `details.reason` `not_found` /
 * `conflict` (vta-sdk protocols/mod.rs:113-118) and the text as the message.
 * The policy gate's asks are `taskFailed` with the `auth:*` code as the
 * message (trust_tasks/policy_gate.rs:213-233, step_up.rs:1300-1308).
 */
export function deviceRefusalOf(error: unknown): DeviceActionRefused {
  if (error instanceof DeviceActionRefused) return error
  const message = error instanceof Error ? error.message : String(error)
  const refusal = (reason: DeviceRefusalReason) => new DeviceActionRefused(reason, message)
  if (consentPendingOf(error)) return refusal('awaitingApproval')
  if (!(error instanceof VtiRefusal)) return refusal(NO_ANSWER.test(message) ? 'noAnswer' : 'failed')
  const details = (error.details ?? {}) as { reason?: unknown }
  if (message === STEP_UP_REQUIRED || details.reason === STEP_UP_REQUIRED) return refusal('stepUpRequired')
  if (NOT_ON_ACL.test(message)) return refusal('accessRevoked')
  if (SELF_DELETE.test(message)) return refusal('thisPhone')
  if (details.reason === 'conflict' && ALREADY_EXISTS.test(message)) return refusal('alreadyAdded')
  if (details.reason === 'not_found') return refusal('notFound')
  if (error.code === 'permissionDenied') return refusal('notPermitted')
  return refusal('failed')
}
