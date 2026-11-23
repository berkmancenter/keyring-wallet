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
import { GenericRecordsIdentityStore, type VtiPersona } from './VtiIdentityStore'
import { getKeyed, putKeyed } from './keyedRecords'
import { PCS_VETTER_ERROR, VTC_VETTER_TASK, type PublishedConfig, type VetterStanding } from './pcsVetterTasks'
import { HIDDEN_VETTING_EXT, type VtiCriterion } from './joinManifest'
import { parametersToSend, pcsErrorCode } from './pcsVtaPayloads'
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
  /**
   * The last tick served, per token label. Ticks are the community's own
   * windows of the label (tick 0 begins at 00:00Z on the label's first day),
   * so this compares with the community's count directly. An older record's
   * `lastTick` counted from the phone's first draw and is not read.
   */
  lastTicks?: Record<string, number>
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

/** The tick length a community that publishes none is taken to mean (vtc-service, openvtc: `P3D`). */
const DEFAULT_TICK_MS = 3 * 86400 * 1000

/** At most this many owed ticks are drawn in one round; the next round draws the rest. */
export const MAX_DRAWS_PER_ROUND = 12

/**
 * The monthly token label to draw under at `now`, and when its tick 0 began:
 * the one covering `now`, else the newest published one that has begun, marked
 * `stale`. A community's labels never advance on their own, and it goes on
 * serving a live label past its month (vtc-service `drip`, `current_tick`), so
 * a month nobody rolled to is still drawn. Undefined when no published label
 * has begun: a month still to come is never asked for, and none is made up.
 * openvtc's `current_month_label` stops at the month's end; this does not.
 */
export function monthLabelAt(
  tokenLabels: string[],
  now: number
): { label: string; start: number; stale?: true } | undefined {
  let newest: { label: string; start: number; stale: true } | undefined
  for (const label of tokenLabels) {
    const m = /^token\/(\d{4})-(\d{2})$/.exec(label)
    if (!m) continue
    const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)
    const end = Date.UTC(Number(m[1]), Number(m[2]), 1)
    if (start <= now && now < end) return { label, start }
    if (start <= now && (!newest || start > newest.start)) newest = { label, start, stale: true }
  }
  return newest
}

/**
 * The next tick of a label owed to this vetter: one after the last served, or
 * tick 0, as long as it has begun. A tick that has begun and was not served —
 * the phone was off, or never drew — is still owed and asked for oldest first;
 * one that has not begun is refused (`tickNotYet`), so it is never asked for.
 * A recorded tick later than the current one belongs to no tick of this label
 * and is read as nothing served. openvtc's `next_tick`.
 */
export function nextOwedTick(start: number, tickMs: number, last: number | undefined, now: number): number | undefined {
  if (now < start) return undefined
  const current = Math.floor((now - start) / tickMs)
  const next = last !== undefined && last <= current ? last + 1 : 0
  return next <= current ? next : undefined
}

/** When the tick after the current one opens: the next time this vetter is owed a draw. */
export function nextTickOpensAt(parameters: PublishedConfig, now: number): string | undefined {
  const month = monthLabelAt(parameters.tokenLabels ?? [], now)
  if (!month) return undefined
  const tickMs = tickMillis(parameters.tickLength) ?? DEFAULT_TICK_MS
  const current = Math.floor((now - month.start) / tickMs)
  return new Date(month.start + (current + 1) * tickMs).toISOString()
}

/**
 * The DID the community's vetter tasks are signed with, which is the DID the
 * agent must bind into its token openings.
 *
 * The community checks every opening proof against the DID that signed the
 * `pcs-tokens` request (openvtc's `vetter_start`: a snapshot "built under any
 * other name draws tokens the community refuses, and the refusal says nothing
 * about why"). `askCommunity` sends through `vtiAgent`, so that session's DID
 * is the signer. Build 259 passed the phone's identity at its own VTA
 * (`client.managerDid`) instead: enrolment, which does not check the binding,
 * went through, and every draw was refused `badOpeningProof`.
 *
 * Read inside `asVetter`, which signs the session in as the vetter's persona
 * and keeps it so, and checked against that persona: the session is shared,
 * and anything else may hold it. 277, a vetter's phone: the session changed
 * hands between two personas every 10 to 20 s, and a round that read it in
 * the middle of a sign-in found no DID at all.
 */
function signerDid(persona: Pick<VtiPersona, 'did'>): string {
  const did = vtiAgent.did
  if (!did || did !== persona.did)
    throw Object.assign(new Error('not signed in to the community'), { code: 'keyring/hidden-vetter:noIdentity' })
  return did
}

/** This phone's persona for a community: the one identity it vets as there. */
async function vetterPersona(agent: Agent, communityDid: string): Promise<VtiPersona> {
  const persona = await new GenericRecordsIdentityStore(agent).getPersona(communityDid)
  if (!persona) throw noPersona('no persona for this community')
  return persona
}

const noPersona = (message: string) => Object.assign(new Error(message), { code: 'keyring/hidden-vetter:noPersona' })

/** The persona each community's rounds are held as now, and how many holds share it. */
const heldVetters = new Map<string, { persona: VtiPersona; holds: number }>()

/**
 * Run a round as the vetter's persona for `communityDid`: the shared session
 * is signed in as it, waiting for any sign-in already running, and nothing
 * else signs it in as another identity until the round is done.
 *
 * Each round below takes this itself, so a screen's single step holds the
 * session. A caller running several in a row (the desk) takes it once around
 * them all, naming its persona: holds for one DID share the session, so the
 * rounds inside run in the caller's hold, and nothing can switch the session
 * between them.
 *
 * A round inside a hold uses the held persona, never a fresh read of the
 * store. The store's answer can change between two reads (a repaired record
 * is rewritten on the next `ensurePersona`), and a hold for another DID inside
 * this one would wait for this one to end, which it cannot while it waits. A
 * persona named here that differs from the held one is refused at once, for
 * the same reason.
 */
export async function asVetter<T>(
  agent: Agent,
  communityDid: string,
  round: (persona: VtiPersona) => Promise<T>,
  named?: VtiPersona
): Promise<T> {
  const held = () => heldVetters.get(communityDid)?.persona
  const mismatch = (p: VtiPersona) => {
    const h = held()
    if (h && h.did !== p.did) throw noPersona("this community is held as another of this phone's identities")
  }
  if (named) mismatch(named)
  const read = held() ?? named ?? (await vetterPersona(agent, communityDid))
  // Read again after the store: a hold may have been taken while it answered.
  const persona = held() ?? read
  if (named) mismatch(named)
  const entry = heldVetters.get(communityDid) ?? { persona, holds: 0 }
  entry.holds++
  heldVetters.set(communityDid, entry)
  try {
    return await vtiAgent.holding(agent, undefined, persona, () => round(persona), { reason: 'a step' })
  } finally {
    if (--entry.holds === 0 && heldVetters.get(communityDid) === entry) heldVetters.delete(communityDid)
  }
}

/**
 * The agent's engine for this community draws as another DID than the one
 * this phone signs with, and that cannot change.
 *
 * At vta-service 0.60 an engine is keyed by context and community and keeps
 * the member DID of its first `root-request`; a request naming another is
 * refused (`MemberMismatch`, not retryable), and no task deletes or resets
 * an engine. Builds before 260 enrolled under the phone's identity at its
 * VTA, so an agent they enrolled can never draw for that community from that
 * context: the community would refuse every opening it makes. So nothing is
 * sent — not a re-enrolment the agent refuses, not a draw the community
 * refuses — and the person is told it plainly.
 */
const memberMismatch = (bound: string) =>
  Object.assign(
    new Error(
      'this agent was enrolled for private vetting in this community under another identity, which cannot be changed'
    ),
    { code: 'keyring/hidden-vetter:memberMismatch', bound }
  )

/**
 * Whether the agent's engine for a community draws as another DID than this
 * phone's persona there. The persona, not whoever holds the shared session:
 * while another identity holds it, every engine would read as bound elsewhere.
 */
export const boundElsewhere = (
  vetter: { memberDid?: string } | undefined,
  persona: Pick<VtiPersona, 'did'> | undefined
): boolean => Boolean(vetter?.memberDid && vetter.memberDid !== persona?.did)

/**
 * The agent's engine for this community, or undefined when it has none yet.
 *
 * `vta/pcs/vetter/show` answers a fresh agent — never enrolled here — with
 * `vta/pcs/vetter/show:notFound` ("no such engine"), and `root-request` is
 * what creates the engine (vta-service 0.60, `operations/pcs.rs`: "creating
 * the vetter engine on first use"). So notFound is the state a first
 * enrolment starts from, not a failure. Build 261 let it throw: the desk's
 * round stopped at `isEnrolled`, and a new vetter never reached `root-request`.
 * Every other refusal still throws.
 *
 * Any `notFound` answer to **this** task is read as "no engine", not only the
 * fully qualified `vta/pcs/vetter/show:notFound` an 0.60 agent sends. Matching
 * the one exact string would put us back in build 261 against an agent that
 * answers a bare `notFound` or prefixes it differently, and the question here
 * is not which spelling arrived — a `notFound` in reply to "show me this
 * vetter's engine" means there is none either way. The applicant's own read of
 * `applications/show` has always done it this way (`refreshHiddenApplication`).
 */
async function engineOf(client: VtaClient, contextId: string, community: string): Promise<VetterStanding | undefined> {
  try {
    return await client.showPcsVetter({ contextId, community })
  } catch (e) {
    const raw = (e as { code?: unknown })?.code
    const code =
      (typeof raw === 'string' ? raw : undefined) ??
      pcsErrorCode((e as { document?: unknown })?.document ?? e) ??
      undefined
    if (code === PCS_VETTER_ERROR.vetterNotFound || code === 'notFound' || code?.endsWith(':notFound')) return undefined
    throw e
  }
}

/**
 * Whether the agent holds a vetter credential for the period `criterion`
 * publishes now, **as the DID this phone signs with**. An engine bound to
 * another DID is not enrolled for this purpose: it can enrol, but every draw
 * it makes is refused.
 */
export async function isEnrolled(agent: Agent, communityDid: string, criterion: VtiCriterion): Promise<boolean> {
  const period = publishedOf(criterion)?.vetterLabels?.[0]
  if (!period) return false
  return asVetter(agent, communityDid, async (persona) => {
    const client = await connectedVetterClient(agent)
    const contextId = await vetterContextOf(client)
    const vetter = await engineOf(client, contextId, communityDid)
    if (vetter?.memberDid && vetter.memberDid !== signerDid(persona)) return false
    return Boolean(vetter?.enrolledLabels?.includes(period))
  })
}

/** Enrol for the period the criterion publishes now: agent blinds, community signs, agent unblinds. */
export async function enrolVetter(agent: Agent, communityDid: string, criterion: VtiCriterion): Promise<void> {
  const parameters = publishedOf(criterion)
  if (!parameters)
    throw Object.assign(new Error('not a hidden criterion'), { code: 'keyring/hidden-vetter:noParameters' })
  const label = parameters.vetterLabels[0]
  if (!label) throw Object.assign(new Error('no vetter label published'), { code: PCS_VETTER_ERROR.rootLabelNotLive })

  return asVetter(agent, communityDid, async (persona) => {
    const client = await connectedVetterClient(agent)
    const contextId = await vetterContextOf(client)
    const memberDid = signerDid(persona)
    const before = await engineOf(client, contextId, communityDid)
    if (before?.memberDid && before.memberDid !== memberDid) throw memberMismatch(before.memberDid)

    // 1 — the agent blinds a request. Only it can: it holds the key. What it
    // answers is the community's payload, whole.
    const request = await client.pcsRootRequest({ contextId, community: communityDid, memberDid, parameters, label })
    // A community binds a member to the PCS identifier of their first enrolment
    // and refuses any other (`pcs-root:identifierRebound`); the same identifier
    // under the same label is re-issued. So a re-enrolment that would carry a
    // new identifier is not sent: it cannot succeed.
    if (before?.id && request.id !== before.id) throw memberMismatch(before.memberDid ?? memberDid)
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
  })
}

const servedCode = 'vtc/vetting/vetters/pcs-tokens:alreadyServed'
const notYetCode = 'vtc/vetting/vetters/pcs-tokens:tickNotYet'

/**
 * Draw every tick of the current month's label this vetter is owed, oldest
 * first and at most `dripPerTick` each: agent blinds, community signs, agent
 * unblinds, per tick.
 *
 * On the schedule, not on demand (openvtc's `due`): which ticks are owed comes
 * from the clock and the label, never from how many tokens are left — drawing
 * when low would make a vetter's balance a public signal of how much they had
 * vetted. Right after enrolment that is ticks 0 to the current one, so a
 * vetter enrolled mid-month can vouch at once.
 */
export async function drawVetterTokens(
  agent: Agent,
  communityDid: string,
  criterion: VtiCriterion
): Promise<{ drawn: number }> {
  const parameters = publishedOf(criterion)
  if (!parameters)
    throw Object.assign(new Error('not a hidden criterion'), { code: 'keyring/hidden-vetter:noParameters' })
  const now = nowMs()
  const month = monthLabelAt(parameters.tokenLabels ?? [], now)
  if (!month || month.stale) {
    const missing = `token/${new Date(now).toISOString().slice(0, 7)}`
    agent.config?.logger?.warn?.(
      `[hidden-vetting] ${missing} is not published: ${month ? `drawing under ${month.label}` : 'no label to draw under'}`
    )
  }
  if (!month) throw Object.assign(new Error('no token label has begun'), { code: PCS_VETTER_ERROR.tokensLabelNotLive })
  const tickMs = tickMillis(parameters.tickLength) ?? DEFAULT_TICK_MS
  const record = await loadVetterRecord(agent, communityDid)
  const lastTicks = { ...(record?.lastTicks ?? {}) }
  if (nextOwedTick(month.start, tickMs, lastTicks[month.label], nowMs()) === undefined) return { drawn: 0 }

  return asVetter(agent, communityDid, async (persona) => {
    const client = await connectedVetterClient(agent)
    const contextId = await vetterContextOf(client)
    // Never draw from an engine bound to another DID: the community refuses
    // every opening it makes.
    const vetter = await engineOf(client, contextId, communityDid)
    if (vetter?.memberDid && vetter.memberDid !== signerDid(persona)) throw memberMismatch(vetter.memberDid)

    let drawn = 0
    const served = async (tick: number) => {
      lastTicks[month.label] = tick
      await saveVetterRecord(agent, { community: communityDid, lastDrawAt: nowIso(), lastTicks })
    }
    for (let i = 0; i < MAX_DRAWS_PER_ROUND; i++) {
      const tick = nextOwedTick(month.start, tickMs, lastTicks[month.label], nowMs())
      if (tick === undefined) break
      const request = await client.pcsTokensRequest({
        contextId,
        community: communityDid,
        parameters,
        label: month.label,
        tick,
        // Never more than the published drip: the agent refuses countExceedsDrip,
        // and asking for more than a community allows is not the phone's call.
        count: parameters.dripPerTick,
      })
      // Carried as the agent built it. A refusal gives up the draw the agent
      // holds open for it, or the next draw of that tick would be refused as
      // one already in flight.
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
        const code = (refused as { code?: string })?.code ?? ''
        // Served before — an answer this phone lost: done, and on to the next.
        if (code === servedCode || code.endsWith(':alreadyServed')) {
          await served(tick)
          continue
        }
        // The community's clock is behind this phone's: wait for the next round.
        if (code === notYetCode || code.endsWith(':tickNotYet')) break
        throw refused
      }
      await client.pcsTokensAccept({
        contextId,
        community: communityDid,
        parameters,
        response: { label: answer.label, tick: answer.tick, preCredentials: answer.preCredentials },
      })
      await served(tick)
      drawn += answer.preCredentials?.length ?? 0
    }
    return { drawn }
  })
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
