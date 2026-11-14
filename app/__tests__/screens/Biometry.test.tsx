import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { Alert } from 'react-native'
import { check, request, RESULTS } from 'react-native-permissions'
import { getSupportedBiometryType } from 'react-native-keychain'

import Biometry from '../../src/screens/Biometry'

const mockCommitWalletToKeychain = jest.fn().mockResolvedValue(undefined)
const mockDispatch = jest.fn()
const mockConfirmBiometricKeychainAccess = jest.fn()

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
    confirmBiometricKeychainAccess: (...args: unknown[]) => mockConfirmBiometricKeychainAccess(...args),
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
    mockConfirmBiometricKeychainAccess.mockResolvedValue(true)
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
  })

  // IN-551: after a reinstall, iOS keeps the app's Face ID grant but
  // react-native-permissions loses its "requested" flag, so check() says DENIED
  // and request() never resolves (it waits for an alert iOS never shows).
  test('iOS Face ID with permission DENIED turns on once Face ID opens the probe item, without calling request(), even when request() would never resolve', async () => {
    mockedRequest.mockImplementation(() => new Promise(() => {}))
    const { getByTestId } = render(<Biometry />)

    fireEvent(getByTestId(TOGGLE), 'valueChange', true)

    await waitFor(() => expect(getByTestId(TOGGLE).props.value).toBe(true))
    expect(mockConfirmBiometricKeychainAccess).toHaveBeenCalledWith(
      'Biometry.UnlockPromptTitle',
      'Biometry.UnlockPromptDescription'
    )
    expect(mockedCheck).toHaveBeenCalledTimes(1)
    expect(mockedRequest).not.toHaveBeenCalled()

    // Continue stores the wallet key for Biometric Unlock and saves the choice.
    fireEvent.press(getByTestId(CONTINUE))
    await waitFor(() => expect(mockCommitWalletToKeychain).toHaveBeenCalledWith(true))
    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith({ type: 'preferences/useBiometry', payload: [true] }))
  })

  test('iOS Face ID with permission DENIED stays off and says where to allow it when the probe fails and Face ID now reads BLOCKED', async () => {
    mockConfirmBiometricKeychainAccess.mockResolvedValue(false)
    mockedCheck.mockResolvedValueOnce(RESULTS.DENIED).mockResolvedValueOnce(RESULTS.BLOCKED)
    const { getByTestId } = render(<Biometry />)

    fireEvent(getByTestId(TOGGLE), 'valueChange', true)

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        'Biometry.AllowBiometricsTitle',
        'Biometry.AllowBiometricsDesc',
        expect.any(Array)
      )
    )
    expect(getByTestId(TOGGLE).props.value).toBe(false)
    expect(mockedRequest).not.toHaveBeenCalled()

    // Continue then leaves Biometric Unlock off.
    fireEvent.press(getByTestId(CONTINUE))
    await waitFor(() => expect(mockCommitWalletToKeychain).toHaveBeenCalledWith(false))
  })

  test('iOS Face ID with permission DENIED stays off and says it was not turned on when the probe fails for another reason', async () => {
    mockConfirmBiometricKeychainAccess.mockResolvedValue(false)
    const { getByTestId } = render(<Biometry />)

    fireEvent(getByTestId(TOGGLE), 'valueChange', true)

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('Biometry.NotConfirmedTitle', 'Biometry.NotConfirmedDesc')
    )
    expect(Alert.alert).toHaveBeenCalledTimes(1)
    expect(getByTestId(TOGGLE).props.value).toBe(false)
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  test('while Face ID is being confirmed the switch is disabled, then turns on when the probe opens', async () => {
    let finishProbe: (opened: boolean) => void = () => undefined
    mockConfirmBiometricKeychainAccess.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finishProbe = resolve
        })
    )
    const { getByTestId } = render(<Biometry />)

    fireEvent(getByTestId(TOGGLE), 'valueChange', true)

    await waitFor(() => expect(getByTestId(TOGGLE).props.disabled).toBe(true))
    expect(mockConfirmBiometricKeychainAccess).toHaveBeenCalledTimes(1)

    await act(async () => {
      finishProbe(true)
    })
    await waitFor(() => expect(getByTestId(TOGGLE).props.value).toBe(true))
    expect(getByTestId(TOGGLE).props.disabled).toBe(false)
  })

  test('turning the switch off never asks Face ID', async () => {
    const { getByTestId } = render(<Biometry />)
    fireEvent(getByTestId(TOGGLE), 'valueChange', true)
    await waitFor(() => expect(getByTestId(TOGGLE).props.value).toBe(true))
    mockConfirmBiometricKeychainAccess.mockClear()
    mockedCheck.mockClear()

    fireEvent(getByTestId(TOGGLE), 'valueChange', false)

    await waitFor(() => expect(getByTestId(TOGGLE).props.value).toBe(false))
    expect(mockConfirmBiometricKeychainAccess).not.toHaveBeenCalled()
    expect(mockedCheck).not.toHaveBeenCalled()
  })

  // Controls: without a Face ID biometry type, DENIED still goes through request().
  test('DENIED with no Face ID type asks request(), and turns on when it answers GRANTED', async () => {
    mockedSupportedType.mockResolvedValue(null as never)
    mockedRequest.mockResolvedValue(RESULTS.GRANTED)
    const { getByTestId } = render(<Biometry />)

    fireEvent(getByTestId(TOGGLE), 'valueChange', true)

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(getByTestId(TOGGLE).props.value).toBe(true))
    expect(mockConfirmBiometricKeychainAccess).not.toHaveBeenCalled()
  })

  test('DENIED with no Face ID type asks request(), and stays off when it answers BLOCKED', async () => {
    mockedSupportedType.mockResolvedValue(null as never)
    const { getByTestId } = render(<Biometry />)

    fireEvent(getByTestId(TOGGLE), 'valueChange', true)

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1))
    expect(getByTestId(TOGGLE).props.value).toBe(false)
    expect(mockConfirmBiometricKeychainAccess).not.toHaveBeenCalled()
  })

  test('GRANTED turns on without calling request()', async () => {
    mockedCheck.mockResolvedValue(RESULTS.GRANTED)
    const { getByTestId } = render(<Biometry />)

    fireEvent(getByTestId(TOGGLE), 'valueChange', true)

    await waitFor(() => expect(getByTestId(TOGGLE).props.value).toBe(true))
    expect(mockedRequest).not.toHaveBeenCalled()
  })
})
