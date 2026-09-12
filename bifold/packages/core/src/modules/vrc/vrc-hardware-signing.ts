/**
 * VRC Hardware Signing — Credo adapter
 *
 * The signing itself lives in `src/hardware-signing/`, which is Credo-free and
 * usable standalone (`createHardwareSigningService()`). This file is the thin
 * adapter VRC issuance calls: it supplies `agent.config.logger` and keeps the
 * `Agent`-first signatures the VRC flow and `@bifold/core`'s public API already
 * export. Behaviour is unchanged.
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

import { createEvidenceBuilder } from './services/EvidenceBuilder'
import { ensureHardwareKey, isHardwareSigningAvailable, signPayloadWithHardwareKey } from '../../hardware-signing'
import type { HardwareSigningAuthMode } from '@bifold/react-native-attestation'

export type {
  HardwareKeyGenerationResult,
  HardwareSignatureResult,
  HardwareKeyInfo,
  AuthenticationMethod,
  HardwareSigningAuthMode,
} from '@bifold/react-native-attestation'

export type { AuthenticationMethodType, HardwareSigningResult } from '../../hardware-signing'

/** Hardware signature to include in VRC evidence block */
export type { HardwareKeySignature as VrcHardwareSignature } from '../../hardware-signing'

const LOG_PREFIX = '[VRC:Sign]'

/**
 * Ensure a hardware signing key exists, creating one if needed.
 * On fresh install, also pre-warms attestation for iOS.
 * @param agent - Credo agent for logging
 * @returns Public key (base64) and storage type
 */
export async function ensureHardwareSigningKey(agent: Agent): Promise<{ publicKey: string; storage: string }> {
  return ensureHardwareKey(agent.config.logger)
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
export async function prepareHardwareKeyForSigning(agent: Agent): Promise<{ ready: boolean; publicKey?: string }> {
  const logger = agent.config.logger

  try {
    // Step 1: Ensure key exists (creates + attests on fresh install)
    const keyInfo = await ensureHardwareSigningKey(agent)
    logger.info(`${LOG_PREFIX} Key ready for signing [${keyInfo.storage}]`)

    // Step 2: Pre-fetch attestation cert chain into the repository cache
    // so EvidenceBuilder's attestation lookup gets a cache hit later
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
      logger.warn(
        `${LOG_PREFIX} Attestation prefetch failed (non-blocking): ${
          prefetchError instanceof Error ? prefetchError.message : String(prefetchError)
        }`
      )
    }

    return { ready: true, publicKey: keyInfo.publicKey }
  } catch (error) {
    logger.warn(`${LOG_PREFIX} Key preparation failed: ${error instanceof Error ? error.message : String(error)}`)
    return { ready: false }
  }
}

/**
 * Sign VRC content with hardware-backed key.
 * Triggers OS authentication (biometric or passcode depending on authMode).
 * @param agent - Credo agent for logging
 * @param vrcContent - JSON string of VRC to sign (without evidence/proof blocks)
 * @param authMode - App auth preference: biometric prompt or passcode-only (Android)
 */
export async function signVrcWithHardwareKey(
  agent: Agent,
  vrcContent: string,
  authMode: HardwareSigningAuthMode = 'biometric'
) {
  return signPayloadWithHardwareKey(vrcContent, { authMode, logger: agent.config.logger })
}

/** Check if hardware-backed signing is available on this device */
export { isHardwareSigningAvailable }
