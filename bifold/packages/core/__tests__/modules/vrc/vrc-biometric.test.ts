/**
 * Tests for VRC Biometric Confirmation
 *
 * Covers:
 * - requestBiometricWithHardwareSigning: full flow, fallback, cancel, retry
 * - sendBiometricStatusNotification: success and silent failure
 * - requestBiometricConfirmationWithUI: biometrics check, error handling
 */

const mockIsBiometricsActive = jest.fn()
const mockLoadWalletKey = jest.fn()

jest.mock('../../../src/services/keychain', () => ({
  isBiometricsActive: (...args: unknown[]) => mockIsBiometricsActive(...args),
  loadWalletKey: (...args: unknown[]) => mockLoadWalletKey(...args),
}))

const mockRequestBiometricConfirmationUI = jest.fn()

jest.mock('../../../src/contexts/biometric-confirmation', () => ({
  requestBiometricConfirmationUI: (...args: unknown[]) => mockRequestBiometricConfirmationUI(...args),
}))

const mockSignVrcWithHardwareKey = jest.fn()
const mockIsHardwareSigningAvailable = jest.fn()

jest.mock('../../../src/modules/vrc/vrc-hardware-signing', () => ({
  signVrcWithHardwareKey: (...args: unknown[]) => mockSignVrcWithHardwareKey(...args),
  isHardwareSigningAvailable: (...args: unknown[]) => mockIsHardwareSigningAvailable(...args),
}))

const mockIsHardwareAttestationAvailable = jest.fn()

jest.mock('@bifold/react-native-attestation', () => ({
  isHardwareAttestationAvailable: (...args: unknown[]) => mockIsHardwareAttestationAvailable(...args),
}))

let mockAppStateCurrentState = 'active'
const mockAddEventListener = jest.fn()

jest.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return mockAppStateCurrentState
    },
    addEventListener: (...args: unknown[]) => mockAddEventListener(...args),
  },
}))

import {
  requestBiometricWithHardwareSigning,
  sendBiometricStatusNotification,
  requestBiometricConfirmationWithUI,
} from '../../../src/modules/vrc/vrc-biometric'

const createMockAgent = () =>
  ({
    config: {
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    },
    context: { contextCorrelationId: 'test-context' },
    basicMessages: {
      sendMessage: jest.fn(),
    },
  }) as any

describe('VRC Biometric Confirmation', () => {
  let mockAgent: ReturnType<typeof createMockAgent>
  const counterpartyName = 'Alice'
  const connectionId = 'conn-123'
  const vrcContent = JSON.stringify({
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    type: ['VerifiableCredential'],
    issuer: { id: 'did:peer:2.Ez6LStest' },
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockAgent = createMockAgent()
    mockAppStateCurrentState = 'active'
  })

  describe('requestBiometricWithHardwareSigning', () => {
    it('should return success with hardware signature on full success path', async () => {
      mockIsHardwareSigningAvailable.mockResolvedValue(true)
      mockIsBiometricsActive.mockResolvedValue(true)
      mockRequestBiometricConfirmationUI.mockResolvedValue({
        status: 'confirmed',
        timestamp: '2025-01-24T12:00:00.000Z',
      })
      mockSignVrcWithHardwareKey.mockResolvedValue({
        success: true,
        reason: 'signed',
        signature: {
          type: 'HardwareBackedBiometric',
          publicKey: 'dGVzdFB1YktleQ==',
          signature: 'c2lnbmF0dXJl',
          algorithm: 'ECDSA-SHA256',
          timestamp: '2025-01-24T12:00:00.000Z',
          keyStorage: 'SecureEnclave',
          platform: 'ios',
        },
      })

      const result = await requestBiometricWithHardwareSigning(
        mockAgent,
        counterpartyName,
        connectionId,
        vrcContent
      )

      expect(result.success).toBe(true)
      expect(result.reason).toBe('confirmed')
      expect(result.hardwareSignature).toBeDefined()
      expect(result.hardwareSignature?.type).toBe('HardwareBackedBiometric')
    })

    it('should fall back to UI-only when hardware signing unavailable', async () => {
      mockIsHardwareSigningAvailable.mockResolvedValue(false)
      mockIsBiometricsActive.mockResolvedValue(true)
      mockRequestBiometricConfirmationUI.mockResolvedValue({
        status: 'confirmed',
        timestamp: '2025-01-24T12:00:00.000Z',
      })

      const result = await requestBiometricWithHardwareSigning(
        mockAgent,
        counterpartyName,
        connectionId,
        vrcContent
      )

      expect(result.success).toBe(true)
      expect(result.reason).toBe('confirmed')
      expect(result.hardwareSignature).toBeUndefined()
      expect(mockSignVrcWithHardwareKey).not.toHaveBeenCalled()
    })

    it('should return not_available when biometrics not active', async () => {
      mockIsHardwareSigningAvailable.mockResolvedValue(true)
      mockIsBiometricsActive.mockResolvedValue(false)

      const result = await requestBiometricWithHardwareSigning(
        mockAgent,
        counterpartyName,
        connectionId,
        vrcContent
      )

      expect(result.success).toBe(true)
      expect(result.reason).toBe('not_available')
    })

    it('should return cancelled when user cancels in UI modal', async () => {
      mockIsHardwareSigningAvailable.mockResolvedValue(true)
      mockIsBiometricsActive.mockResolvedValue(true)
      mockRequestBiometricConfirmationUI.mockResolvedValue({
        status: 'cancelled',
        timestamp: '2025-01-24T12:00:00.000Z',
      })

      const result = await requestBiometricWithHardwareSigning(
        mockAgent,
        counterpartyName,
        connectionId,
        vrcContent
      )

      expect(result.success).toBe(false)
      expect(result.reason).toBe('cancelled')
      expect(mockSignVrcWithHardwareKey).not.toHaveBeenCalled()
    })

    it('should return error for non-retryable signing failure', async () => {
      mockIsHardwareSigningAvailable.mockResolvedValue(true)
      mockIsBiometricsActive.mockResolvedValue(true)
      mockRequestBiometricConfirmationUI.mockResolvedValue({
        status: 'confirmed',
        timestamp: '2025-01-24T12:00:00.000Z',
      })
      mockSignVrcWithHardwareKey.mockResolvedValue({
        success: false,
        retryable: false,
        reason: 'error',
        error: 'Key not found',
      })

      const result = await requestBiometricWithHardwareSigning(
        mockAgent,
        counterpartyName,
        connectionId,
        vrcContent
      )

      expect(result.success).toBe(false)
      expect(result.reason).toBe('error')
    })

    it('should retry and succeed on retryable signing failure', async () => {
      mockIsHardwareSigningAvailable.mockResolvedValue(true)
      mockIsBiometricsActive.mockResolvedValue(true)
      mockRequestBiometricConfirmationUI.mockResolvedValue({
        status: 'confirmed',
        timestamp: '2025-01-24T12:00:00.000Z',
      })

      mockAppStateCurrentState = 'active'
      mockAddEventListener.mockImplementation((_event: string, callback: (state: string) => void) => {
        setTimeout(() => callback('active'), 10)
        return { remove: jest.fn() }
      })

      mockSignVrcWithHardwareKey
        .mockResolvedValueOnce({
          success: false,
          retryable: true,
          reason: 'error',
          error: 'generate assertion failed',
        })
        .mockResolvedValueOnce({
          success: true,
          reason: 'signed',
          signature: {
            type: 'HardwareBackedBiometric',
            publicKey: 'dGVzdA==',
            signature: 'c2ln',
            algorithm: 'ECDSA-SHA256',
            timestamp: '2025-01-24T12:00:00.000Z',
            keyStorage: 'SecureEnclave',
            platform: 'ios',
          },
        })

      const result = await requestBiometricWithHardwareSigning(
        mockAgent,
        counterpartyName,
        connectionId,
        vrcContent
      )

      expect(result.success).toBe(true)
      expect(result.reason).toBe('confirmed')
      expect(mockSignVrcWithHardwareKey).toHaveBeenCalledTimes(2)
    })

    it('should return cancelled when signing is cancelled', async () => {
      mockIsHardwareSigningAvailable.mockResolvedValue(true)
      mockIsBiometricsActive.mockResolvedValue(true)
      mockRequestBiometricConfirmationUI.mockResolvedValue({
        status: 'confirmed',
        timestamp: '2025-01-24T12:00:00.000Z',
      })
      mockSignVrcWithHardwareKey.mockResolvedValue({
        success: false,
        reason: 'cancelled',
        error: 'Biometric cancelled',
      })

      const result = await requestBiometricWithHardwareSigning(
        mockAgent,
        counterpartyName,
        connectionId,
        vrcContent
      )

      expect(result.success).toBe(false)
      expect(result.reason).toBe('cancelled')
    })

    it('should fail after MAX_SIGNING_RETRIES exhausted', async () => {
      mockIsHardwareSigningAvailable.mockResolvedValue(true)
      mockIsBiometricsActive.mockResolvedValue(true)
      mockRequestBiometricConfirmationUI.mockResolvedValue({
        status: 'confirmed',
        timestamp: '2025-01-24T12:00:00.000Z',
      })

      mockAppStateCurrentState = 'active'
      mockAddEventListener.mockImplementation((_event: string, callback: (state: string) => void) => {
        setTimeout(() => callback('active'), 10)
        return { remove: jest.fn() }
      })

      mockSignVrcWithHardwareKey.mockResolvedValue({
        success: false,
        retryable: true,
        reason: 'error',
        error: 'generate assertion failed',
      })

      const result = await requestBiometricWithHardwareSigning(
        mockAgent,
        counterpartyName,
        connectionId,
        vrcContent
      )

      expect(result.success).toBe(false)
      expect(result.reason).toBe('error')
      // Initial + 2 retries (MAX_SIGNING_RETRIES = 2) = 3 total attempts
      expect(mockSignVrcWithHardwareKey).toHaveBeenCalledTimes(3)
    })
  })

  describe('sendBiometricStatusNotification', () => {
    it('should send notification without throwing', async () => {
      mockAgent.basicMessages.sendMessage.mockResolvedValue(undefined)

      await expect(
        sendBiometricStatusNotification(mockAgent, connectionId, 'not-verified', 'cancelled')
      ).resolves.not.toThrow()

      expect(mockAgent.basicMessages.sendMessage).toHaveBeenCalledWith(
        connectionId,
        expect.stringContaining('vrc:biometric-status:not-verified:')
      )
    })

    it('should not propagate error when sendMessage fails', async () => {
      mockAgent.basicMessages.sendMessage.mockRejectedValue(new Error('Connection lost'))

      await expect(
        sendBiometricStatusNotification(mockAgent, connectionId, 'error', 'something broke')
      ).resolves.not.toThrow()
    })
  })

  describe('requestBiometricConfirmationWithUI', () => {
    it('should return not_available when biometrics not active', async () => {
      mockIsBiometricsActive.mockResolvedValue(false)

      const result = await requestBiometricConfirmationWithUI(
        mockAgent,
        counterpartyName,
        connectionId
      )

      expect(result.success).toBe(true)
      expect(result.reason).toBe('not_available')
      expect(mockRequestBiometricConfirmationUI).not.toHaveBeenCalled()
    })

    it('should return error without sending DIDComm notification when UI returns error status', async () => {
      mockIsBiometricsActive.mockResolvedValue(true)
      mockRequestBiometricConfirmationUI.mockResolvedValue({
        status: 'error',
        error: 'Biometric hardware failed',
        timestamp: '2025-01-24T12:00:00.000Z',
      })

      const result = await requestBiometricConfirmationWithUI(
        mockAgent,
        counterpartyName,
        connectionId
      )

      expect(result.success).toBe(false)
      expect(result.reason).toBe('error')
      expect(result.error?.message).toBe('Biometric hardware failed')
      expect(mockAgent.basicMessages.sendMessage).not.toHaveBeenCalled()
    })
  })
})
