/**
 * The witness ceremony on Trust Tasks — §9 step 5, wallet side.
 *
 * A witnessed relationship exchange nests one witness session PER PARTY as
 * its own thread inside the relationship exchange (parentThreadId → the
 * exchange; framework §4.9.2):
 *
 *   wallet → witness   witness/session { parties }          (thread = session id)
 *   witness → wallet   …#response { challenge, domain }     (proof REQUIRED)
 *   wallet → witness   witness/session/submit { vp }        (proof REQUIRED)
 *   witness → wallet   …#response { vwc, vwcDigestMultibase } (proof REQUIRED)
 *
 * The session REQUEST's id is the value the issued VWC carries as
 * `taskContext` (§4.9.1 — the innermost exchange that attests the
 * witnessing), and the VWC's `taskDigestMultibase` binds that document by
 * digest (§4.9.3) — an id is a name anyone can reuse on a counterfeit.
 *
 * Outcome evidence: the submit#response is retained with its proof by the
 * consume pipeline, retrievable via the session id
 * (TrustTasksService.getOutcomeEvidencePair) — the pair a VWC presentation
 * must ship.
 *
 * This half is the WALLET side. It activates only when an exchange runs
 * witnessed (`propose.payload.witnessed === true`), which stays off until
 * the witness-server speaks the dialect.
 */

import type { PredicateHandlingConfig } from '@bifold/dtg-vocab'
import { configure, loadAcceptList, loadSchemaStore, verify as verifyPredicate } from '@bifold/dtg-vocab'
import type { Agent } from '@credo-ts/core'
import { W3cCredentialRecord, utils } from '@credo-ts/core'
import { sha256 } from '@noble/hashes/sha2.js'
import * as submit from '@openvtc/trust-tasks/witness/session/submit/0.1/payload'
import * as session from '@openvtc/trust-tasks/witness/session/0.1/payload'

import {
  DeviceLocalityProvider,
  LOCALITY_EXT_NAMESPACE,
  LocalitySensorDirective,
  LocalityTranscript,
  transcriptDigestMultibase,
} from './deviceLocality'
import {
  digestBytesEqual,
  digestMultibase,
  jcsCanonicalize,
  signDocumentProof,
  taskDigestMultibase,
  verifyDocumentProof,
} from './documentProof'
import { WITNESS_VERIFIED_TAG } from '../vrc/utils/witnessCredentialUtils'

import { taskCitationOf } from './taskCitation'

const LOG_PREFIX = '[TrustTasks:Witness]'

// VSC migration (docs/plans/vsc-migration-plan.md §6 V3): D6 and D8, run
// here because this is where a VWC is received and either stored or
// refused, on both shapes (legacy WD02 `WitnessCredential`, and the new
// VSC/`dtg:witnessed` predicate form).
let acceptListConfig: PredicateHandlingConfig | undefined
function getAcceptListConfig(): PredicateHandlingConfig {
  // loadSchemaStore(): without it, witnessContext's named schema is never
  // loaded and verify() unconditionally rejects every witnessed credential
  // (see loadSchemaStore's own doc comment — found 2026-09-29).
  if (!acceptListConfig) acceptListConfig = configure(loadAcceptList(), loadSchemaStore())
  return acceptListConfig
}

/**
 * D6 (plan §3 D6, §3.2): whether this VWC's `credentialSubject.id` is the
 * referenced VRC's issuer, and whether the digest it carries matches that
 * VRC. Distinguishes three states, never collapsed into a boolean — cred-spec
 * C5: "a digest without the referenced credential to hand is an opaque hash,
 * not an identified edge", so a caller with no referenced VRC gets `checked:
 * false`, never a false `ok: true`.
 */
export interface SubjectBinding {
  checked: boolean
  ok: boolean
  reason?: string
}

function subjectOf(vwc: Record<string, unknown>): Record<string, unknown> | undefined {
  const cs = vwc.credentialSubject
  return (Array.isArray(cs) ? cs[0] : cs) as Record<string, unknown> | undefined
}

/** Legacy WD02 digest: sha256(JCS(the referenced VRC, PROOF INCLUDED)) — a different document than taskDigestMultibase covers (plan §3.1). Verification-only; the witness-server's own issuance-side equivalent is being deleted in V4, not ported here. */
function legacyVrcDigest(vrc: Record<string, unknown>): string {
  return (
    'sha256:' +
    Array.from(sha256(new TextEncoder().encode(jcsCanonicalize(vrc))), (b) => b.toString(16).padStart(2, '0')).join('')
  )
}

export function checkSubjectBinding(
  vwc: Record<string, unknown>,
  referencedVrc?: Record<string, unknown>
): SubjectBinding {
  if (!referencedVrc)
    return {
      checked: false,
      ok: false,
      reason: 'no referenced VRC available — opaque hash, not an identified edge (cred-spec C5)',
    }
  const subject = subjectOf(vwc)
  if (!subject?.id) return { checked: true, ok: false, reason: 'VWC carries no credentialSubject.id' }

  const issuer =
    typeof referencedVrc.issuer === 'string'
      ? referencedVrc.issuer
      : (referencedVrc.issuer as { id?: string } | undefined)?.id
  if (subject.id !== issuer) {
    return {
      checked: true,
      ok: false,
      reason: `credentialSubject.id (${subject.id}) is not the referenced VRC's issuer (${issuer})`,
    }
  }

  const object = subject.object as { digestMultibase?: string } | undefined
  if (object?.digestMultibase) {
    // New VSC shape (D3): digest excludes the referenced VRC's top-level proof.
    const ok = digestBytesEqual(object.digestMultibase, taskDigestMultibase(referencedVrc))
    return ok
      ? { checked: true, ok: true }
      : { checked: true, ok: false, reason: 'object.digestMultibase does not match the referenced VRC' }
  }

  const legacyDigest = subject.digest
  if (typeof legacyDigest === 'string') {
    // Legacy WD02 shape (D3): digest over the PROOFED VRC, sha256:hex — not
    // the same coverage as taskDigestMultibase, so compared with its own
    // encoding, not digestBytesEqual (which decodes a multibase multihash).
    const ok = legacyDigest === legacyVrcDigest(referencedVrc)
    return ok
      ? { checked: true, ok: true }
      : { checked: true, ok: false, reason: 'legacy digest does not match the referenced VRC' }
  }

  return { checked: true, ok: false, reason: 'VWC carries neither object.digestMultibase nor a legacy digest' }
}

/**
 * D8 (plan §3 D8): for a VSC-shaped VWC (carries `credentialSubject.predicate`),
 * rejection is the only conforming outcome for a predicate this wallet's
 * accept-list does not recognize. A legacy WD02 VWC has no predicate at all —
 * this check does not apply to it (`applicable: false`), not a pass.
 */
export interface PredicateAcceptance {
  applicable: boolean
  ok: boolean
  reason?: string
}

export function checkPredicateAcceptance(vwc: Record<string, unknown>): PredicateAcceptance {
  const subject = subjectOf(vwc)
  const predicate = subject?.predicate
  if (typeof predicate !== 'string') return { applicable: false, ok: true }
  const result = verifyPredicate(getAcceptListConfig(), vwc)
  return { applicable: true, ok: result.ok, reason: result.ok ? undefined : result.reason }
}

/**
 * issuerScope (cred-spec #68, merged 2026-09-28): REQUIRED, top-level, one of
 * pairwise/directed/public, on every DTG credential. "Verifiers MUST reject a
 * credential whose issuerScope is missing or invalid." The dtg:witnessed
 * profile's own stated minimum is `directed`. A legacy WD02 VWC predates this
 * property entirely -- this check does not apply to it (`applicable: false`),
 * not a pass, same convention as checkPredicateAcceptance above.
 */
const ISSUER_SCOPE_ORDER = ['pairwise', 'directed', 'public'] as const
type IssuerScope = (typeof ISSUER_SCOPE_ORDER)[number]

export interface IssuerScopeCheck {
  applicable: boolean
  ok: boolean
  reason?: string
}

export function checkIssuerScope(vwc: Record<string, unknown>, minimum: IssuerScope = 'directed'): IssuerScopeCheck {
  const subject = subjectOf(vwc)
  const predicate = subject?.predicate
  if (typeof predicate !== 'string') return { applicable: false, ok: true }

  const issuerScope = (vwc as { issuerScope?: unknown }).issuerScope
  if (typeof issuerScope !== 'string' || !ISSUER_SCOPE_ORDER.includes(issuerScope as IssuerScope)) {
    return { applicable: true, ok: false, reason: `issuerScope is missing or invalid: ${JSON.stringify(issuerScope)}` }
  }
  const declared = ISSUER_SCOPE_ORDER.indexOf(issuerScope as IssuerScope)
  const required = ISSUER_SCOPE_ORDER.indexOf(minimum)
  if (declared < required) {
    return {
      applicable: true,
      ok: false,
      reason: `issuerScope "${issuerScope}" is narrower than this profile's stated minimum "${minimum}"`,
    }
  }
  return { applicable: true, ok: true }
}

export interface WitnessSessionOutcome {
  /** The session document's id — the VWC's taskContext. */
  sessionId: string
  /** The issued Verifiable Witness Credential, as delivered. */
  vwc: Record<string, unknown>
  /** D6: whether the VWC is bound to a specific, identified edge (not just an opaque digest). */
  subjectBinding: SubjectBinding
  /** issuerScope (cred-spec #68): whether the VWC's issuerScope is present, valid, and at least the profile's stated minimum. */
  issuerScope: IssuerScopeCheck
  /** Present only when this session actually ran the locality leg (offered + a sensor directive arrived). */
  locality?: { transcriptProduced: boolean }
}

/**
 * Responses the ceremony awaits, keyed by ceremony thread id (= session id).
 * Inbound routing (ceremony.ts) resolves these when a witness response
 * arrives; the ceremony rejects on timeout.
 */
const pendingWitnessResponses = new Map<
  string,
  { expectedType: string; resolve: (doc: Record<string, unknown>) => void; timer: ReturnType<typeof setTimeout> }
>()

/** Route an inbound witness-leg response to its awaiting ceremony, if any. */
export function resolveWitnessResponse(document: Record<string, unknown>): boolean {
  const threadId = String(document.threadId ?? '')
  const waiter = pendingWitnessResponses.get(threadId)
  if (!waiter || waiter.expectedType !== document.type) return false
  pendingWitnessResponses.delete(threadId)
  clearTimeout(waiter.timer)
  waiter.resolve(document)
  return true
}

function awaitWitnessResponse(
  threadId: string,
  expectedType: string,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingWitnessResponses.delete(threadId)) {
        reject(new Error(`timed out awaiting ${expectedType}`))
      }
    }, timeoutMs)
    pendingWitnessResponses.set(threadId, { expectedType, resolve, timer })
  })
}

export interface RunWitnessSessionOptions {
  /** The wallet's connection to the witness. */
  witnessConnectionId: string
  /** The relationship exchange thread this ceremony nests under. */
  exchangeId: string
  /** The two relationship DIDs of the exchange being witnessed. */
  parties: [string, string]
  /** This party's relationship DID — signs the submit document. */
  myRelationshipDid: string
  /**
   * Build the signed Verifiable Presentation bound to {challenge, domain}.
   * Injected so the ceremony stays free of the VP/credential machinery
   * (the witnessed-vrc-manager owns that).
   */
  buildPresentation: (challenge: string, domain: string) => Promise<Record<string, unknown>>
  /**
   * The VRC this session is witnessing, signed — the same value the caller
   * already built before calling this (VSC migration plan §6 V3, D6). Its
   * absence is conforming (a witness ceremony can run before the VRC exists
   * yet in some flows); the resulting VWC is then only checkable as "an
   * opaque hash, not an identified edge" (cred-spec C5) — see
   * `WitnessSessionOutcome.subjectBinding`.
   */
  referencedVrc?: Record<string, unknown>
  /** Send a trust-task document on a connection (ceremony.ts provides this). */
  sendDocument: (agent: Agent, connectionId: string, document: Record<string, unknown>) => Promise<void>
  /** Retain a document (TrustTasksService.retain, bound by the caller). */
  retain: (document: Record<string, unknown>, role: 'request' | 'response') => Promise<unknown>
  timeoutMs?: number
  /**
   * Whether this party offers locality this session — the
   * `useLocalityConfirmation` preference (locality-plan.md §8.1). Omit
   * entirely to not participate in the `ext` protocol at all (distinct from
   * `false`, which explicitly declines and is recorded as such).
   */
  localityOffered?: boolean
  /** Runs the device's radio-side half once the sensor directive arrives. `ceremony.ts` passes `createDeviceLocalityProvider`'s result; when absent, no transcript is produced, as with `NullDeviceLocalityProvider`. */
  deviceLocalityProvider?: DeviceLocalityProvider
}

/**
 * Run this party's witness session to completion: open, receive the
 * challenge, submit the presentation, validate and store the VWC.
 * Throws on refusal, proof failure, or a VWC whose task binding is wrong.
 */
export async function runWitnessSession(
  agent: Agent,
  options: RunWitnessSessionOptions
): Promise<WitnessSessionOutcome> {
  const logger = agent.config.logger
  const timeoutMs = options.timeoutMs ?? 60_000
  const witnessConnection = await agent.modules.didcomm.connections.getById(options.witnessConnectionId)
  if (!witnessConnection.did || !witnessConnection.theirDid) {
    throw new Error('witness connection has no DIDs')
  }

  // ---- open the session (its own thread, nested in the exchange) ----------
  const sessionId = utils.uuid()
  const sessionPayload: Record<string, unknown> = { parties: options.parties }
  // Plan §6 table row 1: the party's locality capability and consent.
  // Omitted entirely (not `offered: false`) when `localityOffered` wasn't
  // passed at all — that's "this party isn't participating in the ext
  // protocol", distinct from an explicit decline.
  if (options.localityOffered !== undefined) {
    sessionPayload.ext = {
      [LOCALITY_EXT_NAMESPACE]: {
        locality: options.localityOffered
          ? { offered: true, methods: ['ble-challenge-response/0.1'] }
          : { offered: false, reason: 'declinedByHolder' },
      },
    }
  }
  const sessionDoc: Record<string, unknown> = {
    id: sessionId,
    type: session.TYPE_URI,
    threadId: sessionId,
    parentThreadId: options.exchangeId,
    issuer: witnessConnection.did,
    recipient: witnessConnection.theirDid,
    issuedAt: new Date().toISOString(),
    payload: sessionPayload,
  }
  await options.retain(sessionDoc, 'request')
  const challengePromise = awaitWitnessResponse(sessionId, `${session.TYPE_URI}#response`, timeoutMs)
  await options.sendDocument(agent, options.witnessConnectionId, sessionDoc)
  logger.info(`${LOG_PREFIX} session opened (${sessionId}) under exchange ${options.exchangeId}`)

  // ---- the challenge (proof REQUIRED — verify under the witness's DID) ----
  const challengeDoc = await challengePromise
  if (!(await verifyDocumentProof(agent, challengeDoc, witnessConnection.theirDid))) {
    throw new Error('session challenge proof did not verify under the witness DID')
  }
  const challengePayload = (challengeDoc as { payload?: { challenge?: string; domain?: string } }).payload
  if (!challengePayload?.challenge || !challengePayload.domain) {
    throw new Error('session challenge payload incomplete')
  }
  logger.info(`${LOG_PREFIX} challenge received (session ${sessionId})`)

  // ---- the radio phase, concurrent with VP assembly (plan §5.1) -----------
  // The sensor directive rides the SAME #response's ext (plan §6 table row
  // 2). If it's there and a real provider is configured, run the whole
  // advertise/GATT exchange now — the result is what gets attached to the
  // submit request below, and what item 10's cross-check verifies against
  // whatever the witness later claims to have observed.
  const directive = (challengeDoc as { payload?: { ext?: Record<string, { locality?: LocalitySensorDirective }> } })
    .payload?.ext?.[LOCALITY_EXT_NAMESPACE]?.locality
  let transcript: LocalityTranscript | null = null
  if (directive && options.deviceLocalityProvider) {
    transcript = await options.deviceLocalityProvider.respondToSensor({
      taskDigestMultibase: taskDigestMultibase(sessionDoc),
      challenge: challengePayload.challenge,
      directive,
    })
    logger.info(
      `${LOG_PREFIX} locality radio phase ${transcript ? 'produced a transcript' : 'did not complete'} (session ${sessionId})`
    )
  }

  // ---- submit the presentation bound to {challenge, domain} ---------------
  const vp = await options.buildPresentation(challengePayload.challenge, challengePayload.domain)
  const submitPayload: Record<string, unknown> = { vp }
  // Plan §6 table row 3: the device's half of the transcript.
  if (transcript) {
    submitPayload.ext = { [LOCALITY_EXT_NAMESPACE]: { locality: { transcript } } }
  }
  const submitDoc: Record<string, unknown> = {
    id: utils.uuid(),
    type: submit.TYPE_URI,
    threadId: sessionId,
    parentThreadId: options.exchangeId,
    issuer: witnessConnection.did,
    recipient: witnessConnection.theirDid,
    issuedAt: new Date().toISOString(),
    payload: submitPayload,
  }
  const signedSubmit = await signDocumentProof(agent, submitDoc, options.myRelationshipDid)
  await options.retain(signedSubmit, 'request')
  const vwcPromise = awaitWitnessResponse(sessionId, `${submit.TYPE_URI}#response`, timeoutMs)
  await options.sendDocument(agent, options.witnessConnectionId, signedSubmit)
  logger.info(`${LOG_PREFIX} presentation submitted (session ${sessionId})`)

  // ---- the VWC: verify its proof, its task binding, then store ------------
  const vwcDoc = await vwcPromise
  if (!(await verifyDocumentProof(agent, vwcDoc, witnessConnection.theirDid))) {
    throw new Error('submit#response proof did not verify under the witness DID')
  }
  const vwcPayload = (vwcDoc as { payload?: { vwc?: Record<string, unknown>; vwcDigestMultibase?: string } }).payload
  const vwc = vwcPayload?.vwc
  if (!vwc) throw new Error('submit#response carries no VWC')
  if (!vwcPayload.vwcDigestMultibase || !digestBytesEqual(vwcPayload.vwcDigestMultibase, digestMultibase(vwc))) {
    throw new Error('vwcDigestMultibase does not match the delivered VWC')
  }
  // The citation sits at the top level in a witnessed/1 VWC (DTG Credentials
  // v1) and in the subject before it: either binds the session the same way.
  //
  // This is the wallet side of both plan §6 V4/D4 (taskContext) and this
  // segment's taskDigestMultibase fix: cred-spec (pin 94af2d8, §Base
  // Structure) places taskDigestMultibase at the top level, sibling of
  // credentialSubject, wherever taskContext is REQUIRED — vsc shape emits it
  // there (WitnessTaskSessions.placeTaskDigestMultibase), wd02 keeps the
  // legacy nested placement. taskCitationOf already dual-reads BOTH members
  // in that order, so the segment's inline version is dropped in favour of it
  // rather than keeping two implementations of one rule. The emission half of
  // this segment (witness-server) is unaffected and applied as written.
  const { taskContext, taskDigestMultibase: taskDigest } = taskCitationOf(vwc)
  if (taskContext !== sessionId) {
    throw new Error(`VWC taskContext ${taskContext ?? 'absent'} does not name this session (${sessionId})`)
  }
  // §4.9.3: the task digest excludes the document's top-level proof, and
  // digests compare as decoded multihash bytes, never encoded strings.
  if (!taskDigest || !digestBytesEqual(taskDigest, taskDigestMultibase(sessionDoc))) {
    throw new Error('VWC taskDigestMultibase does not bind this session document')
  }

  // ---- D8: predicate acceptance (plan §3 D8, §6 V3) ------------------------
  // Rejection is the only conforming outcome for a VSC-shaped VWC whose
  // predicate this wallet's accept-list does not recognize. A legacy WD02
  // VWC has no predicate at all, so this check does not apply to it.
  const predicateAcceptance = checkPredicateAcceptance(vwc)
  if (predicateAcceptance.applicable && !predicateAcceptance.ok) {
    throw new Error(`VWC predicate rejected: ${predicateAcceptance.reason}`)
  }

  // ---- issuerScope (cred-spec #68, §6 V3 follow-up) ------------------------
  // REQUIRED on every DTG credential as of 2026-09-28; the dtg:witnessed
  // profile's own stated minimum is `directed`. Does not apply to a legacy
  // WD02 VWC, which predates this property.
  const issuerScopeCheck = checkIssuerScope(vwc)
  if (issuerScopeCheck.applicable && !issuerScopeCheck.ok) {
    throw new Error(`VWC issuerScope rejected: ${issuerScopeCheck.reason}`)
  }

  // ---- D6: subject binding (plan §3 D6, §3.2, §6 V3) -----------------------
  // Checked whenever the referenced VRC is in hand. Having none is
  // conforming — an opaque hash, not an identified edge (cred-spec C5) — but
  // a determinable violation (wrong subject, or a digest that does not
  // match) is refused rather than silently stored.
  const subjectBinding = checkSubjectBinding(vwc, options.referencedVrc)
  if (subjectBinding.checked && !subjectBinding.ok) {
    throw new Error(`VWC subject binding failed: ${subjectBinding.reason}`)
  }

  // ---- locality cross-check (plan §10.3 item 10) --------------------------
  // The witness's observation rides the SAME #response's ext (plan §6 table
  // row 4). A witness claiming a CONFIRMED observation this device did not
  // earn — no transcript at all, or one that doesn't match what was actually
  // sent — is refused here rather than silently trusted; this is exactly
  // the "task → physical" binding direction §5.4 describes, checked from the
  // holder's side of the exchange.
  const observation = (
    vwcDoc as {
      payload?: {
        ext?: Record<
          string,
          {
            locality?: {
              observation?: {
                confirmed?: boolean
                method?: string
                reason?: string
                transcriptDigestMultibase?: string
              }
            }
          }
        >
      }
    }
  ).payload?.ext?.[LOCALITY_EXT_NAMESPACE]?.locality?.observation
  if (observation?.confirmed === true) {
    if (!transcript) {
      throw new Error(
        `witness claims a confirmed locality observation for session ${sessionId}, but this device never produced a transcript for it`
      )
    }
    if (observation.transcriptDigestMultibase !== transcriptDigestMultibase(transcript)) {
      throw new Error(
        `witness's locality observation for session ${sessionId} does not match this device's own transcript — refusing`
      )
    }
  }
  // A dedicated, greppable marker distinct from the "transcript produced"
  // line above (which only reports the DEVICE's own radio-phase outcome,
  // not what the witness ultimately confirmed) — e2e's device runs assert
  // on this line (item 12), since the UI badge it otherwise depends on is
  // slower to poll for over Appium than a logcat marker.
  logger.info(
    observation?.confirmed === true
      ? `${LOG_PREFIX} locality confirmed for session ${sessionId} (${observation.method})`
      : `${LOG_PREFIX} locality not confirmed for session ${sessionId}${observation?.reason ? ` (${observation.reason})` : ' (no observation)'}`
  )

  // Mark it verified: everything above this line is the verification — the
  // taskContext binds the VWC to this session, and a claimed locality
  // observation had to match the transcript this device itself produced.
  // Only marked records earn the witness and locality marks in the UI
  // (WITNESS_VERIFIED_TAG, getVerifiedWitnessCredentialsForSubject).
  const vwcRecord = new W3cCredentialRecord({ credentialInstances: [{ credential: vwc as never }] })
  vwcRecord.setTags({ [WITNESS_VERIFIED_TAG]: 'true' } as never)
  await agent.w3cCredentials.store({ record: vwcRecord })
  logger.info(`${LOG_PREFIX} VWC stored — taskContext bound to session ${sessionId} (outcome evidence retained)`)

  return {
    sessionId,
    vwc,
    subjectBinding,
    issuerScope: issuerScopeCheck,
    locality: directive ? { transcriptProduced: transcript !== null } : undefined,
  }
}

/** Test seam: the number of ceremonies still awaiting a witness response. */
export function pendingWitnessResponseCount(): number {
  return pendingWitnessResponses.size
}
