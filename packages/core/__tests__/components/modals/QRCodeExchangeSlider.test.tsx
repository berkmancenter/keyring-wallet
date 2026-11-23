import { render, fireEvent, waitFor } from '@testing-library/react-native'
import React from 'react'
import { useNavigation } from '@react-navigation/native'

import QRCodeExchangeSlider from '../../../src/components/modals/QRCodeExchangeSlider'
import { BasicAppContext } from '../../helpers/app'
import { testIdWithKey } from '../../../src/utils/testable'
import { Screens, Stacks } from '../../../src/types/navigators'

describe('QRCodeExchangeSlider Component', () => {
  const mockNavigation = useNavigation()

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('Renders correctly when visible', () => {
    const onDismiss = jest.fn()
    const tree = render(
      <BasicAppContext>
        <QRCodeExchangeSlider visible={true} onDismiss={onDismiss} navigation={mockNavigation as any} />
      </BasicAppContext>
    )

    expect(tree).toMatchSnapshot()
  })

  test('Does not render when not visible', () => {
    const onDismiss = jest.fn()
    const { queryByTestId } = render(
      <BasicAppContext>
        <QRCodeExchangeSlider visible={false} onDismiss={onDismiss} navigation={mockNavigation as any} />
      </BasicAppContext>
    )

    const title = queryByTestId(testIdWithKey('QRCodeExchangeTitle'))
    expect(title).toBeNull()
  })

  test('Displays title and description', () => {
    const onDismiss = jest.fn()
    const { getByTestId } = render(
      <BasicAppContext>
        <QRCodeExchangeSlider visible={true} onDismiss={onDismiss} navigation={mockNavigation as any} />
      </BasicAppContext>
    )

    expect(getByTestId(testIdWithKey('QRCodeExchangeTitle'))).toBeTruthy()
    expect(getByTestId(testIdWithKey('QRCodeExchangeDescription'))).toBeTruthy()
  })

  test('Displays both action buttons', () => {
    const onDismiss = jest.fn()
    const { getByTestId } = render(
      <BasicAppContext>
        <QRCodeExchangeSlider visible={true} onDismiss={onDismiss} navigation={mockNavigation as any} />
      </BasicAppContext>
    )

    expect(getByTestId(testIdWithKey('ScanQRCode'))).toBeTruthy()
    expect(getByTestId(testIdWithKey('GenerateQRCode'))).toBeTruthy()
  })

  test('Calls onDismiss when close button is pressed', () => {
    const onDismiss = jest.fn()
    const { getByTestId } = render(
      <BasicAppContext>
        <QRCodeExchangeSlider visible={true} onDismiss={onDismiss} navigation={mockNavigation as any} />
      </BasicAppContext>
    )

    const closeButton = getByTestId(testIdWithKey('Close'))
    fireEvent.press(closeButton)

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  test('Navigates to Scan screen when "Scan QR Code" button is pressed', async () => {
    const onDismiss = jest.fn()
    const { getByTestId } = render(
      <BasicAppContext>
        <QRCodeExchangeSlider visible={true} onDismiss={onDismiss} navigation={mockNavigation as any} />
      </BasicAppContext>
    )

    const scanButton = getByTestId(testIdWithKey('ScanQRCode'))
    fireEvent.press(scanButton)

    await waitFor(() => {
      expect(mockNavigation.navigate).toHaveBeenCalledWith(Stacks.ConnectStack, {
        screen: Screens.Scan,
      })
    })

    // onDismiss should be called after navigation
    await waitFor(() => {
      expect(onDismiss).toHaveBeenCalled()
    }, { timeout: 100 })
  })

  test('Navigates to Scan screen with defaultToConnect when "Generate QR Code" button is pressed', async () => {
    const onDismiss = jest.fn()
    const { getByTestId } = render(
      <BasicAppContext>
        <QRCodeExchangeSlider visible={true} onDismiss={onDismiss} navigation={mockNavigation as any} />
      </BasicAppContext>
    )

    const generateButton = getByTestId(testIdWithKey('GenerateQRCode'))
    fireEvent.press(generateButton)

    await waitFor(() => {
      expect(mockNavigation.navigate).toHaveBeenCalledWith(Stacks.ConnectStack, {
        screen: Screens.Scan,
        params: { defaultToConnect: true },
      })
    })

    // onDismiss should be called after navigation
    await waitFor(() => {
      expect(onDismiss).toHaveBeenCalled()
    }, { timeout: 100 })
  })

  // Note: Testing outside area press is complex due to component structure
  // The functionality is covered by integration tests
})

