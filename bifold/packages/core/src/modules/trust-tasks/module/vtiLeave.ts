/**
 * Leaving a community, from the person's side: the phone forgets its persona,
 * membership, invitations and vetting state for that community. The VTA keeps
 * the persona's keys, and the community keeps its own record of the member.
 * Rejoining starts over — a community refuses to invite a current member
 * (VTI-6), which is also why the harness resets an applicant this way.
 *
 * Formerly the Developer screen's "forget this community"; it is a person's
 * action, so it lives on the community screen (UI/UX plan U1).
 *
 * @module trust-tasks/module/vtiLeave
 */

import type { Agent } from '@credo-ts/core'

import { GenericRecordsCommunityStore } from './VtiCommunityStore'
import { GenericRecordsIdentityStore } from './VtiIdentityStore'
import { GenericRecordsVettingStore } from './vtiVetting'

export async function leaveCommunity(agent: Agent, communityDid: string): Promise<void> {
  // TODO(TSP Rev 3): end the relationship with the community VTC before the
  // persona is dropped — send an XRFD (`packCancelRev3`, @bifold/trust-tasks)
  // from the persona's TSP session, naming the relationship by the threadDigest
  // of the XRFI we sent. That needs the invite digest persisted per peer when
  // vtiAgent greets (its `greeted` set is in memory only today). Upstream
  // accepts our cancel (ref-04s-rev3-relationship); the VTA's answering cancel
  // fails upstream (VTI-38), which does not affect us.
  await new GenericRecordsIdentityStore(agent).forgetPersona(communityDid)
  await new GenericRecordsCommunityStore(agent).forgetCommunity(communityDid)
  await new GenericRecordsVettingStore(agent).forget(communityDid)
}
