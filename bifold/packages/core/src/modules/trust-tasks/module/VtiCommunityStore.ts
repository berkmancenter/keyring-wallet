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

export interface VtiCommunityStore {
  listInvitations(): Promise<VtiInvitation[]>
  saveInvitation(invitation: VtiInvitation): Promise<void>
  getMembership(communityDid: string): Promise<VtiMembership | undefined>
  listMemberships(): Promise<VtiMembership[]>
  saveMembership(membership: VtiMembership): Promise<void>
}

const RECORD_TYPE = 'keyring/vti-community'

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
}
