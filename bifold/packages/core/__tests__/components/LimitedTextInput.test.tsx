import { render } from '@testing-library/react-native'
import React from 'react'
import { StyleSheet } from 'react-native'

import LimitedTextInput from '../../src/components/inputs/LimitedTextInput'
import { BasicAppContext } from '../helpers/app'

// iOS layout check (241): the R-Card fields, built on this input, were 42-43 pt
// tall, under the 44 pt minimum touch target.
describe('LimitedTextInput', () => {
  it('is at least 44 pt tall, the minimum touch target', () => {
    const tree = render(
      <BasicAppContext>
        <LimitedTextInput label="Name" limit={40} handleChangeText={jest.fn()} testID="field" />
      </BasicAppContext>
    )
    expect(StyleSheet.flatten(tree.getByTestId('field').props.style).minHeight).toBeGreaterThanOrEqual(44)
  })
})
