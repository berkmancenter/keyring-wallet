/**
 * EvidenceBuilder — Credo adapter
 *
 * Constructs W3C-compliant evidence blocks for VRC credentials by delegating to
 * the Credo-free `HardwareEvidenceBuilder` in `src/hardware-signing/`. What
 * this file adds is exactly the three things that builder leaves injectable:
 * the agent's logger, `utils.uuid()` for evidence ids, and an attestation cache
 * backed by the Askar-persisted `AttestationStorageRepository`.
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
import { AttestationStorageRepository } from './AttestationStorageRepository'
import { HardwareEvidenceBuilder, type AttestationCache, type BuildEvidenceResult } from '../../../hardware-signing'

export type { BuildEvidenceResult }

export class EvidenceBuilder {
  private agent: Agent
  private repository: AttestationStorageRepository
  private builder: HardwareEvidenceBuilder

  constructor(agent: Agent) {
    this.agent = agent
    this.repository = agent.dependencyManager.resolve(AttestationStorageRepository)

    const cache: AttestationCache = {
      find: (publicKey) => this.repository.findValidByPublicKey(this.agent.context, publicKey),
      save: async (entry) => {
        await this.repository.saveAttestation(this.agent.context, entry)
      },
    }

    this.builder = new HardwareEvidenceBuilder({
      cache,
      logger: agent.config.logger,
      generateId: () => utils.uuid(),
    })
  }

  /**
   * Build evidence block from a hardware signing result.
   * @param signingResult - Result from signVrcWithHardwareKey()
   * @param signedContentHash - Base64-encoded SHA256 hash of the signed content
   */
  public async buildEvidenceFromSignature(
    signingResult: HardwareSigningResult,
    signedContentHash?: string
  ): Promise<BuildEvidenceResult> {
    return this.builder.buildEvidenceFromSignature(signingResult, signedContentHash)
  }

  /** Check if we have valid cached attestation for a public key */
  public async hasCachedAttestation(publicKey: string): Promise<boolean> {
    return this.builder.hasCachedAttestation(publicKey)
  }

  /** Pre-fetch and cache attestation (call during setup when network is available) */
  public async prefetchAttestation(publicKey: string): Promise<boolean> {
    return this.builder.prefetchAttestation(publicKey)
  }
}

export function createEvidenceBuilder(agent: Agent): EvidenceBuilder {
  return new EvidenceBuilder(agent)
}
