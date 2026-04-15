import { renderHook, act } from '@testing-library/react-native'

import {
  useVrcFlowInProgress,
  FLOW_TIMEOUT_MS_NON_WITNESSED,
  FLOW_TIMEOUT_MS_WITNESSED,
} from '../../src/hooks/chat-messages'
import { vrcFlowStore } from '../../src/modules/vrc/witnessStatusStore'

describe('useVrcFlowInProgress - timeout behavior', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    vrcFlowStore.clearFlow('conn-1')
    vrcFlowStore.clearFlow('conn-2')
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('should not show overlay when no flow is active', () => {
    const { result } = renderHook(() => useVrcFlowInProgress('conn-1'))

    expect(result.current.inProgress).toBe(false)
    expect(result.current.timedOut).toBe(false)
    expect(result.current.statusText).toBe('')
  })

  it('should show overlay when flow is connecting', () => {
    const { result } = renderHook(() => useVrcFlowInProgress('conn-1'))

    act(() => {
      vrcFlowStore.setStatus('conn-1', 'connecting')
    })

    expect(result.current.inProgress).toBe(true)
    expect(result.current.timedOut).toBe(false)
    expect(result.current.statusText).toBe('Establishing connection...')
  })

  it('should set timedOut after 60s for non-witnessed flow', () => {
    const { result } = renderHook(() => useVrcFlowInProgress('conn-1'))

    act(() => {
      vrcFlowStore.setStatus('conn-1', 'connecting', false)
    })

    expect(result.current.timedOut).toBe(false)

    act(() => {
      jest.advanceTimersByTime(FLOW_TIMEOUT_MS_NON_WITNESSED)
    })

    expect(result.current.timedOut).toBe(true)
    expect(result.current.inProgress).toBe(true)
    expect(result.current.statusText).toContain("didn't complete")
  })

  it('should set timedOut after 120s for witnessed flow', () => {
    const { result } = renderHook(() => useVrcFlowInProgress('conn-1'))

    act(() => {
      vrcFlowStore.setStatus('conn-1', 'witness-active', true)
    })

    expect(result.current.timedOut).toBe(false)

    // Should NOT timeout at 60s
    act(() => {
      jest.advanceTimersByTime(FLOW_TIMEOUT_MS_NON_WITNESSED)
    })

    expect(result.current.timedOut).toBe(false)

    // Should timeout at 120s
    act(() => {
      jest.advanceTimersByTime(FLOW_TIMEOUT_MS_WITNESSED - FLOW_TIMEOUT_MS_NON_WITNESSED)
    })

    expect(result.current.timedOut).toBe(true)
    expect(result.current.inProgress).toBe(true)
  })

  it('should reset timeout when status transitions', () => {
    const { result } = renderHook(() => useVrcFlowInProgress('conn-1'))

    act(() => {
      vrcFlowStore.setStatus('conn-1', 'connecting', false)
    })

    // Advance 50s (not enough to trigger 60s timeout)
    act(() => {
      jest.advanceTimersByTime(50000)
    })

    expect(result.current.timedOut).toBe(false)

    // Status transitions — timer resets
    act(() => {
      vrcFlowStore.setStatus('conn-1', 'preparing-offer', false)
    })

    // Advance another 50s (100s total, but only 50s since last transition)
    act(() => {
      jest.advanceTimersByTime(50000)
    })

    expect(result.current.timedOut).toBe(false)

    // 10 more seconds to hit 60s since last transition
    act(() => {
      jest.advanceTimersByTime(10000)
    })

    expect(result.current.timedOut).toBe(true)
  })

  it('should not timeout if flow completes naturally', () => {
    const { result } = renderHook(() => useVrcFlowInProgress('conn-1'))

    act(() => {
      vrcFlowStore.setStatus('conn-1', 'connecting', false)
    })

    act(() => {
      jest.advanceTimersByTime(30000)
    })

    // Flow completes before timeout
    act(() => {
      vrcFlowStore.setStatus('conn-1', 'offer-received', false)
    })

    // Progress bar completion animation takes 500ms before overlay clears
    act(() => {
      jest.advanceTimersByTime(500)
    })

    expect(result.current.inProgress).toBe(false)
    expect(result.current.timedOut).toBe(false)

    // Advance past the timeout — should not trigger
    act(() => {
      jest.advanceTimersByTime(FLOW_TIMEOUT_MS_NON_WITNESSED)
    })

    expect(result.current.timedOut).toBe(false)
  })

  it('should clear everything when onDismissTimeout is called', () => {
    const { result } = renderHook(() => useVrcFlowInProgress('conn-1'))

    act(() => {
      vrcFlowStore.setStatus('conn-1', 'connecting', false)
    })

    act(() => {
      jest.advanceTimersByTime(FLOW_TIMEOUT_MS_NON_WITNESSED)
    })

    expect(result.current.timedOut).toBe(true)
    expect(result.current.inProgress).toBe(true)

    act(() => {
      result.current.onDismissTimeout()
    })

    expect(result.current.timedOut).toBe(false)
    expect(result.current.inProgress).toBe(false)
    expect(result.current.statusText).toBe('')
    expect(vrcFlowStore.getStatus('conn-1')).toBe('idle')
  })

  it('should not show timeout for empty connectionId', () => {
    const { result } = renderHook(() => useVrcFlowInProgress(''))

    expect(result.current.inProgress).toBe(false)
    expect(result.current.timedOut).toBe(false)

    act(() => {
      jest.advanceTimersByTime(FLOW_TIMEOUT_MS_WITNESSED)
    })

    expect(result.current.timedOut).toBe(false)
  })

  it('should clear timedOut when flow resumes after timeout', () => {
    const { result } = renderHook(() => useVrcFlowInProgress('conn-1'))

    act(() => {
      vrcFlowStore.setStatus('conn-1', 'connecting', false)
    })

    act(() => {
      jest.advanceTimersByTime(FLOW_TIMEOUT_MS_NON_WITNESSED)
    })

    expect(result.current.timedOut).toBe(true)

    // A late status update arrives (e.g., delayed mediator message)
    act(() => {
      vrcFlowStore.setStatus('conn-1', 'offer-received', false)
    })

    // Progress bar completion animation takes 500ms before overlay clears
    act(() => {
      jest.advanceTimersByTime(500)
    })

    expect(result.current.timedOut).toBe(false)
    expect(result.current.inProgress).toBe(false)
  })
})

describe('vrcFlowStore.clearFlow - error event emission', () => {
  beforeEach(() => {
    vrcFlowStore.clearFlow('conn-1')
  })

  it('should emit flowErrorCleared when clearing a flow that has an error', () => {
    const handler = jest.fn()
    vrcFlowStore.on('flowErrorCleared', handler)

    vrcFlowStore.setError('conn-1', {
      type: 'network-error',
      message: 'test error',
    })

    expect(vrcFlowStore.getError('conn-1')).toBeDefined()

    vrcFlowStore.clearFlow('conn-1')

    expect(handler).toHaveBeenCalledWith({ connectionId: 'conn-1' })
    expect(vrcFlowStore.getError('conn-1')).toBeUndefined()

    vrcFlowStore.off('flowErrorCleared', handler)
  })

  it('should NOT emit flowErrorCleared when clearing a flow without an error', () => {
    const handler = jest.fn()
    vrcFlowStore.on('flowErrorCleared', handler)

    vrcFlowStore.setStatus('conn-1', 'connecting')
    vrcFlowStore.clearFlow('conn-1')

    expect(handler).not.toHaveBeenCalled()

    vrcFlowStore.off('flowErrorCleared', handler)
  })

  it('should always emit flowUpdate with idle when clearing', () => {
    const handler = jest.fn()
    vrcFlowStore.on('flowUpdate', handler)

    vrcFlowStore.setStatus('conn-1', 'witness-active', true)
    handler.mockClear()

    vrcFlowStore.clearFlow('conn-1')

    expect(handler).toHaveBeenCalledWith({ connectionId: 'conn-1', status: 'idle' })

    vrcFlowStore.off('flowUpdate', handler)
  })
})
