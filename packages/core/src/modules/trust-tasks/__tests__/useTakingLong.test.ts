/**
 * "Getting your identity ready…" says it can take a minute or two once it has
 * run 20 s: a mint that first reaches a DID host took 31.2 s on the VTA Farm
 * (227 gate), where a spinner alone looks stuck.
 */
import { act, renderHook } from '@testing-library/react-native'

import { TAKING_LONG_MS, useTakingLong } from '../screens/useTakingLong'

describe('useTakingLong', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('says so after 20 s of running, and not before', () => {
    expect(TAKING_LONG_MS).toBe(20_000)
    const { result } = renderHook(() => useTakingLong(true))
    act(() => jest.advanceTimersByTime(19_999))
    expect(result.current).toBe(false)
    act(() => jest.advanceTimersByTime(1))
    expect(result.current).toBe(true)
  })

  it('stops saying so as soon as it is done, and starts over next time', () => {
    const { result, rerender } = renderHook(({ active }) => useTakingLong(active), { initialProps: { active: true } })
    act(() => jest.advanceTimersByTime(TAKING_LONG_MS))
    expect(result.current).toBe(true)
    rerender({ active: false })
    expect(result.current).toBe(false)
    rerender({ active: true })
    act(() => jest.advanceTimersByTime(TAKING_LONG_MS - 1))
    expect(result.current).toBe(false)
  })
})
