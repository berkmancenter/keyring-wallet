/**
 * The room chat's floating day: the day of the topmost post in view (the highest index, the list being drawn bottom
 * up), shown while the member scrolls and faded a moment after they stop.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native'

import { FLOATING_DAY_HOLD_MS, topmostDay, useFloatingDay } from '../components/useFloatingDay'

const TODAY = new Date(2026, 9, 30, 9, 0)
const YESTERDAY = new Date(2026, 9, 29, 18, 0)
const post = (index: number, at?: Date) => ({ index, item: { kind: 'post', post: { at } } })
const pill = (index: number) => ({ index, item: { kind: 'day', date: TODAY } })

describe('topmostDay', () => {
  test('the day of the post with the highest index: the one at the top of a list drawn bottom up', () => {
    expect(topmostDay([post(0, TODAY), post(1, TODAY), post(2, YESTERDAY)])).toBe(YESTERDAY)
    expect(topmostDay([post(2, YESTERDAY), post(0, TODAY)])).toBe(YESTERDAY)
  })

  test('passes over day pills and posts with no time; nothing dated in view is no day', () => {
    expect(topmostDay([post(0, TODAY), pill(1), post(2)])).toBe(TODAY)
    expect(topmostDay([pill(0), post(1)])).toBeUndefined()
    expect(topmostDay([])).toBeUndefined()
  })
})

describe('useFloatingDay', () => {
  const inView = (hook: { current: ReturnType<typeof useFloatingDay> }) =>
    act(() => hook.current.onViewableItemsChanged({ viewableItems: [post(0, TODAY), post(1, YESTERDAY)] as never }))

  test('no day until the member scrolls; then the topmost post’s, faded a moment after scrolling stops', async () => {
    const { result } = renderHook(() => useFloatingDay())
    inView(result)
    expect(result.current.day).toBeUndefined()
    act(() => result.current.onScrollStart())
    expect(result.current.day).toBe(YESTERDAY)
    act(() => result.current.onScrollStop())
    expect(result.current.day).toBe(YESTERDAY) // held for a moment
    await waitFor(() => expect(result.current.day).toBeUndefined(), { timeout: FLOATING_DAY_HOLD_MS + 2000 })
  })

  test('scrolling again before it fades keeps it', async () => {
    const { result } = renderHook(() => useFloatingDay())
    inView(result)
    act(() => result.current.onScrollStart())
    act(() => result.current.onScrollStop())
    act(() => result.current.onScrollStart())
    await new Promise((r) => setTimeout(r, FLOATING_DAY_HOLD_MS + 500))
    expect(result.current.day).toBe(YESTERDAY)
  })

  test('the list’s callbacks are the same on every render, as FlatList requires', () => {
    const { result, rerender } = renderHook(() => useFloatingDay())
    const first = result.current
    rerender({})
    expect(result.current.onViewableItemsChanged).toBe(first.onViewableItemsChanged)
    expect(result.current.viewabilityConfig).toBe(first.viewabilityConfig)
  })
})
