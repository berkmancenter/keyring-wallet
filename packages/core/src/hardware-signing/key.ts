/**
 * Hardware signing key lifecycle.
 *
 * PLATFORMS:
 * - iOS: Secure Enclave with Face ID / Touch ID
 * - Android: StrongBox or TEE with Fingerprint
 *
 * ALGORITHM: ECDSA-SHA256 with P-256 curve
 *
 * Extracted from `modules/vrc/vrc-hardware-signing.ts` — behaviour is
 * unchanged; the only difference is that the Credo `Agent` parameter became a
 * `HardwareSigningLogger`, which is all the original ever used it for.
 *
 * @module hardware-signing/key
 */

import { Platform } from 'react-native'

import {
  createSecureEnclaveKey as nativeCreateKey,
  hasHardwareSigningKey as nativeHasKey,
  getHardwarePublicKey as nativeGetPublicKey,
  getHardwareKeyInfo as nativeGetKeyInfo,
  deleteHardwareSigningKey as nativeDeleteKey,
  getHardwareKeyAttestation,
  isHardwareAttestationAvailable,
} from '@bifold/react-native-attestation'

import type { HardwareSigningLogger } from './types'

export const LOG_PREFIX = '[HW:Sign]'

/**
 * The Google attestation roots actually embedded on the Android side —
 * GoogleAttestationRoots.ROOT_PEM_BLOCKS. Dates are the certificates' own
 * notAfter values, read out of those PEMs.
 *
 * Chain validation succeeds if ANY of these still verifies the chain, so one
 * root lapsing is not a failure: only pre-RKP factory-keyed devices depend on
 * the legacy root, and those chains re-verify against the re-signed RSA root
 * that replaced it. Remote Key Provisioning devices chain to the ECDSA root
 * instead. This check previously tracked the legacy root alone and so logged
 * a hard "cross-device verification will fail" error from 2026-05-24 onward
 * while verification was in fact working (Galaxy S25+ verified both
 * directions, docs/HARDWARE_ATTESTATION_FLOW.md).
 */
const GOOGLE_ATTESTATION_ROOTS: readonly { name: string; expiry: Date }[] = [
  { name: 'legacy RSA', expiry: new Date('2026-05-24T16:45:52Z') },
  { name: 're-signed RSA', expiry: new Date('2042-03-15T18:07:48Z') },
  { name: 'RKP ECDSA P-384', expiry: new Date('2035-07-15T22:32:18Z') },
]

function checkGoogleRootCaExpiry(logger: HardwareSigningLogger): void {
  const now = Date.now()
  const live = GOOGLE_ATTESTATION_ROOTS.filter((root) => root.expiry.getTime() > now)
  const lapsed = GOOGLE_ATTESTATION_ROOTS.filter((root) => root.expiry.getTime() <= now)

  if (live.length === 0) {
    logger.error(
      `${LOG_PREFIX} ⚠ ALL embedded Google roots have EXPIRED — Android cross-device verification will fail`
    )
    return
  }

  const soonest = live.reduce((a, b) => (a.expiry < b.expiry ? a : b))
  const daysUntilExpiry = Math.floor((soonest.expiry.getTime() - now) / (1000 * 60 * 60 * 24))
  if (daysUntilExpiry < 180) {
    logger.warn(`${LOG_PREFIX} ⚠ Google root "${soonest.name}" expires in ${daysUntilExpiry} days — update required`)
  }

  if (lapsed.length > 0) {
    logger.info(
      `${LOG_PREFIX} ${lapsed.length}/${GOOGLE_ATTESTATION_ROOTS.length} embedded Google root(s) lapsed ` +
        `(${lapsed.map((r) => r.name).join(', ')}); ${live.length} still valid — verification unaffected ` +
        `except for pre-RKP factory-keyed devices`
    )
  }
}

/** Logger used when a caller supplies none. */
export const consoleLogger: HardwareSigningLogger = {
  // eslint-disable-next-line no-console
  info: (message: string) => console.log(message),
  // eslint-disable-next-line no-console
  warn: (message: string) => console.warn(message),
  // eslint-disable-next-line no-console
  error: (message: string) => console.error(message),
}

export interface HardwareKeyHandle {
  /** Base64-encoded EC P-256 public key */
  publicKey: string
  /** Where the private key lives, as reported by the platform */
  storage: string
}

/**
 * Ensure a hardware signing key exists, creating one if needed.
 * On fresh install, also pre-warms attestation for iOS.
 */
export async function ensureHardwareKey(logger: HardwareSigningLogger = consoleLogger): Promise<HardwareKeyHandle> {
  checkGoogleRootCaExpiry(logger)

  try {
    // Check for existing key
    if (await nativeHasKey()) {
      try {
        const publicKeyBuffer = await nativeGetPublicKey()
        const keyInfo = await nativeGetKeyInfo()

        // Android key migration: recreate biometric-only keys to support passcode fallback
        if (Platform.OS === 'android' && keyInfo.supportsDeviceCredential === false) {
          logger.warn(`${LOG_PREFIX} Existing key only supports biometric — migrating to support device credential`)
          try {
            await nativeDeleteKey()
          } catch (deleteErr) {
            logger.warn(
              `${LOG_PREFIX} Failed to delete old key: ${
                deleteErr instanceof Error ? deleteErr.message : String(deleteErr)
              }`
            )
          }
          // Fall through to create a new key with updated auth flags
        } else {
          return {
            publicKey: publicKeyBuffer.toString('base64'),
            storage: keyInfo.storage || 'Unknown',
          }
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
        } catch (_attestError) {
          // Attestation also failed — delete the orphaned key and recreate from scratch
          logger.warn(`${LOG_PREFIX} Recovery attestation failed — deleting key and recreating...`)
          try {
            await nativeDeleteKey()
          } catch (deleteErr) {
            logger.warn(
              `${LOG_PREFIX} Failed to delete orphaned key: ${
                deleteErr instanceof Error ? deleteErr.message : String(deleteErr)
              }`
            )
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
 * Pre-warm attestation by fetching certificate chain.
 * iOS App Attest needs time to register new keys with Apple servers.
 * Retries up to 3 times with increasing delays.
 */
export async function preWarmAttestation(logger: HardwareSigningLogger): Promise<void> {
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
          await new Promise((resolve) => setTimeout(resolve, attempt * 3000))
        }
      } catch (attestErr) {
        logger.warn(
          `${LOG_PREFIX} Attestation pre-warm attempt ${attempt}/3 failed: ${
            attestErr instanceof Error ? attestErr.message : String(attestErr)
          }`
        )
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 3000))
        }
      }
    }
  } catch (error) {
    logger.warn(`${LOG_PREFIX} Attestation pre-warm skipped: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Check if hardware-backed signing is available on this device */
export async function isHardwareSigningAvailable(): Promise<boolean> {
  try {
    if (await nativeHasKey()) return true
    return await isHardwareAttestationAvailable()
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      `${LOG_PREFIX} Hardware signing availability check failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    return false
  }
}
