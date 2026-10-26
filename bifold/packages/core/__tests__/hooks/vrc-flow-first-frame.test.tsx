/**
 * A screen that opens on a connection whose exchange is already under way has the overlay in its first frame
 * (UI-smoothness plan, Phase 4). The overlay started hidden and an effect read the flow after the screen had painted,
 * so Chat showed once without it. Every committed frame is kept in order (a layout effect runs once per commit; a
 * render React discards, as one that sets state while rendering, is not a frame), so "first frame" is the first one.
 */
import i18next from 'i18next'
import { renderHook } from '@testing-library/react-native'
import { useLayoutEffect } from 'react'

import { useVrcFlowInProgress } from '../../src/hooks/chat-messages'
import en from '../../src/localization/en/en.json'
import { vrcFlowStore } from '../../src/modules/vrc/witnessStatusStore'

// The overlay's words in English, from the locale file through a real i18next: these assertions read what a person
// reads, not a key (react-i18next is mocked to return keys elsewhere).
const mockI18n = i18next.createInstance()
mockI18n.init({ lng: 'en', resources: { en: { translation: en } }, initImmediate: false })
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockI18n.t.bind(mockI18n), i18n: mockI18n }),
}))

const CONN = 'conn-first-frame'

/** The overlay, with every committed frame's state kept in order. */
function overlay() {
  const seen: { inProgress: boolean; statusText: string; progressFraction: number }[] = []
  const hook = renderHook(() => {
    const state = useVrcFlowInProgress(CONN)
    useLayoutEffect(() => {
      seen.push({
        inProgress: state.inProgress,
        statusText: state.statusText,
        progressFraction: state.progressFraction,
      })
    })
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

// Chat is not remounted when another conversation opens in it (navigating to it updates its params): the overlay
// seeded for the last connection must not show over the new one, not even for one frame.
describe('the overlay when another connection opens in the same screen', () => {
  const A = 'conn-first-frame-a'
  const B = 'conn-first-frame-b'
  beforeEach(() => {
    jest.useFakeTimers()
    vrcFlowStore.clearFlow(A)
    vrcFlowStore.clearFlow(B)
  })
  afterEach(() => {
    vrcFlowStore.clearFlow(A)
    vrcFlowStore.clearFlow(B)
    jest.useRealTimers()
  })

  /** The overlay on `initial`, every committed frame kept with the connection it was for. */
  function overlayOn(initial: string) {
    const seen: { id: string; inProgress: boolean; statusText: string; confirmed: boolean }[] = []
    const hook = renderHook(
      ({ id }: { id: string }) => {
        const state = useVrcFlowInProgress(id)
        useLayoutEffect(() => {
          seen.push({ id, inProgress: state.inProgress, statusText: state.statusText, confirmed: state.confirmed })
        })
        return state
      },
      { initialProps: { id: initial } }
    )
    return { ...hook, seen }
  }

  // And not A's session either: kept, B's idle read as the end of a session whose bar had started — "Relationship
  // confirmed" over a conversation where nothing was exchanged.
  it("A's flow under way, then B opens: no frame shows A's overlay over B, and nothing is confirmed on B", () => {
    vrcFlowStore.setDialect(A, 'trust-tasks')
    vrcFlowStore.setStatus(A, 'witness-active', true)
    const { rerender, seen } = overlayOn(A)
    // The control: A's overlay is there.
    expect(seen[seen.length - 1]).toMatchObject({ id: A, inProgress: true })
    rerender({ id: B })
    expect(seen.some((s) => s.id === B)).toBe(true)
    expect(seen.filter((s) => s.id === B && (s.inProgress || s.confirmed))).toEqual([])
  })

  it("B with its own flow: B's words from B's first frame", () => {
    vrcFlowStore.setStatus(A, 'proposed')
    vrcFlowStore.setDialect(B, 'trust-tasks')
    vrcFlowStore.setStatus(B, 'witness-active', true)
    const { rerender, seen } = overlayOn(A)
    rerender({ id: B })
    const firstOnB = seen.find((s) => s.id === B)
    expect(firstOnB).toMatchObject({ inProgress: true, statusText: 'Verifying with witness...' })
  })
})
