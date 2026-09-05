/**
 * Hardware attestation evidence assembly.
 *
 * Combines a hardware signature with the platform's attestation certificate
 * chain into a W3C-shaped evidence block.
 *
 * ATTESTATION CACHING:
 * - iOS attestation certs expire in ~72 hours
 * - Attestation is cached to avoid repeated Apple server calls
 * - Cache is invalidated when key changes
 *
 * Extracted from `modules/vrc/services/EvidenceBuilder.ts`. That class stays
 * where it is as the Credo adapter: the only Credo-specific things it did were
 * resolve the Askar-backed `AttestationStorageRepository`, mint an id with
 * `utils.uuid()` and read `agent.config.logger`, and all three are injected
 * here instead.
 *
 * @module hardware-signing/evidence
 */

import {
  getHardwareKeyAttestation,
  isHardwareAttestationAvailable,
  type HardwareKeyAttestationResult,
} from '@bifold/react-native-attestation'

import { consoleLogger } from './key'
import type {
  AttestationFormat,
  AuthenticationMethodType,
  BuildEvidenceInput,
  HardwareAttestationEvidence,
  HardwareKeyStorage,
  HardwarePlatform,
  HardwareSigningLogger,
  HardwareSigningResult,
  EvidenceTypeArray,
} from './types'

const LOG_PREFIX = '[HW:Evidence]'

/** An attestation as it is handed to, and returned from, the cache. */
export interface AttestationCacheEntry {
  publicKey: string
  certificateChain: string[]
  format: AttestationFormat
  platform: HardwarePlatform
  securityLevel: HardwareKeyStorage
  /** ISO timestamp after which the entry must not be reused. */
  expiresAt?: string
  rawAttestationObject?: string
}

/**
 * Where fetched attestation chains are kept between signings.
 *
 * `find` MUST return `null` for an entry that has expired — expiry policy
 * belongs to the store, because a Credo-backed store already models it on the
 * record. The wallet supplies an Askar-backed implementation; a standalone
 * caller gets `createInMemoryAttestationCache()` by default.
 */
export interface AttestationCache {
  find(publicKey: string): Promise<{ certificateChain: string[] } | null>
  save(entry: AttestationCacheEntry): Promise<void>
}

/** Process-lifetime cache. Enough for a standalone signer; nothing persists across launches. */
export function createInMemoryAttestationCache(): AttestationCache {
  const entries = new Map<string, AttestationCacheEntry>()
  return {
    async find(publicKey: string) {
      const entry = entries.get(publicKey)
      if (!entry) return null
      if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= Date.now()) {
        entries.delete(publicKey)
        return null
      }
      return { certificateChain: entry.certificateChain }
    },
    async save(entry: AttestationCacheEntry) {
      entries.set(entry.publicKey, entry)
    },
  }
}

/**
 * RFC 4122 v4 identifier. Uses the platform CSPRNG where one is reachable
 * (React Native apps polyfill `crypto.getRandomValues`), and falls back to
 * `Math.random` where it is not — evidence ids are correlation handles, not
 * secrets, and nothing verifies against them.
 */
function defaultGenerateId(): string {
  const bytes = new Uint8Array(16)
  const webCrypto = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto
  if (typeof webCrypto?.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export interface BuildEvidenceResult {
  success: boolean
  evidence?: HardwareAttestationEvidence
  error?: string
  hasAttestation: boolean
  attestationSource?: 'cached' | 'fetched' | 'none'
}

export interface HardwareEvidenceBuilderOptions {
  cache?: AttestationCache
  logger?: HardwareSigningLogger
  /** Returns the bare UUID; the builder prefixes `urn:uuid:`. */
  generateId?: () => string
}

export class HardwareEvidenceBuilder {
  private cache: AttestationCache
  private logger: HardwareSigningLogger
  private generateId: () => string

  public constructor(options: HardwareEvidenceBuilderOptions = {}) {
    this.cache = options.cache ?? createInMemoryAttestationCache()
    this.logger = options.logger ?? consoleLogger
    this.generateId = options.generateId ?? defaultGenerateId
  }

  /**
   * Build evidence block from a hardware signing result.
   * @param signingResult - Result from `signPayloadWithHardwareKey()`
   * @param signedContentHash - Base64-encoded SHA256 hash of the signed content
   */
  public async buildEvidenceFromSignature(
    signingResult: HardwareSigningResult,
    signedContentHash?: string
  ): Promise<BuildEvidenceResult> {
    if (!signingResult.success || !signingResult.signature) {
      return { success: false, error: 'No signature available to build evidence', hasAttestation: false }
    }

    const logger = this.logger
    const signature = signingResult.signature
    logger.info(`${LOG_PREFIX} ▶ Building evidence [${signature.platform}/${signature.keyStorage}]`)

    // Get attestation certificate chain (cached or fresh)
    const attestationResult = await this.getOrFetchAttestation(signature.publicKey)
    const hasChain = attestationResult.certificateChain.length > 0

    if (hasChain) {
      logger.info(
        `${LOG_PREFIX}   Attestation: ${attestationResult.source} (${attestationResult.certificateChain.length} certs)`
      )
    } else {
      logger.warn(`${LOG_PREFIX}   Attestation: none`)
    }

    // Build W3C evidence block
    const authMethod: AuthenticationMethodType =
      signature.authenticationMethod || this.getDefaultAuthMethod(signature.platform)
    const evidence = this.buildEvidenceBlock({
      authenticationMethodType: authMethod,
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
      const cached = await this.cache.find(publicKey)
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
          if (attestation.success && (attestation as { alreadyAttested?: boolean }).alreadyAttested) {
            this.logger.info(
              `${LOG_PREFIX} Key already attested (iOS) — cert chain must be fetched separately or was not cached`
            )
            break
          }
          if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2000))
        } catch (fetchErr) {
          this.logger.warn(
            `${LOG_PREFIX} Attestation fetch attempt ${attempt}/3 failed: ${
              fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
            }`
          )
          if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2000))
        }
      }

      if (!attestation?.success || !attestation.certificateChain.length) {
        return { success: false, certificateChain: [], source: 'none', error: 'Failed to fetch attestation' }
      }

      // Cache attestation (expires in 72 hours)
      const expiresAt = new Date()
      expiresAt.setHours(expiresAt.getHours() + 72)

      await this.cache.save({
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
    const isPasscode = input.authenticationMethodType === 'DevicePasscode'
    const evidenceType: EvidenceTypeArray = isPasscode
      ? ['DeviceAuthentication', 'HardwareKeyAttestation']
      : ['BiometricAttestation', 'HardwareKeyAttestation']

    const evidence: HardwareAttestationEvidence = {
      id: `urn:uuid:${this.generateId()}`,
      type: evidenceType,
      created: new Date().toISOString(),
      authenticationMethod: {
        type: input.authenticationMethodType,
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

    // Backward compat: also set biometricMethod for non-passcode auth
    if (!isPasscode) {
      evidence.biometricMethod = {
        type: input.authenticationMethodType as 'FaceID' | 'TouchID' | 'Fingerprint' | 'Face' | 'Iris',
        authenticatorType: 'platform',
        userVerification: 'required',
      }
    }

    return evidence
  }

  /** Default authentication method when native doesn't report one (backward compat) */
  private getDefaultAuthMethod(platform: HardwarePlatform): AuthenticationMethodType {
    return platform === 'ios' ? 'FaceID' : 'Fingerprint'
  }

  /** Get attestation format string for platform */
  private getAttestationFormat(platform: HardwarePlatform): AttestationFormat {
    return platform === 'ios' ? 'apple-appattest-v1' : 'android-key-attestation-v3'
  }

  /** Check if we have valid cached attestation for a public key */
  public async hasCachedAttestation(publicKey: string): Promise<boolean> {
    return (await this.cache.find(publicKey)) !== null
  }

  /** Pre-fetch and cache attestation (call during setup when network is available) */
  public async prefetchAttestation(publicKey: string): Promise<boolean> {
    this.logger.info(`${LOG_PREFIX} Prefetching attestation...`)
    const result = await this.getOrFetchAttestation(publicKey)
    const success = result.success && result.certificateChain.length > 0
    this.logger.info(`${LOG_PREFIX} Prefetch: ${success ? 'success' : 'failed'}`)
    return success
  }
}
