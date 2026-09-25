/**
 * vtiJoin — joining a community as a persona the wallet's VTA holds.
 *
 * The one place the two legs meet. `VtaClient` (phone ↔ its VTA) supplies the
 * persona and its borrowed key; `vtiAgent` (phone ↔ community) presents it.
 * The steps are named so a screen can show them and a test can assert them,
 * and every side effect goes through the two stores, never straight to Credo.
 *
 *   ensure persona → connect as it → manifest → submit (with the invitation,
 *   when there is one) → verdict → on `allow`, keep the card.
 *
 * @module trust-tasks/module/vtiJoin
 */

import type { Agent } from '@credo-ts/core'

import { parseJoinNeed, recordAnswer, recordSent, recordStatus, type JoinNeed } from './joinSubmission'
import { vtaAgent } from './vtaAgent'
import {
  GenericRecordsCommunityStore,
  type JoinSubmission,
  type VtiCommunityStore,
  type VtiInvitation,
  type VtiMembership,
} from './VtiCommunityStore'
import { GenericRecordsIdentityStore, type VtiIdentityStore, type VtiPersona } from './VtiIdentityStore'
import { selfRemoveRefusal, vtiAgent, type JoinRequestStatus, type VtiVerdict } from './vtiAgent'
import { receiveIssue } from './vtiInbox'
import { checkCredentialStatus } from './vtiStatusList'
import { GenericRecordsTspPeerRevisionStore } from './vtiTsp'

export { parseJoinNeed, type JoinNeed } from './joinSubmission'

export type VtiJoinStep = 'persona' | 'connecting' | 'manifest' | 'submitting' | 'verdict' | 'stored'

export interface VtiJoinDeps {
  agent: Agent
  identityStore: VtiIdentityStore
  communityStore: VtiCommunityStore
  /**
   * The phone's VTA, and a fallback mediator: the persona's own DID document
   * names the mediator it is reached through, so this is only used when it
   * names none.
   */
  vtaDid: string
  mediatorDid?: string
  communityDid: string
  /** Whether the person asked to be listed in the community's public member directory. */
  registryConsent?: boolean
  onStep?: (step: VtiJoinStep, detail?: string) => void
}

export interface VtiJoinResult {
  persona: VtiPersona
  verdict: VtiVerdict
  membership?: VtiMembership
}

/**
 * The persona this wallet presents to a community — reused when one exists,
 * minted on the VTA (and its key-agreement key borrowed) when not. One
 * identity per community, kept: a person is recognised by it afterwards.
 *
 * `fresh` forgets the one on record first, so the community sees a new
 * identity: "Join again" after a refusal or after leaving (openvtc's
 * guidance). The old persona's keys stay on the VTA; only the phone's record
 * of it goes.
 */
export async function ensurePersonaFor(
  deps: Pick<VtiJoinDeps, 'agent' | 'identityStore' | 'vtaDid' | 'communityDid'>,
  options: { fresh?: boolean } = {}
): Promise<VtiPersona> {
  if (options.fresh) await deps.identityStore.forgetPersona(deps.communityDid)
  // The app's one session with its VTA: a granted notice must reach the
  // client that waits for it, and a second socket for the same DID would not.
  const client = vtaAgent.client(deps.agent, deps.vtaDid, deps.identityStore)
  return client.ensurePersona({ communityDid: deps.communityDid })
}

export async function joinCommunity(
  deps: VtiJoinDeps,
  invitation?: VtiInvitation,
  options: { freshPersona?: boolean } = {}
): Promise<VtiJoinResult> {
  const step = (s: VtiJoinStep, d?: string) => deps.onStep?.(s, d)

  step('persona')
  const persona = await ensurePersonaFor(deps, { fresh: options.freshPersona })
  if (!persona.kmsKeyIds?.keyAgreement) throw new Error('vtiJoin: the persona has no borrowed key-agreement key')
  if (invitation && invitation.subjectDid !== persona.did) {
    throw new Error(`vtiJoin: the invitation is for ${invitation.subjectDid}, not this persona`)
  }

  step('connecting', persona.did)
  await vtiAgent.connect(deps.agent, deps.mediatorDid, {
    persona,
    peerRevisionStore: new GenericRecordsTspPeerRevisionStore(deps.agent),
  })

  // Whatever the community delivers during the join — on the Eucalyptus
  // train the card and the role arrive as separate messages after the verdict.
  const via = invitation ? 'invitation' : 'approval'
  // Returned, not fired and forgotten: the mediator is told the message was
  // taken only once it is stored, and a failed store leaves it for redelivery.
  const stopInbox = vtiAgent.onInbound(async (plaintext) => {
    await receiveIssue(deps.communityStore, persona.did, plaintext, { via })
  })

  step('manifest')
  const manifest = await vtiAgent.fetchManifest(deps.communityDid, deps.agent)

  step('submitting', invitation ? 'with invitation' : 'empty')
  await recordSent(deps.communityStore, {
    communityDid: deps.communityDid,
    personaDid: persona.did,
    withInvitation: Boolean(invitation),
    via: 'join',
  })
  let verdict: VtiVerdict
  try {
    verdict = await vtiAgent.apply(deps.communityDid, manifest, {
      credentials: invitation ? [invitation.credential] : [],
      registryConsent: deps.registryConsent,
    })
  } catch (e) {
    await recordAnswer(deps.communityStore, deps.communityDid, { refusal: e }).catch(() => undefined)
    throw e
  }
  await recordAnswer(deps.communityStore, deps.communityDid, { verdict }).catch(() => undefined)
  step('verdict', verdict.effect)

  let membership: VtiMembership | undefined
  try {
    if (verdict.effect === 'allow') {
      membership = membershipFromVerdict(deps.communityDid, persona.did, verdict, via)
      if (membership) {
        await deps.communityStore.saveMembership(membership)
      } else {
        // The card comes by delivery, not inline: give the outbox a moment.
        for (let i = 0; i < 20 && !membership; i++) {
          await new Promise((resolve) => setTimeout(resolve, 1500))
          membership = await deps.communityStore.getMembership(deps.communityDid)
        }
      }
      if (membership) {
        if (invitation) await deps.communityStore.saveInvitation({ ...invitation, status: 'used' })
        step('stored', membership.role)
      }
    }
  } finally {
    // Keep listening a little longer: the role endorsement can trail the card.
    setTimeout(stopInbox, 30000)
  }
  return { persona, verdict, membership }
}

/** The card an `allow` carries inline: `with.vmc` and, when granted, `with.roleVec`. */
export function membershipFromVerdict(
  communityDid: string,
  personaDid: string,
  verdict: VtiVerdict,
  via: VtiMembership['via']
): VtiMembership | undefined {
  const w = (verdict.with ?? {}) as { vmc?: Record<string, unknown>; roleVec?: Record<string, unknown> }
  if (!w.vmc) return undefined
  const roleSubject = (w.roleVec?.credentialSubject as { endorsement?: { role?: string } } | undefined)?.endorsement
  return {
    communityDid,
    personaDid,
    role: roleSubject?.role ?? 'member',
    vmc: w.vmc,
    roleVec: w.roleVec,
    grantedAt: typeof w.vmc.validFrom === 'string' ? w.vmc.validFrom : new Date().toISOString(),
    validUntil: typeof w.vmc.validUntil === 'string' ? w.vmc.validUntil : undefined,
    via,
  }
}

/**
 * Where this phone's join to a community stands (p220 item 1): what a screen
 * shows instead of "You joined this one before".
 *
 * - `member` / `removed`: a card is held; `removed` when the community has
 *   revoked it on its status list.
 * - `sent`: a request went out and the community has not answered yet — its
 *   answer may simply have been lost.
 * - `pending` (the community owes the decision), `deferred` (it waits on the
 *   applicant, and says for what), `rejected` (with its code and words),
 *   `withdrawn`.
 * - `left`: the member left the community on this phone (keyring-bifold, Leave).
 * - `none`: nothing sent, nothing held.
 *
 * While a request is open it is polled with the community's status task —
 * never resubmitted — unless `poll` is false; the poll resolves the request
 * from the persona when no id is held, which recovers a lost first answer.
 * Never throws: a poll that fails falls back to what the phone last knew.
 */
export type CommunityJoinState =
  | { kind: 'none' }
  | { kind: 'member'; membership: VtiMembership }
  | { kind: 'removed'; membership: VtiMembership; at?: string }
  | { kind: 'sent'; submission: JoinSubmission }
  | { kind: 'pending'; submission: JoinSubmission }
  | { kind: 'deferred'; submission: JoinSubmission; needs: JoinNeed[] }
  | { kind: 'rejected'; submission: JoinSubmission; code: string; reason?: string; decidedAt?: string }
  | { kind: 'withdrawn'; submission: JoinSubmission }
  | { kind: 'left'; disposition: 'purge' | 'tombstone' | 'historical'; at: string }

export interface ReadJoinStateOptions {
  /** Ask the community while a request is open (default true). */
  poll?: boolean
  mediatorDid?: string
  communityStore?: VtiCommunityStore
  identityStore?: VtiIdentityStore
  /** The status poll; by default connects as the community's persona and asks. */
  status?: (communityDid: string, requestId?: string) => Promise<JoinRequestStatus | undefined>
  /** Whether a held card still stands; by default its status-list bit. */
  cardStatus?: (membership: VtiMembership) => Promise<{ revoked: boolean; at?: string }>
}

export async function readJoinState(
  agent: Agent,
  communityDid: string,
  options: ReadJoinStateOptions = {}
): Promise<CommunityJoinState> {
  const store = options.communityStore ?? new GenericRecordsCommunityStore(agent)

  const membership = await store.getMembership(communityDid).catch(() => undefined)
  if (membership) {
    const cardStatus =
      options.cardStatus ??
      (async (m: VtiMembership) => {
        const result = await checkCredentialStatus(agent, m.vmc, communityDid)
        return result.state === 'revoked' ? { revoked: true, at: result.checkedAt } : { revoked: false }
      })
    const card = await cardStatus(membership).catch(() => ({ revoked: false, at: undefined }))
    return card.revoked ? { kind: 'removed', membership, at: card.at } : { kind: 'member', membership }
  }

  let submission = await store.getSubmission?.(communityDid).catch(() => undefined)
  // Left on this phone, and nothing sent since: "You left", not "Join".
  const departure = await store.getDeparture?.(communityDid).catch(() => undefined)
  if (departure && (!submission || submission.sentAt <= departure.at)) {
    return {
      kind: 'left',
      disposition: departure.disposition as 'purge' | 'tombstone' | 'historical',
      at: departure.at,
    }
  }
  if (!submission) return { kind: 'none' }

  const open = !submission.acknowledgedAt || submission.status === 'pending' || submission.status === 'deferred'
  if (open && options.poll !== false) {
    const poll =
      options.status ??
      (async (did: string, requestId?: string) => {
        const persona = await (options.identityStore ?? new GenericRecordsIdentityStore(agent)).getPersona(did)
        if (!persona) return undefined
        await vtiAgent.connect(agent, options.mediatorDid, {
          persona,
          peerRevisionStore: new GenericRecordsTspPeerRevisionStore(agent),
        })
        return vtiAgent.status(did, { requestId })
      })
    try {
      const polled = await poll(communityDid, submission.requestId)
      // The community holds no such request: the send never reached it, or it
      // was swept. There is nothing to wait for — the person can send again.
      if (!polled) return { kind: 'none' }
      submission = (await recordStatus(store, communityDid, polled)) ?? submission
    } catch {
      // Keep what the phone last knew.
    }
  }
  return stateOfSubmission(submission)
}

/** A submission as a join state, from what the community last said about it. */
export function stateOfSubmission(submission: JoinSubmission): CommunityJoinState {
  if (!submission.acknowledgedAt) return { kind: 'sent', submission }
  switch (submission.status) {
    case 'deferred':
      return { kind: 'deferred', submission, needs: (submission.needs ?? []).map(parseJoinNeed) }
    case 'rejected':
      return {
        kind: 'rejected',
        submission,
        code: submission.rejection?.code ?? 'rejected',
        reason: submission.rejection?.reason,
        decidedAt: submission.rejection?.decidedAt,
      }
    case 'withdrawn':
      return { kind: 'withdrawn', submission }
    // Approved but no card yet (it comes by delivery), a referral, or an answer
    // that named no state: the community has it and owes the next step.
    default:
      return { kind: 'pending', submission }
  }
}

export interface LeaveCommunityDeps {
  agent: Agent
  identityStore: VtiIdentityStore
  communityStore: VtiCommunityStore
  /** The vetting application for the community, cleared with the rest. */
  vettingStore?: { forget(communityDid: string): Promise<void> }
  mediatorDid?: string
}

/**
 * Leave a community (p220 item 5): `members/self-remove/0.1`, as the
 * community's persona, then clear what this phone held for it — the
 * membership, invitations, held credentials, the vetting application and the
 * persona record — so joining again starts from a fresh identity. A community
 * that says the caller is not a member (`notMember`) is gone already: the
 * phone clears the same way and says so (`alreadyGone`). Any other refusal —
 * leaving as the last admin — throws, and nothing is cleared.
 */
export async function leaveCommunity(
  deps: LeaveCommunityDeps,
  communityDid: string,
  options: { disposition?: 'purge' | 'tombstone' } = {}
): Promise<{ disposition: string; alreadyGone: boolean }> {
  const persona = await deps.identityStore.getPersona(communityDid)
  if (!persona) throw new Error('vtiJoin: this phone holds no identity for that community')
  await vtiAgent.connect(deps.agent, deps.mediatorDid, {
    persona,
    peerRevisionStore: new GenericRecordsTspPeerRevisionStore(deps.agent),
  })
  // TODO(TSP Rev 3): end the relationship with the community VTC too — send an
  // XRFD (`packCancelRev3`, @bifold/trust-tasks) from the persona's TSP
  // session, naming the relationship by the threadDigest of the XRFI we sent.
  // That needs the invite digest persisted per peer when vtiAgent greets (its
  // `greeted` set is in memory only today). Upstream accepts our cancel
  // (ref-04s-rev3-relationship); the VTA's answering cancel fails upstream
  // (VTI-38), which does not affect us. (Carried over from the local-only
  // vtiLeave this replaces.)
  let disposition: string = options.disposition ?? 'policydefault'
  let alreadyGone = false
  try {
    const left = await vtiAgent.selfRemove(communityDid, { disposition: options.disposition })
    disposition = left.disposition
  } catch (e) {
    if (selfRemoveRefusal(e) !== 'notMember') throw e
    alreadyGone = true
  }
  // What the community no longer holds, the phone no longer shows. Each step
  // on its own: one store failing must not leave the others half-cleared.
  await deps.communityStore.forgetCommunity(communityDid).catch(() => undefined)
  await deps.vettingStore?.forget(communityDid).catch(() => undefined)
  await deps.identityStore.forgetPersona(communityDid).catch(() => undefined)
  await deps.communityStore
    .saveDeparture?.({ communityDid, disposition, at: new Date().toISOString() })
    .catch(() => undefined)
  return { disposition, alreadyGone }
}
