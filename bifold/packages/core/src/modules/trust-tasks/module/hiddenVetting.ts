/**
 * Applying to a community that hides which of its vetters attested.
 *
 * The ceremony is unchanged: the same ticket, the same session, the same match
 * code read aloud, the same Vetting Card. Two things differ —
 *
 * 1. a voucher returns an **anonymous attestation** rather than a statement
 *    naming itself, and those accumulate against an application;
 * 2. at submission the applicant sends **one proof** over what is held, and the
 *    community counts distinct vouchers from the proof.
 *
 * **The proof is built by the user's VTA, not by this phone** (the parent plan's
 * D4, and `keyring_implementation_subtask.md` §0): the agent derives a
 * per-application PCS key, holds it, verifies each attestation and builds the
 * proof. This module is Keyring's part — which steps are dispatched in what
 * order, the small record that lets a half-finished application be found again,
 * and what a screen may honestly say about progress.
 *
 * Nothing cryptographic happens here, and **no attestation is stored on the
 * device**: the agent is the source of truth, and `refreshHiddenApplication`
 * re-reads it rather than rebuilding local state. The earlier phone-side prover
 * (`@bifold/react-native-pcs`, on `feat/hidden-vetting-mode`) is parked, not
 * deleted — §0.2 says why, and the measured rungs are kept as evidence in case
 * upstream later accepts a device-built proof.
 *
 * @module trust-tasks/module/hiddenVetting
 */
import type { Agent } from '@credo-ts/core'

import type { VtaClient } from './VtaClient'
import { getKeyed, putKeyed, withKeyLock } from './keyedRecords'
import {
  HIDDEN_VETTING_SUITE,
  PCS_ERROR,
  type HiddenAttestation,
  type PcsApplication,
  type PublishedConfig,
  parametersToSend,
  pcsErrorCode,
} from './pcsVtaPayloads'

const RECORD_TYPE = 'keyring/hidden-vetting'
const KIND = 'application'

/** The scope an identity needs at the agent to run the applicant's round. */
const APPLICANT_SCOPE = 'pcs-applicant'

/**
 * Why a hidden criterion cannot be used, when it cannot.
 *
 * Codes, not sentences: the wording is UI/UX's. Precedence is suite, then agent
 * version, then capability (§0.1) — `pcs-applicant` cannot exist on a pre-0.60
 * agent, so "update your agent" is the step that actually unblocks, and saying
 * "this phone is not allowed" first would send the person to the wrong place.
 */
export type HiddenVettingBlock =
  | 'suiteUnsupported'
  | 'agentTooOld'
  | 'phoneNotAllowed'
  /** The agent could not be asked at all — unreachable, or it refused the probe. */
  | 'cannotTell'

export type HiddenVettingUsable =
  | { usable: true; parameters: PublishedConfig }
  | { usable: false; because: HiddenVettingBlock }

/**
 * Whether this build, this agent and this phone can run the applicant's round
 * for what a community published.
 *
 * **Call this only after the person has tapped to join.** Every dispatched
 * Trust Task passes the agent's policy gate, reads included, and a gated task
 * is not merely refused: the VTA pushes a signed `task-consent/request` to each
 * approver through the mediator (`trust_tasks/consent_request.rs`, read at
 * `vta-service-v0.60.0`). Probing to decorate a list would therefore wake an
 * approver — who may not be this user — because a screen rendered. After a tap
 * it is a prompt belonging to an action the person took. §0.1, and there is a
 * regression test that rendering the join ways dispatches nothing.
 */
export async function hiddenVettingUsable(client: VtaClient, published: unknown): Promise<HiddenVettingUsable> {
  // The suite first, because it costs nothing and asks the agent nothing.
  const parameters = parametersToSend(published)
  if (!parameters) return { usable: false, because: 'suiteUnsupported' }

  const serves = await client.servesPcs()
  if (serves === false) return { usable: false, because: 'agentTooOld' }
  if (serves === undefined) return { usable: false, because: 'cannotTell' }

  const mine = client.managerDid
  if (!mine) return { usable: false, because: 'cannotTell' }
  let entries
  try {
    entries = await client.listAcl()
  } catch {
    return { usable: false, because: 'cannotTell' }
  }
  // An entry naming no scopes is unrestricted (the same reading `grantAdmin`
  // documents); otherwise the scope has to be there by name.
  const allowed = entries.some(
    (entry) => entry.subject === mine && (entry.scopes === undefined || entry.scopes.includes(APPLICANT_SCOPE))
  )
  return allowed ? { usable: true, parameters } : { usable: false, because: 'phoneNotAllowed' }
}

/**
 * What this phone keeps about an application in progress.
 *
 * Deliberately small: an identifier to re-read the agent's copy by, what the
 * proof will be bound to, and a count to show. **No key, no attestation, no
 * proof** — those are the agent's, and a device that loses this record loses
 * nothing that cannot be re-read.
 */
export interface HiddenVettingRecord {
  community: string
  /** The DID the join submission will be signed with; the proof is bound to it. */
  joinDid: string
  applicationId: string
  /** The applicant's PCS identifier, carried to vetters in a request's `ext`. */
  id?: string
  /**
   * The criterion's requirements digest, from the join manifest. Kept because
   * `vta/pcs/prove` needs it at submission, which may be days after the
   * manifest was read — and a digest read from a manifest fetched later is a
   * different criterion, not a refresh.
   */
  requirementsDigest: string
  /** The community's published parameters, as sent to the agent. */
  parameters: PublishedConfig
  /** Attestations the agent reports holding. Not what will be counted. */
  held: number
  /** The minimum the community published for this criterion. */
  minimum: number
}

/**
 * What a screen may say about progress.
 *
 * Compare `VtiApplicant.checklist()`, which returns `counted`, `discounted`,
 * `independenceOk` and `exceededCaps`. **None of those has a meaning here
 * before the community answers**, and they are absent rather than zero on
 * purpose: a zero renders as "none counted", which is a claim this phone cannot
 * make. `ref-27` measured why — the engine accepts a duplicate attestation,
 * builds a proof from it, and the community counts it once.
 */
export interface HiddenProgress {
  /** Always `hidden`, so a renderer cannot confuse this with the named shape. */
  mode: 'hidden'
  /** Attestations the agent holds. **Not** what will be counted. */
  held: number
  minimum: number
  /** Distinct vouchers the community counted. Absent until it has answered. */
  counted?: number
  /** What the community says is still required. Absent until it has answered. */
  stillNeeds?: number
  /**
   * Enough is held to be worth submitting. **Optimistic only**: the client may
   * be optimistic where the community is not, never the reverse. It is not
   * "you will be admitted".
   */
  worthSubmitting: boolean
}

/** The progress a record implies, with a community's verdict folded in if one has arrived. */
export function hiddenProgress(
  record: Pick<HiddenVettingRecord, 'held' | 'minimum'>,
  verdict?: { counted?: number; stillNeeds?: number }
): HiddenProgress {
  return {
    mode: 'hidden',
    held: record.held,
    minimum: record.minimum,
    worthSubmitting: record.held >= record.minimum,
    ...(typeof verdict?.counted === 'number' ? { counted: verdict.counted } : {}),
    ...(typeof verdict?.stillNeeds === 'number' ? { stillNeeds: verdict.stillNeeds } : {}),
  }
}

/** Attestations the agent reports on an application, or 0 when it reports none. */
function heldOf(application: PcsApplication | undefined): number {
  return Array.isArray(application?.attestations) ? application.attestations.length : 0
}

export function loadHiddenVettingRecord(agent: Agent, community: string): Promise<HiddenVettingRecord | undefined> {
  return getKeyed<HiddenVettingRecord>(agent, RECORD_TYPE, KIND, community)
}

function saveHiddenVettingRecord(agent: Agent, record: HiddenVettingRecord): Promise<void> {
  return putKeyed(agent, RECORD_TYPE, KIND, record.community, record as unknown as Record<string, unknown>)
}

/**
 * Step 2 — `vta/pcs/applications/create`. One application per join attempt,
 * before any vetter is asked.
 *
 * The agent mints the key for this application and this `joinDid`, so a change
 * of join identity is a new application, not a resumed one.
 */
export async function startHiddenApplication(
  agent: Agent,
  client: VtaClient,
  what: {
    contextId: string
    community: string
    joinDid: string
    requirementsDigest: string
    parameters: PublishedConfig
    minimum: number
  }
): Promise<HiddenVettingRecord> {
  const application = await client.createPcsApplication({
    contextId: what.contextId,
    community: what.community,
    joinDid: what.joinDid,
    parameters: what.parameters,
  })
  const record: HiddenVettingRecord = {
    community: what.community,
    joinDid: what.joinDid,
    applicationId: application.applicationId,
    id: application.id,
    requirementsDigest: what.requirementsDigest,
    parameters: what.parameters,
    held: heldOf(application),
    minimum: what.minimum,
  }
  await saveHiddenVettingRecord(agent, record)
  return record
}

/**
 * The recovery path — `vta/pcs/applications/show`. The agent is the source of
 * truth, so local state lost is re-read rather than rebuilt.
 *
 * Returns undefined when this phone holds no record for the community, and
 * `'gone'` when it holds one the agent does not: that is a real state (the
 * application was deleted, or it lives in a context this identity cannot act
 * in) and it is the caller's to surface, not this module's to paper over by
 * silently starting again.
 */
export async function refreshHiddenApplication(
  agent: Agent,
  client: VtaClient,
  community: string
): Promise<HiddenVettingRecord | 'gone' | undefined> {
  const record = await loadHiddenVettingRecord(agent, community)
  if (!record) return undefined
  let application: PcsApplication | undefined
  try {
    application = await client.showPcsApplication(record.applicationId)
  } catch (error) {
    const code = pcsErrorCode((error as { document?: unknown })?.document ?? error)
    if (code?.endsWith(':notFound') || code === 'notFound') return 'gone'
    throw error
  }
  if (!application) return 'gone'
  const updated = { ...record, id: application.id ?? record.id, held: heldOf(application) }
  await saveHiddenVettingRecord(agent, updated)
  return updated
}

/**
 * Step 4 — `vta/pcs/verify-attestation`, once per attestation a voucher sends.
 *
 * The agent verifies it and keeps it; **this phone stores no attestation**, by
 * design. A refusal means the attestation is not usable — an old vetter,
 * another community, or a closed token label — and the caller decides what to
 * say; it is not this module's to swallow.
 */
export async function takeHiddenAttestation(
  agent: Agent,
  client: VtaClient,
  community: string,
  attestation: HiddenAttestation
): Promise<HiddenVettingRecord> {
  const record = await loadHiddenVettingRecord(agent, community)
  if (!record) throw new Error(`no hidden-vetting application is held for ${community}`)
  const application = await client.verifyPcsAttestation({
    applicationId: record.applicationId,
    parameters: record.parameters,
    attestation,
  })
  const updated = { ...record, id: application?.id ?? record.id, held: heldOf(application) }
  await saveHiddenVettingRecord(agent, updated)
  return updated
}

/** What `hiddenSubmissionExtensions` says when the agent has too little to prove from. */
export const NOT_ENOUGH_YET = 'notEnoughYet' as const

/**
 * Step 6 and 7 — `vta/pcs/prove`, and the `extensions` object for a
 * `vtc/join-requests/submit/0.3` request.
 *
 * `challenge` comes from `vtc/vetting/pcs-challenge/0.1`. A community holds at
 * most one open challenge per applicant and **replaces** it when asked again,
 * so asking for a second invalidates any proof built on the first: fetch the
 * challenge immediately before proving, and if it has lapsed, ask again and
 * prove again rather than retrying the send.
 *
 * `prove:noUsableAttestation` is a **progress state, not a failure** — the
 * agent has too few valid attestations yet — so it comes back as
 * `NOT_ENOUGH_YET` rather than as a thrown error, because a screen must word it
 * as "keep going", not "something went wrong".
 */
export async function hiddenSubmissionExtensions(
  agent: Agent,
  client: VtaClient,
  community: string,
  challenge: string
): Promise<{ hiddenVetting: Record<string, unknown> } | typeof NOT_ENOUGH_YET> {
  const record = await loadHiddenVettingRecord(agent, community)
  if (!record) throw new Error(`no hidden-vetting application is held for ${community}`)
  try {
    const hiddenVetting = await client.provePcs({
      applicationId: record.applicationId,
      parameters: record.parameters,
      requirementsDigest: record.requirementsDigest,
      challenge,
    })
    return { hiddenVetting }
  } catch (error) {
    const code = pcsErrorCode((error as { document?: unknown })?.document ?? error)
    if (code === PCS_ERROR.noUsableAttestation) return NOT_ENOUGH_YET
    throw error
  }
}

/**
 * Step 8 — `vta/pcs/applications/delete`, once the join is decided, either way
 * it went. The agent drops the application's key path and its attestations.
 *
 * The local record goes whether or not the agent could be told, because keeping
 * it would offer the person a "resume" that cannot work; the agent's own copy
 * expires on its side. A delete that fails is logged, not thrown: a join that
 * has already been decided must not be left undismissable by a network error.
 */
export async function forgetHiddenApplication(agent: Agent, client: VtaClient, community: string): Promise<void> {
  const record = await loadHiddenVettingRecord(agent, community)
  if (record) {
    try {
      await client.deletePcsApplication(record.applicationId)
    } catch (error) {
      agent.config.logger.warn(
        `[hidden-vetting] could not delete application ${record.applicationId} at the agent; dropping the local record anyway`,
        { error }
      )
    }
  }
  await withKeyLock(`${RECORD_TYPE}|${KIND}|${community}`, async () => {
    const found = await agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE, kind: KIND, key: community })
    for (const one of found) await agent.genericRecords.delete(one)
  })
}

/**
 * The applicant's round, as a screen uses it.
 *
 * A seam rather than a direct import so that the vetting screen can be driven
 * by a fake in tests and by a demo profile, without this module reaching
 * towards the screen or the screen constructing a client. It is a plain
 * module-level registration, **not** a DI token: `modules/trust-tasks` has no
 * DI wiring today, and the subtask plan's D6 recommends a token only once a
 * second consumer exists, which it does not.
 */
export interface HiddenVettingSeam {
  usable: typeof hiddenVettingUsable
  start: typeof startHiddenApplication
  refresh: typeof refreshHiddenApplication
  take: typeof takeHiddenAttestation
  submissionExtensions: typeof hiddenSubmissionExtensions
  forget: typeof forgetHiddenApplication
  progress: typeof hiddenProgress
}

const theRealThing: HiddenVettingSeam = {
  usable: hiddenVettingUsable,
  start: startHiddenApplication,
  refresh: refreshHiddenApplication,
  take: takeHiddenAttestation,
  submissionExtensions: hiddenSubmissionExtensions,
  forget: forgetHiddenApplication,
  progress: hiddenProgress,
}

let installed: HiddenVettingSeam = theRealThing

/** Replace some or all of the round. Called with nothing, it restores the real one. */
export function registerHiddenVetting(seam?: Partial<HiddenVettingSeam>): void {
  installed = seam ? { ...theRealThing, ...seam } : theRealThing
}

/** The round as currently installed. */
export function hiddenVetting(): HiddenVettingSeam {
  return installed
}

/** Re-exported so a caller need not import the payload module to name the suite. */
export { HIDDEN_VETTING_SUITE }
