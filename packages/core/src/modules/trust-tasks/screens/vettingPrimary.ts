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
import { VtiVettingIds, type VtiVettingId } from './VtiVetting.ids'

/**
 * The desk's steps. 'share' is a ticket cut on this visit and not yet used:
 * with 'ticket' filling "New ticket" there too, the vetter who had just cut
 * one was pointed at cutting another rather than at handing it over.
 */
export type VetterStep = 'ticket' | 'share' | 'request' | 'match' | 'waitCard' | 'check' | 'done'
export type ApplicantStep = 'member' | 'name' | 'waiting' | 'match' | 'send' | 'checking' | 'apply' | 'ticket'

/** The testID (stem) of the desk step's one filled button; none while there is only waiting to do. */
export function deskPrimary(step: VetterStep): VtiVettingId | undefined {
  switch (step) {
    case 'ticket':
      return VtiVettingIds.newTicketButton
    case 'share':
      return VtiVettingIds.copyTicketLink
    case 'request':
      return VtiVettingIds.openSessionButton
    case 'match':
      return VtiVettingIds.codesMatch
    case 'check':
      return VtiVettingIds.attestButton
    case 'done':
      return VtiVettingIds.vetSomeoneElse
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
export function applicantPrimary(step: ApplicantStep, state: ApplicantPrimaryState): VtiVettingId | undefined {
  const askVetter = state.ticketLinkReady ? VtiVettingIds.requestButton : VtiVettingIds.scanTicketButton
  switch (step) {
    case 'member':
      return VtiVettingIds.goToMyAgent
    case 'name':
      return VtiVettingIds.startButton
    case 'ticket':
      return askVetter
    case 'match':
      return VtiVettingIds.codesMatch
    case 'send':
      return VtiVettingIds.sendCardButton
    case 'apply':
      return state.meets ? VtiVettingIds.applyButton : askVetter
    case 'waiting':
    case 'checking':
      return undefined
  }
}
