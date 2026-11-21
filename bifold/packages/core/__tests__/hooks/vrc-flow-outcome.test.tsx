/**
 * A relationship exchange that ends without completing never says "Relationship confirmed" (UI-smoothness plan,
 * Phase 0). The overlay took any return to idle after its bar had started as the success beat — and a decline (by
 * either person), a withdrawn request, a cancelled error dialog and a failed issuance all return to idle through
 * clearFlow. Every committed render is recorded, so "never confirmed" covers the frames between, not only the end.
 */
import { act, renderHook } from '@testing-library/react-native'

import { FLOW_TIMEOUT_MS_NON_WITNESSED, useVrcFlowInProgress } from '../../src/hooks/chat-messages'
import { vrcFlowStore, type VrcFlowEnd } from '../../src/modules/vrc/witnessStatusStore'

const CONN = 'conn-outcome'

/** The overlay, with every committed `confirmed` kept in order. */
function overlay() {
  const confirmedSeen: boolean[] = []
  const hook = renderHook(() => {
    const state = useVrcFlowInProgress(CONN)
    confirmedSeen.push(state.confirmed)
    return state
  })
  return { ...hook, confirmedSeen }
}

describe('a flow that ends without completing', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    vrcFlowStore.clearFlow(CONN)
  })
  afterEach(() => jest.useRealTimers())

  // The positive control: the same overlay, completing, does confirm — so a "never" below is not an overlay that
  // could not confirm at all.
  it('completed: the confirmation shows', () => {
    const { result, confirmedSeen } = overlay()
    act(() => vrcFlowStore.setStatus(CONN, 'proposed'))
    act(() => {
      vrcFlowStore.markRcardReceiveComplete(CONN)
      vrcFlowStore.setStatus(CONN, 'offer-received')
    })
    expect(result.current.confirmed).toBe(true)
    expect(confirmedSeen).toContain(true)
  })

  it.each<[string, VrcFlowEnd]>([
    ['this phone declined', 'declined'],
    ['the other person declined', 'declined'],
    ['the request was withdrawn', 'cancelled'],
    ['the issuance failed', 'error'],
  ])('%s: never confirmed, in any frame, and the overlay clears', (_, ended) => {
    const { result, confirmedSeen } = overlay()
    act(() => vrcFlowStore.setStatus(CONN, 'proposed'))
    act(() => vrcFlowStore.setStatus(CONN, 'preparing-offer'))
    expect(result.current.inProgress).toBe(true)
    act(() => vrcFlowStore.clearFlow(CONN, ended))
    expect(confirmedSeen).not.toContain(true)
    expect(result.current.inProgress).toBe(false)
    expect(result.current.progressComplete).toBe(false)
  })

  // fd's #469: a waiting dialog the person dismissed keeps the flow and its bar; a decline then read as confirmed.
  it('declined while the waiting dialog was dismissed: never confirmed either', () => {
    const { result, confirmedSeen } = overlay()
    act(() => vrcFlowStore.setStatus(CONN, 'offer-sent'))
    act(() => jest.advanceTimersByTime(FLOW_TIMEOUT_MS_NON_WITNESSED))
    act(() => result.current.onDismissWaiting())
    expect(result.current.inProgress).toBe(false)
    act(() => vrcFlowStore.clearFlow(CONN, 'declined'))
    expect(confirmedSeen).not.toContain(true)
    expect(result.current.inProgress).toBe(false)
    expect(result.current.waitingOnPeer).toBe(false)
  })

  it('a declined flow, then a new one that completes: that one confirms', () => {
    const { result } = overlay()
    act(() => vrcFlowStore.setStatus(CONN, 'proposed'))
    act(() => vrcFlowStore.clearFlow(CONN, 'declined'))
    expect(result.current.confirmed).toBe(false)
    act(() => vrcFlowStore.setStatus(CONN, 'proposed'))
    act(() => {
      vrcFlowStore.markRcardReceiveComplete(CONN)
      vrcFlowStore.setStatus(CONN, 'offer-received')
    })
    expect(result.current.confirmed).toBe(true)
  })
})

describe('the store remembers how a flow ended, until the next starts', () => {
  beforeEach(() => vrcFlowStore.clearFlow(CONN))

  it('kept from clearFlow, said on the idle update, forgotten by a new status or a plain clear', () => {
    const updates: unknown[] = []
    const onUpdate = (u: unknown) => updates.push(u)
    vrcFlowStore.on('flowUpdate', onUpdate)
    vrcFlowStore.setStatus(CONN, 'proposed')
    vrcFlowStore.clearFlow(CONN, 'cancelled')
    expect(vrcFlowStore.flowEndedWith(CONN)).toBe('cancelled')
    expect(updates[updates.length - 1]).toEqual({ connectionId: CONN, status: 'idle', ended: 'cancelled' })
    vrcFlowStore.setStatus(CONN, 'proposed')
    expect(vrcFlowStore.flowEndedWith(CONN)).toBeUndefined()
    vrcFlowStore.clearFlow(CONN, 'error')
    vrcFlowStore.clearFlow(CONN)
    expect(vrcFlowStore.flowEndedWith(CONN)).toBeUndefined()
    vrcFlowStore.off('flowUpdate', onUpdate)
  })
})
