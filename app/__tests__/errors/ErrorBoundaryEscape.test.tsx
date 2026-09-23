/**
 * An error has to be escapable.
 *
 * A tester on a shipped build met a screen that threw every time it rendered.
 * Dismissing the error card cleared a flag and re-rendered the same subtree, so
 * the card came straight back; the app lock then turned that into a trap —
 * unlocking returned to the failed screen, which threw, which locked again —
 * and force-quitting did not help, because the next launch went to the same
 * place (report #27, 2026-09-23).
 *
 * So the test is not "does the boundary catch". It is: after a person dismisses
 * it, do they end up somewhere that does not throw? That question outlives
 * whatever made the screen throw tonight, which is the point — the trigger was
 * a render loop, but a bad cast or a missing field behaves identically.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import React, { useState } from 'react'
import { Text } from 'react-native'

import { ErrorBoundaryWrapper } from '@/errors/components/ErrorBoundary'

const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() } as never

/** A screen that fails the same way every time, like the one that shipped. */
const AlwaysThrows: React.FC = () => {
  throw new Error('Maximum update depth exceeded')
}

/**
 * The app around the boundary: `onEscape` is what navigation does in the real
 * shell — it leaves the failed route — so here it swaps what the subtree
 * renders, which is the same thing from the boundary's point of view.
 */
const App: React.FC<{ onEscapeCalls: () => void }> = ({ onEscapeCalls }) => {
  const [failed, setFailed] = useState(true)
  return (
    <ErrorBoundaryWrapper
      logger={logger}
      onEscape={() => {
        onEscapeCalls()
        setFailed(false)
      }}
    >
      {failed ? <AlwaysThrows /> : <Text>home</Text>}
    </ErrorBoundaryWrapper>
  )
}

describe('dismissing an error', () => {
  beforeEach(() => jest.clearAllMocks())

  it('lands somewhere that does not throw, for an error that always throws', async () => {
    const escaped = jest.fn()
    const tree = render(<App onEscapeCalls={escaped} />)

    // The card is up, and the screen behind it is the one that failed.
    expect(tree.getByTestId('com.ariesbifold:id/HeaderText')).toBeTruthy()

    fireEvent.press(tree.getByTestId('com.ariesbifold:id/CloseButton'))

    // Leaving happened before anything was rendered again…
    expect(escaped).toHaveBeenCalledTimes(1)
    // …and what came back is not the thing that threw.
    await waitFor(() => expect(tree.getByText('home')).toBeTruthy())
    expect(tree.queryByTestId('com.ariesbifold:id/HeaderText')).toBeNull()
  })

  it('does not trap a person when the app cannot leave the screen', async () => {
    // No `onEscape` — the worst case, and the one that shipped. The subtree is
    // still rebuilt under a new key rather than resumed, so the boundary must
    // not wedge: it catches again and offers a way out rather than looping
    // silently.
    const tree = render(
      <ErrorBoundaryWrapper logger={logger}>
        <AlwaysThrows />
      </ErrorBoundaryWrapper>
    )
    fireEvent.press(tree.getByTestId('com.ariesbifold:id/CloseButton'))
    await waitFor(() => expect(tree.getByTestId('com.ariesbifold:id/HeaderText')).toBeTruthy())
    // Caught twice in quick succession: the error is deterministic, so the card
    // stops offering a retry and offers to go home instead.
    await waitFor(() => expect(tree.getByText('Error.GoHome')).toBeTruthy())
  })
})
