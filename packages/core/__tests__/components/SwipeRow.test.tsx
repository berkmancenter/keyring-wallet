/**
 * SwipeRow, the action behind a Messages row (L4's Delete, R3's Hide): the row's own touchable gets the long press
 * and the screen reader's action, both doing what the action behind it does; the action's colour says whether it
 * deletes; its width is the row's to set.
 */
import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'

import SwipeRow, { type SwipeRowAction } from '../../src/components/listItems/SwipeRow'

const row = (action: Partial<SwipeRowAction> = {}) => {
  const onPress = jest.fn()
  const tree = render(
    <SwipeRow
      action={{
        name: 'hide',
        label: 'Hide',
        icon: 'eye-off-outline',
        tone: 'neutral',
        onPress,
        testID: 'act',
        ...action,
      }}
    >
      {(touch) => (
        <TouchableOpacity testID="row" accessibilityLabel="Planning" {...touch}>
          <Text>Planning</Text>
        </TouchableOpacity>
      )}
    </SwipeRow>
  )
  return { tree, onPress }
}

test('a long press does what the action does', () => {
  const { tree, onPress } = row()
  fireEvent(tree.getByTestId('row'), 'longPress')
  expect(onPress).toHaveBeenCalledTimes(1)
})

test("the screen reader's action is the row's own, by the action's name; another name does nothing", () => {
  const { tree, onPress } = row()
  const item = tree.getByTestId('row')
  expect(item.props.accessibilityActions).toEqual([{ name: 'hide', label: 'Hide' }])
  fireEvent(item, 'accessibilityAction', { nativeEvent: { actionName: 'delete' } })
  expect(onPress).not.toHaveBeenCalled()
  fireEvent(item, 'accessibilityAction', { nativeEvent: { actionName: 'hide' } })
  expect(onPress).toHaveBeenCalledTimes(1)
})

test('the action behind the row: its words, a button, and what it does', () => {
  const { tree, onPress } = row()
  const action = tree.getByTestId('act')
  expect(action.props.accessibilityLabel).toBe('Hide')
  fireEvent.press(action)
  expect(onPress).toHaveBeenCalledTimes(1)
})

test('red for what deletes, dark grey for what only puts a row away; 88 pt wide unless the row says', () => {
  const style = (tree: ReturnType<typeof render>) => StyleSheet.flatten(tree.getByTestId('act').props.style)
  expect(style(row({ tone: 'neutral' }).tree)).toMatchObject({ backgroundColor: '#4A4A4A', width: 88 })
  expect(style(row({ tone: 'destructive', width: 96 }).tree)).toMatchObject({ backgroundColor: '#D21E30', width: 96 })
})
