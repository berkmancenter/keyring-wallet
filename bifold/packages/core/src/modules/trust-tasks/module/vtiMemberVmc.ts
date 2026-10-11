/**
 * The member's half of the membership pair: a membership credential the
 * persona issues back to the community that admitted it.
 *
 * A community issues each member a `MembershipCredential` at admission (the
 * grant). The member answers with one of its own (the acknowledgement): issued
 * by the persona, about the community, binding to that grant by its digest. The
 * community stores it (`member_vmc_received_at`), and join status reports
 * `credentialsDelivered`. Before this module Keyring never sent one, so every
 * Keyring member's edge stayed half formed (241).
 *
 * The contract, at our pins:
 * - wire type `vtc/members/vmc/0.1`, payload `{ vc, requestId? }`, receipt
 *   `#response` `{ memberDid, vmcId, status: "stored", requestId? }` (vta-sdk
 *   protocols/members.rs:77-199, VTI 49f5f1be);
 * - the credential exactly as dtg-credentials 0.13 `new_member_vmc_for` mints
 *   it (create.rs:302-428): the VC v2 and DTG v1 contexts, `MembershipCredential`,
 *   `issuer` the persona, a declared `issuerScope`, `credentialSubject`
 *   `{ id: <community>, digestMultibase: <JCS sha-256 of the grant without its proof> }`,
 *   a top-level `id`, no longer valid than the grant; signed `eddsa-jcs-2022`
 *   for `assertionMethod` (vtc-service members/inbound_vmc.rs:302-410);
 * - sent as a signed Trust Task document (`authentication`), carrying the join
 *   request's id when it closes one (inbound_vmc.rs:96-133).
 *
 * The community does not enforce it today (the `reciprocate_vmc` obligation is
 * emitted and discarded, ceremony/execute.rs:150-154), so a failure here never
 * stands in the way of the membership itself: it is logged and tried again.
 *
 * @module trust-tasks/module/vtiMemberVmc
 */
import type { Agent } from '@credo-ts/core'
import { utils } from '@credo-ts/core'

import { signDocumentProof, taskDigestMultibase } from '../documentProof'

import { isCurrentMembership, type VtiCommunityStore, type VtiMembership } from './VtiCommunityStore'
import type { VtiPersona } from './VtiIdentityStore'

export const MEMBER_VMC = 'https://trusttasks.org/spec/vtc/members/vmc/0.1'
export const MEMBER_VMC_RESPONSE = `${MEMBER_VMC}#response`
/** A community asking a member to (re-)issue its acknowledgement (vta-sdk request_vmc.rs:48-98). */
export const REQUEST_VMC = 'https://trusttasks.org/spec/vtc/members/request-vmc/0.1'

const W3C_VC_V2_CONTEXT = 'https://www.w3.org/ns/credentials/v2'
const DTG_CONTEXT_V1 = 'https://registry.trustoverip.org/dtg/context/v1'

/**
 * The scope the member declares for its own identifier: `directed`, known to
 * the community and to whoever the member shows the acknowledgement to — as
 * openvtc declares it (openvtc-core dtg.rs `MEMBER_IDENTIFIER_SCOPE`) and as
 * VTI's own fixture does (inbound_vmc.rs `binding_tests::pair`).
 */
export const MEMBER_ISSUER_SCOPE = 'directed'

/** Why a grant cannot be acknowledged; each mirrors a dtg-credentials refusal. */
export type MemberVmcRefusal =
  | 'notAMembershipGrant'
  | 'alreadyAnAcknowledgement'
  | 'notTheGrantSubject'
  | 'grantScope'
  | 'grantExpired'

export class MemberVmcNotPossible extends Error {
  constructor(readonly reason: MemberVmcRefusal) {
    super(`vtiMemberVmc: the membership credential cannot be acknowledged (${reason})`)
    this.name = 'MemberVmcNotPossible'
  }
}

/** The digest an acknowledgement binds to: the grant's DigestMultibase, its `proof` excluded (dtg-credentials lib.rs:1021). */
export function grantDigest(grant: Record<string, unknown>): string {
  return taskDigestMultibase(grant)
}

/** An instant as the library writes it: RFC 3339, whole seconds, `Z`. */
const wireInstant = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.000Z$/, 'Z')

const issuerOf = (credential: Record<string, unknown>): string | undefined => {
  const issuer = credential.issuer
  if (typeof issuer === 'string') return issuer || undefined
  if (issuer && typeof issuer === 'object') {
    const id = (issuer as { id?: unknown }).id
    return typeof id === 'string' && id ? id : undefined
  }
  return undefined
}

/**
 * The unsigned acknowledgement of `grant`, by `personaDid`. Refuses what
 * dtg-credentials refuses (`read_membership_grant`, `check_within_grant`): a
 * grant that is not a community's membership grant, already an acknowledgement,
 * about someone else, not `public`, or already past its end.
 */
export function buildMemberVmc(
  grant: Record<string, unknown>,
  personaDid: string,
  options: { now?: Date; id?: string } = {}
): Record<string, unknown> {
  const types = Array.isArray(grant.type) ? grant.type : []
  if (!types.includes('MembershipCredential')) throw new MemberVmcNotPossible('notAMembershipGrant')
  const subject = grant.credentialSubject as Record<string, unknown> | undefined
  if (!subject || typeof subject !== 'object' || Array.isArray(subject))
    throw new MemberVmcNotPossible('notAMembershipGrant')
  if ('digestMultibase' in subject || 'digest' in subject) throw new MemberVmcNotPossible('alreadyAnAcknowledgement')
  if (subject.id !== personaDid) throw new MemberVmcNotPossible('notTheGrantSubject')
  const community = issuerOf(grant)
  if (!community) throw new MemberVmcNotPossible('notAMembershipGrant')
  if (grant.issuerScope !== 'public') throw new MemberVmcNotPossible('grantScope')

  const now = (options.now ?? new Date()).getTime()
  const grantUntil = typeof grant.validUntil === 'string' ? Date.parse(grant.validUntil) : NaN
  // An acknowledgement may not outlive what it acknowledges (openvtc build_member_vmc).
  if (Number.isFinite(grantUntil) && grantUntil <= now) throw new MemberVmcNotPossible('grantExpired')

  return {
    '@context': [W3C_VC_V2_CONTEXT, DTG_CONTEXT_V1],
    type: ['VerifiableCredential', 'DTGCredential', 'MembershipCredential'],
    // Set before signing: the proof covers it, and the community keys the
    // stored credential by it, so a re-send is idempotent (openvtc members.rs:95-104).
    id: options.id ?? `urn:uuid:${utils.uuid()}`,
    issuer: personaDid,
    issuerScope: MEMBER_ISSUER_SCOPE,
    validFrom: wireInstant(now),
    ...(Number.isFinite(grantUntil) ? { validUntil: wireInstant(grantUntil) } : {}),
    credentialSubject: { id: community, digestMultibase: grantDigest(grant) },
  }
}

/** Sign the acknowledgement as the persona, for `assertionMethod`, with the key borrowed for the session. */
export function signMemberVmc(
  agent: Agent,
  persona: Pick<VtiPersona, 'did' | 'kmsKeyIds' | 'vtaKeyIds'>,
  vc: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return signDocumentProof(agent, vc, persona.did, {
    kmsKeyId: persona.kmsKeyIds?.signing,
    verificationMethodId: persona.vtaKeyIds.signing,
  })
}

/** The community's receipt (`#response` payload). */
export type MemberVmcReceipt = { memberDid?: string; vmcId?: string; status?: string; requestId?: string }

/** Sends one acknowledgement and returns the receipt; throws on a refusal or no answer. */
export type MemberVmcSend = (
  communityDid: string,
  vc: Record<string, unknown>,
  requestId?: string
) => Promise<MemberVmcReceipt>

export type ReciprocateOutcome = 'acknowledged' | 'alreadyAcknowledged' | 'notOwed' | 'notPossible'

/** Whether this membership's grant already has an acknowledgement the community stored. */
export function acknowledged(membership: VtiMembership): boolean {
  const ack = membership.memberVmc
  if (!ack || !membership.memberVmcAckedAt) return false
  const subject = ack.credentialSubject as { digestMultibase?: unknown } | undefined
  return subject?.digestMultibase === grantDigest(membership.vmc)
}

const inFlight = new Map<string, Promise<ReciprocateOutcome>>()

/**
 * Issue the member's acknowledgement of its membership, once, and record the
 * community's receipt.
 *
 * - Nothing for a removed membership, nor for one already acknowledged
 *   (unless `force`: the community asked again, `request-vmc`).
 * - The acknowledgement is made once per grant and kept on the membership
 *   before it is sent, so a re-send — a lost answer, the community asking
 *   again — carries the same credential (the community keys it by `id`).
 *   A renewed grant gets a new one: its digest no longer matches.
 * - Two callers at once (the join and the delivery inbox both see the same
 *   admission) share one send.
 */
export function reciprocateMembership(deps: {
  agent: Agent
  store: VtiCommunityStore
  persona: Pick<VtiPersona, 'did' | 'kmsKeyIds' | 'vtaKeyIds'>
  communityDid: string
  send: MemberVmcSend
  requestId?: string
  force?: boolean
  now?: Date
}): Promise<ReciprocateOutcome> {
  const key = `${deps.communityDid}|${deps.persona.did}`
  const running = inFlight.get(key)
  if (running) return running
  const work = reciprocateOnce(deps).finally(() => inFlight.delete(key))
  inFlight.set(key, work)
  return work
}

async function reciprocateOnce(deps: Parameters<typeof reciprocateMembership>[0]): Promise<ReciprocateOutcome> {
  const { agent, store, persona, communityDid } = deps
  const membership = await store.getMembership(communityDid, persona.did)
  if (!membership || membership.personaDid !== persona.did || !isCurrentMembership(membership)) return 'notOwed'
  if (!deps.force && acknowledged(membership)) return 'alreadyAcknowledged'

  let vc = membership.memberVmc
  const bound = (vc?.credentialSubject as { digestMultibase?: unknown } | undefined)?.digestMultibase
  if (!vc || bound !== grantDigest(membership.vmc)) {
    try {
      vc = await signMemberVmc(agent, persona, buildMemberVmc(membership.vmc, persona.did, { now: deps.now }))
    } catch (e) {
      if (!(e instanceof MemberVmcNotPossible)) throw e
      agent.config?.logger?.warn?.(`[VTI] ${e.message}; the community's half of the membership stands alone`)
      return 'notPossible'
    }
    await store.saveMembership({ ...membership, memberVmc: vc, memberVmcAckedAt: undefined })
  }

  const receipt = await deps.send(communityDid, vc, deps.requestId)
  if (receipt.status !== 'stored')
    throw new Error(`vtiMemberVmc: the community answered "${String(receipt.status)}", not "stored"`)
  const latest = (await store.getMembership(communityDid, persona.did)) ?? membership
  await store.saveMembership({ ...latest, memberVmc: vc, memberVmcAckedAt: new Date().toISOString() })
  agent.config?.logger?.info?.(
    `[VTI] the community stored this member's acknowledgement (${String(receipt.vmcId ?? vc.id)})`
  )
  return 'acknowledged'
}
