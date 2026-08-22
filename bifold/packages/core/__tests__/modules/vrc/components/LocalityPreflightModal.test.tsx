import { render, fireEvent, waitFor } from '@testing-library/react-native'
import React from 'react'
import { Linking } from 'react-native'

import LocalityPreflightModal from '../../../../src/modules/vrc/components/LocalityPreflightModal'
import { useWitnessConnection } from '../../../../src/modules/vrc/context/WitnessConnectionProvider'

jest.mock('../../../../src/modules/vrc/context/WitnessConnectionProvider', () => ({
  useWitnessConnection: jest.fn(),
}))

const mockRequest = jest.fn(() => Promise.resolve('granted'))
jest.mock('react-native-permissions', () => ({
  PERMISSIONS: {
    ANDROID: {
      BLUETOOTH_ADVERTISE: 'android.permission.BLUETOOTH_ADVERTISE',
      BLUETOOTH_SCAN: 'android.permission.BLUETOOTH_SCAN',
    },
  },
  RESULTS: { GRANTED: 'granted', DENIED: 'denied' },
  request: (...args: unknown[]) => mockRequest(...args),
}))

jest.spyOn(Linking, 'openSettings').mockImplementation(() => Promise.resolve())

const mockUseWitnessConnection = useWitnessConnection as jest.Mock

function withPreflight(overrides?: { eventName?: string; required?: boolean }) {
  const resolveLocalityPreflight = jest.fn()
  mockUseWitnessConnection.mockReturnValue({
    localityPreflight: {
      witness: { name: 'e2e-witness', eventName: overrides?.eventName, connectionId: 'conn-1', connectedAt: new Date() },
      required: overrides?.required ?? false,
    },
    resolveLocalityPreflight,
  })
  return { resolveLocalityPreflight }
}

describe('LocalityPreflightModal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRequest.mockResolvedValue('granted')
  })

  it('renders nothing when no prompt is pending', () => {
    mockUseWitnessConnection.mockReturnValue({
      localityPreflight: undefined,
      resolveLocalityPreflight: jest.fn(),
    })

    const { queryByTestId } = render(<LocalityPreflightModal />)
    expect(queryByTestId('com.bifold:id/LocalityPreflightTitle')).toBeNull()
  })

  it('names the witness event in the offer title', () => {
    withPreflight({ eventName: 'IIW Fall 2026' })

    const { getByText } = render(<LocalityPreflightModal />)
    expect(getByText('IIW Fall 2026 can confirm in-person meetings. Allow Bluetooth?')).toBeTruthy()
  })

  it('falls back to the witness name when no eventName is set', () => {
    withPreflight()

    const { getByText } = render(<LocalityPreflightModal />)
    expect(getByText('e2e-witness can confirm in-person meetings. Allow Bluetooth?')).toBeTruthy()
  })

  it('Allow requests both BLE permissions and resolves with allow:true', async () => {
    const { resolveLocalityPreflight } = withPreflight()

    const { getByLabelText } = render(<LocalityPreflightModal />)
    fireEvent.press(getByLabelText('Allow'))

    await waitFor(() => expect(resolveLocalityPreflight).toHaveBeenCalledWith(true))
    expect(mockRequest).toHaveBeenCalledWith('android.permission.BLUETOOTH_ADVERTISE')
    expect(mockRequest).toHaveBeenCalledWith('android.permission.BLUETOOTH_SCAN')
  })

  it('Allow resolves allow:true even if the OS denies the permission', async () => {
    mockRequest.mockResolvedValue('denied')
    const { resolveLocalityPreflight } = withPreflight()

    const { getByLabelText } = render(<LocalityPreflightModal />)
    fireEvent.press(getByLabelText('Allow'))

    await waitFor(() => expect(resolveLocalityPreflight).toHaveBeenCalledWith(true))
  })

  it('Not now resolves allow:false directly when the witness does not require locality', () => {
    const { resolveLocalityPreflight } = withPreflight({ required: false })

    const { getByLabelText, queryByTestId } = render(<LocalityPreflightModal />)
    fireEvent.press(getByLabelText('Not now'))

    expect(resolveLocalityPreflight).toHaveBeenCalledWith(false)
    expect(queryByTestId('com.bifold:id/LocalityPreflightRequiredTitle')).toBeNull()
  })

  it('Not now on a required witness shows the refusal state instead of resolving immediately', () => {
    const { resolveLocalityPreflight } = withPreflight({ eventName: 'Gated Summit', required: true })

    const { getByLabelText, getByText } = render(<LocalityPreflightModal />)
    fireEvent.press(getByLabelText('Not now'))

    expect(resolveLocalityPreflight).not.toHaveBeenCalled()
    expect(getByText('Gated Summit requires in-person confirmation')).toBeTruthy()
  })

  it('the refusal state\'s "Continue without it" resolves allow:false', () => {
    const { resolveLocalityPreflight } = withPreflight({ required: true })

    const { getByLabelText } = render(<LocalityPreflightModal />)
    fireEvent.press(getByLabelText('Not now'))
    fireEvent.press(getByLabelText('Continue without it'))

    expect(resolveLocalityPreflight).toHaveBeenCalledWith(false)
  })

  it('the refusal state\'s "Open settings" opens the OS settings and resolves allow:false', async () => {
    const { resolveLocalityPreflight } = withPreflight({ required: true })

    const { getByLabelText } = render(<LocalityPreflightModal />)
    fireEvent.press(getByLabelText('Not now'))
    fireEvent.press(getByLabelText('Open settings'))

    await waitFor(() => expect(resolveLocalityPreflight).toHaveBeenCalledWith(false))
    expect(Linking.openSettings).toHaveBeenCalledTimes(1)
  })
})
