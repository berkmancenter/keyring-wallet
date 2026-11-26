import { render, fireEvent, waitFor, cleanup } from '@testing-library/react-native'
import React from 'react'

// Import directly from bifold submodule path
// eslint-disable-next-line @typescript-eslint/no-var-requires
import QRCodeExchangeSlider from '../../../packages/core/src/components/modals/QRCodeExchangeSlider'
import { BasicAppContext } from '../../__mocks__/helpers/app'
import { testIdWithKey } from '@bifold/core'

describe('QR Code Flow Integration', () => {
  const mockNavigation = {
    navigate: jest.fn(),
    getParent: jest.fn(() => ({
      navigate: jest.fn(),
    })),
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    // Clean up rendered components to prevent memory leaks and timer issues
    cleanup()
    // Clear any pending timers that might be running
    jest.clearAllTimers()
  })

  test('QRCodeExchangeSlider renders correctly in AdvancedIdentity context', () => {
    const onDismiss = jest.fn()
    const tree = render(
      <BasicAppContext>
        <QRCodeExchangeSlider visible={true} onDismiss={onDismiss} navigation={mockNavigation as any} />
      </BasicAppContext>
    )

    expect(tree).toMatchSnapshot()
    // Unmount to prevent timer issues
    tree.unmount()
  })

  test('QRCodeExchangeSlider shows both action buttons in AdvancedIdentity context', () => {
    const onDismiss = jest.fn()
    const { getByTestId, unmount } = render(
      <BasicAppContext>
        <QRCodeExchangeSlider visible={true} onDismiss={onDismiss} navigation={mockNavigation as any} />
      </BasicAppContext>
    )

    expect(getByTestId(testIdWithKey('ScanQRCode'))).toBeTruthy()
    expect(getByTestId(testIdWithKey('GenerateQRCode'))).toBeTruthy()
    // Unmount to prevent timer issues
    unmount()
  })

  test('QRCodeExchangeSlider navigation works in AdvancedIdentity context', async () => {
    const onDismiss = jest.fn()
    const { getByTestId, unmount } = render(
      <BasicAppContext>
        <QRCodeExchangeSlider visible={true} onDismiss={onDismiss} navigation={mockNavigation as any} />
      </BasicAppContext>
    )

    const scanButton = getByTestId(testIdWithKey('ScanQRCode'))
    fireEvent.press(scanButton)

    await waitFor(() => {
      expect(mockNavigation.navigate).toHaveBeenCalled()
    })
    // Unmount to prevent timer issues
    unmount()
  })
})
