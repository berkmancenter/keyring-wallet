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
import { GenericRecordsVettingStore } from '../module/vtiVetting'

export async function readJoinHolds(agent: Agent, communityDid: string): Promise<JoinHolds> {
  const [invitations, application] = await Promise.all([
    new GenericRecordsCommunityStore(agent).listInvitations().catch(() => []),
    new GenericRecordsVettingStore(agent).getApplication(communityDid).catch(() => undefined),
  ])
  return {
    invitation: invitations.some((invitation) => invitation.communityDid === communityDid),
    statements: (application?.requests ?? []).filter((request) => request.status === 'attested').length,
  }
}
