/**
 * VtiCommunityStore — what this wallet holds *about* communities: the
 * invitations it has been handed and the memberships it has been granted.
 *
 * Kept apart from `VtiIdentityStore` (which DIDs the wallet presents) on
 * purpose: an identity can exist with no community, and a membership card
 * outlives the session that earned it. Both stores are interfaces so the
 * Credo-records implementation can be swapped for another without touching
 * the join flow or the screens.
 *
 * A membership is the pair of credentials an `allow` verdict carries inline
 * (`verdict.with.vmc`, the membership credential, and `verdict.with.roleVec`,
 * the role endorsement — measured in ref-20) or that
 * `credential-exchange/issue/0.1` delivers later. The card the Wallet shows
 * is drawn from these; they are stored verbatim so a verifier can be shown
 * exactly what the community signed.
 *
 * @module trust-tasks/module/VtiCommunityStore
 */

import type { Agent } from '@credo-ts/core'

export interface VtiInvitation {
  /** The invitation credential's own id. */
  id: string
  /** The community that issued it (the credential's issuer). */
  communityDid: string
  /** The DID it was issued to — the persona that must present it. */
  subjectDid: string
  role: string
  /** The `InvitationCredential` verbatim, to be presented on join. */
  credential: Record<string, unknown>
  receivedAt: string
  validUntil?: string
  status: 'pending' | 'used' | 'declined'
}

export interface VtiMembership {
  communityDid: string
  /** The persona that holds the membership. */
  personaDid: string
  role: string
  /** `MembershipCredential`, verbatim. */
  vmc: Record<string, unknown>
  /** `EndorsementCredential` for the role, verbatim, when the community sent one. */
  roleVec?: Record<string, unknown>
  grantedAt: string
  validUntil?: string
  /** How the membership was earned — what the card says under the name. */
  via: 'invitation' | 'vetting' | 'approval' | 'unknown'
}

/**
 * A join request this phone sent, and what the community has said about it —
 * so a screen can say "Sent — waiting for the community" until the community
 * answers, and what it answered after that (p220 item 7). Written before the
 * send, so a request whose answer was lost is still known to exist; the
 * community's status task (`join-requests/status/0.1`) fills it in later.
 */
export interface JoinSubmission {
  communityDid: string
  /** The persona the request was sent as. */
  personaDid: string
  requestId?: string
  sentAt: string
  /** When the community first answered, with a verdict or a refusal. Absent: sent, no answer yet. */
  acknowledgedAt?: string
  /** Whether an invitation went with the request. */
  withInvitation: boolean
  via: 'join' | 'vetting'
  /** The request's state as the community last stated it. */
  status?: 'pending' | 'deferred' | 'approved' | 'rejected' | 'withdrawn'
  /** What the community still needs, verbatim, while `deferred`. */
  needs?: string[]
  /** The community's refusal, while `rejected`: a stable `code`, its own words, when it decided. */
  rejection?: { code: string; reason?: string; decidedAt?: string }
}

export interface VtiCommunityStore {
  listInvitations(): Promise<VtiInvitation[]>
  saveInvitation(invitation: VtiInvitation): Promise<void>
  getMembership(communityDid: string): Promise<VtiMembership | undefined>
  listMemberships(): Promise<VtiMembership[]>
  saveMembership(membership: VtiMembership): Promise<void>
  /** Drop the membership and every invitation for a community — a person starting over. */
  forgetCommunity(communityDid: string): Promise<void>
  /** Credentials a community or a vetter delivered that are not the membership itself. */
  saveHeldCredential(item: VtiHeldCredential): Promise<void>
  listHeldCredentials(kind?: VtiHeldCredential['kind'], communityDid?: string): Promise<VtiHeldCredential[]>
  /** The last join request sent to a community. Optional: a store without it records none. */
  getSubmission?(communityDid: string): Promise<JoinSubmission | undefined>
  saveSubmission?(submission: JoinSubmission): Promise<void>
}

export interface VtiHeldCredential {
  kind: 'role' | 'vetter-grant' | 'vetting-statement' | 'other'
  communityDid: string
  subjectDid: string
  credential: Record<string, unknown>
  receivedAt: string
}

const RECORD_TYPE = 'keyring/vti-community'

/**
 * What names a held credential. Its own `id` when it has one; otherwise its
 * content, so the same credential delivered twice — the vetting screen and the
 * persona inbox both store what arrives — is one record, not two. Keying the
 * fallback on the arrival time counted one statement as several ("2 of 1").
 */
export function heldCredentialKey(item: Pick<VtiHeldCredential, 'kind' | 'communityDid' | 'credential'>): string {
  const id = (item.credential as { id?: unknown }).id
  if (typeof id === 'string' && id) return id
  // FNV-1a over the credential, stable across launches and cheap; a record key
  // needs to be the same for the same content, not unguessable.
  const text = JSON.stringify(item.credential)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${item.kind}:${item.communityDid}:${hash.toString(16)}`
}

/** Credo generic records, one per invitation or membership, tagged for lookup. */
export class GenericRecordsCommunityStore implements VtiCommunityStore {
  constructor(private readonly agent: Agent) {}

  private async put(kind: string, key: string, content: Record<string, unknown>): Promise<void> {
    const existing = await this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE, kind, key })
    if (existing[0]) {
      existing[0].content = content
      await this.agent.genericRecords.update(existing[0])
      return
    }
    await this.agent.genericRecords.save({ content, tags: { recordType: RECORD_TYPE, kind, key } })
  }

  private async list<T>(kind: string): Promise<T[]> {
    const records = await this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE, kind })
    return records.map((record) => record.content as unknown as T)
  }

  listInvitations() {
    return this.list<VtiInvitation>('invitation')
  }

  saveInvitation(invitation: VtiInvitation) {
    return this.put('invitation', invitation.id, { ...invitation })
  }

  async getMembership(communityDid: string) {
    const records = await this.agent.genericRecords.findAllByQuery({
      recordType: RECORD_TYPE,
      kind: 'membership',
      key: communityDid,
    })
    return records[0]?.content as unknown as VtiMembership | undefined
  }

  listMemberships() {
    return this.list<VtiMembership>('membership')
  }

  saveMembership(membership: VtiMembership) {
    return this.put('membership', membership.communityDid, { ...membership })
  }

  async forgetCommunity(communityDid: string) {
    const memberships = await this.agent.genericRecords.findAllByQuery({
      recordType: RECORD_TYPE,
      kind: 'membership',
      key: communityDid,
    })
    const invitations = (await this.listInvitationRecords()).filter(
      (r) => (r.content as unknown as VtiInvitation).communityDid === communityDid
    )
    const held = (
      await this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE, kind: 'credential' })
    ).filter((r) => (r.content as unknown as VtiHeldCredential).communityDid === communityDid)
    for (const record of [...memberships, ...invitations, ...held]) await this.agent.genericRecords.delete(record)
  }

  private listInvitationRecords() {
    return this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE, kind: 'invitation' })
  }

  async getSubmission(communityDid: string) {
    const records = await this.agent.genericRecords.findAllByQuery({
      recordType: RECORD_TYPE,
      kind: 'submission',
      key: communityDid,
    })
    return records[0]?.content as unknown as JoinSubmission | undefined
  }

  saveSubmission(submission: JoinSubmission) {
    return this.put('submission', submission.communityDid, { ...submission })
  }

  saveHeldCredential(item: VtiHeldCredential) {
    return this.put('credential', heldCredentialKey(item), { ...item })
  }

  async listHeldCredentials(kind?: VtiHeldCredential['kind'], communityDid?: string) {
    const all = await this.list<VtiHeldCredential>('credential')
    const wanted = all.filter((c) => (!kind || c.kind === kind) && (!communityDid || c.communityDid === communityDid))
    // One credential, once — however many times it arrived. Records written
    // before the key was content-addressed can hold the same credential twice.
    const byIdentity = new Map<string, VtiHeldCredential>()
    for (const c of wanted) {
      const key = heldCredentialKey(c)
      const seen = byIdentity.get(key)
      if (!seen || c.receivedAt < seen.receivedAt) byIdentity.set(key, c)
    }
    return [...byIdentity.values()]
  }
}
