/**
 * The vetter's side, as the vetter screens ask for it.
 *
 * `screens/hiddenVetterSeam.ts` owns the contract; this implements it over the
 * seven `vta/pcs/*` vetter tasks and registers itself at import, the same way
 * the applicant's adapter does. A build that never imports it registers
 * nothing and shows no vetter screens.
 *
 * **Enrolling and drawing are each a round trip through two parties**, which
 * is the part no schema could tell us and the part most likely to surprise:
 *
 * 1. the agent builds a request (`root-request` / `tokens/request`) — it holds
 *    the key, so only it can blind anything;
 * 2. the phone carries that request to the **community**
 *    (`vtc/vetting/vetters/pcs-root` / `pcs-tokens`);
 * 3. the phone hands the community's answer back to the agent
 *    (`root-accept` / `tokens/accept`), which unblinds and keeps the result.
 *
 * Note what upstream's TUI is and is not a model for here. It performs the
 * same ceremony, but it holds the PCS key itself and calls `vetter_start`
 * locally; our agent holds the key, which is the whole point of upstream's
 * #487. So its *flow* is a reference and its *sequencing* is not.
 *
 * @module trust-tasks/module/hiddenVetterAdapter
 */
import type { Agent } from '@credo-ts/core'

import type {
  HiddenVetterRequest,
  HiddenVetterSeam,
  HiddenVetterStanding,
  HiddenVetterStatement,
} from '../screens/hiddenVetterSeam'
import { registerHiddenVetter } from '../screens/hiddenVetterSeam'

import type { VtaClient } from './VtaClient'
import { GenericRecordsCommunityStore } from './VtiCommunityStore'
import { GenericRecordsIdentityStore } from './VtiIdentityStore'
import { getKeyed, putKeyed } from './keyedRecords'
import { PCS_VETTER_ERROR, PCS_VETTER_TASK, VTC_VETTER_TASK, type PublishedConfig } from './pcsVetterTasks'
import { HIDDEN_VETTING_EXT, type VtiCriterion } from './joinManifest'
import { parametersToSend } from './pcsVtaPayloads'
import { vtaAgent } from './vtaAgent'
import { vtiAgent } from './vtiAgent'
import { GenericRecordsVettingStore, VtiVetterDesk } from './vtiVetting'

/**
 * One clock for everything here.
 *
 * The draw guard compares a stored timestamp with the present, so both must
 * come from the same source. Writing with `new Date()` and comparing with
 * `Date.now()` is fragile in principle and provably wrong under a test
 * environment that fakes one and not the other — which this one does, and
 * which turned the double-draw guard into a no-op until it was found.
 */
const nowMs = () => Date.now()
const nowIso = () => new Date(nowMs()).toISOString()

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
interface VetterRecord {
  community: string
  lastDrawAt?: string
  /** The tick last drawn for, so a second draw in one tick is not attempted. */
  lastTick?: number
}

const loadRecord = (agent: Agent, community: string) => getKeyed<VetterRecord>(agent, RECORD_TYPE, KIND, community)

const saveRecord = (agent: Agent, record: VetterRecord) =>
  putKeyed(agent, RECORD_TYPE, KIND, record.community, record as unknown as Record<string, unknown>)

/** The criterion's published hidden-vetting parameters, read raw. */
function publishedOf(criterion: VtiCriterion): PublishedConfig | undefined {
  const vetting = (criterion as { vetting?: { ext?: Record<string, unknown> } }).vetting
  return parametersToSend(vetting?.ext?.[HIDDEN_VETTING_EXT])
}

/** A connected client for this phone's own agent, or a coded refusal. */
async function connected(agent: Agent): Promise<VtaClient> {
  const vtaDid = vtaAgent.agentAddress()
  if (!vtaDid) throw Object.assign(new Error('no agent linked'), { code: 'keyring/hidden-vetter:noAgent' })
  const client = vtaAgent.client(agent, vtaDid)
  await client.connect()
  return client
}

/** The context the vetter acts in; the agent's first, as the applicant side does. */
async function contextOf(client: VtaClient): Promise<string> {
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

/**
 * Ask the community one of its vetter tasks and read the answer's payload.
 *
 * `vtiAgent.ask` is the same path the join submission and the challenge take;
 * nothing new is needed for the community hop.
 */
async function askCommunity<T>(communityDid: string, type: string, payload: Record<string, unknown>): Promise<T> {
  const answer = await vtiAgent.ask(communityDid, type, payload)
  const body = (answer?.body as { payload?: unknown } | undefined)?.payload
  if (!body || typeof body !== 'object') throw new Error(`${type} returned no payload`)
  return body as T
}

/**
 * Which tick a draw is for.
 *
 * Ticks are counted from the community's own epoch, which it does not publish
 * — so this counts from the phone's first draw and is only ever used to avoid
 * drawing twice in one tick. A community refuses a draw that is ahead of its
 * own tick, which is the authority that matters.
 */
function currentTick(parameters: PublishedConfig, record: VetterRecord | undefined): number {
  const tick = tickMillis(parameters.tickLength)
  const last = record?.lastDrawAt ? Date.parse(record.lastDrawAt) : undefined
  if (!tick || !last || !record?.lastTick) return record?.lastTick ? record.lastTick + 1 : 1
  // No `Math.max(1, …)` here: within the same tick no time has elapsed, so the
  // answer must be the tick already drawn — forcing it forward made the
  // double-draw guard useless, which is what the test caught.
  return record.lastTick + Math.floor((nowMs() - last) / tick)
}

/**
 * Which community a request belongs to, from the desk's own store.
 *
 * The seam names a request by id alone, so the community has to be looked up
 * rather than passed — and the lookup is the store's, not a guess.
 */
async function communityOfRequest(agent: Agent, requestId: string): Promise<string> {
  const desk = await new GenericRecordsVettingStore(agent).listDesk()
  const found = desk.find((r) => r.requestId === requestId)
  if (!found) {
    throw Object.assign(new Error(`no request ${requestId} on this phone`), {
      code: 'keyring/hidden-vetter:noSuchRequest',
    })
  }
  return found.communityDid
}

/** The community's hidden criterion as it serves it now, for the parameters and the current digest. */
async function hiddenCriterionOf(agent: Agent, communityDid: string): Promise<VtiCriterion> {
  const manifest = await vtiAgent.fetchManifest(communityDid, agent)
  const criterion = manifest.criteria.find((c) => publishedOf(c) !== undefined)
  if (!criterion) {
    throw Object.assign(new Error('this community publishes no hidden criterion'), {
      code: 'keyring/hidden-vetter:notHiddenCommunity',
    })
  }
  return criterion
}

/** A desk for this community's persona, built from the stores the screens use. */
async function deskFor(agent: Agent, communityDid: string): Promise<VtiVetterDesk> {
  const persona = await new GenericRecordsIdentityStore(agent).getPersona(communityDid)
  if (!persona) {
    throw Object.assign(new Error('no persona for this community'), {
      code: 'keyring/hidden-vetter:noPersona',
    })
  }
  return new VtiVetterDesk(
    agent,
    persona,
    new GenericRecordsVettingStore(agent),
    new GenericRecordsCommunityStore(agent)
  )
}

const seam: HiddenVetterSeam = {
  async standing(agent, communityDid, criterion): Promise<HiddenVetterStanding> {
    const parameters = publishedOf(criterion)
    const client = await connected(agent)
    const contextId = await contextOf(client)
    const vetter = await client.showPcsVetter({ contextId, community: communityDid })
    const record = await loadRecord(agent, communityDid)

    const period = parameters?.vetterLabels?.[0]
    const tokenLabel = parameters?.tokenLabels?.[0]
    const tick = tickMillis(parameters?.tickLength)
    const lastDraw = record?.lastDrawAt ? Date.parse(record.lastDrawAt) : undefined
    // Both of these are ours, not the agent's, and both are undefined on a
    // phone that has never drawn here. The screens treat absence as "unknown",
    // never as "due now".
    const nextDrawAt = lastDraw && tick ? new Date(lastDraw + tick).toISOString() : undefined
    const lapsesAt = nextDrawAt

    return {
      enrolled: Boolean(period && vetter?.enrolledLabels?.includes(period)),
      ...(period ? { period } : {}),
      tokens: vetter?.tokensFree ?? 0,
      ...(tokenLabel ? { tokenLabel } : {}),
      ...(record?.lastDrawAt ? { lastDrawAt: record.lastDrawAt } : {}),
      ...(nextDrawAt ? { nextDrawAt } : {}),
      ...(lapsesAt ? { lapsesAt } : {}),
      // `enrolledUntil` is deliberately absent: the agent reports labels and
      // no expiry, and parsing a date out of "vetter/2026-10" would present an
      // inference as a fact.
    }
  },

  async enrol(agent, communityDid, criterion) {
    const parameters = publishedOf(criterion)
    if (!parameters)
      throw Object.assign(new Error('not a hidden criterion'), { code: 'keyring/hidden-vetter:noParameters' })
    const label = parameters.vetterLabels[0]
    if (!label) throw Object.assign(new Error('no vetter label published'), { code: PCS_VETTER_ERROR.rootLabelNotLive })

    const client = await connected(agent)
    const contextId = await contextOf(client)
    const memberDid = client.managerDid
    if (!memberDid)
      throw Object.assign(new Error('no identity at the agent'), { code: 'keyring/hidden-vetter:noIdentity' })

    // 1 — the agent blinds a request. Only it can: it holds the key.
    const request = await client.pcsRootRequest({ contextId, community: communityDid, memberDid, parameters, label })
    // 2 — the phone carries it to the community, which signs a pre-credential.
    const answer = await askCommunity<{ label: string; preCredential: string }>(communityDid, VTC_VETTER_TASK.pcsRoot, {
      label,
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
  },

  async drawTokens(agent, communityDid, criterion) {
    const parameters = publishedOf(criterion)
    if (!parameters)
      throw Object.assign(new Error('not a hidden criterion'), { code: 'keyring/hidden-vetter:noParameters' })
    const label = parameters.tokenLabels[0]
    const client = await connected(agent)
    const contextId = await contextOf(client)

    const record = await loadRecord(agent, communityDid)
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
    const answer = await askCommunity<{ label: string; tick: number; preCredentials: string[] }>(
      communityDid,
      VTC_VETTER_TASK.pcsTokens,
      { label, tick, requests: request.requests }
    )
    await client.pcsTokensAccept({
      contextId,
      community: communityDid,
      parameters,
      response: { label: answer.label, tick: answer.tick, preCredentials: answer.preCredentials },
    })
    await saveRecord(agent, { community: communityDid, lastDrawAt: nowIso(), lastTick: tick })
    return { drawn: answer.preCredentials?.length ?? 0 }
  },

  async requests(agent, communityDid): Promise<HiddenVetterRequest[]> {
    // The desk marks a request private when it arrives carrying the
    // hidden-vetting ext, so the queue is its own and never a filter over the
    // named one.
    const desk = await deskFor(agent, communityDid)
    const open = await desk.hiddenRequests(communityDid)
    return open.map((r) => ({
      id: r.requestId,
      applicantDid: r.applicantDid,
      receivedAt: r.receivedAt,
      ...(r.preferredMethod ? { method: r.preferredMethod } : {}),
      // No applicantName: the desk holds none, and inventing one from a DID
      // would be worse than the screen saying nothing.
    }))
  },

  async attest(agent, requestId, statement: HiddenVetterStatement) {
    const communityDid = await communityOfRequest(agent, requestId)
    const desk = await deskFor(agent, communityDid)
    const criterion = await hiddenCriterionOf(agent, communityDid)
    const parameters = publishedOf(criterion)
    if (!parameters) {
      throw Object.assign(new Error('this community no longer publishes hidden vetting'), {
        code: 'keyring/hidden-vetter/attest:noParameters',
      })
    }

    const client = await connected(agent)
    const contextId = await contextOf(client)

    await desk.attestHidden(requestId, statement, async ({ applicantId, meta }) => {
      // The digest the applicant's proof will bind to is the one their
      // application gathered for, which is what the desk puts in `meta`. If
      // the community has since changed the criterion, that proof cannot
      // verify — so attesting would spend one of this vetter's scarce tokens
      // on an application that is already dead. Refuse instead, and say which.
      const current = criterion.requirementsDigest
      if (current && meta.requirementsDigest && current !== meta.requirementsDigest) {
        throw Object.assign(new Error('the community changed what it asks since this application was made'), {
          code: 'keyring/hidden-vetter/attest:requirementsChanged',
        })
      }
      return client.pcsAttest({ contextId, community: communityDid, parameters, applicantId, meta })
    })
  },

  async decline(agent, requestId) {
    const desk = await deskFor(agent, await communityOfRequest(agent, requestId))
    await desk.decline(requestId)
  },
}

registerHiddenVetter(seam)

export { seam as hiddenVetterSeamImplementation }
