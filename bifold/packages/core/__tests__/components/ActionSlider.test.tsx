import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'

import ActionSlider from '../../src/components/chat/ActionSlider'
import { testIdWithKey } from '../../src/utils/testable'
import { BasicAppContext } from '../helpers/app'

/**
 * The sheet sits below a tap-outside layer in a column. Jest has no layout engine, so these tests check the styles
 * that decide where the sheet lands, not its position: a layer of the full height put the sheet just below the
 * screen, laid out but never seen (the RC's "+" sheet, 10-25). Only a device or simulator run shows the position.
 */
describe('ActionSlider', () => {
  const actions = [{ text: 'Photo library', testID: 'ChatAttachLibrary', icon: () => null, onPress: jest.fn() }]

  const renderSlider = (onDismiss = jest.fn()) =>
    render(
      <BasicAppContext>
        <ActionSlider actions={actions} onDismiss={onDismiss} />
      </BasicAppContext>
    )

  const outsideListener = (tree: ReturnType<typeof renderSlider>) => {
    const layers = tree.UNSAFE_getAllByType(TouchableOpacity).filter((node) => node.props.accessible === false)
    expect(layers).toHaveLength(1)
    return layers[0]
  }

  test('the tap-outside layer takes only the space the sheet leaves', () => {
    const style = StyleSheet.flatten(outsideListener(renderSlider()).props.style)

    expect(style.flex).toBe(1)
    expect(style.height).toBeUndefined()
  })

  test('a tap outside the sheet dismisses it', () => {
    const onDismiss = jest.fn()
    const tree = renderSlider(onDismiss)

    fireEvent.press(outsideListener(tree))

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  test('shows each action under its stable test id', () => {
    const tree = renderSlider()

    fireEvent.press(tree.getByTestId(testIdWithKey('ChatAttachLibrary')))

    expect(actions[0].onPress).toHaveBeenCalledTimes(1)
  })
})
