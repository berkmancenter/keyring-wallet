/**
 * VRC Hardware Signing Service
 * 
 * Creates and uses hardware-backed keys for VRC signing with biometric authentication.
 * 
 * PLATFORMS:
 * - iOS: Secure Enclave with Face ID / Touch ID
 * - Android: StrongBox or TEE with Fingerprint
 * 
 * ALGORITHM: ECDSA-SHA256 with P-256 curve
 * 
 * SIGNING FLOW:
 * 1. Ensure hardware key exists (create if needed)
 * 2. Pre-warm attestation on fresh install (iOS needs Apple server registration)
 * 3. Sign VRC content (triggers biometric prompt)
 * 4. Return signature with metadata
 */

import { Agent } from '@credo-ts/core'
import { Platform } from 'react-native'
import { Buffer } from 'buffer'

import { createEvidenceBuilder } from './services/EvidenceBuilder'
import {
  createSecureEnclaveKey as nativeCreateKey,
  hasHardwareSigningKey as nativeHasKey,
  getHardwarePublicKey as nativeGetPublicKey,
  signWithHardwareBiometricAuth as nativeSign,
  getHardwareKeyInfo as nativeGetKeyInfo,
  deleteHardwareSigningKey as nativeDeleteKey,
  getHardwareKeyAttestation,
  isHardwareAttestationAvailable,
} from '@bifold/react-native-attestation'

export type {
  HardwareKeyGenerationResult,
  HardwareSignatureResult,
  HardwareKeyInfo,
} from '@bifold/react-native-attestation'


const LOG_PREFIX = '[VRC:Sign]'

const GOOGLE_ROOT_CA_EXPIRY = new Date('2026-05-24T16:45:52Z')

function checkGoogleRootCaExpiry(logger: any): void {
  const daysUntilExpiry = Math.floor((GOOGLE_ROOT_CA_EXPIRY.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  if (daysUntilExpiry < 180 && daysUntilExpiry > 0) {
    logger.warn(`${LOG_PREFIX} ⚠ Embedded Google root CA expires in ${daysUntilExpiry} days (2026-05-24) — update required`)
  } else if (daysUntilExpiry <= 0) {
    logger.error(`${LOG_PREFIX} ⚠ Embedded Google root CA has EXPIRED — Android cross-device verification will fail`)
  }
}

/** Hardware signature to include in VRC evidence block */
export interface VrcHardwareSignature {
  type: 'HardwareBackedBiometric'
  publicKey: string        // Base64-encoded EC P-256 public key
  signature: string        // Base64-encoded ECDSA signature
  algorithm: 'ECDSA-SHA256'
  timestamp: string        // ISO timestamp of signing
  keyStorage: 'SecureEnclave' | 'StrongBox' | 'TEE' | 'Software' | 'Unknown'
  platform: 'ios' | 'android'
  clientDataHash?: string  // Base64-encoded SHA256 of the signed content
}

export interface HardwareSigningResult {
  success: boolean
  signature?: VrcHardwareSignature
  error?: string
  reason: 'signed' | 'cancelled' | 'error' | 'key_not_found' | 'not_available'
  retryable?: boolean
}

/**
 * Ensure a hardware signing key exists, creating one if needed.
 * On fresh install, also pre-warms attestation for iOS.
 * @param agent - Credo agent for logging
 * @returns Public key (base64) and storage type
 */
export async function ensureHardwareSigningKey(
  agent: Agent
): Promise<{ publicKey: string; storage: string }> {
  const logger = agent.config.logger
  checkGoogleRootCaExpiry(logger)

  try {
    // Check for existing key
    if (await nativeHasKey()) {
      try {
        const publicKeyBuffer = await nativeGetPublicKey()
        const keyInfo = await nativeGetKeyInfo()
        return {
          publicKey: publicKeyBuffer.toString('base64'),
          storage: keyInfo.storage || 'Unknown',
        }
      } catch {
        // Key exists but public key cache is missing (attestation didn't complete).
        // Run attestation to extract and cache the public key from the leaf cert.
        logger.warn(`${LOG_PREFIX} Key exists but public key not cached — running attestation to recover...`)
        try {
          await preWarmAttestation(logger)
          const publicKeyBuffer = await nativeGetPublicKey()
          const keyInfo = await nativeGetKeyInfo()
          return {
            publicKey: publicKeyBuffer.toString('base64'),
            storage: keyInfo.storage || 'Unknown',
          }
        } catch (attestError) {
          // Attestation also failed — delete the orphaned key and recreate from scratch
          logger.warn(`${LOG_PREFIX} Recovery attestation failed — deleting key and recreating...`)
          try { await nativeDeleteKey() } catch (deleteErr) {
            logger.warn(`${LOG_PREFIX} Failed to delete orphaned key: ${deleteErr instanceof Error ? deleteErr.message : String(deleteErr)}`)
          }
        }
      }
    }

    // Create new key
    logger.info(`${LOG_PREFIX} Creating new hardware key...`)
    const result = await nativeCreateKey()
    logger.info(`${LOG_PREFIX} Key created [${result.storage}]`)

    // NOTE: preWarmAttestation is NOT called here because nativeCreateKey()
    // already performs attestation internally (on iOS: attestKey + cert chain parse).
    // Calling it again would hit Apple servers a second time and fail with error code 3
    // ("key already attested"). The prewarm is only used in the recovery path above.

    return {
      publicKey: result.publicKey.toString('base64'),
      storage: result.storage,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`${LOG_PREFIX} Key creation failed: ${errorMessage}`)
    throw error
  }
}

/**
 * Pre-prepare hardware key and attestation cache so signing is fast.
 * 
 * Call this early (e.g. at connection time) to front-load heavy work:
 * - Key creation + Apple server registration (5-10s on fresh install)
 * - Attestation certificate chain caching
 * 
 * After this completes, signVrcWithHardwareKey() will only need to show
 * the biometric prompt (~2-5s) instead of doing all attestation inline.
 * 
 * This is fire-and-forget safe — failures are logged but don't throw.
 */
export async function prepareHardwareKeyForSigning(
  agent: Agent
): Promise<{ ready: boolean; publicKey?: string }> {
  const logger = agent.config.logger

  try {
    // Step 1: Ensure key exists (creates + attests on fresh install)
    const keyInfo = await ensureHardwareSigningKey(agent)
    logger.info(`${LOG_PREFIX} Key ready for signing [${keyInfo.storage}]`)

    // Step 2: Pre-fetch attestation cert chain into the repository cache
    // so EvidenceBuilder.getOrFetchAttestation() gets a cache hit later
    try {
      const evidenceBuilder = createEvidenceBuilder(agent)
      const hasCached = await evidenceBuilder.hasCachedAttestation(keyInfo.publicKey)
      if (!hasCached) {
        logger.info(`${LOG_PREFIX} Pre-fetching attestation certificates...`)
        await evidenceBuilder.prefetchAttestation(keyInfo.publicKey)
      } else {
        logger.info(`${LOG_PREFIX} Attestation certificates already cached`)
      }
    } catch (prefetchError) {
      // Non-fatal — EvidenceBuilder will fetch on demand if needed
      logger.warn(`${LOG_PREFIX} Attestation prefetch failed (non-blocking): ${prefetchError instanceof Error ? prefetchError.message : String(prefetchError)}`)
    }

    return { ready: true, publicKey: keyInfo.publicKey }
  } catch (error) {
    logger.warn(`${LOG_PREFIX} Key preparation failed: ${error instanceof Error ? error.message : String(error)}`)
    return { ready: false }
  }
}

/**
 * Pre-warm attestation by fetching certificate chain.
 * iOS App Attest needs time to register new keys with Apple servers.
 * Retries up to 3 times with increasing delays.
 */
async function preWarmAttestation(logger: any): Promise<void> {
  try {
    if (!(await isHardwareAttestationAvailable())) return

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const attestation = await getHardwareKeyAttestation()
        if (attestation.success && attestation.certificateChain.length > 0) {
          logger.info(`${LOG_PREFIX} Attestation pre-warmed [${attestation.certificateChain.length} certs]`)
          return
        }
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, attempt * 3000))
        }
      } catch (attestErr) {
        logger.warn(`${LOG_PREFIX} Attestation pre-warm attempt ${attempt}/3 failed: ${attestErr instanceof Error ? attestErr.message : String(attestErr)}`)
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, attempt * 3000))
        }
      }
    }
  } catch (error) {
    logger.warn(`${LOG_PREFIX} Attestation pre-warm skipped: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Sign VRC content with hardware-backed key.
 * Triggers biometric authentication (Face ID / Touch ID / Fingerprint).
 * @param agent - Credo agent for logging
 * @param vrcContent - JSON string of VRC to sign (without evidence/proof blocks)
 */
export async function signVrcWithHardwareKey(
  agent: Agent,
  vrcContent: string
): Promise<HardwareSigningResult> {
  const logger = agent.config.logger
  logger.info(`${LOG_PREFIX} ▶ Starting hardware signing [${Platform.OS}]`)

  try {
    // Step 1: Ensure key exists
    const keyInfo = await ensureHardwareSigningKey(agent)

    // Step 2: Sign (triggers biometric prompt)
    logger.info(`${LOG_PREFIX} VRC to sign (${vrcContent.length} chars): ${vrcContent.substring(0, 120)}...`)
    const contentBuffer = Buffer.from(vrcContent, 'utf8')
    const signResult = await nativeSign(contentBuffer)

    if (!signResult.success) {
      logger.warn(`${LOG_PREFIX} ✗ Signing failed`)
      return { success: false, reason: 'error', error: 'Signing operation failed' }
    }

    logger.info(`${LOG_PREFIX} ✓ Signature created [${signResult.signature.length} bytes]`)

    return {
      success: true,
      reason: 'signed',
      signature: {
        type: 'HardwareBackedBiometric',
        publicKey: keyInfo.publicKey,
        signature: signResult.signature.toString('base64'),
        algorithm: signResult.algorithm,
        timestamp: new Date().toISOString(),
        keyStorage: keyInfo.storage as VrcHardwareSignature['keyStorage'],
        platform: Platform.OS as 'ios' | 'android',
        clientDataHash: signResult.clientDataHash,
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
    const isRetryable = Platform.OS === 'ios' && (
      errorMessage.match(/generate\s*assertion|assertion.*fail|assertion.*error/i) ||
      errorMessage.match(/error.*(-25299|-25300|-25308)/i) // common App Attest OSStatus errors
    )
    logger.error(`${LOG_PREFIX} ✗ Error: ${errorMessage}${isRetryable ? ' (retryable — app likely lost foreground)' : ''}`)
    return { success: false, reason: 'error', error: errorMessage, retryable: !!isRetryable }
  }
}

/** Check if hardware-backed signing is available on this device */
export async function isHardwareSigningAvailable(): Promise<boolean> {
  try {
    if (await nativeHasKey()) return true
    return await isHardwareAttestationAvailable()
  } catch (error) {
    console.warn(`${LOG_PREFIX} Hardware signing availability check failed: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}
