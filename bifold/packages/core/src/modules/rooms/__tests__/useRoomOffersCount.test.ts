/**
 * The Rooms card's offers badge is pulled, never pushed, and only while an agent is linked, the app is in the
 * foreground and the rooms flag is on. It asks at once on mount, on a return to the foreground and when My Agent
 * comes into focus; then every minute while offers wait, every two while none do, and every five after a failure;
 * not again within ten seconds of an ask, and with one timer at a time.
 */
import { useFocusEffect } from '@react-navigation/native'
import { act, renderHook } from '@testing-library/react-native'
import { AppState } from 'react-native'

import { sampleCapabilities } from '../capabilities'
import type { RoomsService } from '../types'
import {
  OFFERS_ERROR_POLL_MS,
  OFFERS_IDLE_POLL_MS,
  OFFERS_POLL_MS,
  OFFERS_REFRESH_FLOOR_MS,
  useRoomOffersCount,
} from '../useRoomOffersCount'

let onAppState: ((state: string) => void) | undefined
let focus: (() => void) | undefined
const serviceWith = (offers: number) =>
  ({
    capabilities: jest.fn(async () => sampleCapabilities()),
    listOffers: jest.fn(async () => Array.from({ length: offers }, (_, i) => ({ offerId: `o${i}` }))),
  }) as unknown as RoomsService & { listOffers: jest.Mock }

beforeEach(() => {
  jest.useFakeTimers()
  onAppState = undefined
  focus = undefined
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (s: string) => void) => {
    onAppState = listener
    return { remove: jest.fn() }
  }) as never)
  // My Agent coming into focus, fired by the test rather than on every render.
  ;(useFocusEffect as jest.Mock).mockImplementation((effect: () => void) => {
    focus = effect
  })
})
afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

const flush = () => act(async () => undefined)
const advance = (ms: number) => act(async () => jest.advanceTimersByTime(ms))

describe('the offers badge poll', () => {
  test('linked and in the foreground: asks at once, then every minute while offers wait, and counts them', async () => {
    const service = serviceWith(2)
    const { result } = renderHook(() => useRoomOffersCount(service, true))
    await flush()
    expect(service.listOffers).toHaveBeenCalledTimes(1)
    expect(result.current).toBe(2)
    await advance(OFFERS_POLL_MS)
    expect(service.listOffers).toHaveBeenCalledTimes(2)
  })

  test('no offers waiting: asks again after two minutes, not one', async () => {
    const service = serviceWith(0)
    const { result } = renderHook(() => useRoomOffersCount(service, true))
    await flush()
    expect(result.current).toBe(0)
    await advance(OFFERS_POLL_MS)
    expect(service.listOffers).toHaveBeenCalledTimes(1)
    await advance(OFFERS_IDLE_POLL_MS - OFFERS_POLL_MS)
    expect(service.listOffers).toHaveBeenCalledTimes(2)
  })

  test('a failed poll waits five minutes, and keeps the count it had', async () => {
    const service = serviceWith(2)
    const { result } = renderHook(() => useRoomOffersCount(service, true))
    await flush()
    service.listOffers.mockRejectedValueOnce(new Error('the community did not answer'))
    await advance(OFFERS_POLL_MS)
    expect(service.listOffers).toHaveBeenCalledTimes(2)
    expect(result.current).toBe(2)
    await advance(OFFERS_ERROR_POLL_MS - 1)
    expect(service.listOffers).toHaveBeenCalledTimes(2)
    await advance(1)
    expect(service.listOffers).toHaveBeenCalledTimes(3)
  })

  test('once an offer arrives, asks every minute again', async () => {
    const service = serviceWith(0)
    const { result } = renderHook(() => useRoomOffersCount(service, true))
    await flush()
    service.listOffers.mockResolvedValue([{ offerId: 'o0' }])
    await advance(OFFERS_IDLE_POLL_MS)
    expect(result.current).toBe(1)
    await advance(OFFERS_POLL_MS)
    expect(service.listOffers).toHaveBeenCalledTimes(3)
  })

  test('My Agent coming into focus asks at once, and the next ask counts from there', async () => {
    const service = serviceWith(0)
    renderHook(() => useRoomOffersCount(service, true))
    await flush()
    await advance(30_000)
    await act(async () => focus?.())
    expect(service.listOffers).toHaveBeenCalledTimes(2)
    await advance(OFFERS_IDLE_POLL_MS - 1)
    expect(service.listOffers).toHaveBeenCalledTimes(2)
    await advance(1)
    expect(service.listOffers).toHaveBeenCalledTimes(3)
  })

  test('focus within ten seconds of an ask asks nothing, however often it comes, and the timer stands', async () => {
    const service = serviceWith(0)
    renderHook(() => useRoomOffersCount(service, true))
    await flush()
    for (let i = 0; i < 5; i++) {
      await advance(1_000)
      await act(async () => focus?.())
    }
    expect(service.listOffers).toHaveBeenCalledTimes(1)
    await advance(OFFERS_IDLE_POLL_MS - 5_000 - 1)
    expect(service.listOffers).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(service.listOffers).toHaveBeenCalledTimes(2)
  })

  test('back from the background within ten seconds of an ask: asks once the ten seconds have passed', async () => {
    const service = serviceWith(0)
    renderHook(() => useRoomOffersCount(service, true))
    await flush()
    await act(async () => onAppState?.('background'))
    await advance(3_000)
    await act(async () => onAppState?.('active'))
    expect(service.listOffers).toHaveBeenCalledTimes(1)
    await advance(OFFERS_REFRESH_FLOOR_MS - 3_000)
    expect(service.listOffers).toHaveBeenCalledTimes(2)
  })

  test('an ask still out is not doubled by a focus', async () => {
    const service = serviceWith(0)
    let answer: (offers: unknown[]) => void = () => undefined
    service.listOffers.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
    renderHook(() => useRoomOffersCount(service, true))
    await flush()
    await advance(OFFERS_REFRESH_FLOOR_MS * 2)
    await act(async () => focus?.())
    expect(service.listOffers).toHaveBeenCalledTimes(1)
    await act(async () => answer([]))
    await advance(OFFERS_IDLE_POLL_MS)
    expect(service.listOffers).toHaveBeenCalledTimes(2)
  })

  test('leaving and coming back, with a focus on the way, leaves one timer running, not two', async () => {
    const service = serviceWith(0)
    renderHook(() => useRoomOffersCount(service, true))
    await flush()
    await advance(OFFERS_POLL_MS)
    await act(async () => onAppState?.('background'))
    await advance(OFFERS_POLL_MS)
    // The return and the focus arrive together: one ask between them.
    await act(async () => onAppState?.('active'))
    await act(async () => focus?.())
    await flush()
    expect(service.listOffers).toHaveBeenCalledTimes(2)
    await act(async () => focus?.())
    // A step at a time, and keep it that way. Each ask is async and sets its next timer only once it settles, which
    // one synchronous advanceTimersByTime does not wait for: a single ten-minute advance fires one timer and then
    // stops. It would report the same low count whether the chain had stalled or doubled, which are the two bugs
    // this test exists to catch.
    for (let i = 0; i < 5; i++) await advance(OFFERS_IDLE_POLL_MS)
    // One chain: one ask every two minutes. Two chains would have asked ten times.
    expect(service.listOffers).toHaveBeenCalledTimes(2 + 5)
  })

  test('no agent linked: never asks, even after a focus (the linked case above is the control)', async () => {
    const service = serviceWith(2)
    const { result } = renderHook(() => useRoomOffersCount(service, false))
    await flush()
    await act(async () => focus?.())
    await advance(OFFERS_IDLE_POLL_MS * 2)
    expect(service.listOffers).not.toHaveBeenCalled()
    expect(result.current).toBeUndefined()
  })

  test('stops when the agent is unlinked, and keeps the count it had', async () => {
    const service = serviceWith(1)
    const { result, rerender } = renderHook<number | undefined, { linked: boolean }>(
      ({ linked }) => useRoomOffersCount(service, linked),
      {
        initialProps: { linked: true },
      }
    )
    await flush()
    expect(service.listOffers).toHaveBeenCalledTimes(1)
    rerender({ linked: false })
    await advance(OFFERS_POLL_MS * 3)
    expect(service.listOffers).toHaveBeenCalledTimes(1)
    expect(result.current).toBe(1)
  })

  test('pauses in the background and asks again on return', async () => {
    const service = serviceWith(1)
    renderHook(() => useRoomOffersCount(service, true))
    await flush()
    await act(async () => onAppState?.('background'))
    await advance(OFFERS_POLL_MS * 3)
    expect(service.listOffers).toHaveBeenCalledTimes(1)
    await act(async () => onAppState?.('active'))
    await flush()
    expect(service.listOffers).toHaveBeenCalledTimes(2)
  })

  test('rooms flag off (no service): nothing to ask', async () => {
    const { result } = renderHook(() => useRoomOffersCount(undefined, true))
    await flush()
    expect(result.current).toBeUndefined()
  })

  test('listing offers not available: listOffers is not called', async () => {
    const service = serviceWith(1)
    ;(service.capabilities as jest.Mock).mockImplementation(async () => ({
      ...sampleCapabilities(),
      listOffers: { status: 'unavailable', reason: 'agentDoesNotServe' },
    }))
    renderHook(() => useRoomOffersCount(service, true))
    await flush()
    expect(service.capabilities).toHaveBeenCalled()
    expect(service.listOffers).not.toHaveBeenCalled()
  })
})
