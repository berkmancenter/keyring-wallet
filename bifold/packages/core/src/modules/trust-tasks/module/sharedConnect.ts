/**
 * sharedConnect — the scanner's side of the shared-connect ceremony, keyed by
 * encounter instead of Credo connection (plan WP6/WP7/WP10). A parallel
 * module: the connection ceremony in `ceremony.ts` is untouched.
 *
 * The scanner proposes first, from a fresh per-encounter DID:
 *
 *   1 propose            scanner -> inviter   (sent by {@link SharedConnectSession.start})
 *   2 propose#response   inviter -> scanner
 *   3 issue              inviter -> scanner
 *   4 issue#response     scanner -> inviter   (receipt; digest of document 3's VRC)
 *   5 issue              scanner -> inviter
 *   6 issue#response     inviter -> scanner   (receipt; digest of document 5's VRC)
 *
 * Every document carries `threadId` = the propose id, a `ceremony` member
 * whose enactment is the link's `_id`, a proof, and in-band `issuer`/
 * `recipient` equal to the encounter VIDs (issuer = proof signer = transport
 * sender). Both directions share one thread, and a receipt names no request,
 * so the digest ties a receipt to the delivery it answers.
 *
 * Transport-neutral: the session sends through {@link EncounterTransport}
 * (TSP or DIDComm v2, see `sharedConnectCarriage`) and is fed inbound
 * documents with {@link SharedConnectSession.handle}.
 *
 * Silence is never failure: a missing answer ends as `unanswered`, kept open
 * until `_exp` plus a grace period (TSP binding section 4).
 *
 * @module trust-tasks/module/sharedConnect
 */

import { utils } from '@credo-ts/core'
import type { Agent } from '@credo-ts/core'
import * as issue from '@openvtc/trust-tasks/vrc/relationships/issue/0.1/payload'
import * as propose from '@openvtc/trust-tasks/vrc/relationships/propose/0.1/payload'

import { RelationshipDidRepository } from '../../vrc/repositories/RelationshipDidRepository'
import { getOrCreateRelationshipDid } from '../../vrc/vrc-manager'
import { vrcFlowStore } from '../../vrc/witnessStatusStore'
import { getTrustTasksService } from '../ceremony'
import { digestMultibase, verifyDocumentProof } from '../documentProof'
import { extendedCode, rejectWith } from '../services/TrustTasksService'

import { didPrefix } from './didPrefix'
import { issueSharedConnectVrc, vcIssuerId, vcSubjectId, verifySharedConnectVrc } from './sharedConnectCredential'
import {
  acceptableProofSigners,
  buildSharedConnectDocument,
  ceremonyMember,
  encounterMismatch,
  newProposeId,
  SHARED_CONNECT_STEP_PROOF_PURPOSE,
  signSharedConnectDocument,
  type SharedConnectStep,
} from './sharedConnectCeremony'
import {
  SHARED_CONNECT_ANSWER_WAIT_MS,
  SHARED_CONNECT_EXP_GRACE_MS,
  SHARED_CONNECT_SEND_ATTEMPTS,
} from './sharedConnectDecisions'
import { storeReceivedVrc } from './sharedConnectStore'
import { ENCOUNTER_LOG_PREFIX, encounterKey, saveEncounter, type EncounterRecord } from './sharedConnectEncounter'

/** What the session sends through. Resolves when the document has been handed to the carriage. */
export interface EncounterTransport {
  send(document: Record<string, unknown>): Promise<void>
}

/** The effects the session needs, with defaults for the wallet and overrides for tests. */
export interface SharedConnectDeps {
  now: () => number
  randomBytes: (length: number) => Uint8Array
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  /** Mint (or reuse) our relationship DID for this inviter. */
  relationshipDidFor: (theirVid: string, key: string) => Promise<string>
  /** Record the inviter's relationship DID against our own. */
  recordTheirRelationshipDid: (theirVid: string, theirRelationshipDid: string) => Promise<void>
  issueVrc: (myRelationshipDid: string, theirRelationshipDid: string) => Promise<Record<string, unknown>>
  verifyVrc: (vc: Record<string, unknown>) => Promise<boolean>
  /** Verify a document's proof under one of the DIDs that may have signed it. */
  verifyProof: (document: Record<string, unknown>, signers: string[]) => Promise<boolean>
  /** Store a received VRC; true when it was new. */
  storeVrc: (vc: Record<string, unknown>) => Promise<boolean>
  sign: (document: Record<string, unknown>) => Promise<Record<string, unknown>>
  /**
   * Run an inbound document through the framework pipeline (schema, identity,
   * freshness) and retain it under the encounter key. True when accepted.
   * Proofs are checked by the session before this is called.
   */
  validate: (spec: unknown, document: Record<string, unknown>) => Promise<boolean>
  retain: (document: Record<string, unknown>, role: 'request' | 'response' | 'error') => Promise<void>
  persist: (record: EncounterRecord) => Promise<void>
}

export type SessionOutcome = 'completed' | 'declined' | 'refused' | 'unanswered' | 'expired' | 'failed'

/** What a watcher is told: an ending (an `unanswered` one is not final), or `waiting` again after a retry. */
export type SessionState = SessionOutcome | 'waiting'

const nowSeconds = (d: SharedConnectDeps) => Math.floor(d.now() / 1000)

export function defaultSharedConnectDeps(agent: Agent): SharedConnectDeps {
  // Registered on first use, by the one helper the connection ceremony uses too. The app registers the module at
  // start-up (setupTrustTasksInbound, before the agent is handed out), but a start must not depend on that order.
  const service = getTrustTasksService(agent)
  return {
    now: () => Date.now(),
    randomBytes: (length) => agent.kms.randomBytes({ length }),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    relationshipDidFor: (theirVid, key) => getOrCreateRelationshipDid(agent, theirVid, key),
    recordTheirRelationshipDid: async (theirVid, theirRel) => {
      await agent.dependencyManager
        .resolve(RelationshipDidRepository)
        .updateCounterpartyRelationshipDid(agent.context, theirVid, theirRel)
    },
    issueVrc: (mine, theirs) => issueSharedConnectVrc(agent, mine, theirs),
    verifyVrc: (vc) => verifySharedConnectVrc(agent, vc),
    verifyProof: async (document, signers) => {
      for (const signer of signers) {
        if (
          await verifyDocumentProof(agent, document, signer, {
            proofPurpose: SHARED_CONNECT_STEP_PROOF_PURPOSE,
          }).catch(() => false)
        )
          return true
      }
      return false
    },
    storeVrc: (vc) => storeReceivedVrc(agent, vc),
    sign: (document) => signSharedConnectDocument(agent, document),
    validate: async (spec, document) => {
      const outcome = await service.consume(agent.context, {
        spec: spec as never,
        document,
        myDid: String(document.recipient),
        senderDid: String(document.issuer),
        connectionId: encounterKey(String((document.ceremony as { enactment?: string })?.enactment)),
        proofPolicy: { kind: 'acceptUnverified' },
        handler: async () => undefined,
      })
      return outcome.kind !== 'rejected'
    },
    retain: async (document, role) => {
      await service.retain(
        agent.context,
        document,
        role,
        encounterKey(String((document.ceremony as { enactment?: string })?.enactment))
      )
    },
    persist: (record) => saveEncounter(agent, record),
  }
}

/**
 * One scanner-side encounter. Create it with the stored encounter record, call
 * {@link start} once the carriage can send, and pass every inbound document to
 * {@link handle}. {@link finished} settles with the outcome.
 */
export class SharedConnectSession {
  private readonly key: string
  private proposeId?: string
  private myRelationshipDid?: string
  private theirRelationshipDid?: string
  private proposeDoc?: Record<string, unknown>
  private ownIssueDoc?: Record<string, unknown>
  private ownDigest?: string
  private heldIssue?: Record<string, unknown>
  private gotReceipt = false
  private sentReceipt = false
  private ended?: SessionOutcome
  private waitTimer?: unknown
  private expiryTimer?: unknown
  private attempts = 0
  private waitingFor?: 'response' | 'receipt'
  /** Replies already given, by inbound document id, so a redelivery repeats the reply (idempotent). */
  private readonly replied = new Map<string, Record<string, unknown>>()
  private resolveFinished!: (outcome: SessionOutcome) => void
  readonly finished: Promise<SessionOutcome>
  private readonly listeners = new Set<(state: SessionState) => void>()

  constructor(
    private readonly agent: Agent,
    private readonly encounter: EncounterRecord,
    private readonly transport: EncounterTransport,
    private readonly deps: SharedConnectDeps = defaultSharedConnectDeps(agent)
  ) {
    this.key = encounterKey(encounter.enactment)
    this.finished = new Promise((resolve) => (this.resolveFinished = resolve))
  }

  get outcome(): SessionOutcome | undefined {
    return this.ended
  }

  /** Be told each ending (and `waiting` after a retry), for the screen. Returns the way to stop listening. */
  subscribe(listener: (state: SessionState) => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  private notify(state: SessionState) {
    for (const listener of [...this.listeners]) {
      try {
        listener(state)
      } catch {
        // a watcher's failure is not the ceremony's
      }
    }
  }

  private log(message: string) {
    // Identifier prefixes and outcome codes only; never a label, reason or link text (WP12).
    this.agent.config.logger.info(`${ENCOUNTER_LOG_PREFIX} ${message} (${didPrefix(this.encounter.theirVid)})`)
  }

  /** The person tapped Connect: send `propose` (step 1) and wait for `propose#response`. */
  async start(): Promise<void> {
    if (this.ended || this.proposeDoc) return
    if (this.expired(0)) return this.end('expired')
    const proposeId = newProposeId(this.deps.randomBytes)
    this.proposeId = proposeId
    this.myRelationshipDid = await this.deps.relationshipDidFor(this.encounter.theirVid, this.key)
    const document = await this.deps.sign(
      buildSharedConnectDocument({
        id: proposeId,
        type: propose.TYPE_URI,
        threadId: proposeId,
        issuer: this.encounter.myVid,
        recipient: this.encounter.theirVid,
        enactment: this.encounter.enactment,
        step: 1,
        payload: { relationshipDid: this.myRelationshipDid, witnessed: false },
      })
    )
    this.proposeDoc = document
    await this.deps.retain(document, 'request')
    this.armExpiry()
    await this.setState('proposing')
    vrcFlowStore.setDialect(this.key, 'trust-tasks')
    vrcFlowStore.setStatus(this.key, 'proposed', false)
    await this.sendAndWait(document, 'response')
  }

  /** Re-send what is awaited, once more, after an `unanswered` ending (the person asked to retry). */
  async retry(): Promise<void> {
    if (this.ended !== 'unanswered' || this.expired(SHARED_CONNECT_EXP_GRACE_MS)) return
    this.ended = undefined
    this.attempts = 0
    this.notify('waiting')
    const document = this.waitingFor === 'receipt' ? this.ownIssueDoc : this.proposeDoc
    if (document && this.waitingFor) await this.sendAndWait(document, this.waitingFor)
  }

  /** Stop the session: timers cleared, the outcome as given (default `failed`, a cancel). */
  async cancel(): Promise<void> {
    await this.end('failed', 'cancelled')
  }

  // ---- inbound -------------------------------------------------------------

  async handle(document: Record<string, unknown>): Promise<void> {
    if (this.ended === 'completed' || this.ended === 'declined' || this.ended === 'refused') return
    if (!this.proposeId || !this.proposeDoc) return // nothing proposed yet: not for us
    const id = typeof document.id === 'string' ? document.id : undefined
    if (id && this.replied.has(id)) {
      const again = this.replied.get(id)
      if (again) await this.transport.send(again).catch(() => undefined)
      return
    }
    const mismatch = encounterMismatch(document, {
      enactment: this.encounter.enactment,
      threadId: this.proposeId,
      myVid: this.encounter.myVid,
      theirVid: this.encounter.theirVid,
    })
    if (mismatch) {
      this.log(`dropped a document that is not part of this encounter (${mismatch})`)
      return
    }
    if (!document.proof) {
      this.log('dropped a document with no proof')
      return
    }
    const type = String(document.type ?? '')
    let reply: Record<string, unknown> | null = null
    if (type === `${propose.TYPE_URI}#response`) await this.onProposeResponse(document)
    else if (type === issue.TYPE_URI) reply = await this.onIssue(document)
    else if (type === `${issue.TYPE_URI}#response`) await this.onReceipt(document)
    else if (type.includes('/trust-task-error/')) await this.onError(document)
    else this.log('dropped a document of an unexpected type')
    if (id && reply) this.replied.set(id, reply)
  }

  private async verifyFrom(document: Record<string, unknown>, extraSigner?: string): Promise<boolean> {
    const signers = acceptableProofSigners(document, extraSigner ?? this.theirRelationshipDid)
    return this.deps.verifyProof(document, signers)
  }

  private async onProposeResponse(document: Record<string, unknown>): Promise<void> {
    if (this.theirRelationshipDid) return // already accepted: a redelivery
    const payload = document.payload as { accept?: boolean; relationshipDid?: string } | undefined
    if (
      payload?.accept !== true ||
      typeof payload.relationshipDid !== 'string' ||
      !payload.relationshipDid.startsWith('did:')
    ) {
      this.log('dropped a propose response with no usable acceptance')
      return
    }
    if (!(await this.verifyFrom(document, payload.relationshipDid))) {
      this.log('dropped a propose response whose proof did not verify')
      return
    }
    if (!(await this.deps.validate(propose.RESPONSE_SPEC, document))) return this.dropInvalid()
    this.theirRelationshipDid = payload.relationshipDid
    await this.deps.recordTheirRelationshipDid(this.encounter.theirVid, payload.relationshipDid)
    this.clearWait()
    await this.setState('accepted')
    this.log('propose accepted')
    // `issue` may have overtaken the response on the relay: take it now.
    if (this.heldIssue) {
      const held = this.heldIssue
      this.heldIssue = undefined
      await this.handle(held)
    } else {
      this.waitingFor = undefined
    }
  }

  private async onIssue(document: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    if (!this.theirRelationshipDid) {
      this.heldIssue = document // before the acceptance: hold it, do not trust it yet
      return null
    }
    if (!(await this.verifyFrom(document))) {
      this.log('dropped an issue whose proof did not verify')
      return null
    }
    if (!(await this.deps.validate(issue.SPEC, document))) {
      this.dropInvalid()
      return null
    }
    const refuse = async (message: string) => {
      this.log('issue refused')
      const error = this.decorate(
        rejectWith(document as never, utils.uuid(), {
          code: extendedCode(issue.TYPE_URI, 'notAccepted'),
          message,
          retryable: false,
        }) as unknown as Record<string, unknown>,
        4
      )
      const signed = await this.deps.sign(error)
      await this.deps.retain(signed, 'error')
      await this.transport.send(signed)
      await this.end('refused')
      return signed
    }
    const vc = (document.payload as { vrc?: Record<string, unknown> } | undefined)?.vrc
    if (!vc) return refuse('payload carries no credential')
    if (vcIssuerId(vc) !== this.theirRelationshipDid)
      return refuse('credential issuer is not the proposer relationship DID')
    if (vcSubjectId(vc) !== this.myRelationshipDid)
      return refuse('credential subject is not this party relationship DID')
    if (!(await this.deps.verifyVrc(vc))) return refuse('credential proof did not verify')
    const digest = digestMultibase(vc)
    const claimed = (document.payload as { vrcDigestMultibase?: string }).vrcDigestMultibase
    if (claimed !== undefined && claimed !== digest) return refuse('credential digest does not match')
    await this.deps.storeVrc(vc)
    const receipt = await this.deps.sign(
      this.decorate(
        {
          id: utils.uuid(),
          type: `${issue.TYPE_URI}#response`,
          threadId: this.proposeId,
          issuer: this.encounter.myVid,
          recipient: this.encounter.theirVid,
          issuedAt: new Date().toISOString(),
          payload: { vrcDigestMultibase: digest },
        },
        4
      )
    )
    await this.deps.retain(receipt, 'response')
    await this.transport.send(receipt)
    this.sentReceipt = true
    vrcFlowStore.setStatus(this.key, 'offer-received', false)
    this.log('issue received and receipted')
    await this.sendOwnIssue()
    await this.maybeComplete()
    return receipt
  }

  private async sendOwnIssue(): Promise<void> {
    if (this.ownIssueDoc) return
    vrcFlowStore.setStatus(this.key, 'preparing-offer', false)
    const vc = await this.deps.issueVrc(this.myRelationshipDid as string, this.theirRelationshipDid as string)
    this.ownDigest = digestMultibase(vc)
    const document = await this.deps.sign(
      buildSharedConnectDocument({
        id: utils.uuid(),
        type: issue.TYPE_URI,
        threadId: this.proposeId as string,
        issuer: this.encounter.myVid,
        recipient: this.encounter.theirVid,
        enactment: this.encounter.enactment,
        step: 5,
        payload: { vrc: vc, vrcDigestMultibase: this.ownDigest },
      })
    )
    this.ownIssueDoc = document
    await this.deps.retain(document, 'request')
    vrcFlowStore.setStatus(this.key, 'offer-sent', false)
    await this.sendAndWait(document, 'receipt')
  }

  private async onReceipt(document: Record<string, unknown>): Promise<void> {
    if (!this.ownDigest) return // no delivery of ours yet
    if (!(await this.verifyFrom(document))) {
      this.log('dropped a receipt whose proof did not verify')
      return
    }
    const digest = (document.payload as { vrcDigestMultibase?: string } | undefined)?.vrcDigestMultibase
    if (digest !== this.ownDigest) {
      this.log('receipt digest matches no delivery of ours, not acknowledged')
      return
    }
    if (!(await this.deps.validate(issue.RESPONSE_SPEC, document))) return this.dropInvalid()
    this.gotReceipt = true
    this.clearWait()
    await this.maybeComplete()
  }

  private async onError(document: Record<string, unknown>): Promise<void> {
    if (!(await this.verifyFrom(document))) {
      this.log('dropped an error whose proof did not verify')
      return
    }
    await this.deps.retain(document, 'error')
    const code = String((document.payload as { code?: string } | undefined)?.code ?? '')
    this.log(`error received (${code.split(':').pop() || 'unknown'})`)
    if (code.endsWith('declined')) await this.end('declined', 'declined')
    else await this.end('refused', 'error')
  }

  private async maybeComplete(): Promise<void> {
    if (this.gotReceipt && this.sentReceipt) await this.end('completed')
  }

  // ---- sending, waiting, timing -----------------------------------------------

  private dropInvalid(): void {
    this.log('dropped a document that does not conform to its schema')
  }

  private decorate(document: Record<string, unknown>, step: SharedConnectStep): Record<string, unknown> {
    return { ...document, ceremony: ceremonyMember(this.encounter.enactment, step) }
  }

  private async sendAndWait(document: Record<string, unknown>, waitingFor: 'response' | 'receipt'): Promise<void> {
    this.waitingFor = waitingFor
    this.attempts += 1
    try {
      await this.transport.send(document)
    } catch (error) {
      this.agent.config.logger.warn(
        `${ENCOUNTER_LOG_PREFIX} send failed (${error instanceof Error ? error.name : 'error'}); will retry`
      )
    }
    this.clearWait()
    this.waitTimer = this.deps.setTimer(() => void this.onWaitElapsed(document), SHARED_CONNECT_ANSWER_WAIT_MS)
  }

  private async onWaitElapsed(document: Record<string, unknown>): Promise<void> {
    if (this.ended || !this.waitingFor) return
    if (this.expired(SHARED_CONNECT_EXP_GRACE_MS)) return this.end('expired')
    if (this.attempts < SHARED_CONNECT_SEND_ATTEMPTS) {
      // Same document, same id: the far side repeats its answer rather than acting twice.
      return this.sendAndWait(document, this.waitingFor)
    }
    // No answer is not a refusal: keep the encounter open until `_exp` plus grace.
    await this.end('unanswered')
  }

  private expired(graceMs: number): boolean {
    return this.deps.now() > this.encounter.exp * 1000 + graceMs
  }

  private armExpiry() {
    const remaining = this.encounter.exp * 1000 + SHARED_CONNECT_EXP_GRACE_MS - this.deps.now()
    this.expiryTimer = this.deps.setTimer(() => void this.onExpiry(), Math.max(remaining, 0))
  }

  private async onExpiry() {
    if (!this.ended || this.ended === 'unanswered') await this.end('expired')
  }

  private clearWait() {
    if (this.waitTimer !== undefined) this.deps.clearTimer(this.waitTimer)
    this.waitTimer = undefined
  }

  private async setState(state: EncounterRecord['state']) {
    this.encounter.state = state
    await this.deps.persist({ ...this.encounter }).catch(() => undefined)
  }

  private async end(outcome: SessionOutcome, flow?: 'declined' | 'cancelled' | 'error') {
    if (this.ended && this.ended !== 'unanswered') return
    this.ended = outcome
    this.clearWait()
    // `unanswered` keeps the expiry timer: the encounter stays open for a retry or a late answer.
    if (outcome !== 'unanswered' && this.expiryTimer !== undefined) this.deps.clearTimer(this.expiryTimer)
    const state: EncounterRecord['state'] =
      outcome === 'completed'
        ? 'completed'
        : outcome === 'expired'
          ? 'expired'
          : outcome === 'unanswered'
            ? 'unanswered'
            : outcome === 'declined'
              ? 'declined'
              : 'failed'
    await this.setState(state)
    if (outcome === 'completed') vrcFlowStore.clearFlow(this.key)
    else if (outcome !== 'unanswered') vrcFlowStore.clearFlow(this.key, flow ?? 'error')
    this.log(`encounter ended: ${outcome} at ${nowSeconds(this.deps)}`)
    if (outcome !== 'unanswered') this.resolveFinished(outcome)
    this.notify(outcome)
  }
}
