/**
 * hiddenVettingSeam — what the hidden-vetting screens ask of the module that
 * carries hidden (private) vetting through the person's agent
 * (module/hiddenVetting.ts: the agent holds the keys and builds every proof;
 * the app carries messages). The screens never call that module directly:
 * it registers itself here, and a build without it registers nothing, so
 * every private way fails closed as before (#405, IN-264).
 *
 * @module trust-tasks/screens/hiddenVettingSeam
 */

import type { Agent } from '@credo-ts/core'

import type { VtiCriterion } from '../module/joinManifest'

/**
 * Why this person cannot apply with private vetting, in order of precedence:
 * the first that holds is said. `noAgent`: no agent is linked at all, which
 * is not a matter of permissions. `agentTooOld` before `phoneNotAllowed`: an
 * agent before vta-service 0.60 cannot grant it, so updating is the step.
 * `cannotTell`: the agent could not be asked, or its answer settled nothing;
 * never said as a cause.
 */
export type HiddenVettingRefusal = 'suiteUnsupported' | 'noAgent' | 'agentTooOld' | 'phoneNotAllowed' | 'cannotTell'

export type HiddenVettingCheck = { ok: true } | { ok: false; reason: HiddenVettingRefusal; detail?: string }

/** An application the agent holds, as the screens keep it to come back to. */
export interface HiddenVettingRecord {
  applicationId: string
  pcsId?: string
  communityDid: string
  criterionId?: string
  /** The way in's digest when the application was made: the proof is bound to it, so a changed way needs a new application. */
  requirementsDigest?: string
  createdAt?: string
}

/** How far it has got. No vetter identity: that is what hidden vetting keeps from the community, and from this screen. */
export interface HiddenVettingProgress {
  /** The community's threshold, from the criterion. */
  needed: number
  /** Attestations the agent verified and keeps. A refused one never enters the list. */
  verified: number
  /** Each one, when the agent lists them; a count alone is enough. */
  attestations?: { tokenLabel?: string; validFrom?: string; validUntil?: string }[]
}

/** What the community decided, as the join submission answers it (the same as a named application). */
export type HiddenVettingVerdict = { effect: string; [key: string]: unknown }

export interface HiddenVettingSeam {
  /** Whether this person's agent can run it. Only ever on the person's tap: it may push a consent request. */
  check(agent: Agent, criterion: VtiCriterion): Promise<HiddenVettingCheck>
  /** The application kept for this community, if one is open. */
  record(agent: Agent, communityDid: string): Promise<HiddenVettingRecord | undefined>
  createApplication(agent: Agent, communityDid: string, criterion: VtiCriterion): Promise<HiddenVettingRecord>
  progress(agent: Agent, record: HiddenVettingRecord, needed: number): Promise<HiddenVettingProgress>
  /** Ask a vetter, as `VtiApplicant.requestVetter` takes it; the module adds the hidden-vetting member. */
  requestVetting(
    agent: Agent,
    record: HiddenVettingRecord,
    request: { link?: string; vetterDid?: string; code?: string; method?: string }
  ): Promise<void>
  /** A single-use challenge from the community, for one proof. */
  fetchChallenge(
    agent: Agent,
    record: HiddenVettingRecord,
    criterion: VtiCriterion
  ): Promise<{ challenge: string; expiresAt?: string }>
  /**
   * The agent builds the proof (slow by design: up to about 90 s). Throws a
   * PcsTaskError: `vta/pcs/prove:noUsableAttestation` while not enough vetters
   * have attested yet.
   */
  prove(agent: Agent, record: HiddenVettingRecord, criterion: VtiCriterion, challenge: string): Promise<unknown>
  /** Send the application with the proof and no vetting statements; the community's verdict. */
  submitJoin(
    agent: Agent,
    record: HiddenVettingRecord,
    criterion: VtiCriterion,
    proof: unknown
  ): Promise<HiddenVettingVerdict>
  deleteApplication(agent: Agent, record: HiddenVettingRecord): Promise<void>
}

let registered: HiddenVettingSeam | undefined

/** The hidden-vetting module registers itself; a test registers a fake. `undefined` takes it away. */
export function registerHiddenVetting(seam: HiddenVettingSeam | undefined): void {
  registered = seam
}

/** The registered module, or undefined in a build that does not carry hidden vetting. */
export function hiddenVettingSeam(): HiddenVettingSeam | undefined {
  return registered
}

/**
 * A trust-task error's `code` (`vta/pcs/prove:noUsableAttestation`, …), however
 * the module carries it: on the error itself, or inside the trust-task-error
 * document it wraps (`payload.code`, or `document.payload.code`).
 */
export function pcsErrorCode(error: unknown): string | undefined {
  const e = error as
    | { code?: unknown; payload?: { code?: unknown }; document?: { payload?: { code?: unknown } } }
    | undefined
  const code = e?.code ?? e?.payload?.code ?? e?.document?.payload?.code
  return typeof code === 'string' ? code : undefined
}
