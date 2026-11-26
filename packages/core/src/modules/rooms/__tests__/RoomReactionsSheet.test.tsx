import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { ScrollView, StyleSheet } from 'react-native'

import { testIdWithKey } from '../../../utils/testable'
import { RoomReactionsSheet } from '../components/RoomReactionsSheet'

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context/jest/mock').default,
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}))

const long = 'thanks for organising all of this, really appreciated by everyone'

describe('RoomReactionsSheet', () => {
  test('shows each value whole, once, with who chose it and a count only for more than one', () => {
    const { getAllByTestId, getByText } = render(
      <RoomReactionsSheet
        rows={[
          { value: '👍', names: ['You', 'Noor Haddad'] },
          { value: long, names: ['river-stone'] },
        ]}
        onClose={jest.fn()}
      />
    )
    const values = getAllByTestId(testIdWithKey('RoomReactionsValue')).map((v) => v.props.children)
    expect(values).toEqual(['👍 2', long])
    expect(getByText('You, Noor Haddad')).toBeTruthy()
    expect(getAllByTestId(testIdWithKey('RoomReactionsValue'))[1].props.numberOfLines).toBeUndefined()
  })

  test('a web address is words: nothing in the list can be pressed', () => {
    const { getByText } = render(
      <RoomReactionsSheet
        rows={[{ value: 'https://example.org/agenda', names: ['Tomás Reyes'] }]}
        onClose={jest.fn()}
      />
    )
    const value = getByText('https://example.org/agenda')
    expect(value.props.onPress).toBeUndefined()
    expect(value.props.accessibilityRole).toBeUndefined()
  })

  test('the list scrolls and Close sits outside it, so Close stays reachable at any text size', () => {
    const { getByTestId, UNSAFE_getByType } = render(
      <RoomReactionsSheet rows={[{ value: '👍', names: ['You'] }]} onClose={jest.fn()} />
    )
    const list = UNSAFE_getByType(ScrollView)
    expect(list.props.testID).toBe(testIdWithKey('RoomReactionsList'))
    const close = getByTestId(testIdWithKey('RoomReactionsClose'))
    let inside = false
    for (let up = close.parent; up; up = up.parent) inside = inside || up === list
    expect(inside).toBe(false)
  })

  test('it stops at the top safe area, clear of the camera at the largest text', () => {
    const { getByTestId } = render(<RoomReactionsSheet rows={[{ value: '👍', names: ['You'] }]} onClose={jest.fn()} />)
    expect(StyleSheet.flatten(getByTestId(testIdWithKey('RoomReactionsLayout')).props.style).paddingTop).toBe(59)
  })

  test('Close and the backdrop both close it, and with no rows nothing is open', () => {
    const onClose = jest.fn()
    const { getByTestId, rerender, queryByTestId } = render(
      <RoomReactionsSheet rows={[{ value: '👍', names: ['You'] }]} onClose={onClose} />
    )
    fireEvent.press(getByTestId(testIdWithKey('RoomReactionsClose')))
    fireEvent.press(getByTestId(testIdWithKey('RoomReactionsBackdrop')))
    expect(onClose).toHaveBeenCalledTimes(2)
    rerender(<RoomReactionsSheet rows={undefined} onClose={onClose} />)
    expect(queryByTestId(testIdWithKey('RoomReactionsSheet'))).toBeNull()
  })
})
