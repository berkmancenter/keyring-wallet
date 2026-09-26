/**
 * The one filled button on each vetting step: the thing to do next. Everything
 * else on the step is outlined. Two or three filled buttons at once left people
 * guessing which was the step (a desk with New ticket, Copy link and Publish
 * all filled; Scan still filled after a link was pasted; Apply beside a grey
 * Withdraw).
 *
 * A list of cards may give each card its own; this is about the step.
 *
 * @module trust-tasks/screens/vettingPrimary
 */

/**
 * The desk's steps. 'share' is a ticket cut on this visit and not yet used:
 * with 'ticket' filling "New ticket" there too, the vetter who had just cut
 * one was pointed at cutting another rather than at handing it over.
 */
export type VetterStep = 'ticket' | 'share' | 'request' | 'match' | 'waitCard' | 'check' | 'done'
export type ApplicantStep = 'member' | 'name' | 'waiting' | 'match' | 'send' | 'checking' | 'apply' | 'ticket'

/** The testID (stem) of the desk step's one filled button; none while there is only waiting to do. */
export function deskPrimary(step: VetterStep): string | undefined {
  switch (step) {
    case 'ticket':
      return 'VettingNewTicketButton'
    case 'share':
      return 'VettingCopyTicketLink'
    case 'request':
      return 'VettingOpenSessionButton'
    case 'match':
      return 'VettingCodesMatch'
    case 'check':
      return 'VettingAttestButton'
    case 'done':
      return 'VettingVetSomeoneElse'
    case 'waitCard':
      return undefined
  }
}

export interface ApplicantPrimaryState {
  /** A ticket link is in the paste box, and it is for this community. */
  ticketLinkReady: boolean
  /** The statements gathered meet the community's criteria. */
  meets: boolean
}

/** The testID (stem) of the applicant step's one filled button; none while there is only waiting to do. */
export function applicantPrimary(step: ApplicantStep, state: ApplicantPrimaryState): string | undefined {
  const askVetter = state.ticketLinkReady ? 'VettingRequestButton' : 'VettingScanTicketButton'
  switch (step) {
    case 'member':
      return 'VettingGoToMyAgent'
    case 'name':
      return 'VettingStartButton'
    case 'ticket':
      return askVetter
    case 'match':
      return 'VettingCodesMatch'
    case 'send':
      return 'VettingSendCardButton'
    case 'apply':
      return state.meets ? 'VettingApplyButton' : askVetter
    case 'waiting':
    case 'checking':
      return undefined
  }
}
