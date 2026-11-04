/**
 * The note's line at each text size. React Native's jest setup reports a font scale of 2, so a test that doesn't set it
 * only ever sees the wrapped line.
 */
import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { RoomNoteMarker } from '../components/RoomNoteMarker'
import { toInertText } from '../inertText'

let mockFontScale = 1
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }),
}))

const id = (key: string) => testIdWithKey(key)
const LONG = 'Notes from the October working session on onboarding, vetting and the community directory'
const draw = (onOpen: () => void = jest.fn()) =>
  render(
    <BasicAppContext>
      <RoomNoteMarker title={toInertText(LONG)} onOpen={onOpen} />
    </BasicAppContext>
  )

describe('the line at each text size', () => {
  test('normal text: one line, the title cut short, "See" beside it', () => {
    mockFontScale = 1
    const tree = draw()
    const words = tree.getByTestId(id('RoomNoteMarkerWords'))
    expect(words.props.numberOfLines).toBe(1)
    expect(words).toHaveTextContent(LONG, { exact: false })
    expect(tree.getByTestId(id('RoomNoteMarkerOpen'))).toBeTruthy()
  })

  test('just under large text: still one line', () => {
    mockFontScale = 1.28
    expect(draw().getByTestId(id('RoomNoteMarkerWords')).props.numberOfLines).toBe(1)
  })

  test("large text, as Android reports 1.3: it wraps, and the title isn't cut", () => {
    mockFontScale = 1.2999999523
    const tree = draw()
    expect(tree.getByTestId(id('RoomNoteMarkerWords')).props.numberOfLines).toBeUndefined()
    expect(tree.getByTestId(id('RoomNoteMarkerOpen'))).toBeTruthy()
  })

  test('the largest text: it wraps', () => {
    mockFontScale = 2
    const tree = draw()
    expect(tree.getByTestId(id('RoomNoteMarkerWords')).props.numberOfLines).toBeUndefined()
    expect(tree.getByTestId(id('RoomNoteMarkerOpen'))).toBeTruthy()
  })

  test('a tap opens, and a screen reader hears the title', () => {
    mockFontScale = 1
    const onOpen = jest.fn()
    const tree = draw(onOpen)
    const row = tree.getByTestId(id('RoomNoteMarker'))
    expect(row.props.accessibilityLabel).toContain(LONG)
    fireEvent.press(row)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
