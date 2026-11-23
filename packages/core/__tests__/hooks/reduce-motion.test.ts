/**
 * The phone's Reduce Motion setting: unknown until the system answers, then known, and kept current when the
 * setting changes while the app runs.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { AccessibilityInfo } from 'react-native'

import { readReduceMotion, resetReduceMotion, useReduceMotion } from '../../src/hooks/reduce-motion'

describe('Reduce Motion', () => {
  let changed: ((reduce: boolean) => void) | undefined
  let added: jest.SpyInstance
  let read: jest.SpyInstance

  beforeEach(() => {
    resetReduceMotion()
    changed = undefined
    added = jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((
      _event: string,
      handler: (reduce: boolean) => void
    ) => {
      changed = handler
      return { remove: jest.fn() }
    }) as never)
    read = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true)
  })
  afterEach(() => {
    added.mockRestore()
    read.mockRestore()
  })

  test('unknown until the system answers, then what it said', async () => {
    const { result } = renderHook(() => useReduceMotion())
    expect(result.current).toBeUndefined()
    await waitFor(() => expect(result.current).toBe(true))
  })

  test('kept current when the setting changes while the app runs', async () => {
    const { result } = renderHook(() => useReduceMotion())
    await waitFor(() => expect(result.current).toBe(true))
    expect(added).toHaveBeenCalledWith('reduceMotionChanged', expect.any(Function))
    act(() => changed?.(false))
    expect(result.current).toBe(false)
  })

  test('read once: a second read answers from what is known', async () => {
    expect(await readReduceMotion()).toBe(true)
    expect(await readReduceMotion()).toBe(true)
    expect(read).toHaveBeenCalledTimes(1)
  })

  test('forgetting removes the system subscription, so a later read makes one, not a second', async () => {
    const remove = jest.fn()
    added.mockReturnValue({ remove } as never)
    await readReduceMotion()
    resetReduceMotion()
    expect(remove).toHaveBeenCalledTimes(1)
    await readReduceMotion()
    expect(added).toHaveBeenCalledTimes(2)
    resetReduceMotion()
    expect(remove).toHaveBeenCalledTimes(2)
  })

  test('a system that cannot say counts as off', async () => {
    read.mockRejectedValue(new Error('unavailable'))
    expect(await readReduceMotion()).toBe(false)
  })
})
