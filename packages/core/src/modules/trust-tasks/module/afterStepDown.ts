/**
 * What a phone may approve for an agent after its person stepped down from approving for that agent's person
 * (approverRole.ts, "asked to stop"). The agent still names this phone, so its requests still arrive and are listed:
 * otherwise the removal of this phone, which the agent holds for this phone's yes, could never be answered (278.22,
 * 11-16). But a step-down must take something away, so the only request that can still be APPROVED is a change to who
 * approves (the trusted action `changeApprovers`, policy/upsert): that is how the asker removes this phone. Every other
 * request can only be declined.
 *
 * The consent request carries a digest of the new rules, not the rules, so this phone cannot check that such a change
 * only removes it: approving one approves whatever change the asker sent. The request card says what it is for.
 *
 * @module trust-tasks/module/afterStepDown
 */
import { trustedKeyOf } from './trustedApprovers'

/** Whether a listed request may be approved: always, unless it is from an agent this phone asked to stop approving for. */
export function mayApprove(approval: { taskType?: string; forAgent?: { stopAsked?: true } }): boolean {
  if (!approval.forAgent?.stopAsked) return true
  return !!approval.taskType && trustedKeyOf(approval.taskType) === 'changeApprovers'
}
