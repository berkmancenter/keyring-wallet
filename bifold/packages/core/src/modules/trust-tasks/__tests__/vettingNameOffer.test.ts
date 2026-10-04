/**
 * Vetting's legal-name step, opened from a vetter's ticket: there is no "Join
 * as", so nothing seeds the name, and the profile from onboarding was nowhere
 * ("I don't see my profile", TestFlight 231). The active profile's name is
 * offered — never filled in, since a profile's name is how the person shows
 * up, not necessarily their legal name.
 */
import { offeredProfileName, type JoinAsOption } from '../screens/JoinAs'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const work: JoinAsOption = { id: 'work', seed: { legalName: 'Alberto Leon', profileLabel: 'Work' } }
const home: JoinAsOption = { id: 'home', seed: { legalName: 'Alberto L', profileLabel: 'Home' } }

describe('the name vetting offers', () => {
  it("the active profile's name, when nothing seeded the field", () => {
    expect(offeredProfileName(undefined, [work, home], 'home')).toEqual(home.seed)
  })

  it('nothing, when "Join as" already chose a profile (the field is filled from it)', () => {
    expect(offeredProfileName({ legalName: 'Alberto Leon' }, [work, home], 'home')).toBeUndefined()
  })

  it('nothing, with no profile that has a name', () => {
    expect(offeredProfileName(undefined, [], undefined)).toBeUndefined()
  })
})
