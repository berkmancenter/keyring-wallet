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

  // A failure is not a stand-down: it used to sit in the row above and clear like a decline, so a send the mailbox
  // refused vanished with no word (bifold #1171, 2026-11-21). Never confirmed still holds; what moves is that the
  // overlay stays, saying so.
  it('the issuance failed: never confirmed, in any frame, and the overlay stays to say it did not complete', () => {
    const { result, confirmedSeen } = overlay()
    act(() => vrcFlowStore.setStatus(CONN, 'proposed'))
    act(() => vrcFlowStore.setStatus(CONN, 'preparing-offer'))
    expect(result.current.inProgress).toBe(true)
    act(() => vrcFlowStore.clearFlow(CONN, 'error'))
    expect(confirmedSeen).not.toContain(true)
    expect(result.current.inProgress).toBe(true)
    expect(result.current.progressComplete).toBe(false)
    // The did-not-complete state is the timeout's, shown at once; Chat.test.tsx pins its wording on screen.
    expect(result.current.timedOut).toBe(true)
    expect(result.current.statusText).toBe('Chat.Flow.DidNotComplete')
  })

  // The first contact failing is this phone's scan never reaching the other, which still shows its code: the next
  // step is a new code and a new scan, not "try connecting again" (the mailbox tester builds, 2026-11-21).
  it('the first contact failed (connecting): the overlay says the scan never reached the other phone', () => {
    const { result, confirmedSeen } = overlay()
    act(() => vrcFlowStore.setStatus(CONN, 'connecting'))
    act(() => vrcFlowStore.clearFlow(CONN, 'error'))
    expect(confirmedSeen).not.toContain(true)
    expect(result.current.timedOut).toBe(true)
    expect(result.current.statusText).toBe('Chat.Flow.DidNotReach')
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

  it('and from which step: the first contact (connecting) is told apart from a later failure', () => {
    vrcFlowStore.setStatus(CONN, 'connecting')
    vrcFlowStore.clearFlow(CONN, 'error')
    expect(vrcFlowStore.flowEndedFromStatus(CONN)).toBe('connecting')
    vrcFlowStore.setStatus(CONN, 'preparing-offer')
    vrcFlowStore.clearFlow(CONN, 'error')
    expect(vrcFlowStore.flowEndedFromStatus(CONN)).toBe('preparing-offer')
    // CONTROL: a plain clear, or a flow that completed, remembers no step
    vrcFlowStore.clearFlow(CONN)
    expect(vrcFlowStore.flowEndedFromStatus(CONN)).toBeUndefined()
    vrcFlowStore.clearFlow(CONN, 'error')
    expect(vrcFlowStore.flowEndedFromStatus(CONN)).toBeUndefined()
  })
})
