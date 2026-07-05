import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { useNavigation as testUseNavigation } from '../../../../__mocks__/@react-navigation/native'
import WitnessHeaderButton from '../../../../src/modules/vrc/components/WitnessHeaderButton'
import { BasicAppContext } from '../../../helpers/app'
import { Screens } from '../../../../src/types/navigators'

const navigation = testUseNavigation()

describe('WitnessHeaderButton Component', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('Renders correctly', () => {
    const tree = render(
      <BasicAppContext>
        <WitnessHeaderButton />
      </BasicAppContext>
    )

    expect(tree).toBeTruthy()
  })

  test('Navigates to WitnessConnections screen when pressed', () => {
    const { getByRole } = render(
      <BasicAppContext>
        <WitnessHeaderButton />
      </BasicAppContext>
    )

    const button = getByRole('button')
    expect(button).toBeTruthy()

    fireEvent.press(button)

    expect(navigation.navigate).toHaveBeenCalledWith(Screens.WitnessConnections)
    expect(navigation.navigate).toHaveBeenCalledTimes(1)
  })

  test('Has correct accessibility label when no active witness', () => {
    const { getByLabelText } = render(
      <BasicAppContext>
        <WitnessHeaderButton />
      </BasicAppContext>
    )

    const button = getByLabelText('View witness connections')
    expect(button).toBeTruthy()
  })
})
