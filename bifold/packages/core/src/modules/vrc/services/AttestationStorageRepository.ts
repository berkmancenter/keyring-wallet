/**
 * AttestationStorageRepository
 *
 * Repository for storing and retrieving biometric key attestation records.
 * Uses Credo's storage system to persist attestation certificate chains.
 *
 * @module vrc/services/AttestationStorageRepository
 */

import { AgentContext, Repository, StorageService, EventEmitter } from '@credo-ts/core'

import { AttestationStorageRecord } from './AttestationStorageRecord'

const LOG_PREFIX = '[VRC-AttestRepo]'

/**
 * Simple hash function for React Native (djb2 algorithm)
 * Used for creating consistent lookup keys from public keys.
 * Not cryptographically secure, but sufficient for database lookups.
 */
function simpleHash(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i)
  }
  // Convert to positive hex string
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Repository for managing attestation storage records
 *
 * This repository handles:
 * - Storing attestation certificate chains
 * - Looking up attestations by public key
 * - Checking attestation validity
 * - Updating expired attestations
 *
 * Note: Uses factory pattern for DI (no decorators)
 */
export class AttestationStorageRepository extends Repository<AttestationStorageRecord> {
  public constructor(storageService: StorageService<AttestationStorageRecord>, eventEmitter: EventEmitter) {
    super(AttestationStorageRecord, storageService, eventEmitter)
  }

  /**
   * Compute a hash of a public key for consistent lookup.
   * Uses a simple hash + prefix of the key for uniqueness.
   */
  public static computePublicKeyHash(publicKey: string): string {
    // Combine djb2 hash with first 24 chars of base64 key for uniqueness
    const hashPart = simpleHash(publicKey)
    const prefixPart = publicKey.replace(/[^a-zA-Z0-9]/g, '').substring(0, 24)
    return `${hashPart}_${prefixPart}`
  }

  /**
   * Find an attestation record by public key
   *
   * @param agentContext The agent context
   * @param publicKey Base64-encoded public key
   * @returns The attestation record if found
   */
  public async findByPublicKey(
    agentContext: AgentContext,
    publicKey: string
  ): Promise<AttestationStorageRecord | null> {
    const publicKeyHash = AttestationStorageRepository.computePublicKeyHash(publicKey)

    const records = await this.findByQuery(agentContext, {
      publicKeyHash,
    })

    if (records.length === 0) {
      return null
    }

    const record = records[0]
    console.log(`${LOG_PREFIX} Found attestation [platform=${record.platform}, certs=${record.certificateChain.length}]`)
    return record
  }

  /**
   * Find a valid (non-expired) attestation by public key
   *
   * @param agentContext The agent context
   * @param publicKey Base64-encoded public key
   * @returns The attestation record if found and valid, null otherwise
   */
  public async findValidByPublicKey(
    agentContext: AgentContext,
    publicKey: string
  ): Promise<AttestationStorageRecord | null> {
    const record = await this.findByPublicKey(agentContext, publicKey)

    if (!record || !record.isValid()) {
      return null
    }

    return record
  }

  /**
   * Save or update an attestation record
   *
   * @param agentContext The agent context
   * @param attestation The attestation data to save
   */
  public async saveAttestation(
    agentContext: AgentContext,
    attestation: {
      publicKey: string
      certificateChain: string[]
      format: 'apple-appattest-v1' | 'android-key-attestation-v3'
      platform: 'ios' | 'android'
      securityLevel: 'SecureEnclave' | 'StrongBox' | 'TEE' | 'Software' | 'Unknown'
      expiresAt?: string
      rawAttestationObject?: string
    }
  ): Promise<AttestationStorageRecord> {
    const publicKeyHash = AttestationStorageRepository.computePublicKeyHash(attestation.publicKey)

    // Check for existing record
    const existing = await this.findByPublicKey(agentContext, attestation.publicKey)

    if (existing) {
      // Update existing record
      existing.certificateChain = attestation.certificateChain
      existing.format = attestation.format
      existing.securityLevel = attestation.securityLevel
      existing.attestedAt = new Date().toISOString()
      existing.expiresAt = attestation.expiresAt
      existing.rawAttestationObject = attestation.rawAttestationObject

      await this.update(agentContext, existing)

      return existing
    }

    // Create new record
    const record = new AttestationStorageRecord({
      publicKeyHash,
      publicKey: attestation.publicKey,
      certificateChain: attestation.certificateChain,
      format: attestation.format,
      platform: attestation.platform,
      securityLevel: attestation.securityLevel,
      attestedAt: new Date().toISOString(),
      expiresAt: attestation.expiresAt,
      rawAttestationObject: attestation.rawAttestationObject,
    })

    await this.save(agentContext, record)

    console.log(`${LOG_PREFIX} Saved attestation [platform=${attestation.platform}, certs=${attestation.certificateChain.length}]`)
    return record
  }
}
