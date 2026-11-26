/**
 * IN-452: with Biometric Unlock off in Keyring the app has removed its
 * biometric copy of the wallet key, so a confirm by Face ID or a fingerprint
 * found nothing, showed no prompt and closed. The sheet now asks for the
 * Keyring PIN, and says plainly when it cannot.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'

import { AuthContext } from '../../src/contexts/auth'
import { testIdWithKey } from '../../src/utils/testable'
import authContext from '../contexts/auth'
import { BasicAppContext } from '../helpers/app'

const mockUseBiometricConfirmation = jest.fn()

jest.mock('../../src/contexts/biometric-confirmation', () => ({
  ...jest.requireActual('../../src/contexts/biometric-confirmation'),
  useBiometricConfirmation: () => mockUseBiometricConfirmation(),
}))

jest.mock('../../src/services/keychain', () => ({
  ...jest.requireActual('../../src/services/keychain'),
  loadWalletKey: jest.fn(),
}))

import BiometricConfirmationModal from '../../src/components/modals/BiometricConfirmationModal'
import { loadWalletKey } from '../../src/services/keychain'

const secret = { id: 'wallet', key: 'k', salt: 's' }

function sheet(opts: {
  authMode: 'biometric' | 'keyringPin' | 'keyringPinNoBiometrics'
  walletSecret?: typeof secret
  pinRight?: boolean
}) {
  const ctx = { isModalVisible: true, onConfirm: jest.fn(), onCancel: jest.fn(), onError: jest.fn() }
  mockUseBiometricConfirmation.mockReturnValue({
    ...ctx,
    pendingRequest: {
      counterpartyName: 'Keyring Lab Community',
      connectionId: 'join',
      timestamp: '2026-11-04T12:00:00.000Z',
      skipNativeBiometric: false,
      authMode: opts.authMode,
      copy: { title: 'Join.ConfirmTitle', description: 'Join.ConfirmBody' },
    },
  })
  const auth = {
    ...authContext,
    walletSecret: 'walletSecret' in opts ? opts.walletSecret : secret,
    verifyPIN: jest.fn().mockResolvedValue(opts.pinRight ?? true),
  }
  const tree = render(
    <BasicAppContext>
      <AuthContext.Provider value={auth}>
        <BiometricConfirmationModal />
      </AuthContext.Provider>
    </BasicAppContext>
  )
  return { ...ctx, auth, tree }
}

const confirmPress = (tree: ReturnType<typeof render>) =>
  act(async () => {
    fireEvent.press(tree.getByTestId(testIdWithKey('ConfirmBiometric')))
  })

async function enterPin(tree: ReturnType<typeof render>) {
  await act(async () => {
    fireEvent.changeText(tree.getByTestId(testIdWithKey('ConfirmActionEnterPIN')), '123456')
  })
  await act(async () => {
    fireEvent.press(tree.getByTestId(testIdWithKey('ConfirmActionWithPIN')))
  })
}

describe('the confirm sheet with Biometric Unlock off in Keyring', () => {
  beforeEach(() => jest.clearAllMocks())

  it('says Biometric Unlock is off and offers the Keyring PIN, not Face ID', () => {
    const { tree } = sheet({ authMode: 'keyringPin' })
    expect(tree.getByText('Biometry.ConfirmPinNote')).toBeTruthy()
    expect(tree.getByText('Biometry.ConfirmWithKeyringPIN')).toBeTruthy()
    expect(tree.queryByText('Biometry.ConfirmWithBiometrics')).toBeNull()
  })

  it('a right Keyring PIN confirms, and the biometric key is never tried', async () => {
    const { tree, auth, onConfirm, onError } = sheet({ authMode: 'keyringPin' })
    await confirmPress(tree)
    expect(loadWalletKey).not.toHaveBeenCalled()
    await enterPin(tree)
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    expect(auth.verifyPIN).toHaveBeenCalledWith('123456')
    expect(onError).not.toHaveBeenCalled()
  })

  it('a wrong Keyring PIN does not confirm, and the PIN entry stays', async () => {
    const { tree, onConfirm } = sheet({ authMode: 'keyringPin', pinRight: false })
    await confirmPress(tree)
    await enterPin(tree)
    await waitFor(() => expect(tree.getByTestId(testIdWithKey('ConfirmActionEnterPIN')).props.value).toBe(''))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Cancel on the PIN entry goes back to the sheet, which is still there to cancel', async () => {
    const { tree, onConfirm, onCancel } = sheet({ authMode: 'keyringPin' })
    await confirmPress(tree)
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('AppSettingCancel')))
    })
    expect(tree.queryByTestId(testIdWithKey('ConfirmActionEnterPIN'))).toBeNull()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.press(tree.getByTestId(testIdWithKey('CancelBiometric')))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('when the PIN cannot be checked it says so plainly, and only Cancel is left', async () => {
    const { tree, onConfirm, onError, onCancel } = sheet({ authMode: 'keyringPin', walletSecret: undefined })
    await confirmPress(tree)
    expect(tree.getByText('Biometry.ConfirmPinUnavailable')).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('ConfirmBiometric'))).toBeNull()
    expect(tree.queryByTestId(testIdWithKey('ConfirmActionEnterPIN'))).toBeNull()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    fireEvent.press(tree.getByTestId(testIdWithKey('CancelBiometric')))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('the confirm sheet on a phone with no biometrics set up', () => {
  beforeEach(() => jest.clearAllMocks())

  it('says what the phone lacks, not that a setting is off, and the Keyring PIN confirms', async () => {
    const { tree, onConfirm } = sheet({ authMode: 'keyringPinNoBiometrics' })
    expect(tree.getByText('Biometry.ConfirmPinNoBiometricsNote')).toBeTruthy()
    expect(tree.queryByText('Biometry.ConfirmPinNote')).toBeNull()
    await confirmPress(tree)
    expect(loadWalletKey).not.toHaveBeenCalled()
    await enterPin(tree)
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
  })

  it('when the PIN cannot be checked it says so in the same terms, and only Cancel is left', async () => {
    const { tree, onConfirm } = sheet({ authMode: 'keyringPinNoBiometrics', walletSecret: undefined })
    await confirmPress(tree)
    expect(tree.getByText('Biometry.ConfirmPinUnavailableNoBiometrics')).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('ConfirmBiometric'))).toBeNull()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe('the confirm sheet at a large text size', () => {
  beforeEach(() => jest.clearAllMocks())

  // Taller than the screen, the sheet scrolled nowhere and pushed its title off the top: it scrolls now,
  // with the buttons reached past the words (renders in the PR).
  it('keeps the title, the words and the buttons in one scroll, buttons last', () => {
    const { tree } = sheet({ authMode: 'keyringPin' })
    const scroll = tree.getByTestId(testIdWithKey('BiometricConfirmationScroll'))
    for (const id of ['CloseBiometricModal', 'ConfirmBiometric', 'CancelBiometric']) {
      let node = tree.getByTestId(testIdWithKey(id)).parent
      while (node && node !== scroll) node = node.parent
      expect(node).toBe(scroll)
    }
    const json = JSON.stringify(tree.toJSON())
    expect(json.indexOf('Join.ConfirmTitle')).toBeLessThan(json.indexOf('Biometry.ConfirmPinNote'))
    expect(json.indexOf('Biometry.ConfirmPinNote')).toBeLessThan(json.indexOf(testIdWithKey('ConfirmBiometric')))
  })
})

describe('the confirm sheet when the biometric key is not there', () => {
  beforeEach(() => jest.clearAllMocks())

  it('does not close: it says so and offers the Keyring PIN, which confirms', async () => {
    ;(loadWalletKey as jest.Mock).mockResolvedValue(false)
    const { tree, onConfirm, onError } = sheet({ authMode: 'biometric' })
    await confirmPress(tree)
    expect(onError).not.toHaveBeenCalled()
    expect(tree.getByText('Biometry.ConfirmPinAfterMissingKey')).toBeTruthy()
    expect(tree.getByText('Biometry.ConfirmWithKeyringPIN')).toBeTruthy()
    await confirmPress(tree)
    expect(loadWalletKey).toHaveBeenCalledTimes(1)
    await enterPin(tree)
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
  })

  it('with no way to check a PIN either, it ends as before', async () => {
    ;(loadWalletKey as jest.Mock).mockResolvedValue(false)
    const { tree, onError } = sheet({ authMode: 'biometric', walletSecret: undefined })
    await confirmPress(tree)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('a key that is there confirms with biometrics, as before', async () => {
    ;(loadWalletKey as jest.Mock).mockResolvedValue({ key: 'k' })
    const { tree, onConfirm } = sheet({ authMode: 'biometric' })
    await confirmPress(tree)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(tree.queryByTestId(testIdWithKey('ConfirmActionEnterPIN'))).toBeNull()
  })

  it('a cancelled or failed scan still ends as before: the keychain rejects then', async () => {
    ;(loadWalletKey as jest.Mock).mockRejectedValue(new Error('User canceled the operation.'))
    const { tree, onError } = sheet({ authMode: 'biometric' })
    await confirmPress(tree)
    expect(onError).toHaveBeenCalledWith('User canceled the operation.')
  })
})
