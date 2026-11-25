/**
 * Plain words for why a Guardian card (or the authorization under it) didn't check out on Who approves: what went
 * wrong, and what to do about it. The reason codes come from guardianEvidence.ts (its `refuse(...)` calls and
 * checkSocialAuthorization) and from the SEDI chain check (sedi/guardian/chain.ts RefusalReason). They stay in the
 * log; none of them is shown on screen. A code not listed here gets the general words, never the code itself.
 *
 * @module trust-tasks/screens/approver/guardianReasonWords
 */

/** The groups a reason is worded by; each has `Approver.Reason.<group>` and `Approver.ReasonDo.<group>`. */
export type GuardianReasonGroup =
  | 'noWard'
  | 'wardMismatch'
  | 'notTheirs'
  | 'untrustedRoot'
  | 'expired'
  | 'notCurrent'
  | 'revoked'
  | 'unreachable'
  | 'stateHostRefused'
  | 'unsupported'
  | 'incomplete'
  | 'damaged'
  | 'checkFailed'
  | 'switchedOff'
  | 'other'

/** Every reason code known today, by group. A new code lands in 'other' until it is listed here. */
export const GUARDIAN_REASON_GROUPS: Readonly<Record<string, GuardianReasonGroup>> = {
  // this phone's own setup
  noWard: 'noWard',
  wardMismatch: 'wardMismatch',
  switchedOff: 'switchedOff',
  // whose card it is
  wrongHolder: 'notTheirs',
  notTheHolder: 'notTheirs',
  // which state issued it, and what that state's record says
  untrustedRoot: 'untrustedRoot',
  expired: 'expired',
  notIssued: 'notCurrent',
  statusNotCurrent: 'notCurrent',
  revoked: 'revoked',
  revokedInIssuerRecord: 'revoked',
  revokedInStateRecord: 'revoked',
  stateNotResolved: 'unreachable',
  stateHostRefused: 'stateHostRefused',
  // the card itself
  unsupportedCesr: 'unsupported',
  notAcdcV2: 'unsupported',
  noStateDisclosure: 'incomplete',
  chainMissing: 'incomplete',
  edgeMissing: 'incomplete',
  socialIncomplete: 'incomplete',
  malformedCesr: 'damaged',
  kelNotReplaying: 'damaged',
  edgeOperator: 'damaged',
  edgeNotI2I: 'damaged',
  telBroken: 'damaged',
  telUnanchored: 'damaged',
  saidMismatch: 'damaged',
  schemaMismatch: 'damaged',
  expiryUnreadable: 'damaged',
  tooLarge: 'damaged',
  notThisAuthorization: 'damaged',
  notThisCard: 'damaged',
  // the check
  checkFailed: 'checkFailed',
}

/** The group a reason code is worded by: its own, or 'other' for a code this list doesn't know. */
export function guardianReasonGroup(reason: string): GuardianReasonGroup {
  return Object.prototype.hasOwnProperty.call(GUARDIAN_REASON_GROUPS, reason) ? GUARDIAN_REASON_GROUPS[reason] : 'other'
}

/** The two localization keys for a reason code: what went wrong, and what to do. */
export function guardianReasonKeys(reason: string): { what: string; todo: string } {
  const group = guardianReasonGroup(reason)
  return { what: `Approver.Reason.${group}`, todo: `Approver.ReasonDo.${group}` }
}
