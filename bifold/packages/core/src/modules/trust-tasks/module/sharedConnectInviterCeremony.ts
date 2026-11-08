/**
 * sharedConnectInviterCeremony — the shared-connect ceremony from the INVITER's side (relationship-over-tsp plan
 * WP9): what happens after the inviter's choke point (sharedConnectInvite) accepted a scanner's `propose`.
 *
 * The same six documents as the scanner side (sharedConnect.ts), with the roles inverted:
 *
 *   1 propose            scanner -> inviter   (accepted by the choke point under §2.8; the person is asked)
 *   2 propose#response   inviter -> scanner   (on Accept; a signed `declined` error on Decline)
 *   3 issue              inviter -> scanner   (this phone's VRC about the scanner's relationship DID)
 *   4 issue#response     scanner -> inviter   (receipt: the digest of document 3's VRC)
 *   5 issue              scanner -> inviter   (the scanner's VRC about this phone's relationship DID)
 *   6 issue#response     inviter -> scanner   (receipt: the digest of document 5's VRC)
 *
 * Every document carries `threadId` = the propose id, the `ceremony` member with the code's `_id`, in-band
 * `issuer`/`recipient` equal to the encounter VIDs, and a proof by the issuer VID for `authentication`. The VRC is the scanner side's
 * profile (VC 2.0, `eddsa-jcs-2022`, no `validUntil`), signed by this phone's relationship DID, and a received one is
 * verified under its issuer's `assertionMethod` (the shared credential module).
 *
 * The person is asked through the same consent sheet as a connection's proposal (RelationshipProposalModal): the
 * prompt's `connectionId` is the encounter key (`enc:` + `_id`), and `sharedConnect.didShort` replaces a name, since
 * a code's scanner has none. `respondToSharedConnectProposal` is that sheet's answer.
 *
 * Nothing here retries on a timer: a scanner re-sends its propose when it hears nothing, and the choke point hands
 * that to {@link SharedConnectInviterCeremony.onProposalAgain}, which repeats what was answered. Silence after the
 * acceptance is ended by the code's own grace timer.
 *
 * @module trust-tasks/module/sharedConnectInviterCeremony
 */

import { utils } from '@credo-ts/core'
import type { Agent } from '@credo-ts/core'
import * as issue from '@openvtc/trust-tasks/vrc/relationships/issue/0.1/payload'
import * as propose from '@openvtc/trust-tasks/vrc/relationships/propose/0.1/payload'

import { vrcFlowStore } from '../../vrc/witnessStatusStore'
import { setEncounterConsentHandler } from '../ceremony'
import { digestMultibase } from '../documentProof'
import { extendedCode, rejectWith } from '../services/TrustTasksService'

import { didPrefix } from './didPrefix'
import { defaultSharedConnectDeps, type SharedConnectDeps } from './sharedConnect'
import { vcIssuerId, vcSubjectId } from './sharedConnectCredential'
import { acceptableProofSigners, ceremonyMember, type SharedConnectStep } from './sharedConnectCeremony'
import { encounterKey, ENCOUNTER_LOG_PREFIX } from './sharedConnectEncounter'
import type { InviterCeremony, SharedConnectInviter } from './sharedConnectInvite'

/** The pieces of the scanner side's effects this side uses. */
export type InviterCeremonyDeps = Pick<
  SharedConnectDeps,
  | 'relationshipDidFor'
  | 'recordTheirRelationshipDid'
  | 'issueVrc'
  | 'verifyVrc'
  | 'verifyProof'
  | 'storeVrc'
  | 'sign'
  | 'validate'
  | 'retain'
>

/** Ceremonies waiting on the person's answer, by encounter key. */
const asking = new Map<string, SharedConnectInviterCeremony>()

/** The consent sheet's answer for a code this phone showed (`connectionId` = `enc:` + `_id`). */
export async function respondToSharedConnectProposal(agent: Agent, key: string, accept: boolean): Promise<void> {
  vrcFlowStore.clearProposalPrompt(key)
  const ceremony = asking.get(key)
  asking.delete(key)
  if (!ceremony) {
    agent.config.logger.warn(`${ENCOUNTER_LOG_PREFIX} inviter: no proposal waiting for this answer`)
    return
  }
  await ceremony.answer(accept)
}

// The consent sheet calls respondToRelationshipProposal for every proposal; an `enc:` key comes here.
setEncounterConsentHandler(respondToSharedConnectProposal)

export class SharedConnectInviterCeremony implements InviterCeremony {
  private readonly key: string
  private proposeId?: string
  private proposeDoc?: Record<string, unknown>
  private theirVid?: string
  private theirRelationshipDid?: string
  private myRelationshipDid?: string
  /** What was answered to the propose: the response and our issue, or the declined error. Repeated on a re-send. */
  private answered: Record<string, unknown>[] = []
  private ownDigest?: string
  private gotReceipt = false
  private sentReceipt = false
  private done = false
  /** Replies already given, by inbound document id, so a redelivery repeats the reply rather than acting twice. */
  private readonly replied = new Map<string, Record<string, unknown>>()

  constructor(
    private readonly agent: Agent,
    private readonly inviter: SharedConnectInviter,
    private readonly deps: InviterCeremonyDeps = defaultSharedConnectDeps(agent)
  ) {
    this.key = encounterKey(inviter.enactment)
    inviter.subscribe((state) => {
      if (state === 'expired' || state === 'failed' || state === 'cancelled') this.forget()
    })
  }

  // ---- step 1: the accepted propose ---------------------------------------------------------------------------

  async onProposal(document: Record<string, unknown>, theirVid: string): Promise<void> {
    if (this.proposeDoc) return
    const relationshipDid = (document.payload as { relationshipDid?: unknown } | undefined)?.relationshipDid
    // The choke point checked identity, enactment, expiry, proof and the bound; the payload is checked here, and a
    // propose that fails it ends the code without a word (it was a stranger's or a broken scanner's).
    const valid =
      typeof relationshipDid === 'string' &&
      relationshipDid.startsWith('did:') &&
      (await this.deps.validate(propose.SPEC, document))
    if (!valid) {
      // The acceptance is spent on it, so this code can never connect: say so (`rejected`), not a generic failure.
      this.log('accepted propose failed its schema or carried no relationship DID')
      await this.inviter.fail('rejected')
      return
    }
    this.proposeDoc = document
    this.proposeId = String(document.id)
    this.theirVid = theirVid
    this.theirRelationshipDid = relationshipDid as string
    await this.deps.retain(document, 'request').catch(() => undefined)
    asking.set(this.key, this)
    vrcFlowStore.setDialect(this.key, 'trust-tasks')
    vrcFlowStore.setStatus(this.key, 'proposed', false)
    vrcFlowStore.setProposalPrompt({
      connectionId: this.key,
      exchangeId: this.proposeId,
      counterpartyLabel: '',
      sharedConnect: { didShort: didPrefix(theirVid) },
    })
    this.log('asking the person')
  }

  /** The scanner heard nothing and re-sent its propose: repeat what was answered (nothing yet, if still asking). */
  async onProposalAgain(): Promise<void> {
    for (const document of this.answered) await this.sendQuietly(document)
  }

  // ---- steps 2 and 3: the person's answer ---------------------------------------------------------------------

  async answer(accept: boolean): Promise<void> {
    if (!this.proposeDoc || this.answered.length || this.done) return
    if (!accept) {
      const declined = await this.deps.sign(
        this.decorate(
          rejectWith(this.proposeDoc as never, this.newId(), {
            code: extendedCode(propose.TYPE_URI, 'declined'),
            message: 'The person declined the relationship',
            retryable: false,
          }) as unknown as Record<string, unknown>,
          2
        )
      )
      this.answered = [declined]
      await this.deps.retain(declined, 'error').catch(() => undefined)
      await this.sendQuietly(declined)
      vrcFlowStore.clearFlow(this.key, 'declined')
      this.log('declined by the person')
      await this.inviter.fail('declined')
      return
    }
    await this.inviter.advance('connecting')
    try {
      this.myRelationshipDid = await this.deps.relationshipDidFor(this.theirVid as string, this.key)
      await this.deps.recordTheirRelationshipDid(this.theirVid as string, this.theirRelationshipDid as string)
      const response = await this.deps.sign(
        this.build(`${propose.TYPE_URI}#response`, 2, { accept: true, relationshipDid: this.myRelationshipDid })
      )
      vrcFlowStore.setStatus(this.key, 'preparing-offer', false)
      const vc = await this.deps.issueVrc(this.myRelationshipDid, this.theirRelationshipDid as string)
      this.ownDigest = digestMultibase(vc)
      const ownIssue = await this.deps.sign(
        this.build(issue.TYPE_URI, 3, { vrc: vc, vrcDigestMultibase: this.ownDigest })
      )
      this.answered = [response, ownIssue]
      await this.deps.retain(response, 'response').catch(() => undefined)
      await this.deps.retain(ownIssue, 'request').catch(() => undefined)
    } catch (error) {
      this.log(`could not prepare the answer (${error instanceof Error ? error.name : 'error'})`)
      await this.inviter.fail('unknown')
      return
    }
    for (const document of this.answered) await this.sendQuietly(document)
    vrcFlowStore.setStatus(this.key, 'offer-sent', false)
    this.log('accepted; response and issue sent')
  }

  // ---- steps 4 and 5 in, step 6 out ---------------------------------------------------------------------------

  async onDocument(document: Record<string, unknown>): Promise<void> {
    if (this.done || !this.answered.length || !this.myRelationshipDid) return // nothing answered yet: not for us
    const id = typeof document.id === 'string' ? document.id : undefined
    const again = id ? this.replied.get(id) : undefined
    if (again) return this.sendQuietly(again)
    if (!document.proof) return this.log('dropped a document with no proof')
    const type = String(document.type ?? '')
    if (type === `${issue.TYPE_URI}#response`) return this.onReceipt(document)
    if (type === issue.TYPE_URI) {
      const receipt = await this.onIssue(document)
      if (id && receipt) this.replied.set(id, receipt)
      return
    }
    if (type.includes('/trust-task-error/')) return this.onError(document)
    this.log('dropped a document of an unexpected type')
  }

  private async onReceipt(document: Record<string, unknown>): Promise<void> {
    if (this.gotReceipt) return
    if (!(await this.verifyFrom(document))) return this.log('dropped a receipt whose proof did not verify')
    const digest = (document.payload as { vrcDigestMultibase?: string } | undefined)?.vrcDigestMultibase
    if (digest !== this.ownDigest) return this.log('receipt digest matches no delivery of ours')
    if (!(await this.deps.validate(issue.RESPONSE_SPEC, document))) return this.log('dropped a nonconforming receipt')
    await this.deps.retain(document, 'response').catch(() => undefined)
    this.gotReceipt = true
    await this.maybeComplete()
  }

  private async onIssue(document: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    if (this.sentReceipt) return null
    if (!(await this.verifyFrom(document))) {
      this.log('dropped an issue whose proof did not verify')
      return null
    }
    if (!(await this.deps.validate(issue.SPEC, document))) {
      this.log('dropped a nonconforming issue')
      return null
    }
    const vc = (document.payload as { vrc?: Record<string, unknown> } | undefined)?.vrc
    const digest = vc ? digestMultibase(vc) : undefined
    const claimed = (document.payload as { vrcDigestMultibase?: string } | undefined)?.vrcDigestMultibase
    const reason = !vc
      ? 'payload carries no credential'
      : vcIssuerId(vc) !== this.theirRelationshipDid
        ? 'credential issuer is not the proposer relationship DID'
        : vcSubjectId(vc) !== this.myRelationshipDid
          ? 'credential subject is not this party relationship DID'
          : claimed !== undefined && claimed !== digest
            ? 'credential digest does not match'
            : !(await this.deps.verifyVrc(vc))
              ? 'credential proof did not verify'
              : undefined
    if (reason) {
      // The scanner's VRC is refused in words it can act on: it is a party to this exchange, not a stranger.
      const refusal = await this.deps.sign(
        this.decorate(
          rejectWith(document as never, this.newId(), {
            code: extendedCode(issue.TYPE_URI, 'notAccepted'),
            message: reason,
            retryable: false,
          }) as unknown as Record<string, unknown>,
          6
        )
      )
      await this.deps.retain(refusal, 'error').catch(() => undefined)
      await this.sendQuietly(refusal)
      this.log('issue refused')
      // A refusal ends the exchange: it is said once and not repeated (nothing is read after `finish`).
      await this.finish('unknown')
      return null
    }
    await this.deps.storeVrc(vc as Record<string, unknown>)
    const receipt = await this.deps.sign(
      this.build(`${issue.TYPE_URI}#response`, 6, { vrcDigestMultibase: digest as string })
    )
    await this.deps.retain(receipt, 'response').catch(() => undefined)
    await this.sendQuietly(receipt)
    this.sentReceipt = true
    vrcFlowStore.setStatus(this.key, 'offer-received', false)
    this.log('issue received and receipted')
    await this.maybeComplete()
    return receipt
  }

  private async onError(document: Record<string, unknown>): Promise<void> {
    if (!(await this.verifyFrom(document))) return this.log('dropped an error whose proof did not verify')
    await this.deps.retain(document, 'error').catch(() => undefined)
    const code = String((document.payload as { code?: string } | undefined)?.code ?? '')
    this.log(`error received (${code.split(':').pop() || 'unknown'})`)
    await this.finish('unknown')
  }

  private async maybeComplete(): Promise<void> {
    if (!this.gotReceipt || !this.sentReceipt || this.done) return
    this.done = true
    vrcFlowStore.clearFlow(this.key)
    this.log('encounter ended: completed')
    await this.inviter.advance('connected')
  }

  private async finish(failure: 'unknown'): Promise<void> {
    if (this.done) return
    this.done = true
    vrcFlowStore.clearFlow(this.key, 'error')
    await this.inviter.fail(failure)
  }

  /** The code ended some other way (expiry, cancel, the switch): drop the question if it is still being asked. */
  private forget() {
    if (asking.get(this.key) === this) {
      asking.delete(this.key)
      vrcFlowStore.clearProposalPrompt(this.key)
    }
    if (!this.done) vrcFlowStore.clearFlow(this.key, 'cancelled')
    this.done = true
  }

  // ---- helpers ------------------------------------------------------------------------------------------------

  private verifyFrom(document: Record<string, unknown>): Promise<boolean> {
    return this.deps.verifyProof(document, acceptableProofSigners(document, this.theirRelationshipDid))
  }

  private build(type: string, step: SharedConnectStep, payload: Record<string, unknown>): Record<string, unknown> {
    return {
      id: this.newId(),
      type,
      threadId: this.proposeId,
      issuer: this.inviter.myVid,
      recipient: this.theirVid,
      issuedAt: new Date().toISOString(),
      ceremony: ceremonyMember(this.inviter.enactment, step),
      payload,
    }
  }

  private decorate(document: Record<string, unknown>, step: SharedConnectStep): Record<string, unknown> {
    return { ...document, ceremony: ceremonyMember(this.inviter.enactment, step) }
  }

  private newId(): string {
    return utils.uuid()
  }

  /** A send that fails is not the end: the scanner re-sends its propose, or the code's grace ends it. */
  private async sendQuietly(document: Record<string, unknown>): Promise<void> {
    try {
      await this.inviter.send(document)
    } catch (error) {
      this.log(`send failed (${error instanceof Error ? error.name : 'error'})`)
    }
  }

  private log(message: string) {
    this.agent.config.logger.info(
      `${ENCOUNTER_LOG_PREFIX} inviter ceremony: ${message} (${this.theirVid ? didPrefix(this.theirVid) : '-'})`
    )
  }
}
