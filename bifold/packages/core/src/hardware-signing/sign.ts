/**
 * Sign an arbitrary payload with the device's hardware-backed key.
 *
 * Extracted from `modules/vrc/vrc-hardware-signing.ts`. The original already
 * took a plain string — nothing about it was ever VRC-shaped — so the only
 * change is the `Agent` parameter becoming a `HardwareSigningLogger`.
 *
 * @module hardware-signing/sign
 */

import { Platform } from 'react-native'
import { Buffer } from 'buffer'

import {
  signWithHardwareBiometricAuth as nativeSign,
  type HardwareSigningAuthMode,
} from '@bifold/react-native-attestation'

import { consoleLogger, ensureHardwareKey, LOG_PREFIX } from './key'
import type {
  AuthenticationMethodType,
  HardwareKeySignature,
  HardwareSigningLogger,
  HardwareSigningResult,
} from './types'

export interface SignPayloadOptions {
  /** App auth preference: biometric prompt or passcode-only (Android). Defaults to `biometric`. */
  authMode?: HardwareSigningAuthMode
  logger?: HardwareSigningLogger
}

/**
 * Sign a payload with the hardware-backed key.
 * Triggers OS authentication (biometric or passcode depending on authMode).
 *
 * @param payload - The exact string to sign
 */
export async function signPayloadWithHardwareKey(
  payload: string,
  options: SignPayloadOptions = {}
): Promise<HardwareSigningResult> {
  const { authMode = 'biometric', logger = consoleLogger } = options
  logger.info(`${LOG_PREFIX} ▶ Starting hardware signing [${Platform.OS}, authMode=${authMode}]`)

  try {
    // Step 1: Ensure key exists
    const keyInfo = await ensureHardwareKey(logger)

    // Step 2: Sign (triggers biometric prompt)
    logger.info(`${LOG_PREFIX} Payload to sign (${payload.length} chars): ${payload.substring(0, 120)}...`)
    const contentBuffer = Buffer.from(payload, 'utf8')
    const signResult = await nativeSign(contentBuffer, authMode)

    if (!signResult.success) {
      logger.warn(`${LOG_PREFIX} ✗ Signing failed`)
      return { success: false, reason: 'error', error: 'Signing operation failed' }
    }

    logger.info(
      `${LOG_PREFIX} ✓ Signature created [${signResult.signature.length} bytes, auth=${
        signResult.authenticationMethod || 'unknown'
      }]`
    )

    return {
      success: true,
      reason: 'signed',
      signature: {
        type: 'HardwareBackedBiometric',
        publicKey: keyInfo.publicKey,
        signature: signResult.signature.toString('base64'),
        algorithm: signResult.algorithm,
        timestamp: new Date().toISOString(),
        keyStorage: keyInfo.storage as HardwareKeySignature['keyStorage'],
        platform: Platform.OS as 'ios' | 'android',
        clientDataHash: signResult.clientDataHash,
        authenticationMethod: signResult.authenticationMethod as AuthenticationMethodType | undefined,
      },
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    // Check for user cancellation
    if (errorMessage.match(/cancel|user/i)) {
      logger.info(`${LOG_PREFIX} ✗ Cancelled by user`)
      return { success: false, reason: 'cancelled', error: 'Biometric authentication was cancelled' }
    }

    // iOS: generateAssertion fails when app loses foreground (status bar pull, notification, etc.)
    // Match broadly — any assertion-related error on iOS is worth retrying once the app returns to foreground
    const isRetryable =
      Platform.OS === 'ios' &&
      (errorMessage.match(/generate\s*assertion|assertion.*fail|assertion.*error/i) ||
        errorMessage.match(/error.*(-25299|-25300|-25308)/i)) // common App Attest OSStatus errors
    logger.error(
      `${LOG_PREFIX} ✗ Error: ${errorMessage}${isRetryable ? ' (retryable — app likely lost foreground)' : ''}`
    )
    return { success: false, reason: 'error', error: errorMessage, retryable: !!isRetryable }
  }
}
