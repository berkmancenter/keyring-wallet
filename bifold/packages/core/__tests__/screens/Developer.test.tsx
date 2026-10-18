import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import Config from 'react-native-config'

import Developer from '../../src/screens/Developer'
import { testIdWithKey } from '../../src/utils/testable'

jest.mock('react-native-config', () => ({ __esModule: true, default: {} }))

describe('Developer Screen', () => {
  beforeEach(() => {
    // Silence console.error because it will print a warning about Switch
    // "Warning: dispatchCommand was called with a ref ...".
    jest.spyOn(console, 'error').mockImplementation(() => {
      return null
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  test('screen renders correctly', () => {
    const tree = render(<Developer />)

    expect(tree).toMatchSnapshot()
  })

  // Gate efficiency items 3 and 4: the e2e rows read the clocks in force from here, in a test build only.
  test('a store build (E2E_CLOCKS unset) shows no clock rows', () => {
    const { queryByTestId } = render(<Developer />)

    for (const key of ['E2EClocksMode', 'E2EGrantWindowSeconds', 'E2EPhoneGrantWindowSeconds', 'E2EAutoLockMinutes']) {
      expect(queryByTestId(testIdWithKey(key))).toBeNull()
    }
  })

  test('a real-clocks test build (E2E_CLOCKS=real) shows the real clocks in force, under testIDs', () => {
    const config = Config as Record<string, string | undefined>
    config.E2E_CLOCKS = 'real'
    try {
      const { getByTestId } = render(<Developer />)

      expect(getByTestId(testIdWithKey('E2EClocksMode'))).toHaveTextContent('real')
      expect(getByTestId(testIdWithKey('E2EGrantWindowSeconds'))).toHaveTextContent('600')
      expect(getByTestId(testIdWithKey('E2EPhoneGrantWindowSeconds'))).toHaveTextContent('600')
      expect(getByTestId(testIdWithKey('E2EAutoLockMinutes'))).toHaveTextContent('5')
    } finally {
      delete config.E2E_CLOCKS
    }
  })

  test('in a test build with E2E_CLOCKS=short, shows the short clocks', () => {
    const config = Config as Record<string, string | undefined>
    config.E2E_CLOCKS = 'short'
    try {
      const { getByTestId } = render(<Developer />)

      expect(getByTestId(testIdWithKey('E2EClocksMode'))).toHaveTextContent('short')
      expect(getByTestId(testIdWithKey('E2EGrantWindowSeconds'))).toHaveTextContent('60')
      expect(getByTestId(testIdWithKey('E2EPhoneGrantWindowSeconds'))).toHaveTextContent('60')
      expect(getByTestId(testIdWithKey('E2EAutoLockMinutes'))).toHaveTextContent('0.5')
    } finally {
      delete config.E2E_CLOCKS
    }
  })

  test('pressables exist', async () => {
    const { findByTestId } = render(<Developer />)

    const VerifierToggle = await findByTestId(testIdWithKey('ToggleVerifierCapability'))
    const DevCredentialsToggle = await findByTestId(testIdWithKey('ToggleAcceptDevCredentials'))
    const ConnectionToggle = await findByTestId(testIdWithKey('ToggleConnectionInviterCapabilitySwitch'))
    const DevVerifierToggle = await findByTestId(testIdWithKey('ToggleDevVerifierTemplatesSwitch'))
    const WalletNamingToggle = await findByTestId(testIdWithKey('ToggleEnableWalletNamingSwitch'))
    const PreventAutoLockToggle = await findByTestId(testIdWithKey('TogglePreventAutoLockSwitch'))

    expect(VerifierToggle).not.toBe(null)
    expect(DevCredentialsToggle).not.toBe(null)
    expect(ConnectionToggle).not.toBe(null)
    expect(DevVerifierToggle).not.toBe(null)
    expect(WalletNamingToggle).not.toBe(null)
    expect(PreventAutoLockToggle).not.toBe(null)
  })

  test('useVerifierCapability can be toggled', async () => {
    const tree = render(<Developer />)

    const VerifierSwitch = await tree.findByTestId(testIdWithKey('VerifierCapabilitySwitchElement'))
    await act(async () => {
      fireEvent(VerifierSwitch, 'onValueChange')
    })
    expect(tree).toMatchSnapshot()
  })

  test('acceptDevCredentials can be toggled', async () => {
    const tree = render(<Developer />)

    const AcceptDevCredentialsSwitch = await tree.findByTestId(testIdWithKey('AcceptDevCredentialsSwitchElement'))
    await act(async () => {
      fireEvent(AcceptDevCredentialsSwitch, 'onValueChange')
    })
    expect(tree).toMatchSnapshot()
  })

  test('useConnectionInviterCapability can be toggled', async () => {
    const tree = render(<Developer />)

    const ConnectionInviterCapabilitySwitch = await tree.findByTestId(
      testIdWithKey('ConnectionInviterCapabilitySwitchElement')
    )
    await act(async () => {
      fireEvent(ConnectionInviterCapabilitySwitch, 'onValueChange')
    })
    expect(tree).toMatchSnapshot()
  })

  test('useDevVerifierTemplates can be toggled', async () => {
    const tree = render(<Developer />)

    const DevVerifierTemplatesSwitch = await tree.findByTestId(testIdWithKey('DevVerifierTemplatesSwitchElement'))
    await act(async () => {
      fireEvent(DevVerifierTemplatesSwitch, 'onValueChange')
    })
    expect(tree).toMatchSnapshot()
  })

  test('enableWalletNaming can be toggled', async () => {
    const tree = render(<Developer />)

    const EnableWalletNamingSwitch = await tree.findByTestId(testIdWithKey('EnableWalletNamingSwitchElement'))
    await act(async () => {
      fireEvent(EnableWalletNamingSwitch, 'onValueChange')
    })
    expect(tree).toMatchSnapshot()
  })

  test('preventAutoLock can be toggled', async () => {
    const tree = render(<Developer />)

    const PreventAutoLockSwitch = await tree.findByTestId(testIdWithKey('PreventAutoLockSwitchElement'))
    await act(async () => {
      fireEvent(PreventAutoLockSwitch, 'onValueChange')
    })
    expect(tree).toMatchSnapshot()
  })
})
