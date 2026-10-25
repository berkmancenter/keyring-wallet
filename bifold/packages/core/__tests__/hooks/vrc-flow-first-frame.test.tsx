/**
 * A screen that opens on a connection whose exchange is already under way has the overlay in its first frame
 * (UI-smoothness plan, Phase 4). The overlay started hidden and an effect read the flow after the screen had painted,
 * so Chat showed once without it. Every render is kept in order, so "first frame" is the first one, not the end.
 */
import { renderHook } from '@testing-library/react-native'

import { useVrcFlowInProgress } from '../../src/hooks/chat-messages'
import { vrcFlowStore } from '../../src/modules/vrc/witnessStatusStore'

const CONN = 'conn-first-frame'

/** The overlay, with every render's state kept in order. */
function overlay() {
  const seen: { inProgress: boolean; statusText: string; progressFraction: number }[] = []
  const hook = renderHook(() => {
    const state = useVrcFlowInProgress(CONN)
    seen.push({ inProgress: state.inProgress, statusText: state.statusText, progressFraction: state.progressFraction })
    return state
  })
  return { ...hook, seen }
}

describe('the overlay when a screen opens on a flow', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    vrcFlowStore.clearFlow(CONN)
  })
  afterEach(() => {
    vrcFlowStore.clearFlow(CONN)
    jest.useRealTimers()
  })

  it('a flow under way: the overlay, its words and its bar in the first frame, and in every frame after', () => {
    vrcFlowStore.setDialect(CONN, 'trust-tasks')
    vrcFlowStore.setStatus(CONN, 'witness-active', true)
    const { seen } = overlay()
    expect(seen[0]).toEqual({
      inProgress: true,
      statusText: 'Verifying with witness...',
      progressFraction: expect.any(Number),
    })
    expect(seen[0].progressFraction).toBeGreaterThan(0)
    expect(seen.filter((s) => !s.inProgress)).toEqual([])
    // Read once at open: no render loop.
    expect(seen.length).toBeLessThan(5)
  })

  it('a flow that has ended, or holds an offer to act on: no overlay, from the first frame (the control)', () => {
    const { seen: idle } = overlay()
    expect(idle[0].inProgress).toBe(false)
    vrcFlowStore.setStatus(CONN, 'offer-received')
    const { seen: offer } = overlay()
    expect(offer.filter((s) => s.inProgress)).toEqual([])
  })
})
