/**
 * The vetting desk used to say nothing about the grant it was seated on, so a
 * vetter whose grant had been revoked — or re-granted, where the new grant
 * never arrived — sat at a desk that would refuse to sign, with nothing on
 * screen to explain it. What the desk says about each state is decided here,
 * apart from the screen, because the distinctions are the whole point.
 */
import { vetterStandingLine } from '../screens/vetterStanding'
import { vetterNotEligibleReason } from '../module/vtiGrantState'

describe('what the desk says about a vetter’s standing', () => {
  it('says nothing when the grant is live — a working vetter needs no notice', () => {
    expect(vetterStandingLine({ state: 'active', statusChecked: true })).toBeUndefined()
  })

  it('says nothing when there is no grant here: that is an applicant, not a broken vetter', () => {
    expect(vetterStandingLine({ state: 'none' })).toBeUndefined()
  })

  it('tells revoked and expired apart, and asks for the same remedy', () => {
    const revoked = vetterStandingLine({ state: 'revoked', checkedAt: '2026-09-22T00:00:00Z' })
    const expired = vetterStandingLine({ state: 'expired', validUntil: '2026-09-01T00:00:00Z' })
    expect(revoked?.line).toBe('Vetting.StandingRevoked')
    expect(expired?.line).toBe('Vetting.StandingExpired')
    expect(revoked?.line).not.toBe(expired?.line)
    expect(revoked?.ask).toBe(true)
    expect(expired?.ask).toBe(true)
  })

  it('does not ask for a grant that exists and has simply not started', () => {
    const waiting = vetterStandingLine({ state: 'notYetValid', validFrom: '2027-01-01T00:00:00Z' })
    expect(waiting?.line).toBe('Vetting.StandingNotYet')
    expect(waiting?.ask).toBe(false)
  })
})

/**
 * Two people are told about one fact: the vetter reads the desk, the applicant
 * receives `vetting/request:vetterNotEligible:<state>`. They must name the same
 * state, or a vetter argues "it expired" while the applicant was told
 * "revoked" about the very same grant. The refusal is built here by the
 * function that actually sends it, not by a copy of its format — a copy would
 * keep agreeing with itself while the two sides drifted apart.
 */
describe('the vetter and the applicant are told the same thing', () => {
  const cases = [
    { standing: { state: 'revoked', checkedAt: 'x' } as const, line: 'Vetting.StandingRevoked' },
    { standing: { state: 'expired', validUntil: 'x' } as const, line: 'Vetting.StandingExpired' },
    { standing: { state: 'notYetValid', validFrom: 'x' } as const, line: 'Vetting.StandingNotYet' },
  ]

  it.each(cases)('$standing.state reads the same on both sides', ({ standing, line }) => {
    expect(vetterStandingLine(standing)?.line).toBe(line)
    expect(vetterNotEligibleReason(standing.state)).toBe(`vetting/request:vetterNotEligible:${standing.state}`)
    for (const other of cases.filter((c) => c.standing.state !== standing.state)) {
      expect(vetterStandingLine(standing)?.line).not.toBe(other.line)
      expect(vetterNotEligibleReason(standing.state)).not.toBe(vetterNotEligibleReason(other.standing.state))
    }
  })

  it('a state the desk stays quiet about is one the applicant is never refused for', () => {
    // A live grant signs; a phone with no grant here has no desk and no ticket
    // of its own to redeem, so neither reaches the refusal.
    expect(vetterStandingLine({ state: 'active', statusChecked: true })).toBeUndefined()
    expect(vetterStandingLine({ state: 'none' })).toBeUndefined()
  })
})

describe('the words themselves', () => {
  // The screen renders keys; what a person reads lives in the string table.
  const copy = jest.requireActual('../../../localization/en/en.json').Vetting as Record<string, string>

  it('names the role a person recognises, in each case', () => {
    for (const key of ['StandingRevoked', 'StandingExpired', 'StandingNotYet']) {
      expect(copy[key]).toMatch(/vetter role/i)
    }
  })

  it('asks for something a person can actually do, and promises nothing', () => {
    expect(copy.StandingAsk).toMatch(/admin/i)
    // Delivery of a re-granted vetter role is a separate defect, so the app
    // must not suggest that retrying will fix this.
    expect(copy.StandingAsk).not.toMatch(/try again|retry|refresh/i)
  })

  it('does not tell someone who was a vetter that they never were', () => {
    expect(copy.StandingRevoked).not.toMatch(/not a vetter|never/i)
  })
})
