/**
 * The hidden-vetting module, as the screens ask for it.
 *
 * `screens/hiddenVettingSeam.ts` owns the contract; this file implements it
 * over {@link module/hiddenVetting}'s functions and registers itself at module
 * load. The screens never import the module, so a build that does not carry
 * hidden vetting registers nothing and every private way fails closed (#405).
 *
 * Two shapes meet here and they are not the same, which is the whole reason
 * this file exists rather than the screens calling the module directly:
 *
 * - the screens hold an `Agent` and a `VtiCriterion`; the module works with a
 *   connected {@link VtaClient} and the community's published parameters. The
 *   client is resolved the way the Developer screen's probe does — the public
 *   `vtaAgent.client(agent, vtaDid)` plus `connect()` — because that is the
 *   path proven to reach a real agent;
 * - the screens' record and progress are the UI's shapes. `needed` is passed
 *   through as given (the criterion's `minStatements`) and never recomputed
 *   here, so one place decides it.
 *
 * @module trust-tasks/module/hiddenVettingAdapter
 */
import type { Agent } from '@credo-ts/core'

import type {
  HiddenVettingCheck,
  HiddenVettingProgress,
  HiddenVettingRecord as SeamRecord,
  HiddenVettingSeam,
  HiddenVettingVerdict,
} from '../screens/hiddenVettingSeam'
import { registerHiddenVetting } from '../screens/hiddenVettingSeam'

import type { VtaClient } from './VtaClient'
import {
  forgetHiddenApplication,
  hiddenSubmissionExtensions,
  hiddenVettingUsable,
  loadHiddenVettingRecord,
  refreshHiddenApplication,
  startHiddenApplication,
  type HiddenVettingRecord as StoredRecord,
} from './hiddenVetting'
import type { VtiCriterion } from './joinManifest'
import { HIDDEN_VETTING_EXT } from './joinManifest'
import { vtaAgent } from './vtaAgent'
import { vtiAgent } from './vtiAgent'

/** The criterion's published hidden-vetting parameters, raw: a typed parse would drop members. */
function publishedOf(criterion: VtiCriterion): unknown {
  const vetting = (criterion as { vetting?: { ext?: Record<string, unknown> } }).vetting
  return vetting?.ext?.[HIDDEN_VETTING_EXT]
}

/** The criterion's threshold, when it carries one. */
function minimumOf(criterion: VtiCriterion): number {
  const vetting = (criterion as { vetting?: { minStatements?: unknown } }).vetting
  return typeof vetting?.minStatements === 'number' ? vetting.minStatements : 1
}

/**
 * A connected client for this phone's agent, or the refusal a screen words.
 *
 * `noAgent` is not a permission problem and is kept distinct from the rest:
 * there is nothing to ask until a phone is linked. A connect that fails is
 * `cannotTell` rather than a refusal — the agent may be asleep, and "we could
 * not ask" is not "you may not".
 */
async function connected(agent: Agent): Promise<{ client: VtaClient } | { refusal: HiddenVettingCheck }> {
  const vtaDid = vtaAgent.agentAddress()
  if (!vtaDid) return { refusal: { ok: false, reason: 'noAgent' } }
  try {
    const client = vtaAgent.client(agent, vtaDid)
    await client.connect()
    return { client }
  } catch (error) {
    return {
      refusal: { ok: false, reason: 'cannotTell', detail: error instanceof Error ? error.message : String(error) },
    }
  }
}

/** The stored record as the screens hold it. */
function toSeamRecord(stored: StoredRecord, criterionId?: string): SeamRecord {
  return {
    applicationId: stored.applicationId,
    communityDid: stored.community,
    ...(stored.id ? { pcsId: stored.id } : {}),
    ...(criterionId ? { criterionId } : {}),
    ...(stored.requirementsDigest ? { requirementsDigest: stored.requirementsDigest } : {}),
    createdAt: new Date().toISOString(),
  }
}

/**
 * A step this build does not carry yet.
 *
 * The code matters: the screens word a `:notImplemented` code as "this step
 * isn't in this build of Keyring yet", where a bare Error reads as "something
 * went wrong, try again in a moment" — and the person then retries something
 * that cannot work. 03 added the wording in #409 (ed02ae68).
 */
function notImplemented(step: string): Error {
  return Object.assign(new Error(`${step} is not in this build yet`), {
    code: `keyring/hidden-vetting/${step}:notImplemented`,
  })
}

const seam: HiddenVettingSeam = {
  async check(agent, criterion) {
    const found = await connected(agent)
    if ('refusal' in found) return found.refusal
    const answer = await hiddenVettingUsable(found.client, publishedOf(criterion))
    if (answer.usable) return { ok: true }
    return { ok: false, reason: answer.because }
  },

  async record(agent, communityDid) {
    const stored = await loadHiddenVettingRecord(agent, communityDid)
    return stored ? toSeamRecord(stored) : undefined
  },

  async createApplication(agent, communityDid, criterion) {
    const found = await connected(agent)
    if ('refusal' in found) {
      const reason = found.refusal.ok ? 'cannotTell' : found.refusal.reason
      throw Object.assign(new Error(`cannot reach the agent: ${reason}`), {
        code: `keyring/hidden-vetting/createApplication:${reason}`,
      })
    }
    const parameters = publishedOf(criterion)
    const usable = await hiddenVettingUsable(found.client, parameters)
    if (!usable.usable) throw new Error(`this agent cannot apply: ${usable.because}`)
    const contextId = (await found.client.listContexts().catch(() => []))[0]?.id ?? 'vta'
    const joinDid = found.client.managerDid
    if (!joinDid) throw new Error('the phone has no identity at its agent')
    const stored = await startHiddenApplication(agent, found.client, {
      contextId,
      community: communityDid,
      joinDid,
      // The digest the proof binds to, as the community published it — never
      // recomputed here: a proof must bind to what the applicant was shown.
      requirementsDigest: criterion.requirementsDigest ?? '',
      parameters: usable.parameters,
      minimum: minimumOf(criterion),
    })
    return toSeamRecord(stored, criterion.id)
  },

  async progress(agent, record, needed) {
    const found = await connected(agent)
    if ('refusal' in found) {
      // The agent is the source of truth for the count; without it, say what
      // is stored rather than invent a number.
      const stored = await loadHiddenVettingRecord(agent, record.communityDid)
      return { needed, verified: stored?.held ?? 0 }
    }
    const refreshed = await refreshHiddenApplication(agent, found.client, record.communityDid)
    if (refreshed === 'gone' || !refreshed) return { needed, verified: 0 }
    return { needed, verified: refreshed.held }
  },

  async requestVetting() {
    throw notImplemented('requestVetting')
  },

  async fetchChallenge(_agent, record, criterion) {
    // The community issues it, and **replaces** any it had open for this
    // applicant — so it is fetched immediately before proving and never
    // reused across attempts. `vtiAgent.fetchChallenge` also drops its own
    // answered hold for this task first, so a second call cannot be served a
    // challenge an earlier submit already spent.
    const answer = await vtiAgent.fetchChallenge(record.communityDid, { criterionId: criterion.id })
    return { challenge: answer.challenge, expiresAt: answer.expiresAt }
  },

  async prove(agent, record, _criterion, challenge) {
    const found = await connected(agent)
    if ('refusal' in found) {
      const reason = found.refusal.ok ? 'cannotTell' : found.refusal.reason
      throw Object.assign(new Error(`cannot reach the agent to prove: ${reason}`), {
        code: `keyring/hidden-vetting/prove:${reason}`,
      })
    }
    const answer = await hiddenSubmissionExtensions(agent, found.client, record.communityDid, challenge)
    if (answer === 'notEnoughYet') {
      // The screens read a code off the error; this is the progress state, not
      // a failure, and it must arrive as the code they key on.
      throw Object.assign(new Error('not enough attestations yet'), {
        code: 'vta/pcs/prove:noUsableAttestation',
      })
    }
    return answer.hiddenVetting
  },

  async submitJoin(agent, record, criterion, proof): Promise<HiddenVettingVerdict> {
    // The manifest is read again rather than remembered: a submission names
    // the criterion by the digest the community is serving now, and the join
    // wire version can move between gathering and submitting.
    const manifest = await vtiAgent.fetchManifest(record.communityDid, agent)
    const verdict = await vtiAgent.apply(record.communityDid, manifest, {
      requirementsDigest: criterion.requirementsDigest ?? record.requirementsDigest,
      // Verbatim: the agent built it, and the community verifies exactly what
      // the agent signed. The presentation carries no vetting statements —
      // `apply` strips them for a hidden submission, because naming vetters
      // beside a proof that hides them would defeat the point.
      hiddenVetting: proof as Record<string, unknown>,
    })
    return verdict as unknown as HiddenVettingVerdict
  },

  async deleteApplication(agent, record) {
    const found = await connected(agent)
    if ('refusal' in found) {
      // The agent cannot be told; the local record still goes, so a decided
      // join does not offer a resume that cannot work.
      await forgetHiddenApplication(agent, undefined as never, record.communityDid).catch(() => undefined)
      return
    }
    await forgetHiddenApplication(agent, found.client, record.communityDid)
  },
}

/** Registered at module load: importing the module is what makes the build carry hidden vetting. */
registerHiddenVetting(seam)

export { seam as hiddenVettingSeamImplementation }

export type { HiddenVettingProgress }
