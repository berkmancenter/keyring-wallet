/**
 * The vetter's two rounds of hidden vetting — enrolling for a period and
 * drawing the period's attestation tokens — in one place, for both callers:
 * the vetter screens' adapter (`hiddenVetterAdapter`) and the vetter's own desk
 * (`VtiVetterDesk`), which runs them without anyone asking.
 *
 * Each round is a trip through two parties, and the order is the point:
 *
 * 1. the agent builds a request (`root-request` / `tokens/request`) — it holds
 *    the key, so only it can blind anything;
 * 2. the phone carries that request to the **community**
 *    (`vtc/vetting/vetters/pcs-root` / `pcs-tokens`);
 * 3. the phone hands the community's answer back to the agent
 *    (`root-accept` / `tokens/accept`), which unblinds and keeps the result.
 *
 * Moved here unchanged from the adapter, so that the tick arithmetic — wrong
 * twice before it was tested — exists once.
 *
 * @module trust-tasks/module/hiddenVetterRounds
 */
import type { Agent } from '@credo-ts/core'

import type { VtaClient } from './VtaClient'
import { getKeyed, putKeyed } from './keyedRecords'
import { PCS_VETTER_ERROR, VTC_VETTER_TASK, type PublishedConfig } from './pcsVetterTasks'
import { HIDDEN_VETTING_EXT, type VtiCriterion } from './joinManifest'
import { parametersToSend } from './pcsVtaPayloads'
import { vtaAgent } from './vtaAgent'
import { VtiRefusal, vtiAgent } from './vtiAgent'

/**
 * One clock for everything here.
 *
 * The draw guard compares a stored timestamp with the present, so both must
 * come from the same source. Writing with `new Date()` and comparing with
 * `Date.now()` is fragile in principle and provably wrong under a test
 * environment that fakes one and not the other — which this one does, and
 * which turned the double-draw guard into a no-op until it was found.
 */
export const nowMs = () => Date.now()
export const nowIso = () => new Date(nowMs()).toISOString()

const RECORD_TYPE = 'keyring/hidden-vetter'
const KIND = 'standing'

/**
 * What the phone keeps about its own vetting, which is only what the agent
 * cannot tell it.
 *
 * The agent reports labels and token counts but **no clock**: no last draw, no
 * tick boundary, no enrolment expiry. So the draw time is kept here, and a
 * phone that has never drawn — a new or restored one — simply does not know,
 * which the screens show as no date rather than as "draw now".
 */
export interface VetterRecord {
  community: string
  lastDrawAt?: string
  /** The tick last drawn for, so a second draw in one tick is not attempted. */
  lastTick?: number
}

export const loadVetterRecord = (agent: Agent, community: string) =>
  getKeyed<VetterRecord>(agent, RECORD_TYPE, KIND, community)

const saveVetterRecord = (agent: Agent, record: VetterRecord) =>
  putKeyed(agent, RECORD_TYPE, KIND, record.community, record as unknown as Record<string, unknown>)

/** The criterion's published hidden-vetting parameters, read raw. */
export function publishedOf(criterion: VtiCriterion): PublishedConfig | undefined {
  const vetting = (criterion as { vetting?: { ext?: Record<string, unknown> } }).vetting
  return parametersToSend(vetting?.ext?.[HIDDEN_VETTING_EXT])
}

/** A connected client for this phone's own agent, or a coded refusal. */
export async function connectedVetterClient(agent: Agent): Promise<VtaClient> {
  const vtaDid = vtaAgent.agentAddress()
  if (!vtaDid) throw Object.assign(new Error('no agent linked'), { code: 'keyring/hidden-vetter:noAgent' })
  const client = vtaAgent.client(agent, vtaDid)
  await client.connect()
  return client
}

/** The context the vetter acts in; the agent's first, as the applicant side does. */
export async function vetterContextOf(client: VtaClient): Promise<string> {
  return (await client.listContexts().catch(() => []))[0]?.id ?? 'vta'
}

/** ISO duration `P3D` → milliseconds. Only the forms a community publishes for a tick. */
export function tickMillis(tickLength: string | undefined): number | undefined {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(tickLength ?? '')
  if (!match) return undefined
  const [, d, h, m] = match
  const ms = (Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(m ?? 0) * 60) * 1000
  return ms > 0 ? ms : undefined
}

/** The framework's error family: a refusal arrives as a task of this type. */
const TASK_ERROR = 'https://trusttasks.org/spec/trust-task-error/'

/**
 * Ask the community one of its vetter tasks and read the answer's payload.
 *
 * `vtiAgent.ask` is the same path the join submission and the challenge take;
 * nothing new is needed for the community hop.
 *
 * A refusal, though, is a **task** rather than an absence: its body carries a
 * payload too, so reading `payload` without looking at the type returns the
 * refusal's own `{code, message, details}` as though it were the answer. On
 * 2026-10-15 test-vtc refused a root request over an encoding, this returned
 * the refusal as the response, and the next step handed the agent
 * `label: undefined, preCredential: undefined` — which is why root-accept ran
 * after the community had already said no. A refused step stops here.
 */
async function askCommunity<T>(communityDid: string, type: string, payload: Record<string, unknown>): Promise<T> {
  const answer = await vtiAgent.ask(communityDid, type, payload)
  if (!answer) throw Object.assign(new Error(`${type} went unanswered`), { code: 'keyring/hidden-vetter:noAnswer' })
  const body = answer?.body as { type?: unknown; payload?: unknown } | undefined
  const answered = String(body?.type ?? answer?.type ?? '')
  if (answered.startsWith(TASK_ERROR) || answered.includes('trust-task-error')) {
    const refusal = (body?.payload ?? {}) as { code?: unknown; message?: unknown; details?: unknown }
    throw new VtiRefusal(
      String(refusal.code ?? 'refused'),
      String(refusal.message ?? `${type} was refused`),
      refusal.details
    )
  }
  const got = body?.payload
  if (!got || typeof got !== 'object') throw new Error(`${type} returned no payload`)
  return got as T
}

/**
 * Which tick a draw is for.
 *
 * Ticks are counted from the community's own epoch, which it does not publish
 * — so this counts from the phone's first draw and is only ever used to avoid
 * drawing twice in one tick. A community refuses a draw that is ahead of its
 * own tick, which is the authority that matters.
 */
export function currentTick(parameters: PublishedConfig, record: VetterRecord | undefined): number {
  const tick = tickMillis(parameters.tickLength)
  const last = record?.lastDrawAt ? Date.parse(record.lastDrawAt) : undefined
  if (!tick || !last || !record?.lastTick) return record?.lastTick ? record.lastTick + 1 : 1
  // No `Math.max(1, …)` here: within the same tick no time has elapsed, so the
  // answer must be the tick already drawn — forcing it forward made the
  // double-draw guard useless, which is what the test caught.
  return record.lastTick + Math.floor((nowMs() - last) / tick)
}

/** Whether the agent holds a vetter credential for the period `criterion` publishes now. */
export async function isEnrolled(agent: Agent, communityDid: string, criterion: VtiCriterion): Promise<boolean> {
  const period = publishedOf(criterion)?.vetterLabels?.[0]
  if (!period) return false
  const client = await connectedVetterClient(agent)
  const contextId = await vetterContextOf(client)
  const vetter = await client.showPcsVetter({ contextId, community: communityDid })
  return Boolean(vetter?.enrolledLabels?.includes(period))
}

/** Enrol for the period the criterion publishes now: agent blinds, community signs, agent unblinds. */
export async function enrolVetter(agent: Agent, communityDid: string, criterion: VtiCriterion): Promise<void> {
  const parameters = publishedOf(criterion)
  if (!parameters)
    throw Object.assign(new Error('not a hidden criterion'), { code: 'keyring/hidden-vetter:noParameters' })
  const label = parameters.vetterLabels[0]
  if (!label) throw Object.assign(new Error('no vetter label published'), { code: PCS_VETTER_ERROR.rootLabelNotLive })

  const client = await connectedVetterClient(agent)
  const contextId = await vetterContextOf(client)
  const memberDid = client.managerDid
  if (!memberDid)
    throw Object.assign(new Error('no identity at the agent'), { code: 'keyring/hidden-vetter:noIdentity' })

  // 1 — the agent blinds a request. Only it can: it holds the key. What it
  // answers is the community's payload, whole.
  const request = await client.pcsRootRequest({ contextId, community: communityDid, memberDid, parameters, label })
  // 2 — the phone carries it to the community, unchanged, and the community
  // signs a pre-credential. A refusal stops the round here.
  const answer = await askCommunity<{ label: string; preCredential: string }>(communityDid, VTC_VETTER_TASK.pcsRoot, {
    label: request.label,
    id: request.id,
    request: request.request,
  })
  // 3 — back to the agent, which unblinds and keeps it. The phone never sees
  // the credential, only the blinded halves.
  await client.pcsRootAccept({
    contextId,
    community: communityDid,
    parameters,
    response: { label: answer.label, preCredential: answer.preCredential },
  })
}

/** Draw this tick's tokens, once per tick: agent blinds, community signs, agent unblinds. */
export async function drawVetterTokens(
  agent: Agent,
  communityDid: string,
  criterion: VtiCriterion
): Promise<{ drawn: number }> {
  const parameters = publishedOf(criterion)
  if (!parameters)
    throw Object.assign(new Error('not a hidden criterion'), { code: 'keyring/hidden-vetter:noParameters' })
  const label = parameters.tokenLabels[0]
  const client = await connectedVetterClient(agent)
  const contextId = await vetterContextOf(client)

  const record = await loadVetterRecord(agent, communityDid)
  const tick = currentTick(parameters, record)
  if (record?.lastTick === tick) return { drawn: 0 }

  const request = await client.pcsTokensRequest({
    contextId,
    community: communityDid,
    parameters,
    label,
    tick,
    // Never more than the published drip: the agent refuses countExceedsDrip,
    // and asking for more than a community allows is not the phone's call.
    count: parameters.dripPerTick,
  })
  // Carried as the agent built it. A refusal stops the round, and the draw
  // the agent holds open for it is given up, or the next tick's draw would be
  // refused as one already in flight.
  let answer: { label: string; tick: number; preCredentials: string[] }
  try {
    answer = await askCommunity(communityDid, VTC_VETTER_TASK.pcsTokens, {
      label: request.label,
      tick: request.tick,
      requests: request.requests,
    })
  } catch (refused) {
    await client
      .pcsTokensAbandon({ contextId, community: communityDid, draw: { label: request.label, tick: request.tick } })
      .catch(() => undefined)
    throw refused
  }
  await client.pcsTokensAccept({
    contextId,
    community: communityDid,
    parameters,
    response: { label: answer.label, tick: answer.tick, preCredentials: answer.preCredentials },
  })
  await saveVetterRecord(agent, { community: communityDid, lastDrawAt: nowIso(), lastTick: tick })
  return { drawn: answer.preCredentials?.length ?? 0 }
}

/**
 * The community's hidden criterion as it serves it now, or undefined when it
 * publishes none (most communities). Read fresh: the period and the digest are
 * the community's current ones.
 */
export async function currentHiddenCriterion(agent: Agent, communityDid: string): Promise<VtiCriterion | undefined> {
  const manifest = await vtiAgent.fetchManifest(communityDid, agent)
  return manifest.criteria.find((c) => publishedOf(c) !== undefined)
}
