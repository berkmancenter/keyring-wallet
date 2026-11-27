import type { PairingFailure } from './pairing'

/**
 * Why a connect ended, as the screens say it: every pairing failure the logic reports (`PairingFailure`), the
 * connect guard's refusals, and the three §6 failures that reach the phone from elsewhere (a closed mediator, the
 * terminal refusing, a lockout). The logic gives codes only; the words are the screens' (plan §6, "Failure, ...").
 *
 * @module connected-agents/failureCopy
 */
export type ConnectEnd =
  | PairingFailure
  | 'notAdministrator'
  | 'vtaTooOld'
  | 'mediator-closed'
  | 'terminal-refused'
  | 'locked'

/**
 * The ConnectedAgents.* key for each end. "locked" takes a count of minutes (`count`).
 *
 * TODO(#1060 proposal 17): the words for spent, not-a-pairing-code, grant-refused, rotation-lost-limits,
 * handle-collision, invalid-choice and vtaTooOld are proposals (PROPOSED_COPY) until the plan owner rules.
 */
export const CONNECT_END_KEY: Record<ConnectEnd, string> = {
  expired: 'ConnectedAgents.FailExpired',
  spent: 'ConnectedAgents.FailSpent',
  'wrong-number': 'ConnectedAgents.FailWrongNumber',
  'foreign-vta': 'ConnectedAgents.FailForeignVta',
  'not-a-pairing-code': 'ConnectedAgents.FailNotAPairingCode',
  'vta-unreachable': 'ConnectedAgents.FailUnreachable',
  'grant-refused': 'ConnectedAgents.FailGrantRefused',
  unsupported: 'ConnectedAgents.VersionMismatch',
  'rotation-lost-limits': 'ConnectedAgents.FailRotationLostLimits',
  'handle-collision': 'ConnectedAgents.FailHandleCollision',
  'invalid-choice': 'ConnectedAgents.FailGeneric',
  notAdministrator: 'ConnectedAgents.NotAnAdministrator',
  vtaTooOld: 'ConnectedAgents.VtaTooOld',
  'mediator-closed': 'ConnectedAgents.FailMediatorClosed',
  'terminal-refused': 'ConnectedAgents.TerminalRefused',
  locked: 'ConnectedAgents.FailLocked',
}

/** The clock for a code that ran out; the warning sign for everything else (canvas frames 18 and K23). */
export const connectEndIcon = (end: ConnectEnd): string =>
  end === 'expired' || end === 'spent' ? 'clock-outline' : 'alert-outline'
