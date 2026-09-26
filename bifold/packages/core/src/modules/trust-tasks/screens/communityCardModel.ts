/**
 * One community on "Your agent": where this phone stands with it, in one line,
 * and the one thing to do next (IN-20c). Everything the agent holds for the
 * community sits under it, instead of in one list for all of them.
 *
 * Pure, so each state's line and button are tested as a table.
 *
 * @module trust-tasks/screens/communityCardModel
 */

import type { CommunityJoinState } from '../module/vtiJoin'

export interface CommunityCardFacts {
  /** From the community journey; undefined until it is read. */
  join?: CommunityJoinState
  /** This phone holds an identity for the community. */
  hasIdentity: boolean
  /** An invitation for that identity is waiting. */
  invited: boolean
  /** A vetter grant for the community stands. */
  vetter: boolean
}

export type CommunityCardPrimary = 'openDesk' | 'continueVetting' | 'acceptInvitation'

export interface CommunityCardModel {
  /** The translation key of the status line (it takes `{{community}}`). */
  statusKey: string
  primary?: CommunityCardPrimary
}

export function communityCardModel(facts: CommunityCardFacts): CommunityCardModel {
  const model = standing(facts)
  // The desk is a standing vetter's one way in from "Your agent" — the vetter
  // card above no longer repeats it — so it is the card's next step even
  // before this phone holds the membership.
  return facts.vetter && model.primary !== 'acceptInvitation' ? { ...model, primary: 'openDesk' } : model
}

function standing(facts: CommunityCardFacts): CommunityCardModel {
  const kind = facts.join?.kind ?? 'none'
  if (kind === 'member') {
    return { statusKey: 'Join.StandingMember', primary: facts.vetter ? 'openDesk' : undefined }
  }
  if (facts.invited) return { statusKey: 'VtaLink.InvitationWaiting', primary: 'acceptInvitation' }
  switch (kind) {
    case 'sent':
      return { statusKey: 'Join.StandingSent' }
    case 'pending':
      return { statusKey: 'Join.StandingPending' }
    case 'deferred':
      return { statusKey: 'Join.StandingDeferred', primary: 'continueVetting' }
    case 'rejected':
      return { statusKey: 'Join.StandingRejected' }
    case 'withdrawn':
      return { statusKey: 'Join.StandingWithdrawn' }
    case 'removed':
      return { statusKey: 'Join.StandingRemoved' }
    case 'left':
      return { statusKey: 'Join.StandingLeft' }
    default:
      // An identity made for the community, and nothing sent yet: the way on
      // is the vetting that makes the application.
      return facts.hasIdentity
        ? { statusKey: 'VtaLink.IdentityFor', primary: 'continueVetting' }
        : { statusKey: 'VtaLink.IdentityFor' }
  }
}
