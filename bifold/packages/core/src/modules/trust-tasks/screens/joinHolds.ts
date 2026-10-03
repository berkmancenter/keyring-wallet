/**
 * What this phone holds towards a community, for the Join screen's reading of
 * its ways in (`joinAsks`): an invitation the community issued to it, and the
 * vetting statements it has gathered. Read from the wallet's own records;
 * nothing is asked of the community. A store that cannot be read is "holds
 * nothing known", never an error on the way to what the community asks.
 *
 * @module trust-tasks/screens/joinHolds
 */
import type { Agent } from '@credo-ts/core'

import type { JoinHolds } from '../module/joinManifest'
import { GenericRecordsCommunityStore } from '../module/VtiCommunityStore'
import { GenericRecordsIdentityStore } from '../module/VtiIdentityStore'
import { GenericRecordsVettingStore } from '../module/vtiVetting'

export async function readJoinHolds(agent: Agent, communityDid: string): Promise<JoinHolds> {
  const [invitations, application, persona] = await Promise.all([
    new GenericRecordsCommunityStore(agent).listInvitations().catch(() => []),
    new GenericRecordsVettingStore(agent).getApplication(communityDid).catch(() => undefined),
    new GenericRecordsIdentityStore(agent).getPersona(communityDid).catch(() => undefined),
  ])
  // Statements count only for the identity they were gathered for: an earlier
  // identity's, kept after a removal, would read a vetting way as met for a
  // request that carries none of them (IN-104).
  const ownApplication = application && persona && application.joinDid === persona.did ? application : undefined
  return {
    invitation: invitations.some((invitation) => invitation.communityDid === communityDid),
    statements: (ownApplication?.requests ?? []).filter((request) => request.status === 'attested').length,
  }
}
