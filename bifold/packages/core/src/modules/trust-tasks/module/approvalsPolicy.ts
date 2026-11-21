/**
 * Declarative approval rules, as the VTA keeps them: a port of
 * `vta-sdk/src/approvals/mod.rs` (VTI, read at the pin in
 * `scripts/openvtc/PINS.json`).
 *
 * A rule says "this Trust Task needs this kind of approval". The rules travel
 * in one reserved policy row (`approvals`, priority 200) under
 * `ext["openvtc.approvals"]`, with the named approver sets under
 * `ext["openvtc.approver-sets"]`, and the row's Rego module is generated from
 * them. The VTA re-derives the module on every upsert and refuses the write if
 * the two differ byte for byte, so `synthesizeRego` must produce exactly what
 * the SDK's `synthesize_rego` does. Tests compare it with fixtures the SDK
 * generated at the pinned commit (`scripts/openvtc/gen-approvals-fixtures.sh`);
 * re-run that at every VTI bump. Treat any edit here as a wire change, as the
 * SDK says of its own (`mod.rs:22-40`).
 *
 * @module trust-tasks/module/approvalsPolicy
 */

export const DECLARATIVE_POLICY_ID = 'approvals'
export const DECLARATIVE_POLICY_NAME = 'Declarative approvals'
export const DECLARATIVE_POLICY_PRIORITY = 200
export const EXT_KEY_RULES = 'openvtc.approvals'
export const EXT_KEY_APPROVER_SETS = 'openvtc.approver-sets'

/** What a gated task requires before it may run. */
export type Requires = 'reauth' | 'consent'

/** One rule, in the SDK's camelCase JSON shape. */
export interface ApprovalRule {
  /** The Trust Task Type URI to gate, e.g. `https://trusttasks.org/spec/vta/contexts/create/1.0`. */
  taskType: string
  requires: Requires
  /** Named set the approvers belong to: required for consent, refused for reauth. */
  approverSet?: string
  /** Distinct approvals needed (consent only); defaults to 1, never below 1. */
  minApprovals?: number
  /** The requester's own approval does not count (consent only); defaults to false. */
  excludeRequester?: boolean
  /** Contexts the rule applies in; empty or absent means every context. */
  contexts?: string[]
}

/** Set name → the DIDs that may approve. */
export type ApproverSets = Record<string, string[]>

export const effectiveMinApprovals = (rule: ApprovalRule): number => Math.max(rule.minApprovals ?? 1, 1)
export const effectiveExcludeRequester = (rule: ApprovalRule): boolean => rule.excludeRequester ?? false

/** A Rego string literal; escapes what could break out of it (`rego_string`). */
function regoString(s: string): string {
  let out = '"'
  for (const c of s) {
    switch (c) {
      case '"':
        out += '\\"'
        break
      case '\\':
        out += '\\\\'
        break
      case '\n':
        out += '\\n'
        break
      case '\r':
        out += '\\r'
        break
      case '\t':
        out += '\\t'
        break
      default:
        out += c
    }
  }
  return `${out}"`
}

const GENERATED_HEADER =
  '# Generated from the declarative approvals rules — do not hand-edit.\n' +
  '#\n' +
  '# The VTA re-derives this module from ext["openvtc.approvals"] on every upsert\n' +
  '# and refuses the write if the two disagree, so an edit here is not a way to\n' +
  '# change behaviour: change the rules instead.\n'

/**
 * The rules as a `vta.policy` Rego module (`synthesize_rego`): one complete
 * `decision` rule per entry, guarded on the task type (and the context when
 * scoped), so it abstains for every task it does not name. Deterministic.
 */
export function synthesizeRego(rules: ApprovalRule[]): string {
  let out = 'package vta.policy\n\nimport rego.v1\n\n' + GENERATED_HEADER
  for (const rule of rules) {
    out += '\n'
    const guardType = `input.request.typeUri == ${regoString(rule.taskType)}`
    const contexts = rule.contexts ?? []
    const guardCtx = contexts.length ? `input.contextId in {${contexts.map(regoString).join(', ')}}` : undefined
    const head =
      rule.requires === 'reauth'
        ? 'decision := {\n\t"decision": "requireStepUp",\n}'
        : `decision := {\n\t"decision": "requireConsent",\n\t"requireConsent": {"approverSet": ${regoString(
            rule.approverSet ?? ''
          )}, "minApprovals": ${effectiveMinApprovals(rule)}, "excludeRequester": ${effectiveExcludeRequester(
            rule
          )}},\n}`
    out += guardCtx ? `${head} if {\n\t${guardType}\n\t${guardCtx}\n}\n` : `${head} if ${guardType}\n`
  }
  return out
}

/** Why a model was refused; the same words as the SDK's `ApprovalsError`. */
export class ApprovalsError extends Error {
  constructor(
    readonly code:
      | 'MalformedTaskType'
      | 'MissingApproverSet'
      | 'ApproverSetOnReauth'
      | 'UnknownApproverSet'
      | 'EmptyApproverSet'
      | 'ThresholdExceedsSet'
      | 'OverlappingRules'
      | 'ConsentFieldOnReauth',
    message: string
  ) {
    super(message)
    this.name = 'ApprovalsError'
  }
}

/** `https://trusttasks.org/spec/<slug>/<major>.<minor>`, structurally (`is_task_type_uri`). */
export function isTaskTypeUri(uri: string): boolean {
  const prefix = 'https://trusttasks.org/spec/'
  if (!uri.startsWith(prefix)) return false
  const rest = uri.slice(prefix.length)
  const cut = rest.lastIndexOf('/')
  if (cut < 0) return false
  const slug = rest.slice(0, cut)
  const version = rest.slice(cut + 1)
  if (!slug) return false
  const dot = version.indexOf('.')
  if (dot < 0) return false
  const major = version.slice(0, dot)
  const minor = version.slice(dot + 1)
  return /^[0-9]+$/.test(major) && /^[0-9]+$/.test(minor)
}

/**
 * Validate a whole model (`validate`): the VTA refuses what this refuses, so
 * it is refused here first, in the same words.
 */
export function validateApprovals(rules: ApprovalRule[], sets: ApproverSets): void {
  for (const rule of rules) {
    const t = rule.taskType
    if (!isTaskTypeUri(t)) {
      throw new ApprovalsError(
        'MalformedTaskType',
        `rule for \`${t}\` is not a Trust Task Type URI: expected \`https://trusttasks.org/spec/<slug>/<major>.<minor>\``
      )
    }
    if (rule.requires === 'reauth') {
      if (rule.approverSet !== undefined) {
        throw new ApprovalsError(
          'ApproverSetOnReauth',
          `rule for \`${t}\` requires reauth but names approverSet \`${rule.approverSet}\`: reauth elevates the caller's own session and has no third-party approver — use requires = "consent" if another party must sign off`
        )
      }
      for (const [present, field] of [
        [rule.minApprovals !== undefined, 'minApprovals'],
        [rule.excludeRequester !== undefined, 'excludeRequester'],
      ] as const) {
        if (present) {
          throw new ApprovalsError(
            'ConsentFieldOnReauth',
            `\`${field}\` is a consent-only field and cannot be set on the reauth rule for \`${t}\``
          )
        }
      }
      continue
    }
    const setName = rule.approverSet
    if (setName === undefined) {
      throw new ApprovalsError('MissingApproverSet', `rule for \`${t}\` requires consent but names no approverSet`)
    }
    const members = sets[setName]
    if (!members) {
      throw new ApprovalsError(
        'UnknownApproverSet',
        `rule for \`${t}\` names approver set \`${setName}\`, which is not defined; define it before referencing it, or the rule could never be satisfied`
      )
    }
    if (members.length === 0) {
      throw new ApprovalsError(
        'EmptyApproverSet',
        `approver set \`${setName}\` is empty: a consent rule naming it could never reach its threshold, so every task it gates would be permanently refused`
      )
    }
    const min = effectiveMinApprovals(rule)
    if (min > members.length) {
      throw new ApprovalsError(
        'ThresholdExceedsSet',
        `rule for \`${t}\` needs ${min} approvals but set \`${setName}\` has only ${members.length} member(s)`
      )
    }
  }
  rules.forEach((rule, i) => {
    for (const other of rules.slice(i + 1)) {
      if (other.taskType !== rule.taskType) continue
      const a = rule.contexts ?? []
      const b = new Set(other.contexts ?? [])
      const disjoint = a.length > 0 && b.size > 0 && a.every((c) => !b.has(c))
      if (!disjoint) {
        throw new ApprovalsError(
          'OverlappingRules',
          `two rules name \`${rule.taskType}\` with overlapping scope: rules for one task type must either be a single unscoped rule or carry disjoint \`contexts\``
        )
      }
    }
  })
}
