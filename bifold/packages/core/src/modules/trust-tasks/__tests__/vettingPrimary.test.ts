/**
 * The one filled button on each vetting step (vettingPrimary): a table of every
 * step on both sides.
 */
import { applicantPrimary, deskPrimary } from '../screens/vettingPrimary'

describe('the desk: one next action per step', () => {
  test.each([
    ['ticket', 'VettingNewTicketButton'],
    // A ticket just cut: hand it over, not cut another.
    ['share', 'VettingCopyTicketLink'],
    ['request', 'VettingOpenSessionButton'],
    ['match', 'VettingCodesMatch'],
    ['waitCard', undefined],
    ['check', 'VettingAttestButton'],
    ['done', 'VettingVetSomeoneElse'],
  ] as const)('%s → %s', (step, id) => {
    expect(deskPrimary(step)).toBe(id)
  })
})

describe('the applicant: one next action per step', () => {
  const none = { ticketLinkReady: false, meets: false }
  test.each([
    ['member', none, 'VettingGoToMyAgent'],
    ['name', none, 'VettingStartButton'],
    ['ticket', none, 'VettingScanTicketButton'],
    ['ticket', { ...none, ticketLinkReady: true }, 'VettingRequestButton'],
    ['waiting', none, undefined],
    ['match', none, 'VettingCodesMatch'],
    ['send', none, 'VettingSendCardButton'],
    ['checking', none, undefined],
    ['apply', { ...none, meets: true }, 'VettingApplyButton'],
    ['apply', none, 'VettingScanTicketButton'],
    ['apply', { ...none, ticketLinkReady: true }, 'VettingRequestButton'],
  ] as const)('%s %o → %s', (step, state, id) => {
    expect(applicantPrimary(step, state)).toBe(id)
  })
})
