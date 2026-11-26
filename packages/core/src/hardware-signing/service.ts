/**
 * The standalone hardware-signing service.
 *
 * "Sign this payload with a device key, and get verifiable evidence back",
 * usable without instantiating Credo or DIDComm.
 *
 * @module hardware-signing/service
 */

import type { HardwareSigningAuthMode } from '@bifold/react-native-attestation'

import { HardwareEvidenceBuilder, type AttestationCache } from './evidence'
import { consoleLogger, ensureHardwareKey, isHardwareSigningAvailable } from './key'
import { signPayloadWithHardwareKey } from './sign'
import type { HardwareKeySignature, HardwareSigningLogger, SignedPayloadAttestation } from './types'
import { verifySignedPayload, type SignatureVerificationResult } from './verify'

export interface SignPayloadRequest {
  /** App auth preference: biometric prompt or passcode-only (Android). Defaults to `biometric`. */
  authMode?: HardwareSigningAuthMode
}

export interface SignPayloadOutcome {
  success: boolean
  reason: 'signed' | 'cancelled' | 'error' | 'key_not_found' | 'not_available'
  /** Present when `success` — the portable object to hand a relying party. */
  attestation?: SignedPayloadAttestation
  /** The raw signature, for callers assembling their own evidence. */
  signature?: HardwareKeySignature
  /**
   * False when the signature is real but no Apple/Google certificate chain
   * could be obtained — simulators and emulators always land here.
   */
  hasAttestation?: boolean
  error?: string
  /** iOS assertion failures caused by losing foreground are worth retrying. */
  retryable?: boolean
}

export interface HardwareSigningService {
  /** Whether this device can sign with a hardware-backed key at all. */
  isAvailable(): Promise<boolean>
  /**
   * Front-load the slow work — key creation, Apple server registration and
   * attestation caching — so a later `signPayload` only shows the prompt.
   * Never throws.
   */
  prepare(): Promise<{ ready: boolean; publicKey?: string }>
  /** Sign a payload; triggers OS authentication. */
  signPayload(payload: string, request?: SignPayloadRequest): Promise<SignPayloadOutcome>
  /** Check an attestation produced by this service (or by another device). */
  verify(attestation: SignedPayloadAttestation): Promise<SignatureVerificationResult>
}

export interface HardwareSigningServiceOptions {
  logger?: HardwareSigningLogger
  /**
   * Where fetched attestation chains are kept. Defaults to a process-lifetime
   * in-memory cache; the wallet passes an Askar-backed one.
   */
  attestationCache?: AttestationCache
  /** Returns a bare UUID for evidence ids. */
  generateId?: () => string
}

export function createHardwareSigningService(options: HardwareSigningServiceOptions = {}): HardwareSigningService {
  const logger = options.logger ?? consoleLogger
  const evidenceBuilder = new HardwareEvidenceBuilder({
    cache: options.attestationCache,
    logger,
    generateId: options.generateId,
  })

  return {
    isAvailable: isHardwareSigningAvailable,

    async prepare() {
      try {
        const keyInfo = await ensureHardwareKey(logger)
        try {
          if (!(await evidenceBuilder.hasCachedAttestation(keyInfo.publicKey))) {
            await evidenceBuilder.prefetchAttestation(keyInfo.publicKey)
          }
        } catch (prefetchError) {
          // Non-fatal — evidence assembly will fetch on demand if needed
          logger.warn(
            `Attestation prefetch failed (non-blocking): ${
              prefetchError instanceof Error ? prefetchError.message : String(prefetchError)
            }`
          )
        }
        return { ready: true, publicKey: keyInfo.publicKey }
      } catch (error) {
        logger.warn(`Key preparation failed: ${error instanceof Error ? error.message : String(error)}`)
        return { ready: false }
      }
    },

    async signPayload(payload: string, request: SignPayloadRequest = {}) {
      const signingResult = await signPayloadWithHardwareKey(payload, { authMode: request.authMode, logger })

      if (!signingResult.success || !signingResult.signature) {
        return {
          success: false,
          reason: signingResult.reason,
          error: signingResult.error,
          retryable: signingResult.retryable,
        }
      }

      const evidenceResult = await evidenceBuilder.buildEvidenceFromSignature(
        signingResult,
        signingResult.signature.clientDataHash
      )

      if (!evidenceResult.success || !evidenceResult.evidence) {
        return {
          success: false,
          reason: 'error',
          signature: signingResult.signature,
          error: evidenceResult.error ?? 'Failed to build evidence',
        }
      }

      return {
        success: true,
        reason: 'signed',
        signature: signingResult.signature,
        hasAttestation: evidenceResult.hasAttestation,
        attestation: {
          payload,
          payloadHash: signingResult.signature.clientDataHash,
          signedAt: signingResult.signature.timestamp,
          evidence: evidenceResult.evidence,
        },
      }
    },

    verify(attestation: SignedPayloadAttestation) {
      return verifySignedPayload(attestation, logger)
    },
  }
}
