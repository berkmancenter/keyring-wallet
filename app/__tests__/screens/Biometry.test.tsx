import { fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { check, request, RESULTS } from 'react-native-permissions'
import { getSupportedBiometryType } from 'react-native-keychain'

import Biometry from '../../src/screens/Biometry'

const mockCommitWalletToKeychain = jest.fn().mockResolvedValue(undefined)
const mockDispatch = jest.fn()

// Minimal fakes for the few @bifold/core pieces this screen uses, so the test
// pins this screen's switch logic and nothing else.
jest.mock('@bifold/core', () => {
  const { Pressable, Text } = jest.requireActual('react-native')
  const mockReact = jest.requireActual('react')
  return {
    useTheme: () => ({ Spacing: { md: 16 } }),
    testIdWithKey: (key: string) => `com.ariesbifold:id/${key}`,
    ThemedText: ({ children }: { children: React.ReactNode }) => mockReact.createElement(Text, null, children),
    Button: ({ testID, onPress, title }: { testID: string; onPress: () => void; title: string }) =>
      mockReact.createElement(Pressable, { testID, onPress }, mockReact.createElement(Text, null, title)),
    ButtonType: { Primary: 'Primary' },
    useAuth: () => ({
      commitWalletToKeychain: mockCommitWalletToKeychain,
      isBiometricsActive: () => Promise.resolve(true),
    }),
    useStore: () => [{ preferences: { useBiometry: false } }, mockDispatch],
    DispatchAction: { USE_BIOMETRY: 'preferences/useBiometry' },
    useAnimatedComponents: () => ({ ButtonLoading: () => null }),
  }
})

jest.mock('react-native-keychain', () => ({
  getSupportedBiometryType: jest.fn(),
  BIOMETRY_TYPE: { FACE_ID: 'FaceID', TOUCH_ID: 'TouchID' },
}))

jest.mock('../../src/assets/img/setup-fingerprint.svg', () => 'FingerprintIcon')

const mockedCheck = check as jest.MockedFunction<typeof check>
const mockedRequest = request as jest.MockedFunction<typeof request>
const mockedSupportedType = getSupportedBiometryType as jest.MockedFunction<typeof getSupportedBiometryType>

const TOGGLE = 'com.ariesbifold:id/ToggleBiometrics'
const CONTINUE = 'com.ariesbifold:id/Continue'

describe('onboarding Biometry screen, turning the switch on', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedCheck.mockResolvedValue(RESULTS.DENIED)
    mockedRequest.mockResolvedValue(RESULTS.BLOCKED)
    mockedSupportedType.mockResolvedValue('FaceID' as never)
  })

  // IN-551: after a reinstall, iOS keeps the app's Face ID grant but
  // react-native-permissions loses its "requested" flag, so check() says DENIED
  // and request() never resolves (it waits for an alert iOS never shows).
  test('iOS Face ID with permission DENIED turns on without calling request(), even when request() would never resolve', async () => {
    mockedRequest.mockImplementation(() => new Promise(() => {}))
    const { getByTestId } = render(<Biometry />)

    fireEvent(getByTestId(TOGGLE), 'valueChange', true)

    await waitFor(() => expect(getByTestId(TOGGLE).props.value).toBe(true))
    expect(mockedCheck).toHaveBeenCalledTimes(1)
    expect(mockedRequest).not.toHaveBeenCalled()

    // Continue stores the wallet key for Biometric Unlock and saves the choice.
    fireEvent.press(getByTestId(CONTINUE))
    await waitFor(() => expect(mockCommitWalletToKeychain).toHaveBeenCalledWith(true))
    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith({ type: 'preferences/useBiometry', payload: [true] }))
  })

  // Controls: without a Face ID biometry type, DENIED still goes through request().
  test('DENIED with no Face ID type asks request(), and turns on when it answers GRANTED', async () => {
    mockedSupportedType.mockResolvedValue(null as never)
    mockedRequest.mockResolvedValue(RESULTS.GRANTED)
    const { getByTestId } = render(<Biometry />)

    fireEvent(getByTestId(TOGGLE), 'valueChange', true)

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(getByTestId(TOGGLE).props.value).toBe(true))
  })

  test('DENIED with no Face ID type asks request(), and stays off when it answers BLOCKED', async () => {
    mockedSupportedType.mockResolvedValue(null as never)
    const { getByTestId } = render(<Biometry />)

    fireEvent(getByTestId(TOGGLE), 'valueChange', true)

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1))
    expect(getByTestId(TOGGLE).props.value).toBe(false)
  })

  test('GRANTED turns on without calling request()', async () => {
    mockedCheck.mockResolvedValue(RESULTS.GRANTED)
    const { getByTestId } = render(<Biometry />)

    fireEvent(getByTestId(TOGGLE), 'valueChange', true)

    await waitFor(() => expect(getByTestId(TOGGLE).props.value).toBe(true))
    expect(mockedRequest).not.toHaveBeenCalled()
  })
})
