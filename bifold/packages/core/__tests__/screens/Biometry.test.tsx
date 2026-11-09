import { act, render, fireEvent, waitFor } from '@testing-library/react-native'
import React from 'react'
import { AuthContext } from '../../src/contexts/auth'
import Biometry from '../../src/screens/Biometry'
import { readFaceIdNotAllowed } from '../../src/components/inputs/BiometryControl'
import { testIdWithKey } from '../../src/utils/testable'
import authContext from '../contexts/auth'
import { BasicAppContext } from '../helpers/app'
import { Linking, Platform } from 'react-native'
import { testDefaultState } from '../contexts/store'
import { StoreProvider } from '../../src/contexts/store'
import { RESULTS, check, request } from 'react-native-permissions'
import { getSupportedBiometryType } from 'react-native-keychain'
import { confirmBiometricKeychainAccess } from '../../src/services/keychain'

jest.mock('react-native-permissions', () => require('react-native-permissions/mock'))
const mockedCheck = check as jest.MockedFunction<typeof check>
const mockedRequest = request as jest.MockedFunction<typeof request>

jest.mock('../../src/services/keychain', () => ({
  ...jest.requireActual('../../src/services/keychain'),
  confirmBiometricKeychainAccess: jest.fn(),
}))
const mockedProbe = confirmBiometricKeychainAccess as jest.MockedFunction<typeof confirmBiometricKeychainAccess>

jest.spyOn(Linking, 'openSettings').mockImplementation(() => Promise.resolve())
jest.mock('react-native-keychain', () => ({
  getSupportedBiometryType: jest.fn().mockResolvedValue('FaceID'),
  BIOMETRY_TYPE: {
    FACE_ID: 'FaceID',
    TOUCH_ID: 'TouchID',
  },
}))

jest.mock('@react-navigation/elements', () => ({
  Header: jest.fn().mockImplementation(() => {
    const Component = () => null
    Component.displayName = 'Header'
    return Component
  }),
  HeaderBackButton: jest.fn().mockImplementation(() => {
    const Component = () => null
    Component.displayName = 'HeaderBackButton'
    return Component
  }),
  useHeaderHeight: jest.fn().mockReturnValue(150),
}))

const customStore = {
  ...testDefaultState,
  preferences: {
    ...testDefaultState.preferences,
    useBiometry: false,
  },
}

describe('Biometry Screen', () => {
  beforeAll(() => {
    jest.spyOn(global.console, 'error').mockImplementation(() => null)
  })

  beforeEach(() => {
    authContext.isBiometricsActive = jest.fn().mockResolvedValue(true)
    customStore.preferences.useBiometry = false
    mockedCheck.mockClear()
    mockedRequest.mockClear()
    mockedCheck.mockResolvedValue(RESULTS.DENIED) // DENIED essentially means available but user decision has not been made
    mockedRequest.mockResolvedValue(RESULTS.BLOCKED) // BLOCKED means user has actively rejected biometry use
    mockedProbe.mockReset()
    mockedProbe.mockResolvedValue(true)
  })

  test('renders correctly when biometry available', async () => {
    const tree = render(
      <BasicAppContext>
        <AuthContext.Provider value={authContext}>
          <Biometry />
        </AuthContext.Provider>
      </BasicAppContext>
    )

    await tree.findByText('Biometry.EnabledText1')
    // Onboarding says, under the switch, that turning it on is recommended and why.
    expect(tree.getByTestId(testIdWithKey('BiometryRecommended'))).toHaveTextContent('Biometry.Recommended')
    expect(tree).toMatchSnapshot()
  })

  test('renders correctly when biometry unavailable', async () => {
    authContext.isBiometricsActive = jest.fn().mockResolvedValue(false)
    const tree = render(
      <BasicAppContext>
        <AuthContext.Provider value={authContext}>
          <Biometry />
        </AuthContext.Provider>
      </BasicAppContext>
    )

    await tree.findByText('Biometry.NotEnabledText1')
    expect(tree.queryByTestId(testIdWithKey('BiometryRecommended'))).toBeNull()
    expect(tree).toMatchSnapshot()
  })

  test('toggle is enabled when biometry is available', async () => {
    const { findByTestId, findByText } = render(
      <BasicAppContext>
        <AuthContext.Provider value={authContext}>
          <Biometry />
        </AuthContext.Provider>
      </BasicAppContext>
    )

    await findByText('Biometry.EnabledText1')
    const toggleButton = await findByTestId(testIdWithKey('ToggleBiometrics'))
    expect(toggleButton.props.accessibilityState.disabled).toBe(false)
  })

  test('toggle is enabled even when biometry is not available', async () => {
    authContext.isBiometricsActive = jest.fn().mockResolvedValue(false)

    const { findByTestId, findByText } = render(
      <BasicAppContext>
        <AuthContext.Provider value={authContext}>
          <Biometry />
        </AuthContext.Provider>
      </BasicAppContext>
    )

    await findByText('Biometry.NotEnabledText1')
    const toggleButton = await findByTestId(testIdWithKey('ToggleBiometrics'))
    expect(toggleButton.props.accessibilityState.disabled).toBe(false)
  })

  test('can toggle off if on', async () => {
    // Setup with toggle switch on
    customStore.preferences.useBiometry = true

    const { findByTestId, findByText } = render(
      <StoreProvider initialState={customStore}>
        <BasicAppContext>
          <AuthContext.Provider value={authContext}>
            <Biometry />
          </AuthContext.Provider>
        </BasicAppContext>
      </StoreProvider>
    )

    await findByText('Biometry.EnabledText1')
    const toggleButton = await findByTestId(testIdWithKey('ToggleBiometrics'))

    await waitFor(async () => {
      fireEvent(toggleButton, 'press')
    })
    const updatedToggleButton = await findByTestId(testIdWithKey('ToggleBiometrics'))
    expect(updatedToggleButton.props.accessibilityState.checked).toBe(false)
    // Turning Face ID off must never need Face ID.
    expect(mockedProbe).not.toHaveBeenCalled()
    expect(mockedCheck).not.toHaveBeenCalled()
  })

  test('can toggle on when biometrics available and permission is GRANTED', async () => {
    mockedCheck.mockResolvedValue(RESULTS.GRANTED)

    const { findByTestId, findByText } = render(
      <StoreProvider initialState={customStore}>
        <BasicAppContext>
          <AuthContext.Provider value={authContext}>
            <Biometry />
          </AuthContext.Provider>
        </BasicAppContext>
      </StoreProvider>
    )

    await findByText('Biometry.EnabledText1')
    const toggleButton = await findByTestId(testIdWithKey('ToggleBiometrics'))

    await waitFor(async () => {
      fireEvent(toggleButton, 'press')
    })
    const updatedToggleButton = await findByTestId(testIdWithKey('ToggleBiometrics'))
    expect(updatedToggleButton.props.accessibilityState.checked).toBe(true)
  })

  test('shows settings popup when permission is UNAVAILABLE', async () => {
    mockedCheck.mockResolvedValue(RESULTS.UNAVAILABLE)
    ;(getSupportedBiometryType as jest.Mock).mockResolvedValueOnce(null)

    const { findByTestId, findByText, queryByText } = render(
      <StoreProvider initialState={customStore}>
        <BasicAppContext>
          <AuthContext.Provider value={authContext}>
            <Biometry />
          </AuthContext.Provider>
        </BasicAppContext>
      </StoreProvider>
    )

    const toggleButton = await findByTestId(testIdWithKey('ToggleBiometrics'))

    await waitFor(async () => {
      fireEvent(toggleButton, 'press')
    })
    expect(await findByText('Biometry.SetupBiometricsTitle')).toBeTruthy()
    expect(await findByText('Biometry.SetupBiometricsDesc')).toBeTruthy()
    // Android reaches this popup too, so its button keeps the platform-neutral label, not iOS's "Réglages"/"Ajustes".
    expect(await findByText('Biometry.OpenSettings')).toBeTruthy()
    expect(queryByText('Biometry.OpenSettingsIos')).toBeNull()

    expect(toggleButton.props.accessibilityState.checked).toBe(false)
  })

  test('shows settings popup when permission is BLOCKED', async () => {
    mockedCheck.mockResolvedValueOnce(RESULTS.BLOCKED)

    const { findByTestId, findByText } = render(
      <StoreProvider initialState={customStore}>
        <BasicAppContext>
          <AuthContext.Provider value={authContext}>
            <Biometry />
          </AuthContext.Provider>
        </BasicAppContext>
      </StoreProvider>
    )

    await findByText('Biometry.EnabledText1')
    const toggleButton = await findByTestId(testIdWithKey('ToggleBiometrics'))

    await waitFor(async () => {
      fireEvent(toggleButton, 'press')
    })
    expect(await findByText('Biometry.AllowBiometricsTitle')).toBeTruthy()
    expect(await findByText('Biometry.AllowBiometricsDesc')).toBeTruthy()

    expect(toggleButton.props.accessibilityState.checked).toBe(false)
  })

  test('shows settings popup and "Open settings" button works', async () => {
    mockedCheck.mockResolvedValue(RESULTS.BLOCKED)

    const { findByTestId, findByText, queryByText } = render(
      <StoreProvider initialState={customStore}>
        <BasicAppContext>
          <AuthContext.Provider value={authContext}>
            <Biometry />
          </AuthContext.Provider>
        </BasicAppContext>
      </StoreProvider>
    )

    await findByText('Biometry.EnabledText1')
    const toggleButton = await findByTestId(testIdWithKey('ToggleBiometrics'))

    await waitFor(async () => {
      fireEvent(toggleButton, 'press')
    })
    // Only iOS reads BLOCKED, so the button names iOS's Settings app.
    const openSettingsButton = await findByText('Biometry.OpenSettingsIos')
    expect(queryByText('Biometry.OpenSettings')).toBeNull()

    fireEvent(openSettingsButton, 'press')
    expect(Linking.openSettings).toHaveBeenCalledTimes(1)
  })

  const renderWithStore = () =>
    render(
      <StoreProvider initialState={customStore}>
        <BasicAppContext>
          <AuthContext.Provider value={authContext}>
            <Biometry />
          </AuthContext.Provider>
        </BasicAppContext>
      </StoreProvider>
    )

  // IN-551: after a reinstall, iOS keeps the app's Face ID grant but
  // react-native-permissions loses its "requested" flag, so check() says DENIED
  // and request() never resolves (it waits for an alert iOS never shows).
  test('iOS Face ID with permission DENIED toggles on once Face ID opens the probe item, without calling request(), even when request() would never resolve', async () => {
    mockedRequest.mockImplementation(() => new Promise(() => {}))

    const { findByTestId, findByText } = renderWithStore()

    await findByText('Biometry.EnabledText1')
    const toggleButton = await findByTestId(testIdWithKey('ToggleBiometrics'))

    await waitFor(async () => {
      fireEvent(toggleButton, 'press')
    })
    await waitFor(async () => {
      const updatedToggleButton = await findByTestId(testIdWithKey('ToggleBiometrics'))
      expect(updatedToggleButton.props.accessibilityState.checked).toBe(true)
    })
    expect(mockedProbe).toHaveBeenCalledTimes(1)
    expect(mockedProbe).toHaveBeenCalledWith('Biometry.UnlockPromptTitle', 'Biometry.UnlockPromptDescription')
    expect(mockedCheck).toHaveBeenCalledTimes(1)
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  test('iOS Face ID with permission DENIED stays off and says where to allow it when the probe fails and Face ID now reads BLOCKED (declined just now)', async () => {
    mockedProbe.mockResolvedValue(false)
    mockedCheck.mockResolvedValueOnce(RESULTS.DENIED).mockResolvedValueOnce(RESULTS.BLOCKED)

    const { findByTestId, findByText, queryByText } = renderWithStore()

    await findByText('Biometry.EnabledText1')
    const toggleButton = await findByTestId(testIdWithKey('ToggleBiometrics'))

    await waitFor(async () => {
      fireEvent(toggleButton, 'press')
    })
    expect(await findByText('Biometry.AllowBiometricsTitle')).toBeTruthy()
    expect(queryByText('Biometry.NotConfirmedTitle')).toBeNull()
    expect(toggleButton.props.accessibilityState.checked).toBe(false)
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  test('iOS Face ID with permission DENIED stays off and says it was not turned on when the probe fails for another reason (cancel, failed scan, timeout)', async () => {
    mockedProbe.mockResolvedValue(false)

    const { findByTestId, findByText, queryByText } = renderWithStore()

    await findByText('Biometry.EnabledText1')
    const toggleButton = await findByTestId(testIdWithKey('ToggleBiometrics'))

    await waitFor(async () => {
      fireEvent(toggleButton, 'press')
    })
    expect(await findByText('Biometry.NotConfirmedTitle')).toBeTruthy()
    expect(await findByText('Biometry.NotConfirmedDesc')).toBeTruthy()
    expect(queryByText('Biometry.AllowBiometricsTitle')).toBeNull()
    expect(toggleButton.props.accessibilityState.checked).toBe(false)
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  test('while Face ID is being confirmed the switch is disabled, and a second tap does not start a second probe', async () => {
    let finishProbe: (opened: boolean) => void = () => undefined
    mockedProbe.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finishProbe = resolve
        })
    )

    const { findByTestId, findByText } = renderWithStore()

    await findByText('Biometry.EnabledText1')
    const toggleButton = await findByTestId(testIdWithKey('ToggleBiometrics'))

    fireEvent(toggleButton, 'press')
    await waitFor(async () => {
      const pending = await findByTestId(testIdWithKey('ToggleBiometrics'))
      expect(pending.props.accessibilityState.disabled).toBe(true)
    })
    fireEvent(await findByTestId(testIdWithKey('ToggleBiometrics')), 'press')
    expect(mockedProbe).toHaveBeenCalledTimes(1)

    await act(async () => {
      finishProbe(true)
    })
    await waitFor(async () => {
      const done = await findByTestId(testIdWithKey('ToggleBiometrics'))
      expect(done.props.accessibilityState.checked).toBe(true)
      expect(done.props.accessibilityState.disabled).toBe(false)
    })
    expect(mockedProbe).toHaveBeenCalledTimes(1)
  })

  // Control: without a Face ID biometry type, DENIED still goes through request().
  test('requests permission when permission is DENIED and the biometry type is not Face ID, and toggles on when it becomes GRANTED', async () => {
    ;(getSupportedBiometryType as jest.Mock).mockResolvedValueOnce(null)
    mockedRequest.mockResolvedValue(RESULTS.GRANTED)

    const { findByTestId, findByText } = renderWithStore()

    await findByText('Biometry.EnabledText1')
    const toggleButton = await findByTestId(testIdWithKey('ToggleBiometrics'))

    await waitFor(async () => {
      fireEvent(toggleButton, 'press')
    })
    expect(mockedRequest).toHaveBeenCalledTimes(1)
    await waitFor(async () => {
      const updatedToggleButton = await findByTestId(testIdWithKey('ToggleBiometrics'))
      expect(updatedToggleButton.props.accessibilityState.checked).toBe(true)
    })
    expect(mockedProbe).not.toHaveBeenCalled()
  })

  test('requests permission when permission is DENIED and the biometry type is not Face ID, and stays off when it becomes BLOCKED', async () => {
    ;(getSupportedBiometryType as jest.Mock).mockResolvedValueOnce(null)

    const { findByTestId, findByText } = renderWithStore()

    await findByText('Biometry.EnabledText1')
    const toggleButton = await findByTestId(testIdWithKey('ToggleBiometrics'))

    await waitFor(async () => {
      fireEvent(toggleButton, 'press')
    })
    expect(mockedRequest).toHaveBeenCalledTimes(1)
    expect(toggleButton.props.accessibilityState.checked).toBe(false)
    expect(mockedProbe).not.toHaveBeenCalled()
  })

  test('can toggle on and correctly continue when biometrics is available and permission is GRANTED', async () => {
    mockedCheck.mockResolvedValue(RESULTS.GRANTED)

    const { findByTestId, findByText } = render(
      <BasicAppContext>
        <AuthContext.Provider value={authContext}>
          <Biometry />
        </AuthContext.Provider>
      </BasicAppContext>
    )

    await findByText('Biometry.EnabledText1')
    const toggleButton = await findByTestId(testIdWithKey('ToggleBiometrics'))
    await waitFor(async () => {
      fireEvent(toggleButton, 'press')
    })

    expect(mockedCheck).toHaveBeenCalledTimes(1)

    const continueButton = await findByTestId(testIdWithKey('Continue'))
    await waitFor(async () => {
      fireEvent(continueButton, 'press')
    })

    expect(authContext.commitWalletToKeychain).toHaveBeenCalledTimes(1)
  })
})

// IN-550: a phone with Face ID whose Keyring permission is off read as "biometrics not set up on this device", which
// sent people to the wrong setting. react-native-permissions reads BLOCKED exactly then (Face ID present, the app not
// allowed); a phone with none reads UNAVAILABLE.
describe('Biometry Screen, when biometrics read as unavailable', () => {
  const open = () =>
    render(
      <BasicAppContext>
        <AuthContext.Provider value={authContext}>
          <Biometry />
        </AuthContext.Provider>
      </BasicAppContext>
    )

  beforeEach(() => {
    authContext.isBiometricsActive = jest.fn().mockResolvedValue(false)
    mockedCheck.mockReset()
    ;(Linking.openSettings as jest.Mock).mockClear()
  })

  test('says Keyring is not allowed to use Face ID, and opens Settings, when the phone has Face ID', async () => {
    mockedCheck.mockResolvedValue(RESULTS.BLOCKED)
    const tree = open()

    expect(await tree.findByText('Biometry.NotAllowedText1')).toBeTruthy()
    expect(tree.getByText('Biometry.NotAllowedText2')).toBeTruthy()
    expect(tree.queryByText('Biometry.NotEnabledText1')).toBeNull()
    // An iOS-only state, so the link names iOS's Settings app (fr "Réglages", pt-BR "Ajustes").
    expect(tree.getByText('Biometry.OpenSettingsIos')).toBeTruthy()
    expect(tree.queryByText('Biometry.OpenSettings')).toBeNull()

    fireEvent.press(tree.getByTestId(testIdWithKey('BiometryOpenSettings')))
    expect(Linking.openSettings).toHaveBeenCalledTimes(1)
  })

  test('still says biometrics are not set up when the phone has none', async () => {
    mockedCheck.mockResolvedValue(RESULTS.UNAVAILABLE)
    const tree = open()

    expect(await tree.findByText('Biometry.NotEnabledText1')).toBeTruthy()
    await waitFor(() => expect(mockedCheck).toHaveBeenCalled())
    expect(tree.queryByTestId(testIdWithKey('BiometryNotAllowed'))).toBeNull()
  })

  test('does not ask about the permission when biometrics are available', async () => {
    authContext.isBiometricsActive = jest.fn().mockResolvedValue(true)
    const tree = open()

    expect(await tree.findByText('Biometry.EnabledText1')).toBeTruthy()
    expect(mockedCheck).not.toHaveBeenCalled()
    expect(tree.queryByTestId(testIdWithKey('BiometryNotAllowed'))).toBeNull()
  })
})

describe('readFaceIdNotAllowed', () => {
  test('is true on iOS only when the permission reads BLOCKED', async () => {
    mockedCheck.mockResolvedValueOnce(RESULTS.BLOCKED)
    expect(await readFaceIdNotAllowed()).toBe(true)
    mockedCheck.mockResolvedValueOnce(RESULTS.UNAVAILABLE)
    expect(await readFaceIdNotAllowed()).toBe(false)
    mockedCheck.mockRejectedValueOnce(new Error('no handler'))
    expect(await readFaceIdNotAllowed()).toBe(false)
  })

  test('is false on Android, which has no per-app biometrics permission', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'android')
    mockedCheck.mockResolvedValue(RESULTS.BLOCKED)
    expect(await readFaceIdNotAllowed()).toBe(false)
    os.restore()
  })
})
