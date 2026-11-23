import {
  isVrcModuleCredential,
  isWitnessCredential,
  isRCardTemplate,
  isPeerVrcCredential,
} from '../../src/modules/vrc/credentialTypes'

/**
 * Every VRC, VWC and R-Card is VCDM 2.0, so credo stores them as
 * W3cV2CredentialRecord — where `credential` is a private setter and reads back
 * as undefined. The wallet list's filter only understood the v1 shape
 * (`cred.credential` as an object), so all of them leaked into the Credentials
 * tab (device 2026-09-01). These pin the type sets the filter relies on, for
 * each shape the type can arrive in.
 */
describe('credentials hidden from the wallet list', () => {
  const vwcTypes = ['VerifiableCredential', 'DTGCredential', 'WitnessCredential']
  const vrcTypes = ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential']
  const rcardTemplateTypes = ['VerifiableCredential', 'RCardTemplate']
  const rcardTypes = ['VerifiableCredential', 'RelationshipCard']

  test.each([
    ['VWC', vwcTypes],
    ['VRC', vrcTypes],
    ['RCard template', rcardTemplateTypes],
    ['RCard', rcardTypes],
  ])('%s is a VRC-module credential and must be hidden', (_label, types) => {
    expect(isVrcModuleCredential(types)).toBe(true)
  })

  test('an ordinary credential is NOT hidden', () => {
    expect(isVrcModuleCredential(['VerifiableCredential', 'UniversityDegreeCredential'])).toBe(false)
  })

  // The three shapes the type can arrive in, mirroring the filter's sources.
  test('matches on a v1-style credential object', () => {
    expect(isVrcModuleCredential({ type: vwcTypes })).toBe(true)
  })

  test('matches on a v2 firstCredential object', () => {
    expect(isVrcModuleCredential({ type: vrcTypes })).toBe(true)
  })

  test('matches on a bare types array, as carried by the record tag', () => {
    expect(isVrcModuleCredential(rcardTemplateTypes)).toBe(true)
  })

  test('a VWC is still distinguishable from a peer VRC', () => {
    expect(isWitnessCredential(vwcTypes)).toBe(true)
    expect(isPeerVrcCredential(vwcTypes)).toBe(false)
    expect(isPeerVrcCredential(vrcTypes)).toBe(true)
    expect(isRCardTemplate(rcardTemplateTypes)).toBe(true)
  })
})

/**
 * A community's cards are DTG credentials too, and they belong in the Wallet
 * (agent-kept cards, 226). Keyed on DTGCredential, the Wallet hid them and
 * Contacts listed each community as an unnamed contact; both rules now key on
 * the relationship family. Shapes as communities issue them (membership and
 * role cards, and a vetter grant, which is a role).
 */
describe("a community's cards", () => {
  const membershipTypes = ['VerifiableCredential', 'DTGCredential', 'MembershipCredential']
  const roleTypes = ['VerifiableCredential', 'DTGCredential', 'EndorsementCredential']

  test.each([
    ['membership', membershipTypes],
    ['role', roleTypes],
  ])('a %s card shows in the Wallet and is not a contact', (_label, types) => {
    expect(isVrcModuleCredential(types)).toBe(false)
    expect(isVrcModuleCredential({ type: types })).toBe(false)
    expect(isVrcModuleCredential(JSON.stringify(types))).toBe(false)
    expect(isPeerVrcCredential(types)).toBe(false)
    expect(isPeerVrcCredential({ type: types })).toBe(false)
  })

  test('the relationship family stays hidden, and only a peer VRC is a contact', () => {
    const family = {
      VRC: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
      VWC: ['VerifiableCredential', 'DTGCredential', 'WitnessCredential'],
      'R-Card': ['VerifiableCredential', 'RelationshipCard'],
      'R-Card template': ['VerifiableCredential', 'RCardTemplate'],
    }
    for (const [label, types] of Object.entries(family)) {
      expect([label, isVrcModuleCredential(types)]).toEqual([label, true])
      expect([label, isPeerVrcCredential(types)]).toEqual([label, label === 'VRC'])
    }
  })
})
