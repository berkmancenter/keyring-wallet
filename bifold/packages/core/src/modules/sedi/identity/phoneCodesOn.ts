/**
 * Whether this phone may make, show or use its own codes for a state office, read at each call: trusted approvers and
 * state-verified approvers both on (each already folds in its own remote off and the SEDI/KERI kill). Kept apart from
 * ./phoneIdentity so the link router can ask without loading the KEL code.
 *
 * @module sedi/identity/phoneCodesOn
 */
import { isStateVerifiedApproversEnabled } from '../../trust-tasks/module/stateVerifiedApproversFlag'
import { isTrustedApproversEnabled } from '../../trust-tasks/module/trustedApproversFlag'

export const phoneCodesOn = (): boolean => isTrustedApproversEnabled() && isStateVerifiedApproversEnabled()
