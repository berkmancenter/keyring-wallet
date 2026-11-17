jest.mock('../agentBadgesBackend', () => ({ createAgentBadgesBackend: jest.fn() }))

import { isMemberBadgesOn, MEMBER_BADGES } from '../badgesSwitch'
import { createFakeBadgeService } from '../fakeBadgeService'
import { badgeServiceFor, resetBadgeService, setBadgeServiceForTests } from '../useBadges'

const SHIPPED = { ...MEMBER_BADGES }
afterEach(() => {
  Object.assign(MEMBER_BADGES, SHIPPED)
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
