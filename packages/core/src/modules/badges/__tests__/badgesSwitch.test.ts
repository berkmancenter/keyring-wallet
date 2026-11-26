jest.mock('../agentBadgesBackend', () => ({ createAgentBadgesBackend: jest.fn() }))

import { areBadgesInWallet, BADGES_IN_WALLET, isMemberBadgesOn, MEMBER_BADGES } from '../badgesSwitch'
import { createFakeBadgeService } from '../fakeBadgeService'
import { badgeServiceFor, resetBadgeService, setBadgeServiceForTests } from '../useBadges'

const SHIPPED = { ...MEMBER_BADGES }
const SHIPPED_IN_WALLET = { ...BADGES_IN_WALLET }
afterEach(() => {
  Object.assign(MEMBER_BADGES, SHIPPED)
  Object.assign(BADGES_IN_WALLET, SHIPPED_IN_WALLET)
  resetBadgeService()
})

describe('the badges switch', () => {
  it('ships on, with no remote off', () => {
    expect(SHIPPED).toEqual({ on: true, remoteOff: false })
    expect(isMemberBadgesOn()).toBe(true)
  })

  it('is off when turned off remotely, whatever `on` says', () => {
    MEMBER_BADGES.remoteOff = true
    expect(isMemberBadgesOn()).toBe(false)
  })

  it('is off when `on` is false', () => {
    MEMBER_BADGES.on = false
    expect(isMemberBadgesOn()).toBe(false)
  })

  it('reads anything not plainly on as off', () => {
    Object.assign(MEMBER_BADGES, { on: 'yes' as unknown as boolean })
    expect(isMemberBadgesOn()).toBe(false)
    Object.assign(MEMBER_BADGES, { on: true, remoteOff: undefined as unknown as boolean })
    expect(isMemberBadgesOn()).toBe(false)
  })
})

describe('the Wallet badges switch', () => {
  it('ships not showing badges in the Wallet, with no remote off', () => {
    expect(SHIPPED_IN_WALLET).toEqual({ on: false, remoteOff: false })
    expect(areBadgesInWallet()).toBe(false)
  })

  it('shows them only while on and not turned off remotely', () => {
    Object.assign(BADGES_IN_WALLET, { on: true, remoteOff: false })
    expect(areBadgesInWallet()).toBe(true)
    BADGES_IN_WALLET.remoteOff = true
    expect(areBadgesInWallet()).toBe(false)
  })

  it('reads anything not plainly on as off', () => {
    Object.assign(BADGES_IN_WALLET, { on: 'yes' as unknown as boolean, remoteOff: false })
    expect(areBadgesInWallet()).toBe(false)
    Object.assign(BADGES_IN_WALLET, { on: true, remoteOff: undefined as unknown as boolean })
    expect(areBadgesInWallet()).toBe(false)
  })

  it('leaves the badges themselves on: the community page still shows them', () => {
    expect(isMemberBadgesOn()).toBe(true)
  })
})

describe('the badge service a screen gets', () => {
  it('is the injected one while badges are on', () => {
    const fake = createFakeBadgeService()
    setBadgeServiceForTests(fake)
    expect(badgeServiceFor(undefined)).toBe(fake)
  })

  it('is none while badges are off, even when one is injected (the kill hides every surface)', () => {
    setBadgeServiceForTests(createFakeBadgeService())
    MEMBER_BADGES.remoteOff = true
    expect(badgeServiceFor(undefined)).toBeUndefined()
  })

  it('is none before the agent is up and no service is injected', () => {
    expect(badgeServiceFor(undefined)).toBeUndefined()
  })
})
