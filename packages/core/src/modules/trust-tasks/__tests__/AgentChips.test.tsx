/**
 * The agent chips across the top of "Your agent": the current chip is
 * scrolled into view, and a long name loses its middle, not its end (236,
 * Pixel: two "keyring-runner-…" agents read alike, and the chip switched to
 * stayed half off the screen's edge).
 */
import { act, render } from '@testing-library/react-native'
import React from 'react'
import { ScrollView, StyleSheet } from 'react-native'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { AgentChips, AgentChip } from '../screens/AgentChips'

const UIUX = 'did:webvh:example:keyring-runner-uiux'
const OPENVTC = 'did:webvh:example:keyring-runner-openvtc'

const chips = (current: string): AgentChip[] => [
  { vtaDid: UIUX, name: 'keyring-runner-uiux', current: current === UIUX, waiting: 0 },
  { vtaDid: OPENVTC, name: 'keyring-runner-openvtc', current: current === OPENVTC, waiting: 0 },
]

const layout = (x: number) => ({ nativeEvent: { layout: { x, y: 0, width: 220, height: 44 } } })
// The current chip is disabled (it is already in use), and the testing
// library sends no events to a disabled element; a device lays it out all
// the same, so its onLayout is called directly.
const laidOut = (tree: ReturnType<typeof render>, i: number, x: number) =>
  act(() => tree.getByTestId(testIdWithKey(`AgentSwitcherRow_${i}`)).props.onLayout(layout(x)))

describe('AgentChips', () => {
  let scrollTo: jest.SpyInstance
  beforeEach(() => {
    scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => undefined)
  })
  afterEach(() => scrollTo.mockRestore())

  const renderChips = (current: string, inset?: number) =>
    render(
      <BasicAppContext>
        <AgentChips agents={chips(current)} onUse={jest.fn()} onAdd={jest.fn()} inset={inset} />
      </BasicAppContext>
    )

  it('scrolls the current chip into view once it is laid out', () => {
    const tree = renderChips(OPENVTC)
    laidOut(tree, 0, 0)
    expect(scrollTo).not.toHaveBeenCalled()
    laidOut(tree, 1, 236)
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 236, animated: true })
  })

  it('scrolls to the chip switched to, and back to the start for the first', () => {
    const tree = renderChips(UIUX)
    laidOut(tree, 0, 0)
    laidOut(tree, 1, 236)
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 0, animated: true })
    tree.rerender(
      <BasicAppContext>
        <AgentChips agents={chips(OPENVTC)} onUse={jest.fn()} onAdd={jest.fn()} />
      </BasicAppContext>
    )
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 236, animated: true })
  })

  // 239, iPhone: the strip stopped at an invisible line short of the screen's
  // edge (the page's and the card's padding). It runs out to the edges and
  // starts its first chip as far in as the text above.
  it('runs out to the screen edges, its chips in line with the text above', () => {
    const tree = renderChips(OPENVTC, 36)
    const strip = tree.getByTestId(testIdWithKey('AgentChips'))
    expect(StyleSheet.flatten(strip.props.style)).toMatchObject({ marginHorizontal: -36 })
    expect(StyleSheet.flatten(strip.props.contentContainerStyle)).toMatchObject({ paddingHorizontal: 36 })
    laidOut(tree, 0, 36)
    laidOut(tree, 1, 272)
    // The chip switched to lines up where the first one starts.
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 236, animated: true })
  })

  it('cuts a long name in the middle, so the start and end both show', () => {
    const tree = renderChips(UIUX)
    expect(tree.getByTestId(testIdWithKey('AgentHomeName')).props.ellipsizeMode).toBe('middle')
    expect(tree.getByTestId(testIdWithKey('AgentSwitcherOther_1')).props.ellipsizeMode).toBe('middle')
  })
})
