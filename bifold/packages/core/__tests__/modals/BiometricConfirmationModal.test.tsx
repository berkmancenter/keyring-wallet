/**
 * Tests for BiometricConfirmationModal
 *
 * Verifies the modal renders different UI for biometric vs passcode auth modes.
 */

import { render } from '@testing-library/react-native'
import React from 'react'
import { Platform } from 'react-native'

import { BasicAppContext } from '../helpers/app'

const mockUseBiometricConfirmation = jest.fn()

jest.mock('../../src/contexts/biometric-confirmation', () => ({
  ...jest.requireActual('../../src/contexts/biometric-confirmation'),
  useBiometricConfirmation: () => mockUseBiometricConfirmation(),
}))

jest.mock('../../src/services/keychain', () => ({
  loadWalletKey: jest.fn().mockResolvedValue(true),
}))

import BiometricConfirmationModal from '../../src/components/modals/BiometricConfirmationModal'

const baseContextValue = {
  isModalVisible: true,
  onConfirm: jest.fn(),
  onCancel: jest.fn(),
  onError: jest.fn(),
}

describe('BiometricConfirmationModal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should not render when modal is not visible', () => {
    mockUseBiometricConfirmation.mockReturnValue({
      ...baseContextValue,
      isModalVisible: false,
      pendingRequest: null,
    })

    const { queryByTestId } = render(
      <BasicAppContext>
        <BiometricConfirmationModal />
      </BasicAppContext>
    )

    expect(queryByTestId('ConfirmBiometric')).toBeNull()
  })

  it('should render biometric mode with counterparty name and biometric title', () => {
    mockUseBiometricConfirmation.mockReturnValue({
      ...baseContextValue,
      pendingRequest: {
        counterpartyName: 'Alice',
        connectionId: 'conn-123',
        timestamp: '2025-01-24T12:00:00.000Z',
        skipNativeBiometric: true,
        authMode: 'biometric',
      },
    })

    const { getByText, queryAllByText } = render(
      <BasicAppContext>
        <BiometricConfirmationModal />
      </BasicAppContext>
    )

    expect(getByText('Alice')).toBeTruthy()
    // In biometric mode, title uses the i18n key (returned as-is in tests)
    expect(getByText('Biometry.ConfirmRelationship')).toBeTruthy()
    // Should NOT show passcode text
    expect(queryAllByText(/Confirm with Device Passcode/i)).toHaveLength(0)
  })

  it('should render passcode mode with Continue button and Confirm Relationship title', () => {
    mockUseBiometricConfirmation.mockReturnValue({
      ...baseContextValue,
      pendingRequest: {
        counterpartyName: 'Bob',
        connectionId: 'conn-456',
        timestamp: '2025-01-24T12:00:00.000Z',
        skipNativeBiometric: true,
        authMode: 'passcode',
      },
    })

    const { getByText, queryAllByText } = render(
      <BasicAppContext>
        <BiometricConfirmationModal />
      </BasicAppContext>
    )

    expect(getByText('Bob')).toBeTruthy()
    expect(getByText('Biometry.ConfirmRelationship')).toBeTruthy()
    expect(getByText('Continue')).toBeTruthy()
    expect(queryAllByText(/Confirm with Device Passcode/i)).toHaveLength(0)
  })

  it('should render passcode mode with device passcode button when not hardware signing', () => {
    mockUseBiometricConfirmation.mockReturnValue({
      ...baseContextValue,
      pendingRequest: {
        counterpartyName: 'Bob',
        connectionId: 'conn-456',
        timestamp: '2025-01-24T12:00:00.000Z',
        skipNativeBiometric: false,
        authMode: 'passcode',
      },
    })

    const { getAllByText } = render(
      <BasicAppContext>
        <BiometricConfirmationModal />
      </BasicAppContext>
    )

    expect(getAllByText(/Confirm with Device Passcode/i)).not.toHaveLength(0)
  })

  it('should show biometric security note in biometric mode', () => {
    mockUseBiometricConfirmation.mockReturnValue({
      ...baseContextValue,
      pendingRequest: {
        counterpartyName: 'Carol',
        connectionId: 'conn-789',
        timestamp: '2025-01-24T12:00:00.000Z',
        skipNativeBiometric: true,
        authMode: 'biometric',
      },
    })

    const { getByText } = render(
      <BasicAppContext>
        <BiometricConfirmationModal />
      </BasicAppContext>
    )

    // In test env, t() returns the key string directly
    expect(getByText('Biometry.SecurityNote')).toBeTruthy()
  })

  it('should show passcode security note in passcode mode on iOS', () => {
    mockUseBiometricConfirmation.mockReturnValue({
      ...baseContextValue,
      pendingRequest: {
        counterpartyName: 'Dave',
        connectionId: 'conn-abc',
        timestamp: '2025-01-24T12:00:00.000Z',
        skipNativeBiometric: true,
        authMode: 'passcode',
      },
    })

    const { getByText } = render(
      <BasicAppContext>
        <BiometricConfirmationModal />
      </BasicAppContext>
    )

    expect(getByText(/Face ID or your device passcode may appear/i)).toBeTruthy()
    expect(getByText(/signing key stays in secure hardware/i)).toBeTruthy()
  })

  it('should show passcode security note in passcode mode on Android', () => {
    const originalOs = Platform.OS
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' })

    mockUseBiometricConfirmation.mockReturnValue({
      ...baseContextValue,
      pendingRequest: {
        counterpartyName: 'Dave',
        connectionId: 'conn-abc',
        timestamp: '2025-01-24T12:00:00.000Z',
        skipNativeBiometric: true,
        authMode: 'passcode',
      },
    })

    const { getByText } = render(
      <BasicAppContext>
        <BiometricConfirmationModal />
      </BasicAppContext>
    )

    expect(getByText(/device passcode will authorize this signature/i)).toBeTruthy()
    expect(getByText(/signing key stays in secure hardware/i)).toBeTruthy()

    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalOs })
  })

  it('should default to biometric mode when authMode is undefined', () => {
    mockUseBiometricConfirmation.mockReturnValue({
      ...baseContextValue,
      pendingRequest: {
        counterpartyName: 'Eve',
        connectionId: 'conn-def',
        timestamp: '2025-01-24T12:00:00.000Z',
        skipNativeBiometric: true,
      },
    })

    const { getByText, queryAllByText } = render(
      <BasicAppContext>
        <BiometricConfirmationModal />
      </BasicAppContext>
    )

    expect(getByText('Eve')).toBeTruthy()
    expect(queryAllByText(/Confirm with Device Passcode/i)).toHaveLength(0)
  })
})
