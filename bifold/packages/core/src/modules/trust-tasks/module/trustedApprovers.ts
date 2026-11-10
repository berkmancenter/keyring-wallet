/**
 * Trusted approvers: the agent's approval rules that make another person's
 * phone approve sensitive actions (docs/plans/trusted-approver-plan.md §4–§5).
 *
 * It uses the same approvals row as "Ask me before…" (approvalRules.ts), with a
 * second kind of rule: consent for a task, from one shared set of the people
 * this person trusts, one approval, and never the requester's own. Unlike "Ask
 * me before…", these rules are meant to hold tasks this phone sends (joining a
 * community mints a persona, `vta/webvh/dids/create`): the phone waits for the
 * approver's yes, which is the point. The approver needs no account on the
 * agent; membership in the set is enough (VTI docs/02-vta/task-consent.md,
 * "Membership in the approver set the policy names is sufficient").
 *
 * Every other rule and set in the row is kept exactly as it is.
 *
 * @module trust-tasks/module/trustedApprovers
 */

import { type ApprovalRule, type ApproverSets } from './approvalsPolicy'
import { type ApprovalsModel, versionsOf } from './approvalRules'

const SPEC = 'https://trusttasks.org/spec/'

/** The one set every trusted approver of this agent is in. */
export const TRUSTED_SET = 'keyring-trusted-approvers'

/**
 * What a trusted approver can be asked to approve, in the order the screen
 * shows them. `conditional` marks one whose holding is not yet proven on an
 * agent (plan §5.1): adding a device rides an access grant, and changing the
 * rules is a super-admin write that the agent may let through without asking
 * (VTI-22). The screen says so; the rule is still written.
 *
 * A rule's coverage, not what is sent: each task goes at whichever version its
 * own ladder picks, so every version is here, newest first.
 *
 * @versionCoverage
 */
export const TRUSTED_TASKS = [
  { key: 'shareCredential', taskTypes: [`${SPEC}vault/credentials/present/0.1`], conditional: false },
  // Joining a community mints its persona (one per community, VtaClient ensurePersona). Never the key borrow
  // (`keys/export-secret`): the phone borrows persona keys again on its own (an in-memory key fetched when needed,
  // a rotation), so a rule there would ask the approver about routine work.
  {
    key: 'joinCommunity',
    taskTypes: [
      `${SPEC}vta/webvh/dids/create/1.2`,
      `${SPEC}vta/webvh/dids/create/1.1`,
      `${SPEC}vta/webvh/dids/create/1.0`,
    ],
    conditional: false,
  },
  { key: 'addDevice', taskTypes: [`${SPEC}acl/grant/0.2`, `${SPEC}acl/grant/0.1`], conditional: true },
  {
    key: 'changeApprovers',
    taskTypes: [`${SPEC}policy/upsert/0.3`, `${SPEC}policy/upsert/0.2`],
    conditional: true,
  },
] as const

export type TrustedKey = (typeof TRUSTED_TASKS)[number]['key']

const taskTypesOf = (key: TrustedKey): readonly string[] =>
  TRUSTED_TASKS.find((t) => t.key === key)?.taskTypes.flatMap((uri) => [...versionsOf(uri)]) ?? []

/** The trusted action a task type falls under (any version a rule covers), if any. */
export const trustedKeyOf = (taskType: string): TrustedKey | undefined =>
  TRUSTED_TASKS.find((t) => taskTypesOf(t.key).includes(taskType))?.key

const isTrusted = (rule: ApprovalRule) => rule.requires === 'consent' && rule.approverSet === TRUSTED_SET

/** What the screen shows: who approves, for what, and what another rule already holds. */
export interface TrustedApproversView {
  approvers: string[]
  keys: TrustedKey[]
  /** Actions another rule (set elsewhere) already names: they cannot be given to a trusted approver. */
  heldElsewhere: TrustedKey[]
}

export function trustedApproversView(model: Pick<ApprovalsModel, 'rules' | 'sets'>): TrustedApproversView {
  const mine = model.rules.filter(isTrusted)
  const others = model.rules.filter((rule) => !isTrusted(rule))
  const keys = TRUSTED_TASKS.filter((t) => mine.some((rule) => taskTypesOf(t.key).includes(rule.taskType))).map(
    (t) => t.key
  )
  const heldElsewhere = TRUSTED_TASKS.filter((t) =>
    others.some((rule) => taskTypesOf(t.key).includes(rule.taskType))
  ).map((t) => t.key)
  return { approvers: mine.length ? [...(model.sets[TRUSTED_SET] ?? [])] : [], keys, heldElsewhere }
}

/** Refused before anything is sent. */
export class TrustedRuleRefused extends Error {
  constructor(
    readonly reason: 'not-a-did' | 'held-elsewhere' | 'unknown-action',
    readonly detail: string
  ) {
    super(`trusted approver rule refused (${reason}): ${detail}`)
    this.name = 'TrustedRuleRefused'
  }
}

/**
 * The row with the trusted approvers and the actions they approve set to
 * `approvers` and `keys`. Empty `approvers` or `keys` removes every trusted
 * rule and the set. Other rules and sets are kept as they were, in their
 * order. Refuses an approver that is not a DID, an unknown action, and an
 * action another rule already names (two rules for one task overlap, vta-sdk
 * approvals/mod.rs validate).
 *
 * `served`, when known, is the task types the agent dispatches: a rule is
 * written only for those versions, as {@link ruleVersionsFor} does for the
 * phone's own rules. Unknown, every listed version is written.
 */
export function withTrustedApprovers(
  model: Pick<ApprovalsModel, 'rules' | 'sets'>,
  approvers: readonly string[],
  keys: readonly TrustedKey[],
  served?: readonly string[]
): Pick<ApprovalsModel, 'rules' | 'sets'> {
  for (const did of approvers) if (!/^did:[a-z0-9]+:.+/.test(did)) throw new TrustedRuleRefused('not-a-did', did)
  for (const key of keys)
    if (!TRUSTED_TASKS.some((t) => t.key === key)) throw new TrustedRuleRefused('unknown-action', String(key))
  const others = model.rules.filter((rule) => !isTrusted(rule))
  const sets: ApproverSets = { ...model.sets }
  delete sets[TRUSTED_SET]
  const members = [...new Set(approvers)]
  if (members.length === 0 || keys.length === 0) return { rules: others, sets }

  const rules: ApprovalRule[] = [...others]
  for (const key of keys) {
    const listed = taskTypesOf(key)
    const clash = others.find((rule) => listed.includes(rule.taskType))
    if (clash) throw new TrustedRuleRefused('held-elsewhere', clash.taskType)
    const versions = served ? listed.filter((uri) => served.includes(uri)) : listed
    for (const taskType of versions.length ? versions : listed)
      rules.push({ taskType, requires: 'consent', approverSet: TRUSTED_SET, minApprovals: 1, excludeRequester: true })
  }
  sets[TRUSTED_SET] = members
  return { rules, sets }
}

/**
 * The row after an approver's key changed (their phone swapped its manager
 * key): the set names the new DID instead. `changed` is false when the old DID
 * is not in the set.
 */
export function withTrustedApproverReplaced(
  model: Pick<ApprovalsModel, 'rules' | 'sets'>,
  oldDid: string,
  newDid: string
): Pick<ApprovalsModel, 'rules' | 'sets'> & { changed: boolean } {
  const members = model.sets[TRUSTED_SET]
  if (!members?.includes(oldDid)) return { ...model, changed: false }
  return {
    rules: model.rules,
    sets: { ...model.sets, [TRUSTED_SET]: [...new Set(members.map((m) => (m === oldDid ? newDid : m)))] },
    changed: true,
  }
}
