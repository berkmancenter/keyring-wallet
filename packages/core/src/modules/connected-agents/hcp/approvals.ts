/**
 * Finding the consent request the person's VTA sends for an HCP grant (step 7.27 track C, part 2, steps 2 to 4).
 *
 * The VTA holds the CLI's `hcp/grants/request` and sends Keyring a `task-consent/request/0.1` over it, which arrives
 * as a {@link VtiApproval} in `vtaAgent`'s state, as every consent request does. This file reads them; it never
 * changes one. An approval that is not the one the scanned link names stays where it is, and Keyring's ordinary
 * Requests screen lists it as today.
 *
 * The match number is not read, written or logged here.
 *
 * @module connected-agents/hcp/approvals
 */
import type { VtiApproval } from '../../trust-tasks/module/vtaAgent'
import { vtaAgent } from '../../trust-tasks/module/vtaAgent'
import {
  HCP_GRANTS_REQUEST,
  type HcpCategoryDetail,
  type HcpClientDetail,
  type HcpConnectLink,
  type HcpDirectivesDetail,
  type HcpGrantTermDetail,
  type HcpOperator,
  type HcpPurposeDetail,
  type HcpUseUntilDetail,
} from './types'

/** Where the approvals come from: `vtaAgent` in the app, a fake in tests. */
export interface HcpApprovalSource {
  list(): VtiApproval[]
  subscribe(listener: () => void): () => void
  decide(id: string, decision: 'approve' | 'deny', reason?: string): Promise<void>
}

/** The `vtaAgent` singleton's approvals: its state, its listeners and its `decide` (which runs the owner check). */
export function vtaAgentApprovalSource(): HcpApprovalSource {
  return {
    list: () => vtaAgent.getState().approvals,
    subscribe: (listener) => {
      const unsubscribe = vtaAgent.subscribe(listener)
      return () => {
        unsubscribe()
      }
    },
    decide: (id, decision, reason) => vtaAgent.decide(id, decision, reason),
  }
}

/**
 * The effects of an HCP grant's consent request, read (VTI hcp.md §5.1). `rows` are every effect's summary, verbatim,
 * in the order sent, a kind Keyring does not know included. The structured members are those whose `detail` read;
 * a known kind with a `detail` of another shape still shows its row and only loses its structure.
 */
export interface HcpEffects {
  client: HcpClientDetail
  categories: HcpCategoryDetail[]
  /** The named purposes read (never a `choose: true` one). */
  purposes: HcpPurposeDetail[]
  /**
   * The `choose: true` purposes (the request names none), each by its summary, with its purpose and description when
   * its detail reads: kept out of `rows`, and shown as the purposes approving allows (`./approveView.ts`).
   */
  choices: { summary: string; purpose?: string; description?: string }[]
  useUntil?: HcpUseUntilDetail
  term: HcpGrantTermDetail
  directives?: HcpDirectivesDetail
  rows: string[]
}

const URN_UUID = /^urn:uuid:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
/** An RFC 3339 date-time with a zone (`Z` or an offset). */
const RFC3339 = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/

type Plain = Record<string, unknown>

const isPlain = (v: unknown): v is Plain => typeof v === 'object' && v !== null && !Array.isArray(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const isTextList = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every(isText)
const isPositiveInteger = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0

function operatorOf(v: unknown): HcpOperator | undefined {
  if (isText(v)) return v
  if (!isPlain(v)) return undefined
  const op: { id?: string; name?: string } = {}
  if (isText(v.id)) op.id = v.id
  if (isText(v.name)) op.name = v.name
  return op.id || op.name ? op : undefined
}

function clientDetail(d: unknown): HcpClientDetail | undefined {
  if (!isPlain(d) || !isText(d.clientId) || !isText(d.name)) return undefined
  const operator = operatorOf(d.operator)
  if (!operator) return undefined
  const client: HcpClientDetail = { clientId: d.clientId, name: d.name, operator }
  // Not in the §5.1 contract; read only when well formed, ignored otherwise.
  if (isText(d.grantId) && URN_UUID.test(d.grantId)) client.grantId = d.grantId
  if (isText(d.threadId) && URN_UUID.test(d.threadId)) client.threadId = d.threadId
  return client
}

function categoryDetail(d: unknown): HcpCategoryDetail | undefined {
  if (!isPlain(d) || !isText(d.category) || !isText(d.description) || !isTextList(d.actions)) return undefined
  return { category: d.category, description: d.description, actions: [...d.actions] }
}

/** A named purpose (`choose: true` is read before this, in {@link readHcpEffects}). */
function purposeDetail(d: unknown): HcpPurposeDetail | undefined {
  if (!isPlain(d) || !isText(d.purpose) || !isText(d.description)) return undefined
  if (d.choose !== undefined && d.choose !== false) return undefined
  return { purpose: d.purpose, description: d.description }
}

function useUntilDetail(d: unknown): HcpUseUntilDetail | undefined {
  if (!isPlain(d) || !isPositiveInteger(d.maxUseSeconds)) return undefined
  return { maxUseSeconds: d.maxUseSeconds }
}

function termDetail(d: unknown): HcpGrantTermDetail | undefined {
  if (!isPlain(d) || !isText(d.persistence) || !isText(d.expiresAt)) return undefined
  if (!RFC3339.test(d.expiresAt) || Number.isNaN(Date.parse(d.expiresAt))) return undefined
  return { persistence: d.persistence, expiresAt: d.expiresAt }
}

function directivesDetail(d: unknown): HcpDirectivesDetail | undefined {
  if (!isPlain(d) || typeof d.followsDirectives !== 'boolean') return undefined
  return { followsDirectives: d.followsDirectives }
}

/**
 * The Client Operator's id, the one derivation for every caller (C5's "answers other people" switch): text gives
 * itself, an object gives its `id`, and an object with only a `name` gives none (no switch).
 */
export function hcpOperatorId(operator: HcpOperator | undefined): string | undefined {
  if (typeof operator === 'string') return operator
  return operator?.id
}

/**
 * The effects, read. A `choose: true` purpose goes to `choices`, not to `rows`, detected before its detail is
 * validated, so a malformed one can never read as an ordinary row. Requests that mix named and `choose: true`
 * purposes, or carry no `hcpCategory` at all, are outside VTI hcp.md §5.1 and refused. Order and count are not fixed beyond what §5.1 says: every effect must be an object with a
 * non-empty `summary` (the row a surface must show), and there must be exactly one `hcpClient` and exactly one
 * `hcpGrantTerm` whose `detail` reads, since the match and the record need them. A second `hcpUseUntil` or
 * `hcpDirectives` (one per request) also refuses, as the two could disagree. Categories and purposes are as many as
 * sent. An unknown kind, or a known optional kind whose `detail` does not read, is kept as its row only.
 * Anything else gives `undefined`.
 */
export function readHcpEffects(approval: Pick<VtiApproval, 'effects'>): HcpEffects | undefined {
  const effects = approval.effects
  if (!Array.isArray(effects) || effects.length === 0) return undefined
  const rows: string[] = []
  const clients: HcpClientDetail[] = []
  const terms: HcpGrantTermDetail[] = []
  const categories: HcpCategoryDetail[] = []
  const purposes: HcpPurposeDetail[] = []
  const choices: HcpEffects['choices'] = []
  let useUntil: HcpUseUntilDetail | undefined
  let directives: HcpDirectivesDetail | undefined
  let useUntilCount = 0
  let directivesCount = 0
  let categoryCount = 0
  let namedPurposeCount = 0
  for (const e of effects as unknown[]) {
    if (!isPlain(e) || !isText(e.summary)) return undefined
    const summary = e.summary
    let isChoice = false
    switch (e.kind) {
      case 'hcpClient': {
        const c = clientDetail(e.detail)
        if (!c) return undefined
        clients.push(c)
        break
      }
      case 'hcpGrantTerm': {
        const t = termDetail(e.detail)
        if (!t) return undefined
        terms.push(t)
        break
      }
      case 'hcpCategory': {
        categoryCount++
        const c = categoryDetail(e.detail)
        if (c) categories.push(c)
        break
      }
      case 'hcpPurpose': {
        if (isPlain(e.detail) && e.detail.choose === true) {
          const { purpose, description } = e.detail
          choices.push({
            summary,
            ...(isText(purpose) ? { purpose } : {}),
            ...(isText(description) ? { description } : {}),
          })
          isChoice = true
          break
        }
        namedPurposeCount++
        const p = purposeDetail(e.detail)
        if (p) purposes.push(p)
        break
      }
      case 'hcpUseUntil':
        useUntilCount++
        useUntil = useUntilDetail(e.detail) ?? useUntil
        break
      case 'hcpDirectives':
        directivesCount++
        directives = directivesDetail(e.detail) ?? directives
        break
      default:
        // An unknown kind (or none): its summary is the row, and nothing is refused.
        break
    }
    if (!isChoice) rows.push(summary)
  }
  if (clients.length !== 1 || terms.length !== 1 || useUntilCount > 1 || directivesCount > 1) return undefined
  if (categoryCount === 0 || (choices.length > 0 && namedPurposeCount > 0)) return undefined
  return {
    client: clients[0],
    categories,
    purposes,
    choices,
    ...(useUntil ? { useUntil } : {}),
    term: terms[0],
    ...(directives ? { directives } : {}),
    rows,
  }
}

/**
 * The thread a consent request answers: the document's `parentThreadId` (VTI hcp.md §5.2, the "VTA → Keyring"
 * boundary: the VTA always sets it to the held request's `threadId`), which `vtaAgent` keeps on the approval. Required:
 * without it nothing is matched. A `threadId` in the `hcpClient` detail, outside the contract, is never a source on its
 * own; when present it must agree.
 */
export function hcpApprovalThread(approval: VtiApproval, effects: HcpEffects): string | undefined {
  const parent = typeof approval.parentThreadId === 'string' ? approval.parentThreadId : undefined
  const inDetail = effects.client.threadId
  if (!parent || (inDetail && parent !== inDetail)) return undefined
  return parent
}

/**
 * Whether an approval is the HCP grant request the link names, whatever its status and time: the task type, the
 * requester, the client effect's VID, and the thread it answers. Never one from another person's agent (`forAgent`):
 * an HCP consent comes from the person's own VTA.
 */
export function isHcpApprovalFor(approval: VtiApproval, link: HcpConnectLink): boolean {
  if (approval.forAgent) return false
  if (approval.taskType !== HCP_GRANTS_REQUEST || approval.requester !== link.clientVid) return false
  const effects = readHcpEffects(approval)
  return (
    !!effects && effects.client.clientId === link.clientVid && hcpApprovalThread(approval, effects) === link.threadId
  )
}

/** Whether the approval's own `expiresAt` has passed at `now` (an unreadable one counts as passed). */
export function hcpApprovalExpired(approval: Pick<VtiApproval, 'expiresAt'>, now: Date): boolean {
  const at = Date.parse(approval.expiresAt)
  return !Number.isFinite(at) || at <= now.getTime()
}

/** The pending, unexpired approval that is the HCP grant request the link names (step 2), if there is one. */
export function findHcpApproval(approvals: VtiApproval[], link: HcpConnectLink, now: Date): VtiApproval | undefined {
  return approvals.find((a) => a.status === 'pending' && !hcpApprovalExpired(a, now) && isHcpApprovalFor(a, link))
}
