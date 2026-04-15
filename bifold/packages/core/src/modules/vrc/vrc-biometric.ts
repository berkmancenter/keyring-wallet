/**
 * VRC Biometric Confirmation
 * 
 * Handles user confirmation for VRC signing with biometric authentication.
 * 
 * CONFIRMATION MODES:
 * 1. UI-only: Shows modal, uses wallet key biometric
 * 2. Hardware signing: Shows modal, then triggers hardware key signing
 * 
 * FLOW:
 * 1. Check if biometrics available
 * 2. Show confirmation modal (BiometricConfirmationModal)
 * 3. User confirms → trigger biometric auth
 * 4. For hardware signing: sign VRC content with Secure Enclave / TEE key
 * 5. Send DIDComm notification to counterparty if cancelled/failed
 */

import { Agent } from '@credo-ts/core'
import { AppState, AppStateStatus } from 'react-native'

import { isBiometricsActive } from '../../services/keychain'
import {
  requestBiometricConfirmationUI,
  BiometricConfirmationResponse,
} from '../../contexts/biometric-confirmation'
import {
  signVrcWithHardwareKey,
  isHardwareSigningAvailable,
  VrcHardwareSignature,
} from './vrc-hardware-signing'

const LOG_PREFIX = '[VRC:Biometric]'
const MAX_SIGNING_RETRIES = 2
const FOREGROUND_WAIT_TIMEOUT_MS = 15000

/**
 * Wait for the app to return to active foreground state.
 * Used to retry signing after iOS generateAssertion fails due to brief background transition.
 * Resolves true when active, false on timeout.
 */
function waitForForeground(timeoutMs: number = FOREGROUND_WAIT_TIMEOUT_MS): Promise<boolean> {
  if (AppState.currentState === 'active') {
    return Promise.resolve(true)
  }

  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        subscription.remove()
        resolve(false)
      }
    }, timeoutMs)

    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (!settled && nextState === 'active') {
        settled = true
        clearTimeout(timer)
        subscription.remove()
        resolve(true)
      }
    })
  })
}

export interface BiometricConfirmationResult {
  success: boolean
  reason: 'confirmed' | 'cancelled' | 'not_available' | 'not_enabled' | 'error' | 'skipped'
  error?: Error
  timestamp: string
  hardwareSignature?: VrcHardwareSignature
}

export type { VrcHardwareSignature }

/** DIDComm message prefix for biometric status notifications */
export const BIOMETRIC_STATUS_MESSAGE_PREFIX = 'vrc:biometric-status:'

/**
 * Send biometric status notification to counterparty via DIDComm.
 * Best-effort - failures are silently ignored.
 */
export async function sendBiometricStatusNotification(
  agent: Agent,
  connectionId: string,
  status: 'not-verified' | 'error',
  reason?: string
): Promise<void> {
  const timestamp = new Date().toISOString()
  const message = `${BIOMETRIC_STATUS_MESSAGE_PREFIX}${status}:${timestamp}${reason ? `:${reason}` : ''}`

  try {
    await agent.basicMessages.sendMessage(connectionId, message)
  } catch {
    // Best-effort notification - don't fail the flow
  }
}

/**
 * Request biometric confirmation via UI modal.
 * @param agent - Credo agent
 * @param counterpartyName - Name to display in confirmation modal
 * @param connectionId - Connection ID for DIDComm notifications
 */
export async function requestBiometricConfirmationWithUI(
  agent: Agent,
  counterpartyName: string,
  connectionId: string
): Promise<BiometricConfirmationResult> {
  const logger = agent.config.logger

  try {
    if (!(await isBiometricsActive())) {
      return { success: true, reason: 'not_available', timestamp: new Date().toISOString() }
    }

    const response: BiometricConfirmationResponse = await requestBiometricConfirmationUI(
      counterpartyName,
      connectionId
    )

    switch (response.status) {
      case 'confirmed':
        logger.info(`${LOG_PREFIX} ✓ Confirmed`)
        return { success: true, reason: 'confirmed', timestamp: response.timestamp }

      case 'cancelled':
        logger.info(`${LOG_PREFIX} ✗ Cancelled`)
        return { success: false, reason: 'cancelled', timestamp: response.timestamp }

      case 'error':
        logger.error(`${LOG_PREFIX} ✗ Error: ${response.error}`)
        return {
          success: false,
          reason: 'error',
          error: new Error(response.error || 'Unknown error'),
          timestamp: response.timestamp,
        }

      case 'not_available':
        return { success: true, reason: 'not_available', timestamp: response.timestamp }

      default:
        return {
          success: false,
          reason: 'error',
          error: new Error(`Unknown status: ${response.status}`),
          timestamp: response.timestamp,
        }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`${LOG_PREFIX} ✗ Exception: ${errorMessage}`)

    return {
      success: false,
      reason: 'error',
      error: error instanceof Error ? error : new Error(errorMessage),
      timestamp: new Date().toISOString(),
    }
  }
}

/**
 * Request biometric confirmation with hardware signing.
 * 
 * FLOW:
 * 1. Check hardware signing availability
 * 2. Check biometrics availability
 * 3. Show confirmation modal (skipNativeBiometric=true)
 * 4. User confirms → sign VRC with hardware key (triggers biometric)
 * 5. Return hardware signature for inclusion in evidence block
 * 
 * @param agent - Credo agent
 * @param counterpartyName - Name for modal display
 * @param connectionId - Connection ID for DIDComm notifications
 * @param vrcContent - VRC JSON string to sign
 */
export async function requestBiometricWithHardwareSigning(
  agent: Agent,
  counterpartyName: string,
  connectionId: string,
  vrcContent: string
): Promise<BiometricConfirmationResult> {
  const logger = agent.config.logger
  logger.info(`${LOG_PREFIX} ▶ Starting hardware signing for ${counterpartyName}`)

  try {
    // Check hardware signing availability
    if (!(await isHardwareSigningAvailable())) {
      logger.info(`${LOG_PREFIX} Hardware signing unavailable, using UI-only`)
      return requestBiometricConfirmationWithUI(agent, counterpartyName, connectionId)
    }

    // Check biometrics availability
    if (!(await isBiometricsActive())) {
      return { success: true, reason: 'not_available', timestamp: new Date().toISOString() }
    }

    // Show modal (skip wallet biometric - hardware signing will prompt)
    const uiResponse: BiometricConfirmationResponse = await requestBiometricConfirmationUI(
      counterpartyName,
      connectionId,
      true // skipNativeBiometric
    )

    if (uiResponse.status === 'cancelled') {
      logger.info(`${LOG_PREFIX} ✗ Cancelled by user`)
      return { success: false, reason: 'cancelled', timestamp: uiResponse.timestamp }
    }

    if (uiResponse.status === 'error') {
      return {
        success: false,
        reason: 'error',
        error: new Error(uiResponse.error || 'Unknown error'),
        timestamp: uiResponse.timestamp,
      }
    }

    if (uiResponse.status === 'not_available') {
      return { success: true, reason: 'not_available', timestamp: uiResponse.timestamp }
    }

    // Perform hardware signing (triggers biometric prompt) with retry for transient iOS failures
    let signingResult = await signVrcWithHardwareKey(agent, vrcContent)
    let retryCount = 0

    while (
      !signingResult.success &&
      signingResult.retryable &&
      retryCount < MAX_SIGNING_RETRIES
    ) {
      retryCount++
      logger.warn(`${LOG_PREFIX} Signing failed (retryable) — waiting for app to return to foreground [attempt ${retryCount}/${MAX_SIGNING_RETRIES}]`)

      const returned = await waitForForeground()
      if (!returned) {
        logger.warn(`${LOG_PREFIX} Timed out waiting for foreground — giving up`)
        break
      }

      // Small delay after foreground to let the system settle
      await new Promise(resolve => setTimeout(resolve, 500))
      logger.info(`${LOG_PREFIX} App is active — retrying hardware signing`)
      signingResult = await signVrcWithHardwareKey(agent, vrcContent)
    }

    if (!signingResult.success) {
      if (signingResult.reason === 'cancelled') {
        logger.info(`${LOG_PREFIX} ✗ Hardware signing cancelled`)
        return { success: false, reason: 'cancelled', timestamp: new Date().toISOString() }
      }

      logger.error(`${LOG_PREFIX} ✗ Hardware signing failed: ${signingResult.error}`)
      return {
        success: false,
        reason: 'error',
        error: new Error(signingResult.error || 'Hardware signing failed'),
        timestamp: new Date().toISOString(),
      }
    }

    logger.info(`${LOG_PREFIX} ✓ Hardware signing complete [${signingResult.signature?.keyStorage}]${retryCount > 0 ? ` (after ${retryCount} retry)` : ''}`)

    return {
      success: true,
      reason: 'confirmed',
      timestamp: new Date().toISOString(),
      hardwareSignature: signingResult.signature,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`${LOG_PREFIX} ✗ Exception: ${errorMessage}`)

    return {
      success: false,
      reason: 'error',
      error: error instanceof Error ? error : new Error(errorMessage),
      timestamp: new Date().toISOString(),
    }
  }
}
