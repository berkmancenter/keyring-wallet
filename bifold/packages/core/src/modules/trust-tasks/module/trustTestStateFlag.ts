/**
 * The Developer setting "Trust the test state (K0)" (trusted-approver plan, stage 2, S1): a tester build trusts the
 * K0 test State root, so a K0 test Guardian card can be checked outside a Developer build. Off unless the app turns it
 * on from its developer settings at start-up, like setStateVerifiedApproversEnabled (stateVerifiedApproversFlag.ts).
 *
 * It holds only while trusted approvers and state-verified approvers are both on, so either switch, its remote off,
 * or SEDI_KERI_REMOTE_OFF turns it off too; none of them turns it on. It adds the K0 test root and nothing else
 * (sedi/guardian/stateRoots.ts), and a card checked against that root is always shown as the test state.
 *
 * @module trust-tasks/module/trustTestStateFlag
 */
import { isStateVerifiedApproversEnabled } from './stateVerifiedApproversFlag'
import { isTrustedApproversEnabled } from './trustedApproversFlag'

let trustTestStateEnabled = false

/** Turn "Trust the test state (K0)" on or off (developer setting). */
export function setTrustTestStateEnabled(enabled: boolean): void {
  trustTestStateEnabled = enabled
}

/** Switched on, with trusted approvers and state-verified approvers both on (each read at the call, never at load). */
export function isTrustTestStateEnabled(): boolean {
  return trustTestStateEnabled && isTrustedApproversEnabled() && isStateVerifiedApproversEnabled()
}
