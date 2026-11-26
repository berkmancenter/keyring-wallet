/**
 * A screen listing rooms reads them again when it comes back into view, and, after a read that failed, when the
 * app comes back to the foreground while it is in view. Never on its first focus (the mount reads), never on a
 * return to the foreground after a read that answered, and never while another screen is in view.
 *
 * In view, it also reads quietly after a read that failed, a bounded number of times, and once when the offers poll
 * reads an offer the list doesn't show.
 */
import { act, renderHook } from '@testing-library/react-native'
import { AppState } from 'react-native'

import { sampleCapabilities } from '../capabilities'
import type { RoomOffer, RoomsService } from '../types'
import { useMyRooms } from '../useMyRooms'
import { OFFERS_REREAD_RETRY_MS, REREAD_RETRY_MS, useRereadOnReturn } from '../useRereadOnReturn'
import { OFFERS_IDLE_POLL_MS, OFFERS_POLL_MS, useRoomOffersCount } from '../useRoomOffersCount'

let mockFocused = true
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useIsFocused: () => mockFocused,
}))

jest.mock('../../trust-tasks/module/vtaAgent', () => ({
  vtaAgent: { subscribe: () => () => undefined, agentAddress: () => 'did:webvh:QmA:agent.example' },
}))

const appIs = (state: string) =>
  Object.defineProperty(AppState, 'currentState', { value: state, writable: true, configurable: true })

let onAppState: ((state: string) => void) | undefined
beforeEach(() => {
  mockFocused = true
  onAppState = undefined
  appIs('active')
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (s: string) => void) => {
    onAppState = listener
    return { remove: jest.fn() }
  }) as never)
})
afterEach(() => jest.restoreAllMocks())

type Read = { failed: boolean; failures?: number; offersNotShown?: string; offersFailed?: boolean }

const mount = (failed: boolean, more: Omit<Read, 'failed'> = {}) => {
  const reload = jest.fn()
  const reread = jest.fn()
  const hook = renderHook(
    ({ failures = 0, offersNotShown = '', offersFailed = false, ...read }: Read) =>
      useRereadOnReturn({ reload, reread, failures, offersNotShown, offersFailed, ...read }),
    { initialProps: { failed, ...more } as Read }
  )
  return { reload, reread, hook }
}

const backAndForth = () =>
  act(() => {
    onAppState?.('background')
    onAppState?.('active')
  })

describe('reading rooms again on return', () => {
  it('on coming back into view, not on the first focus', () => {
    const { reload, hook } = mount(false)
    expect(reload).not.toHaveBeenCalled()
    mockFocused = false
    hook.rerender({ failed: false })
    mockFocused = true
    hook.rerender({ failed: false })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('on returning to the app after a read that failed', () => {
    const { reload } = mount(true)
    backAndForth()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('not on returning to the app after a read that answered (control for the one above)', () => {
    const { reload } = mount(false)
    backAndForth()
    expect(reload).not.toHaveBeenCalled()
  })

  it('reads the latest outcome: a read that fails after mount is read again on return', () => {
    const { reload, hook } = mount(false)
    hook.rerender({ failed: true })
    backAndForth()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('not while another screen is in view; coming back reads instead', () => {
    const { reload, hook } = mount(true)
    mockFocused = false
    hook.rerender({ failed: true })
    backAndForth()
    expect(reload).not.toHaveBeenCalled()
    mockFocused = true
    hook.rerender({ failed: true })
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('reading rooms again after a read that failed', () => {
  const advance = (ms: number) => act(async () => jest.advanceTimersByTime(ms))
  const [first, second, third] = REREAD_RETRY_MS

  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('after each step in turn, then waits; quietly, never as a reload', async () => {
    const { reload, reread, hook } = mount(true, { failures: 1 })
    await advance(first - 1)
    expect(reread).not.toHaveBeenCalled()
    await advance(1)
    expect(reread).toHaveBeenCalledTimes(1)

    hook.rerender({ failed: true, failures: 2 })
    await advance(second - 1)
    expect(reread).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(reread).toHaveBeenCalledTimes(2)

    hook.rerender({ failed: true, failures: 3 })
    await advance(third - 1)
    expect(reread).toHaveBeenCalledTimes(2)
    await advance(1)
    expect(reread).toHaveBeenCalledTimes(3)

    hook.rerender({ failed: true, failures: 4 })
    await advance(3_600_000)
    expect(reread).toHaveBeenCalledTimes(3)
    expect(reload).not.toHaveBeenCalled()
  })

  it('none after a read that answered (control for the one above)', async () => {
    const { reread } = mount(false)
    await advance(3_600_000)
    expect(reread).not.toHaveBeenCalled()
  })

  it('a read that answers cancels the one waiting', async () => {
    const { reread, hook } = mount(true, { failures: 1 })
    hook.rerender({ failed: false, failures: 0 })
    await advance(3_600_000)
    expect(reread).not.toHaveBeenCalled()
  })

  it('not while another screen is in view', async () => {
    const { reread, hook } = mount(true, { failures: 1 })
    mockFocused = false
    hook.rerender({ failed: true, failures: 1 })
    await advance(3_600_000)
    expect(reread).not.toHaveBeenCalled()
  })

  it('not with the app away: the return reads, as after any failure', async () => {
    appIs('background')
    const { reload, reread } = mount(true, { failures: 1 })
    await advance(3_600_000)
    expect(reread).not.toHaveBeenCalled()
    backAndForth()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('reading rooms again for an offer the list does not show', () => {
  it('once for those offers, again for others', () => {
    const { reload, reread, hook } = mount(false)
    expect(reread).not.toHaveBeenCalled()
    hook.rerender({ failed: false, offersNotShown: 'o1' })
    expect(reread).toHaveBeenCalledTimes(1)
    hook.rerender({ failed: false, offersNotShown: 'o1' })
    expect(reread).toHaveBeenCalledTimes(1)
    hook.rerender({ failed: false, offersNotShown: 'o1\no2' })
    expect(reread).toHaveBeenCalledTimes(2)
    expect(reload).not.toHaveBeenCalled()
  })

  it('not when the list shows them all (control for the one above)', () => {
    const { reread, hook } = mount(false)
    hook.rerender({ failed: false, offersNotShown: '' })
    expect(reread).not.toHaveBeenCalled()
  })

  it('not while another screen is in view; coming back reads once, as a reload', () => {
    const { reload, reread, hook } = mount(false)
    mockFocused = false
    hook.rerender({ failed: false })
    hook.rerender({ failed: false, offersNotShown: 'o1' })
    expect(reread).not.toHaveBeenCalled()
    mockFocused = true
    hook.rerender({ failed: false, offersNotShown: 'o1' })
    expect(reread).not.toHaveBeenCalled()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

// IN-704-7: the one read made for an offer the list doesn't show can fail in its offers alone (the rooms list on
// their own). Nothing read again then: the rooms' retries follow the rooms, and the unshown offers were the same.
describe('the read for an unshown offer whose offers failed', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())
  const pass = (ms: number) => act(() => void jest.advanceTimersByTime(ms))

  it('is made once more after the wait, and not before', () => {
    const { reload, reread, hook } = mount(false)
    hook.rerender({ failed: false, offersNotShown: 'o1' })
    expect(reread).toHaveBeenCalledTimes(1)
    // That read's offers failed; its rooms answered.
    hook.rerender({ failed: false, offersNotShown: 'o1', offersFailed: true })
    pass(OFFERS_REREAD_RETRY_MS - 1)
    expect(reread).toHaveBeenCalledTimes(1)
    pass(1)
    expect(reread).toHaveBeenCalledTimes(2)
    expect(reload).not.toHaveBeenCalled()
  })

  it('control: a read whose offers answered is not made again, however long the offer stays unshown', () => {
    const { reread, hook } = mount(false)
    hook.rerender({ failed: false, offersNotShown: 'o1' })
    hook.rerender({ failed: false, offersNotShown: 'o1', offersFailed: false })
    pass(100 * OFFERS_REREAD_RETRY_MS)
    expect(reread).toHaveBeenCalledTimes(1)
  })

  it('once: offers that fail again are not read a third time', () => {
    const { reread, hook } = mount(false)
    hook.rerender({ failed: false, offersNotShown: 'o1', offersFailed: true })
    pass(OFFERS_REREAD_RETRY_MS)
    expect(reread).toHaveBeenCalledTimes(2)
    hook.rerender({ failed: false, offersNotShown: 'o1', offersFailed: true })
    pass(100 * OFFERS_REREAD_RETRY_MS)
    expect(reread).toHaveBeenCalledTimes(2)
  })

  it('once for those offers, even when a later read of theirs answers without them and one after it fails', () => {
    const { reread, hook } = mount(false)
    hook.rerender({ failed: false, offersNotShown: 'o1', offersFailed: true })
    pass(OFFERS_REREAD_RETRY_MS)
    expect(reread).toHaveBeenCalledTimes(2)
    // The retry answered and still does not show the offer; then another read (a pull, say) fails in its offers.
    hook.rerender({ failed: false, offersNotShown: 'o1', offersFailed: false })
    hook.rerender({ failed: false, offersNotShown: 'o1', offersFailed: true })
    pass(100 * OFFERS_REREAD_RETRY_MS)
    expect(reread).toHaveBeenCalledTimes(2)
  })

  it('other offers unshown later, failing too, are read once more as well', () => {
    const { reread, hook } = mount(false)
    hook.rerender({ failed: false, offersNotShown: 'o1', offersFailed: true })
    pass(OFFERS_REREAD_RETRY_MS)
    hook.rerender({ failed: false, offersNotShown: 'o1\no2', offersFailed: true })
    // The read for the new offer, at once, then its one retry.
    expect(reread).toHaveBeenCalledTimes(3)
    pass(OFFERS_REREAD_RETRY_MS)
    expect(reread).toHaveBeenCalledTimes(4)
    pass(100 * OFFERS_REREAD_RETRY_MS)
    expect(reread).toHaveBeenCalledTimes(4)
  })

  it('offers that answer before the wait is up are not read again', () => {
    const { reread, hook } = mount(false)
    hook.rerender({ failed: false, offersNotShown: 'o1', offersFailed: true })
    pass(OFFERS_REREAD_RETRY_MS - 1)
    hook.rerender({ failed: false, offersNotShown: '', offersFailed: false })
    pass(100 * OFFERS_REREAD_RETRY_MS)
    expect(reread).toHaveBeenCalledTimes(1)
  })

  it('control: failed offers with none unshown read nothing', () => {
    const { reread, hook } = mount(false)
    hook.rerender({ failed: false, offersNotShown: '', offersFailed: true })
    pass(100 * OFFERS_REREAD_RETRY_MS)
    expect(reread).not.toHaveBeenCalled()
  })

  it('not while another screen is in view', () => {
    const { reread, hook } = mount(false)
    hook.rerender({ failed: false, offersNotShown: 'o1', offersFailed: true })
    mockFocused = false
    hook.rerender({ failed: false, offersNotShown: 'o1', offersFailed: true })
    pass(100 * OFFERS_REREAD_RETRY_MS)
    expect(reread).toHaveBeenCalledTimes(1)
  })

  it('not with the app in the background when the wait ends', () => {
    const { reread, hook } = mount(false)
    hook.rerender({ failed: false, offersNotShown: 'o1', offersFailed: true })
    appIs('background')
    pass(OFFERS_REREAD_RETRY_MS)
    expect(reread).toHaveBeenCalledTimes(1)
  })
})

// The hooks together, as a screen runs them: a return from a lock, and an offer arriving at an open list.
describe('a screen listing rooms, end to end', () => {
  const flush = () => act(async () => undefined)
  const advance = (ms: number) => act(async () => jest.advanceTimersByTime(ms))
  const offer = (offerId: string, communityDid: string) => ({ offerId, communityDid }) as RoomOffer
  const serviceOf = (read: (communityDid?: string) => RoomOffer[]) =>
    ({
      capabilities: jest.fn(async (_options?: { refresh?: boolean }) => sampleCapabilities()),
      listMyRooms: jest.fn(async () => []),
      listOffers: jest.fn(async (communityDid?: string) => read(communityDid)),
    }) as unknown as RoomsService & { listMyRooms: jest.Mock; capabilities: jest.Mock }
  // The offers poll is the tab navigator's, and its last read outlives a test: each one starts it.
  const useScreen = (service: RoomsService, communityDid?: string) => {
    useRoomOffersCount(service, true)
    const myRooms = useMyRooms(service, communityDid)
    useRereadOnReturn(myRooms)
    return myRooms
  }

  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('a read that failed in the reconnect clears at the first retry, without asking the services', async () => {
    const service = serviceOf(() => [])
    service.listMyRooms.mockRejectedValueOnce(new Error('[TrustTasks:VtaClient] not connected'))
    const { result } = renderHook(() => useScreen(service))
    await flush()
    expect(result.current.failed).toBe(true)
    expect(result.current.capabilities).toBeUndefined()

    await advance(REREAD_RETRY_MS[0])
    await flush()
    expect(result.current.failed).toBe(false)
    expect(result.current.capabilities?.listMyRooms.status).toBe('available')
    expect(service.listMyRooms).toHaveBeenCalledTimes(2)
    expect(service.capabilities).not.toHaveBeenCalledWith({ refresh: true })
  })

  it('an agent that stays away is asked four times in all, and the failure stays said', async () => {
    const service = serviceOf(() => [])
    service.listMyRooms.mockRejectedValue(new Error('[TrustTasks:VtaClient] not connected'))
    const { result } = renderHook(() => useScreen(service))
    await flush()
    for (const step of REREAD_RETRY_MS) {
      await advance(step)
      await flush()
    }
    expect(service.listMyRooms).toHaveBeenCalledTimes(1 + REREAD_RETRY_MS.length)
    await advance(3_600_000)
    await flush()
    expect(service.listMyRooms).toHaveBeenCalledTimes(1 + REREAD_RETRY_MS.length)
    expect(result.current.failed).toBe(true)
  })

  it('an offer the poll reads shows in an open list, with one read; the next poll reads nothing more', async () => {
    let offered: RoomOffer[] = []
    const service = serviceOf(() => offered)
    const { result } = renderHook(() => useScreen(service))
    await flush()
    expect(result.current.offers).toEqual([])
    expect(service.listMyRooms).toHaveBeenCalledTimes(1)

    offered = [offer('o1', 'c1')]
    await advance(OFFERS_IDLE_POLL_MS)
    await flush()
    expect(result.current.offers?.map((o) => o.offerId)).toEqual(['o1'])
    expect(result.current.offersNotShown).toBe('')
    expect(service.listMyRooms).toHaveBeenCalledTimes(2)
    expect(service.capabilities).not.toHaveBeenCalledWith({ refresh: true })

    await advance(OFFERS_POLL_MS)
    await flush()
    expect(service.listMyRooms).toHaveBeenCalledTimes(2)
  })

  it('a read that still does not show the offer does not ask again', async () => {
    const offered = [offer('o2', 'c1')]
    // The poll asks for all; this screen asks for its community, and its read stays behind.
    const service = serviceOf((communityDid) => (communityDid ? [] : offered))
    const { result } = renderHook(() => useScreen(service, 'c1'))
    await flush()
    await flush()
    expect(result.current.offersNotShown).toBe('o2')
    expect(service.listMyRooms).toHaveBeenCalledTimes(2)

    for (let poll = 0; poll < 5; poll++) await advance(OFFERS_POLL_MS)
    await flush()
    expect(service.listMyRooms).toHaveBeenCalledTimes(2)
  })

  // IN-704-7, as the screen runs it: the poll reads the new offer, the screen's own read of its community's offers
  // fails once, and the offer shows after the one retry, with the screen never left.
  it('an offer whose first read on the open screen failed shows after the one retry', async () => {
    let offered: RoomOffer[] = []
    let failing = 0
    const service = serviceOf((communityDid) => {
      if (communityDid && failing-- > 0) throw new Error('the community did not answer')
      return offered
    })
    const { result } = renderHook(() => useScreen(service, 'c1'))
    await flush()
    expect(result.current.offers).toEqual([])

    offered = [offer('o1', 'c1')]
    failing = 1
    await advance(OFFERS_IDLE_POLL_MS)
    await flush()
    // The rooms listed; the offers of that read did not, and the offer is still not on the list.
    expect(result.current.failed).toBe(false)
    expect(result.current.offersFailed).toBe(true)
    expect(result.current.offersNotShown).toBe('o1')
    expect(service.listMyRooms).toHaveBeenCalledTimes(2)

    await advance(OFFERS_REREAD_RETRY_MS)
    await flush()
    expect(result.current.offers?.map((o) => o.offerId)).toEqual(['o1'])
    expect(result.current.offersFailed).toBe(false)
    expect(result.current.offersNotShown).toBe('')
    expect(service.listMyRooms).toHaveBeenCalledTimes(3)
  })

  it('control: the same offer read at the first try is read once, and nothing reads again at the wait', async () => {
    let offered: RoomOffer[] = []
    const service = serviceOf(() => offered)
    const { result } = renderHook(() => useScreen(service, 'c1'))
    await flush()
    offered = [offer('o1', 'c1')]
    await advance(OFFERS_IDLE_POLL_MS)
    await flush()
    expect(result.current.offers?.map((o) => o.offerId)).toEqual(['o1'])
    expect(service.listMyRooms).toHaveBeenCalledTimes(2)
    await advance(OFFERS_REREAD_RETRY_MS)
    await flush()
    expect(service.listMyRooms).toHaveBeenCalledTimes(2)
  })

  it('offers that keep failing are read twice for that offer, and no more', async () => {
    let offered: RoomOffer[] = []
    let failing = 0
    const service = serviceOf((communityDid) => {
      if (communityDid && failing-- > 0) throw new Error('the community did not answer')
      return offered
    })
    const { result } = renderHook(() => useScreen(service, 'c1'))
    await flush()
    offered = [offer('o1', 'c1')]
    failing = 1000
    await advance(OFFERS_IDLE_POLL_MS)
    await flush()
    await advance(OFFERS_REREAD_RETRY_MS)
    await flush()
    expect(service.listMyRooms).toHaveBeenCalledTimes(3)
    for (let poll = 0; poll < 5; poll++) await advance(OFFERS_POLL_MS)
    await flush()
    expect(service.listMyRooms).toHaveBeenCalledTimes(3)
    expect(result.current.offersNotShown).toBe('o1')
  })

  it("another community's offer reads nothing on this community's screen", async () => {
    const service = serviceOf((communityDid) => (communityDid ? [] : [offer('o3', 'c2')]))
    const { result } = renderHook(() => useScreen(service, 'c1'))
    await flush()
    await flush()
    expect(result.current.offersNotShown).toBe('')
    expect(service.listMyRooms).toHaveBeenCalledTimes(1)
  })
})
