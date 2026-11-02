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
import { REREAD_RETRY_MS, useRereadOnReturn } from '../useRereadOnReturn'
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

type Read = { failed: boolean; failures?: number; offersNotShown?: string }

const mount = (failed: boolean, more: Omit<Read, 'failed'> = {}) => {
  const reload = jest.fn()
  const reread = jest.fn()
  const hook = renderHook(
    ({ failures = 0, offersNotShown = '', ...read }: Read) =>
      useRereadOnReturn({ reload, reread, failures, offersNotShown, ...read }),
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

  it("another community's offer reads nothing on this community's screen", async () => {
    const service = serviceOf((communityDid) => (communityDid ? [] : [offer('o3', 'c2')]))
    const { result } = renderHook(() => useScreen(service, 'c1'))
    await flush()
    await flush()
    expect(result.current.offersNotShown).toBe('')
    expect(service.listMyRooms).toHaveBeenCalledTimes(1)
  })
})
