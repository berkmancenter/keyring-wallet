/**
 * "Ask me before…": which of the agent's approval rules this phone sets, and
 * which it may never set.
 *
 * Upstream keeps the rules in one reserved policy row (approvalsPolicy.ts).
 * Keyring adds one kind of rule only: consent for a task type, from this
 * phone's own approver set, one approval, the requester's own approval
 * counting. Every other rule in the row was set elsewhere (pnm, openvtc,
 * another phone) and is kept exactly as it is.
 *
 * A consent rule on a task this phone sends traps the phone: every task but the
 * three ceremony ones goes through the agent's policy gate (vta-service
 * trust_tasks/policy_gate.rs:3, ceremony.rs:48-53), so the phone would wait
 * for its own approval — or, with `excludeRequester`, never clear at all
 * (measured on device/set-wake, 2026-10-02). So the screen offers only tasks
 * the phone never sends, and flags a rule set elsewhere on one it does.
 *
 * @module trust-tasks/module/approvalRules
 */

import { type ApprovalRule, type ApproverSets } from './approvalsPolicy'

const SPEC = 'https://trusttasks.org/spec/'

/**
 * The tasks the screen offers, in the order it shows them. None is sent by
 * this phone (the test in approvalRules.test.ts holds that against the code).
 * Approving a request does not run its task — the requester must re-submit
 * with the grant (vta-service consent_request.rs:41-42, 207-214) — so a rule
 * here can only ever hold a task, never run one.
 */
export const OFFERED_TASKS = [
  { taskType: `${SPEC}vta/contexts/create/1.0`, key: 'contextsCreate' },
  { taskType: `${SPEC}vta/contexts/delete/1.0`, key: 'contextsDelete' },
  { taskType: `${SPEC}vta/webvh/dids/delete/1.0`, key: 'didsDelete' },
  { taskType: `${SPEC}keys/revoke/0.1`, key: 'keysRevoke' },
] as const

export type OfferedKey = (typeof OFFERED_TASKS)[number]['key']

/**
 * Every Trust Task this phone sends to its agent. A rule on any of them would
 * hold the phone itself. `policy/upsert/0.2` is here because the phone sends
 * it to change rules: a rule on it would lock this screen out for good.
 * `vta/contexts/create/1.0` is sent only by "Send me a test request", which
 * expects it to be held, and `vta/contexts/delete/1.0` only to clean up after
 * a test request the agent let through — which happens only when the agent
 * enforces no rules at all.
 */
export const PHONE_SENDS: readonly string[] = [
  'auth/whoami/0.1',
  'auth/revoke-session/0.2',
  'auth/step-up/approve-response/0.2',
  'auth/step-up/approve-response/0.6',
  'config/show/0.1',
  'vta/contexts/list/1.0',
  'vta/webvh/dids/list/1.0',
  'vta/webvh/dids/create/1.0',
  'vta/webvh/dids/rotate-keys/1.0',
  'vta/webvh/servers/list/1.0',
  'keys/export-secret/0.1',
  'acl/list/0.1',
  'acl/list/0.2',
  'acl/grant/0.1',
  'acl/grant/0.2',
  'acl/revoke/0.1',
  'acl/revoke/0.2',
  'acl/update/0.1',
  'acl/update/0.2',
  'acl/swap-key/0.1',
  'task-consent/decision/0.1',
  'task-consent/decision/0.2',
  'device/heartbeat/0.2',
  'device/list/0.2',
  'device/register/0.2',
  'device/set-wake/0.2',
  'device/wipe/0.2',
  'vault/credentials/get/0.1',
  'vault/credentials/query/0.1',
  'vault/credentials/receive/0.1',
  'policy/get/0.1',
  'policy/upsert/0.2',
].map((slug) => SPEC + slug)

/** The tasks the test request sends: held by the phone's own rule, or let through when nothing is enforced. */
export const TEST_REQUEST_TASKS = [`${SPEC}vta/contexts/create/1.0`, `${SPEC}vta/contexts/delete/1.0`] as const

/** Does a rule on this task hold this phone itself? */
export const holdsThisPhone = (taskType: string) => PHONE_SENDS.includes(taskType)

/**
 * This phone's approver set, named by its manager DID so two phones on one
 * agent each keep their own: one member, this phone.
 */
export const phoneSetName = (managerDid: string) => `keyring-phone:${managerDid}`

/** The approvals row as Keyring reads it: the rules, the sets, and the version to write against. */
export interface ApprovalsModel {
  rules: ApprovalRule[]
  sets: ApproverSets
  /** The row's version; 0 when the agent has none yet (vta-service operations/policy.rs upsert_policy). */
  version: number
}

export const EMPTY_APPROVALS: ApprovalsModel = { rules: [], sets: {}, version: 0 }

/** One rule set elsewhere, as the screen lists it under "Set from another device". */
export interface RuleSetElsewhere {
  rule: ApprovalRule
  /** It holds a task this phone sends: notifications or devices may stop working. */
  holdsThisPhone: boolean
  /** The offered task it names, if any — that switch is then read-only. */
  offered?: OfferedKey
}

export interface ApprovalsView {
  /** Each offered task: on when this phone's own rule holds it; `elsewhere` when another rule already names it. */
  offered: { key: OfferedKey; taskType: string; on: boolean; elsewhere: boolean }[]
  elsewhere: RuleSetElsewhere[]
  /** The phone's own rule on contexts/create is on, so a test request will be held. */
  canTest: boolean
}

const isMine = (rule: ApprovalRule, managerDid: string) =>
  rule.requires === 'consent' && rule.approverSet === phoneSetName(managerDid) && !rule.contexts?.length

/** What the screen shows for the row as read. */
export function approvalsView(model: ApprovalsModel, managerDid: string): ApprovalsView {
  const elsewhere = model.rules
    .filter((rule) => !isMine(rule, managerDid))
    .map((rule) => ({
      rule,
      holdsThisPhone: holdsThisPhone(rule.taskType),
      offered: OFFERED_TASKS.find((o) => o.taskType === rule.taskType)?.key,
    }))
  const offered = OFFERED_TASKS.map(({ key, taskType }) => ({
    key,
    taskType,
    on: model.rules.some((rule) => rule.taskType === taskType && isMine(rule, managerDid)),
    elsewhere: elsewhere.some((e) => e.rule.taskType === taskType),
  }))
  return { offered, elsewhere, canTest: offered.some((o) => o.key === 'contextsCreate' && o.on && !o.elsewhere) }
}

/** Refused before anything is sent: the screen never sets a rule that is not on offer. */
export class NotOffered extends Error {
  constructor(readonly taskType: string) {
    super(`Keyring does not set approval rules for ${taskType}`)
    this.name = 'NotOffered'
  }
}

/**
 * The row with this phone's rule for `taskType` switched on or off. Other
 * rules and sets are kept as they were, in their order. Switching on adds this
 * phone's set (one member, this phone); switching off the last rule that
 * names it removes the set. Refuses a task that is not offered, and switching
 * on a task another rule already names (two rules for one task overlap,
 * vta-sdk approvals/mod.rs validate).
 */
export function withPhoneRule(
  model: ApprovalsModel,
  taskType: string,
  on: boolean,
  managerDid: string
): Pick<ApprovalsModel, 'rules' | 'sets'> {
  if (!OFFERED_TASKS.some((o) => o.taskType === taskType) || holdsThisPhone(taskType)) throw new NotOffered(taskType)
  const set = phoneSetName(managerDid)
  const others = model.rules.filter((rule) => !(rule.taskType === taskType && isMine(rule, managerDid)))
  const rules = on
    ? [
        ...others,
        { taskType, requires: 'consent' as const, approverSet: set, minApprovals: 1, excludeRequester: false },
      ]
    : others
  const sets: ApproverSets = { ...model.sets }
  if (rules.some((rule) => rule.approverSet === set)) sets[set] = [managerDid]
  else delete sets[set]
  return { rules, sets }
}

/**
 * The row after this phone's manager key was swapped (`acl/swap-key/0.1`):
 * every approver set that names the old key names the new one instead, and
 * this phone's own set — named after its key ({@link phoneSetName}) — is
 * renamed with the rules that use it. Without this the agent keeps asking the
 * retired key, which can no longer answer, so the phone stops being asked at
 * all, and the screen no longer recognises the phone's own rules.
 *
 * Every other rule and set is kept as it was, in its order. `changed` is false
 * when the old key appears nowhere, so nothing needs writing.
 */
export function withKeySwapped(
  model: Pick<ApprovalsModel, 'rules' | 'sets'>,
  oldDid: string,
  newDid: string
): Pick<ApprovalsModel, 'rules' | 'sets'> & { changed: boolean } {
  const oldSet = phoneSetName(oldDid)
  const newSet = phoneSetName(newDid)
  let changed = false
  const sets: ApproverSets = {}
  for (const [name, members] of Object.entries(model.sets)) {
    const renamed = name === oldSet ? newSet : name
    const swapped = members.map((m) => (m === oldDid ? newDid : m))
    if (renamed !== name || swapped.some((m, i) => m !== members[i])) changed = true
    // A set renamed onto one that already exists merges into it, each member once.
    sets[renamed] = [...new Set([...(sets[renamed] ?? []), ...swapped])]
  }
  const rules = model.rules.map((rule) => {
    if (rule.approverSet !== oldSet) return rule
    changed = true
    return { ...rule, approverSet: newSet }
  })
  return { rules, sets, changed }
}

/**
 * A rule as the agent's strict reader takes it (`deny_unknown_fields`,
 * vta-sdk approvals/mod.rs:97): the known members only, absent ones left out.
 */
export function ruleForWire(rule: ApprovalRule): ApprovalRule {
  return {
    taskType: rule.taskType,
    requires: rule.requires,
    ...(rule.approverSet !== undefined ? { approverSet: rule.approverSet } : {}),
    ...(rule.minApprovals !== undefined ? { minApprovals: rule.minApprovals } : {}),
    ...(rule.excludeRequester !== undefined ? { excludeRequester: rule.excludeRequester } : {}),
    ...(rule.contexts?.length ? { contexts: rule.contexts } : {}),
  }
}

const RULE_MEMBERS = new Set(['taskType', 'requires', 'approverSet', 'minApprovals', 'excludeRequester', 'contexts'])

const readsAsRule = (r: unknown): r is ApprovalRule => {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false
  const rule = r as Record<string, unknown>
  return (
    Object.keys(rule).every((k) => RULE_MEMBERS.has(k)) &&
    typeof rule.taskType === 'string' &&
    (rule.requires === 'consent' || rule.requires === 'reauth') &&
    (rule.approverSet === undefined || typeof rule.approverSet === 'string') &&
    (rule.minApprovals === undefined || (Number.isInteger(rule.minApprovals) && (rule.minApprovals as number) >= 0)) &&
    (rule.excludeRequester === undefined || typeof rule.excludeRequester === 'boolean') &&
    (rule.contexts === undefined || (Array.isArray(rule.contexts) && rule.contexts.every((c) => typeof c === 'string')))
  )
}

/**
 * The rules and sets in an approvals row's `ext`. A row with anything Keyring
 * cannot read whole is `unreadable`: shown, never written back, since writing
 * it would drop what was set elsewhere.
 */
export function modelFromExt(ext: unknown, version: number): ApprovalsModel & { unreadable: boolean } {
  const e = (ext && typeof ext === 'object' ? ext : {}) as Record<string, unknown>
  const rawRules = e['openvtc.approvals'] ?? []
  const rawSets = e['openvtc.approver-sets'] ?? {}
  let unreadable = !Array.isArray(rawRules) || !rawSets || typeof rawSets !== 'object' || Array.isArray(rawSets)
  const rules = (Array.isArray(rawRules) ? rawRules : []).filter((r) => {
    if (readsAsRule(r)) return true
    unreadable = true
    return false
  })
  const sets: ApproverSets = {}
  if (!unreadable) {
    for (const [name, members] of Object.entries(rawSets as Record<string, unknown>)) {
      if (Array.isArray(members) && members.every((m) => typeof m === 'string')) sets[name] = members as string[]
      else unreadable = true
    }
  }
  return { rules: rules.map(ruleForWire), sets, version, unreadable }
}
