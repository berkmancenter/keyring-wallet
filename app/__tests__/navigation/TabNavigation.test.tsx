import { render } from '@testing-library/react-native'
import React from 'react'

// Import directly from bifold submodule path
// eslint-disable-next-line @typescript-eslint/no-var-requires
import QRCodeExchangeSlider from '../../../packages/core/src/components/modals/QRCodeExchangeSlider'
import { BasicAppContext } from '../../__mocks__/helpers/app'
import { testIdWithKey } from '@bifold/core'

describe('Tab Navigation Integration', () => {
  const mockNavigation = {
    navigate: jest.fn(),
    getParent: jest.fn(() => ({
      navigate: jest.fn(),
    })),
  }

  test('QRCodeExchangeSlider component is accessible from bifold in AdvancedIdentity', () => {
    const onDismiss = jest.fn()
    const { getByTestId } = render(
      <BasicAppContext>
        <QRCodeExchangeSlider visible={true} onDismiss={onDismiss} navigation={mockNavigation as any} />
      </BasicAppContext>,
    )

    // Verify the component renders and has expected elements
    expect(getByTestId(testIdWithKey('QRCodeExchangeTitle'))).toBeTruthy()
    expect(getByTestId(testIdWithKey('QRCodeExchangeDescription'))).toBeTruthy()
    expect(getByTestId(testIdWithKey('ScanQRCode'))).toBeTruthy()
    expect(getByTestId(testIdWithKey('GenerateQRCode'))).toBeTruthy()
  })

  test('QRCodeExchangeSlider renders correctly', () => {
    const onDismiss = jest.fn()
    const tree = render(
      <BasicAppContext>
        <QRCodeExchangeSlider visible={true} onDismiss={onDismiss} navigation={mockNavigation as any} />
      </BasicAppContext>,
    )

    expect(tree).toMatchSnapshot()
  })
})
