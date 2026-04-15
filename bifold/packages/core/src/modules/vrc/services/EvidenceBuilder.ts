/**
 * EvidenceBuilder
 * 
 * Constructs W3C-compliant evidence blocks for VRC credentials.
 * Combines biometric signature with attestation certificate chain.
 * 
 * EVIDENCE STRUCTURE (W3C VC format):
 * - id: Unique URN UUID
 * - type: ['BiometricAttestation', 'HardwareKeyAttestation']
 * - biometricMethod: FaceID / TouchID / Fingerprint
 * - hardwareBinding: Platform, key storage, public key, algorithm
 * - attestation: Certificate chain from Apple/Google
 * - signature: ECDSA-SHA256 signature over VRC content
 * 
 * ATTESTATION CACHING:
 * - iOS attestation certs expire in ~72 hours
 * - Attestation is cached to avoid repeated Apple server calls
 * - Cache is invalidated when key changes
 */

import { Agent, utils } from '@credo-ts/core'

import type { HardwareSigningResult } from '../vrc-hardware-signing'
import type { HardwareAttestationEvidence, BuildEvidenceInput } from '../types/evidence'
import { AttestationStorageRepository } from './AttestationStorageRepository'
import {
  getHardwareKeyAttestation,
  isHardwareAttestationAvailable,
  type HardwareKeyAttestationResult,
} from '@bifold/react-native-attestation'

const LOG_PREFIX = '[VRC:Evidence]'

export interface BuildEvidenceResult {
  success: boolean
  evidence?: HardwareAttestationEvidence
  error?: string
  hasAttestation: boolean
  attestationSource?: 'cached' | 'fetched' | 'none'
}

export class EvidenceBuilder {
  private agent: Agent
  private repository: AttestationStorageRepository

  constructor(agent: Agent) {
    this.agent = agent
    this.repository = agent.dependencyManager.resolve(AttestationStorageRepository)
  }

  /**
   * Build evidence block from a hardware signing result.
   * @param signingResult - Result from signVrcWithHardwareKey()
   * @param signedContentHash - Base64-encoded SHA256 hash of the signed content
   */
  public async buildEvidenceFromSignature(signingResult: HardwareSigningResult, signedContentHash?: string): Promise<BuildEvidenceResult> {
    if (!signingResult.success || !signingResult.signature) {
      return { success: false, error: 'No signature available to build evidence', hasAttestation: false }
    }

    const logger = this.agent.config.logger
    const signature = signingResult.signature
    logger.info(`${LOG_PREFIX} ▶ Building evidence [${signature.platform}/${signature.keyStorage}]`)

    // Get attestation certificate chain (cached or fresh)
    const attestationResult = await this.getOrFetchAttestation(signature.publicKey)
    const hasChain = attestationResult.certificateChain.length > 0

    if (hasChain) {
      logger.info(`${LOG_PREFIX}   Attestation: ${attestationResult.source} (${attestationResult.certificateChain.length} certs)`)
    } else {
      logger.warn(`${LOG_PREFIX}   Attestation: none`)
    }

    // Build W3C evidence block
    const evidence = this.buildEvidenceBlock({
      biometricType: this.getBiometricType(signature.platform),
      keyStorage: signature.keyStorage,
      platform: signature.platform,
      publicKey: signature.publicKey,
      signature: signature.signature,
      attestationFormat: this.getAttestationFormat(signature.platform),
      certificateChain: attestationResult.certificateChain,
      signedContentHash,
    })

    logger.info(`${LOG_PREFIX} ✓ Evidence built [${evidence.id.substring(0, 20)}...]`)

    return {
      success: true,
      evidence,
      hasAttestation: hasChain,
      attestationSource: attestationResult.source,
    }
  }

  /**
   * Get attestation from cache or fetch from Apple/Google.
   * Retries up to 3 times with exponential backoff.
   */
  private async getOrFetchAttestation(publicKey: string): Promise<{
    success: boolean
    certificateChain: string[]
    source: 'cached' | 'fetched' | 'none'
    error?: string
  }> {
    try {
      // Check cache first
      const cached = await this.repository.findValidByPublicKey(this.agent.context, publicKey)
      if (cached) {
        return { success: true, certificateChain: cached.certificateChain, source: 'cached' }
      }

      // Check if attestation is available
      if (!(await isHardwareAttestationAvailable())) {
        return { success: false, certificateChain: [], source: 'none', error: 'Attestation not available' }
      }

      // Fetch with retry (iOS needs time after key generation)
      let attestation: HardwareKeyAttestationResult | null = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          attestation = await getHardwareKeyAttestation()
          if (attestation.success && attestation.certificateChain.length > 0) break
          // On iOS, "already attested" returns success but empty chain — don't retry
          if (attestation.success && (attestation as any).alreadyAttested) {
            this.agent.config.logger.info(`${LOG_PREFIX} Key already attested (iOS) — cert chain must be fetched separately or was not cached`)
            break
          }
          if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 2000))
        } catch (fetchErr) {
          this.agent.config.logger.warn(`${LOG_PREFIX} Attestation fetch attempt ${attempt}/3 failed: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`)
          if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 2000))
        }
      }

      if (!attestation?.success || !attestation.certificateChain.length) {
        return { success: false, certificateChain: [], source: 'none', error: 'Failed to fetch attestation' }
      }

      // Cache attestation (expires in 72 hours)
      const expiresAt = new Date()
      expiresAt.setHours(expiresAt.getHours() + 72)

      await this.repository.saveAttestation(this.agent.context, {
        publicKey,
        certificateChain: attestation.certificateChain,
        format: attestation.format,
        platform: attestation.platform,
        securityLevel: attestation.securityLevel,
        expiresAt: expiresAt.toISOString(),
        rawAttestationObject: attestation.rawAttestationObject,
      })

      return { success: true, certificateChain: attestation.certificateChain, source: 'fetched' }
    } catch (error) {
      return {
        success: false,
        certificateChain: [],
        source: 'none',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /** Build the W3C evidence block structure */
  private buildEvidenceBlock(input: BuildEvidenceInput): HardwareAttestationEvidence {
    return {
      id: `urn:uuid:${utils.uuid()}`,
      type: ['BiometricAttestation', 'HardwareKeyAttestation'],
      created: new Date().toISOString(),
      biometricMethod: {
        type: input.biometricType,
        authenticatorType: 'platform',
        userVerification: 'required',
      },
      hardwareBinding: {
        keyStorage: input.keyStorage,
        platform: input.platform,
        keyType: 'EC-P256',
        algorithm: 'ECDSA-SHA256',
        publicKey: input.publicKey,
      },
      attestation: {
        format: input.attestationFormat,
        certificateChain: input.certificateChain,
      },
      signature: {
        value: input.signature,
        algorithm: 'ECDSA-SHA256',
        ...(input.signedContentHash ? { signedContentHash: input.signedContentHash } : {}),
      },
    }
  }

  /** Get biometric type based on platform (simplified assumption) */
  private getBiometricType(platform: 'ios' | 'android'): 'FaceID' | 'TouchID' | 'Fingerprint' {
    return platform === 'ios' ? 'FaceID' : 'Fingerprint'
  }

  /** Get attestation format string for platform */
  private getAttestationFormat(platform: 'ios' | 'android'): 'apple-appattest-v1' | 'android-key-attestation-v3' {
    return platform === 'ios' ? 'apple-appattest-v1' : 'android-key-attestation-v3'
  }

  /** Check if we have valid cached attestation for a public key */
  public async hasCachedAttestation(publicKey: string): Promise<boolean> {
    return (await this.repository.findValidByPublicKey(this.agent.context, publicKey)) !== null
  }

  /** Pre-fetch and cache attestation (call during setup when network is available) */
  public async prefetchAttestation(publicKey: string): Promise<boolean> {
    this.agent.config.logger.info(`${LOG_PREFIX} Prefetching attestation...`)
    const result = await this.getOrFetchAttestation(publicKey)
    const success = result.success && result.certificateChain.length > 0
    this.agent.config.logger.info(`${LOG_PREFIX} Prefetch: ${success ? 'success' : 'failed'}`)
    return success
  }
}

export function createEvidenceBuilder(agent: Agent): EvidenceBuilder {
  return new EvidenceBuilder(agent)
}
