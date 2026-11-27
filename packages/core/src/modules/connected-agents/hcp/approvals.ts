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
  HCP_EFFECT_KINDS,
  HCP_GRANTS_REQUEST,
  type HcpConnectLink,
  type HcpGrantAccessDetail,
  type HcpGrantClientDetail,
  type HcpGrantTermDetail,
  type HcpGrantUseUntilDetail,
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

/** The five effects of an HCP grant's consent request, read. `rows` are their summaries, verbatim, in order. */
export interface HcpEffects {
  client: HcpGrantClientDetail
  access: HcpGrantAccessDetail
  useUntil: HcpGrantUseUntilDetail
  term: HcpGrantTermDetail
  rows: string[]
}

const URN_UUID = /^urn:uuid:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

type Plain = Record<string, unknown>

const isPlain = (v: unknown): v is Plain => typeof v === 'object' && v !== null && !Array.isArray(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const isTextList = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every(isText)
const isPositiveInteger = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0

function clientDetail(d: unknown): HcpGrantClientDetail | undefined {
  if (!isPlain(d)) return undefined
  const { clientVid, clientName, operator, threadId, grantId } = d
  if (!isText(clientVid) || !isText(clientName) || !isPlain(operator)) return undefined
  if (!isText(operator.id) || !isText(operator.name)) return undefined
  if (!isText(threadId) || !URN_UUID.test(threadId) || !isText(grantId) || !URN_UUID.test(grantId)) return undefined
  return { clientVid, clientName, operator: { id: operator.id, name: operator.name }, threadId, grantId }
}

function accessDetail(d: unknown): HcpGrantAccessDetail | undefined {
  if (!isPlain(d) || !Array.isArray(d.access) || d.access.length === 0) return undefined
  const access: HcpGrantAccessDetail['access'] = []
  for (const a of d.access) {
    if (!isPlain(a) || !isTextList(a.actions) || !isTextList(a.categories)) return undefined
    if (!Array.isArray(a.purposes) || a.purposes.length === 0) return undefined
    const purposes: { code: string; description: string }[] = []
    for (const p of a.purposes) {
      if (!isPlain(p) || !isText(p.code) || !isText(p.description)) return undefined
      purposes.push({ code: p.code, description: p.description })
    }
    access.push({ actions: [...a.actions], categories: [...a.categories], purposes })
  }
  return { access }
}

function keepForDetail(d: unknown): HcpGrantUseUntilDetail | undefined {
  if (!isPlain(d) || !isPositiveInteger(d.maxUseSeconds)) return undefined
  return { maxUseSeconds: d.maxUseSeconds }
}

function termDetail(d: unknown): HcpGrantTermDetail | undefined {
  if (!isPlain(d) || d.grantType !== 'temporary' || !isPositiveInteger(d.expiresInSeconds)) return undefined
  return { grantType: 'temporary', expiresInSeconds: d.expiresInSeconds }
}

/**
 * The five effects, read: exactly {@link HCP_EFFECT_KINDS}, each once and in that order, each with a non-empty
 * `summary` and a `detail` of the right shape (`hcpGrantNotSignIn`'s is `{}`). Anything else gives `undefined`.
 */
export function readHcpEffects(approval: Pick<VtiApproval, 'effects'>): HcpEffects | undefined {
  const effects = approval.effects
  if (!Array.isArray(effects) || effects.length !== HCP_EFFECT_KINDS.length) return undefined
  const rows: string[] = []
  for (let i = 0; i < HCP_EFFECT_KINDS.length; i++) {
    const e: unknown = effects[i]
    if (!isPlain(e) || e.kind !== HCP_EFFECT_KINDS[i] || !isText(e.summary)) return undefined
    rows.push(e.summary)
  }
  const detail = (i: number) => (effects[i] as Plain).detail
  const client = clientDetail(detail(0))
  const access = accessDetail(detail(1))
  const useUntil = keepForDetail(detail(2))
  const term = termDetail(detail(3))
  const notSignIn = detail(4)
  if (!client || !access || !useUntil || !term) return undefined
  if (!isPlain(notSignIn) || Object.keys(notSignIn).length !== 0) return undefined
  return { client, access, useUntil, term, rows }
}

/**
 * Whether an approval is the HCP grant request the link names, whatever its status and time: the task type, the
 * requester, the five effects, and the client detail's thread and VID.
 */
export function isHcpApprovalFor(approval: VtiApproval, link: HcpConnectLink): boolean {
  if (approval.taskType !== HCP_GRANTS_REQUEST || approval.requester !== link.clientVid) return false
  const effects = readHcpEffects(approval)
  return !!effects && effects.client.threadId === link.threadId && effects.client.clientVid === link.clientVid
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
