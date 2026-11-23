import { render, fireEvent } from '@testing-library/react-native'
import React from 'react'

import IconButton, { ButtonLocation } from '../../src/components/buttons/IconButton'
import { testIdWithKey } from '../../src/utils/testable'
import { BasicAppContext } from '../helpers/app'

describe('IconButton Component', () => {
  test('Left alignment renders correctly', () => {
    const tree = render(
      <BasicAppContext>
        <IconButton
          buttonLocation={ButtonLocation.Left}
          accessibilityLabel={'LeftButton'}
          testID={testIdWithKey('LeftButton')}
          onPress={jest.fn()}
          icon="information"
        />
      </BasicAppContext>
    )

    expect(tree).toMatchSnapshot()
  })

  test('Right alignment renders correctly', () => {
    const tree = render(
      <BasicAppContext>
        <IconButton
          buttonLocation={ButtonLocation.Right}
          accessibilityLabel={'RightButton'}
          testID={testIdWithKey('RightButton')}
          onPress={jest.fn()}
          icon="information"
        />
      </BasicAppContext>
    )

    expect(tree).toMatchSnapshot()
  })

  test('Right alignment with text renders correctly', () => {
    const tree = render(
      <BasicAppContext>
        <IconButton
          buttonLocation={ButtonLocation.Right}
          accessibilityLabel={'RightButton'}
          testID={testIdWithKey('RightButton')}
          onPress={jest.fn()}
          text="RightButton"
          icon="information"
        />
      </BasicAppContext>
    )

    expect(tree).toMatchSnapshot()
  })

  test('Button onPress triggers on press', () => {
    const callback = jest.fn()
    const { getByTestId } = render(
      <BasicAppContext>
        <IconButton
          buttonLocation={ButtonLocation.Left}
          accessibilityLabel={'LeftButton'}
          testID={testIdWithKey('LeftButton')}
          onPress={callback}
          icon="information"
        />
      </BasicAppContext>
    )

    const button = getByTestId(testIdWithKey('LeftButton'))

    fireEvent(button, 'press')

    expect(callback).toHaveBeenCalledTimes(1)
  })

  // On Android a hit slop reaches past the header and wins taps below it: Messages' search Clear opened New message.
  test.each([
    ['Left', ButtonLocation.Left],
    ['Right', ButtonLocation.Right],
  ])('%s: its touch area reaches only 12 below the icon, staying inside the header', (_name, location) => {
    const tree = render(
      <BasicAppContext>
        <IconButton
          buttonLocation={location}
          accessibilityLabel={'HeaderButton'}
          testID={testIdWithKey('HeaderButton')}
          onPress={jest.fn()}
          icon="information"
        />
      </BasicAppContext>
    )
    expect(tree.getByTestId(testIdWithKey('HeaderButton')).props.hitSlop).toEqual({
      top: 44,
      bottom: 12,
      left: 44,
      right: 44,
    })
  })
})
