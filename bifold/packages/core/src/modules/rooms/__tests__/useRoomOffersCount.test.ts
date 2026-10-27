/**
 * The Rooms card's offers badge is pulled, never pushed: once on mount and every minute after, only while an agent
 * is linked, the app is in the foreground and the rooms flag is on. Any of those false, and nothing is asked.
 */
import { act, renderHook } from '@testing-library/react-native'
import { AppState } from 'react-native'

import { sampleCapabilities } from '../capabilities'
import type { RoomsService } from '../types'
import { OFFERS_POLL_MS, useRoomOffersCount } from '../useRoomOffersCount'

let onAppState: ((state: string) => void) | undefined
const serviceWith = (offers: number) =>
  ({
    capabilities: jest.fn(async () => sampleCapabilities()),
    listOffers: jest.fn(async () => Array.from({ length: offers }, (_, i) => ({ offerId: `o${i}` }))),
  }) as unknown as RoomsService & { listOffers: jest.Mock }

beforeEach(() => {
  jest.useFakeTimers()
  onAppState = undefined
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (s: string) => void) => {
    onAppState = listener
    return { remove: jest.fn() }
  }) as never)
})
afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

const flush = () => act(async () => undefined)

describe('the offers badge poll', () => {
  test('linked and in the foreground: asks at once, then every minute, and counts the offers', async () => {
    const service = serviceWith(2)
    const { result } = renderHook(() => useRoomOffersCount(service, true))
    await flush()
    expect(service.listOffers).toHaveBeenCalledTimes(1)
    expect(result.current).toBe(2)
    await act(async () => jest.advanceTimersByTime(OFFERS_POLL_MS))
    expect(service.listOffers).toHaveBeenCalledTimes(2)
  })

  test('no agent linked: never asks, even a minute later (the linked case above is the control)', async () => {
    const service = serviceWith(2)
    const { result } = renderHook(() => useRoomOffersCount(service, false))
    await flush()
    await act(async () => jest.advanceTimersByTime(OFFERS_POLL_MS * 2))
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
    await act(async () => jest.advanceTimersByTime(OFFERS_POLL_MS * 3))
    expect(service.listOffers).toHaveBeenCalledTimes(1)
    expect(result.current).toBe(1)
  })

  test('pauses in the background and asks again on return', async () => {
    const service = serviceWith(1)
    renderHook(() => useRoomOffersCount(service, true))
    await flush()
    await act(async () => onAppState?.('background'))
    await act(async () => jest.advanceTimersByTime(OFFERS_POLL_MS * 3))
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
