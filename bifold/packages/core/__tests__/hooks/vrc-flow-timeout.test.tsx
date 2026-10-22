import { renderHook, act } from '@testing-library/react-native'

import {
  useVrcFlowInProgress,
  FLOW_HARD_TIMEOUT_MS,
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

  it('should set timedOut after 60s of our own work in a non-witnessed flow', () => {
    const { result } = renderHook(() => useVrcFlowInProgress('conn-1'))

    act(() => {
      vrcFlowStore.setStatus('conn-1', 'preparing-offer', false)
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

    // Flow completes before timeout (R-Card already landed, so no trailing beat)
    act(() => {
      vrcFlowStore.markRcardReceiveComplete('conn-1')
      vrcFlowStore.setStatus('conn-1', 'offer-received', false)
    })

    // A successful flow holds the confirmation until the user dismisses it
    act(() => {
      result.current.onDismissConfirmation()
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
      vrcFlowStore.setStatus('conn-1', 'preparing-offer', false)
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
      vrcFlowStore.setStatus('conn-1', 'preparing-offer', false)
    })

    act(() => {
      jest.advanceTimersByTime(FLOW_TIMEOUT_MS_NON_WITNESSED)
    })

    expect(result.current.timedOut).toBe(true)

    // A late status update arrives (e.g., delayed mediator message)
    act(() => {
      vrcFlowStore.markRcardReceiveComplete('conn-1')
      vrcFlowStore.setStatus('conn-1', 'offer-received', false)
    })

    // A successful flow holds the confirmation until the user dismisses it
    act(() => {
      result.current.onDismissConfirmation()
    })

    expect(result.current.timedOut).toBe(false)
    expect(result.current.inProgress).toBe(false)
  })
})

describe('useVrcFlowInProgress - R-Card trailing beat', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    vrcFlowStore.clearFlow('conn-1')
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('lingers with contact-card wording after VRC completes, clears when the card lands', () => {
    const { result } = renderHook(() => useVrcFlowInProgress('conn-1'))

    act(() => {
      vrcFlowStore.setStatus('conn-1', 'connecting', false)
      vrcFlowStore.markRcardReceivePending('conn-1')
    })
    // VRC completes — R-Card still in flight
    act(() => {
      vrcFlowStore.setStatus('conn-1', 'offer-received', false)
    })

    expect(result.current.inProgress).toBe(true)
    expect(result.current.statusText).toBe('Exchanging contact cards...')
    expect(result.current.timedOut).toBe(false)

    // The peer's card lands → overlay finishes (500ms completion animation)
    act(() => {
      vrcFlowStore.markRcardReceiveComplete('conn-1')
    })
    act(() => {
      result.current.onDismissConfirmation()
    })

    expect(result.current.inProgress).toBe(false)
    expect(result.current.statusText).toBe('')
  })

  it('clears after the grace period even if the card never lands', () => {
    const { result } = renderHook(() => useVrcFlowInProgress('conn-1'))

    act(() => {
      vrcFlowStore.setStatus('conn-1', 'connecting', false)
      vrcFlowStore.markRcardReceivePending('conn-1')
    })
    act(() => {
      vrcFlowStore.setStatus('conn-1', 'offer-received', false)
    })

    expect(result.current.inProgress).toBe(true)
    expect(result.current.statusText).toBe('Exchanging contact cards...')

    // Grace expires (30s) + completion animation
    act(() => {
      jest.advanceTimersByTime(30000)
    })
    act(() => {
      result.current.onDismissConfirmation()
    })

    expect(result.current.inProgress).toBe(false)
    expect(result.current.timedOut).toBe(false)
  })

  it('does not linger when no R-Card was ever expected (e.g. unidirectional inviter)', () => {
    const { result } = renderHook(() => useVrcFlowInProgress('conn-1'))

    act(() => {
      vrcFlowStore.setStatus('conn-1', 'connecting', false)
    })
    // VRC completes; rcardReceive was never set to 'pending' — nothing to wait on.
    act(() => {
      vrcFlowStore.setStatus('conn-1', 'offer-received', false)
    })
    act(() => {
      result.current.onDismissConfirmation()
    })

    expect(result.current.inProgress).toBe(false)
    expect(result.current.statusText).toBe('')
  })

  it('does not linger when the card already landed before VRC completion', () => {
    const { result } = renderHook(() => useVrcFlowInProgress('conn-1'))

    act(() => {
      vrcFlowStore.setStatus('conn-1', 'connecting', false)
    })
    act(() => {
      vrcFlowStore.markRcardReceiveComplete('conn-1')
      vrcFlowStore.setStatus('conn-1', 'offer-received', false)
    })
    act(() => {
      result.current.onDismissConfirmation()
    })

    expect(result.current.inProgress).toBe(false)
  })

  it('a late R-Card event does not resurrect a finished overlay', () => {
    const { result } = renderHook(() => useVrcFlowInProgress('conn-1'))

    act(() => {
      vrcFlowStore.setStatus('conn-1', 'connecting', false)
    })
    act(() => {
      vrcFlowStore.markRcardReceiveComplete('conn-1')
      vrcFlowStore.setStatus('conn-1', 'offer-received', false)
    })
    act(() => {
      result.current.onDismissConfirmation()
    })
    expect(result.current.inProgress).toBe(false)

    // A stray flowUpdate later (e.g. duplicate rcard pending event)
    act(() => {
      vrcFlowStore.markRcardReceivePending('conn-1')
    })
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

describe('useVrcFlowInProgress - success confirmation beat', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    vrcFlowStore.clearFlow('conn-1')
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('holds the confirmation after a successful exchange until dismissed', () => {
    const { result } = renderHook(() => useVrcFlowInProgress('conn-1'))

    act(() => {
      vrcFlowStore.setStatus('conn-1', 'connecting', false)
    })
    act(() => {
      vrcFlowStore.markRcardReceiveComplete('conn-1')
      vrcFlowStore.setStatus('conn-1', 'offer-received', false)
    })

    // Beat is up: dialog still shown, flagged confirmed, bar at 100%
    expect(result.current.confirmed).toBe(true)
    expect(result.current.inProgress).toBe(true)
    expect(result.current.progressComplete).toBe(true)

    act(() => {
      result.current.onDismissConfirmation()
    })

    expect(result.current.confirmed).toBe(false)
    expect(result.current.inProgress).toBe(false)
  })

  it('onDismissConfirmation clears immediately (user tapped through)', () => {
    const { result } = renderHook(() => useVrcFlowInProgress('conn-1'))

    act(() => {
      vrcFlowStore.setStatus('conn-1', 'connecting', false)
    })
    act(() => {
      vrcFlowStore.markRcardReceiveComplete('conn-1')
      vrcFlowStore.setStatus('conn-1', 'offer-received', false)
    })
    expect(result.current.confirmed).toBe(true)

    act(() => {
      result.current.onDismissConfirmation()
    })

    expect(result.current.confirmed).toBe(false)
    expect(result.current.inProgress).toBe(false)
    expect(vrcFlowStore.getStatus('conn-1')).toBe('idle')
  })

  it('a timed-out flow shows the timeout, never the confirmation', () => {
    const { result } = renderHook(() => useVrcFlowInProgress('conn-1'))

    act(() => {
      vrcFlowStore.setStatus('conn-1', 'preparing-offer', false)
    })
    act(() => {
      jest.advanceTimersByTime(FLOW_TIMEOUT_MS_NON_WITNESSED)
    })

    expect(result.current.timedOut).toBe(true)
    expect(result.current.confirmed).toBe(false)
  })
})

describe('useVrcFlowInProgress - waiting on the other phone', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    vrcFlowStore.clearFlow('conn-1')
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it.each(['connecting', 'discovering', 'proposed', 'offer-sent'] as const)(
    'a long wait in %s says we are waiting, never that the exchange failed',
    (status) => {
      const { result } = renderHook(() => useVrcFlowInProgress('conn-1'))

      act(() => {
        vrcFlowStore.setStatus('conn-1', status, false)
      })
      expect(result.current.inProgress).toBe(true)
      expect(result.current.waitingOnPeer).toBe(false)

      act(() => {
        jest.advanceTimersByTime(FLOW_TIMEOUT_MS_NON_WITNESSED)
      })

      expect(result.current.waitingOnPeer).toBe(true)
      expect(result.current.timedOut).toBe(false)
      expect(result.current.inProgress).toBe(true)
    }
  )

  it('waits past the hard timeout, and the hard timeout counts only our own work after it', () => {
    const { result } = renderHook(() => useVrcFlowInProgress('conn-1'))

    act(() => {
      vrcFlowStore.setStatus('conn-1', 'proposed', false)
    })
    act(() => {
      jest.advanceTimersByTime(FLOW_HARD_TIMEOUT_MS * 3)
    })
    // An unrelated store update re-runs the status check mid-wait.
    act(() => {
      vrcFlowStore.setStatus('conn-2', 'connecting', false)
    })
    expect(result.current.timedOut).toBe(false)
    expect(result.current.waitingOnPeer).toBe(true)

    // They answer: our own work starts now, with a fresh clock.
    act(() => {
      vrcFlowStore.setStatus('conn-1', 'preparing-offer', false)
    })
    expect(result.current.timedOut).toBe(false)
    expect(result.current.waitingOnPeer).toBe(false)
    expect(result.current.statusText).toBe('Preparing credential offer...')
    vrcFlowStore.clearFlow('conn-2')
  })

  it('dismissing the wait hides the dialog but keeps the flow, and the next step brings it back', () => {
    const { result } = renderHook(() => useVrcFlowInProgress('conn-1'))

    act(() => {
      vrcFlowStore.setStatus('conn-1', 'proposed', false)
    })
    act(() => {
      jest.advanceTimersByTime(FLOW_TIMEOUT_MS_NON_WITNESSED)
    })
    expect(result.current.waitingOnPeer).toBe(true)

    act(() => {
      result.current.onDismissWaiting()
    })
    expect(result.current.inProgress).toBe(false)
    expect(result.current.waitingOnPeer).toBe(false)
    expect(vrcFlowStore.getStatus('conn-1')).toBe('proposed')

    // Re-checks while still waiting keep it hidden.
    act(() => {
      vrcFlowStore.setStatus('conn-1', 'proposed', false)
      jest.advanceTimersByTime(FLOW_TIMEOUT_MS_NON_WITNESSED)
    })
    expect(result.current.inProgress).toBe(false)

    act(() => {
      vrcFlowStore.setStatus('conn-1', 'preparing-offer', false)
    })
    expect(result.current.inProgress).toBe(true)
    expect(result.current.statusText).toBe('Preparing credential offer...')
  })

  it('a dismissed wait that ends in success shows the confirmation', () => {
    const { result } = renderHook(() => useVrcFlowInProgress('conn-1'))

    act(() => {
      vrcFlowStore.setStatus('conn-1', 'offer-sent', false)
    })
    act(() => {
      jest.advanceTimersByTime(FLOW_TIMEOUT_MS_NON_WITNESSED)
    })
    act(() => {
      result.current.onDismissWaiting()
    })
    expect(result.current.inProgress).toBe(false)

    act(() => {
      vrcFlowStore.markRcardReceiveComplete('conn-1')
      vrcFlowStore.setStatus('conn-1', 'offer-received', false)
    })
    expect(result.current.confirmed).toBe(true)
    expect(result.current.inProgress).toBe(true)
  })

  it('onDismissWaiting does nothing outside a wait on the other phone', () => {
    const { result } = renderHook(() => useVrcFlowInProgress('conn-1'))

    act(() => {
      vrcFlowStore.setStatus('conn-1', 'witness-active', false)
    })
    act(() => {
      result.current.onDismissWaiting()
    })
    expect(result.current.inProgress).toBe(true)
  })
})
