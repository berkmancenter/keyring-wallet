import { renderHook, waitFor } from '@testing-library/react-native'

import { MEMBER_BADGES } from '../badgesSwitch'
import { createFakeBadgeService } from '../fakeBadgeService'
import { resetBadgeService, setBadgeServiceForTests, useMemberWall, useMyBadges } from '../useBadges'

// The shared navigation mock runs the focus callback, then its cleanup, on every render.
jest.mock('../agentBadgesBackend', () => ({ createAgentBadgesBackend: jest.fn() }))
jest.mock('@bifold/react-hooks', () => ({ useAgent: () => ({ agent: undefined }) }))

const COMMUNITY = 'did:webvh:example:community'
const SHIPPED = { ...MEMBER_BADGES }
afterEach(() => {
  Object.assign(MEMBER_BADGES, SHIPPED)
  resetBadgeService()
})

describe('useMyBadges', () => {
  it('with no service: renders once and settles, reading nothing (the loop eb found)', () => {
    const { result } = renderHook(() => useMyBadges(COMMUNITY))
    expect(result.current).toMatchObject({ served: false, loading: false, badges: undefined })
  })

  it("shows the member's badges, and stops reading once settled, under a navigator that focuses every render", async () => {
    const fake = createFakeBadgeService()
    const mine = jest.spyOn(fake, 'mine')
    setBadgeServiceForTests(fake)
    const { result } = renderHook(() => useMyBadges(COMMUNITY))
    await waitFor(() => expect(result.current.served).toBe(true))
    expect(result.current.badges?.held.map((b) => b.name)).toEqual(['Helper', 'Thanks!'])
    expect(result.current.loading).toBe(false)
    // The reads stop: an answer equal to what is shown sets nothing, so nothing renders again to read again.
    const settled = mine.mock.calls.length
    await new Promise((r) => setTimeout(r, 50))
    expect(mine.mock.calls).toHaveLength(settled)
    expect(settled).toBeLessThanOrEqual(3)
  })

  it('a community that does not serve badges reads as not served', async () => {
    setBadgeServiceForTests(createFakeBadgeService({ mine: 'notServed' }))
    const { result } = renderHook(() => useMyBadges(COMMUNITY))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.served).toBe(false)
  })

  it('shows nothing while badges are off, even with a service in place', () => {
    setBadgeServiceForTests(createFakeBadgeService())
    MEMBER_BADGES.remoteOff = true
    const { result } = renderHook(() => useMyBadges(COMMUNITY))
    expect(result.current).toMatchObject({ served: false, loading: false, badges: undefined })
  })
})

describe('useMemberWall', () => {
  it('with no entry: not served, reading nothing', () => {
    const fake = createFakeBadgeService()
    const wall = jest.spyOn(fake, 'wall')
    setBadgeServiceForTests(fake)
    const { result } = renderHook(() => useMemberWall(COMMUNITY, undefined))
    expect(result.current).toEqual({ state: 'notServed' })
    expect(wall).not.toHaveBeenCalled()
  })

  it('shows the wall the community shows', async () => {
    setBadgeServiceForTests(createFakeBadgeService())
    const { result } = renderHook(() => useMemberWall(COMMUNITY, 'dir_x'))
    await waitFor(() => expect(result.current.state).toBe('shown'))
    expect(result.current.wall?.map((b) => b.name)).toEqual(['Helper'])
  })

  it('a wall it may not see reads as hidden', async () => {
    setBadgeServiceForTests(createFakeBadgeService({ wall: 'hidden' }))
    const { result } = renderHook(() => useMemberWall(COMMUNITY, 'dir_x'))
    await waitFor(() => expect(result.current.state).toBe('hidden'))
  })
})
