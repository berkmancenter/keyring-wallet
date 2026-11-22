/**
 * "Check that your agent waits for them" on Who approves: whether the agent holds a task for consent at all.
 *
 * A trusted approver written on an agent that enforces no rules is never asked (Alberto's albertoleon-vta, 11-10:
 * rules written, the approver said yes, and the persona mint went through unheld). Upstream gives no read-only way to
 * see enforcement (VTI docs/02-vta/task-consent.md, "Turn the PDP on": no runtime surface), so this runs the same live
 * probe as "Send me a test request" ({@link vtaAgent.sendTestRequest}): it asks the agent to create a test context
 * that this phone's own "Ask me before…" rule holds. It has side effects (a held request in Requests, or a context
 * created and deleted again), which is why it runs only on a tap, never on open or focus.
 *
 * The probe's rule names this phone's own approver set (approvalRules.ts phoneSetName, withPhoneRule), and it is
 * offered only while no other rule names that task (ApprovalsView.canTest), so the request reaches this phone alone,
 * never a trusted approver: keyring-trusted-approvers rules never cover contexts/create (trustedApprovers.ts).
 *
 * @module trust-tasks/screens/approverEnforcementCheck
 */
import type { Agent } from '@credo-ts/core'

import { GenericRecordsTestRequestStore } from '../module/testRequestOutcome'
import { vtaAgent } from '../module/vtaAgent'

/**
 * - `held`: the agent asked before acting, so approvals are on where it is hosted.
 * - `letThrough`: it acted without asking; `kept` when the test context could not be deleted again.
 * - `needsTestRule`: this phone's own rule on the test task is not on, so the probe would prove nothing.
 * - `wouldReachOthers`: the set that rule names holds more than this phone (edited elsewhere), so the test would
 *   ask them too: not sent.
 * - `unknown`: no answer, or an error: nothing is concluded.
 */
export type EnforcementCheck =
  | { kind: 'held' }
  | { kind: 'letThrough'; kept: boolean }
  | { kind: 'needsTestRule' }
  | { kind: 'wouldReachOthers' }
  | { kind: 'unknown' }

/** The last result on each agent, for this session only. */
const lastByAgent = new Map<string, EnforcementCheck>()

export const lastEnforcementCheck = (vtaDid: string | undefined): EnforcementCheck | undefined =>
  vtaDid ? lastByAgent.get(vtaDid) : undefined

/** Tests only. */
export const forgetEnforcementChecks = () => lastByAgent.clear()

/**
 * The test rule's set holds this phone alone: exactly one member, and that member is this phone's manager DID. The
 * rule is found by its set's name (approvalRules.ts phoneSetName, `keyring-phone:<managerDid>`), but the name is not
 * taken as the identity: a set edited elsewhere could hold others, whom the test request would then ask too, and the
 * check must hold on its own, not only because canTest ran first. No managerDid known: false.
 */
const PHONE_SET = 'keyring-phone:'
export function onlyThisPhone(
  model: { rules: { taskType: string; approverSet?: string }[]; sets: Record<string, string[]> },
  managerDid: string | undefined
) {
  if (!managerDid) return false
  const rule = model.rules.find(
    (r) => r.taskType.endsWith('/vta/contexts/create/1.0') && r.approverSet?.startsWith(PHONE_SET)
  )
  if (!rule?.approverSet) return false
  const members = model.sets[rule.approverSet] ?? []
  return members.length === 1 && members[0] === managerDid
}

/** Run the probe once, on this phone's linked agent. Never throws: a failure is `unknown`. */
export async function checkEnforcement(agent: Agent): Promise<EnforcementCheck> {
  const vtaDid = vtaAgent.getState().vtaDid
  let result: EnforcementCheck
  try {
    const rules = await vtaAgent.approvalRules(agent)
    if (!rules.view.canTest) {
      result = { kind: 'needsTestRule' }
    } else if (!vtaAgent.getState().managerDid) {
      // Not knowing who this phone is says nothing about the person's rules: couldn't tell, never "would ask others".
      result = { kind: 'unknown' }
    } else if (!onlyThisPhone(rules.model, vtaAgent.getState().managerDid)) {
      result = { kind: 'wouldReachOthers' }
    } else {
      const sent = await vtaAgent.sendTestRequest(agent)
      result = sent.kind === 'held' ? { kind: 'held' } : { kind: 'letThrough', kept: !sent.cleanedUp }
      // Kept where "Ask me before…" keeps its own test's outcome, so both screens say the same.
      if (vtaDid)
        await new GenericRecordsTestRequestStore(agent)
          .set({
            vtaDid,
            kind: sent.kind,
            ...(sent.kind === 'letThrough' ? { cleanedUp: sent.cleanedUp } : {}),
            at: new Date().toISOString(),
          })
          .catch(() => undefined)
    }
  } catch {
    result = { kind: 'unknown' }
  }
  if (vtaDid) lastByAgent.set(vtaDid, result)
  return result
}
