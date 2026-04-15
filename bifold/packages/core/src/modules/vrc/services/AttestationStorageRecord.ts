/**
 * AttestationStorageRecord
 *
 * Credo BaseRecord for storing biometric key attestation data.
 * This persists the certificate chain from Apple/Google so we only
 * need to fetch it once (requires internet on iOS).
 *
 * @module vrc/services/AttestationStorageRecord
 */

import { BaseRecord, utils } from '@credo-ts/core'

/**
 * Tags for querying attestation records
 */
export type AttestationStorageRecordTags = {
  /** SHA256 hash of the public key (unique identifier) */
  publicKeyHash: string
  /** Platform: 'ios' or 'android' */
  platform: string
  /** Whether this attestation is still valid */
  isValid: string
}

/**
 * Properties for creating an attestation storage record
 */
export interface AttestationStorageRecordProps {
  id?: string
  /** SHA256 hash of the public key (for lookup) */
  publicKeyHash: string
  /** Base64-encoded public key */
  publicKey: string
  /** PEM-encoded certificate chain */
  certificateChain: string[]
  /** Attestation format */
  format: 'apple-appattest-v1' | 'android-key-attestation-v3'
  /** Platform that created this attestation */
  platform: 'ios' | 'android'
  /** Security level of the key */
  securityLevel: 'SecureEnclave' | 'StrongBox' | 'TEE' | 'Software' | 'Unknown'
  /** When the attestation was created */
  attestedAt: string
  /** When the leaf certificate expires (if known) */
  expiresAt?: string
  /** Raw attestation object (iOS only, for re-verification) */
  rawAttestationObject?: string
}

/**
 * Credo record for storing biometric key attestation
 *
 * This record persists the certificate chain so we only need to fetch
 * it from Apple/Google servers once. The chain can then be included
 * in every VRC without requiring internet access.
 */
export class AttestationStorageRecord extends BaseRecord<AttestationStorageRecordTags> {
  public static readonly type = 'AttestationStorageRecord'
  public readonly type = AttestationStorageRecord.type

  /** SHA256 hash of the public key (for lookup) */
  public publicKeyHash!: string
  /** Base64-encoded public key */
  public publicKey!: string
  /** PEM-encoded certificate chain */
  public certificateChain!: string[]
  /** Attestation format */
  public format!: 'apple-appattest-v1' | 'android-key-attestation-v3'
  /** Platform */
  public platform!: 'ios' | 'android'
  /** Security level */
  public securityLevel!: 'SecureEnclave' | 'StrongBox' | 'TEE' | 'Software' | 'Unknown'
  /** When attested */
  public attestedAt!: string
  /** When expires */
  public expiresAt?: string
  /** Raw attestation (iOS) */
  public rawAttestationObject?: string

  public constructor(props?: AttestationStorageRecordProps) {
    super()

    if (props) {
      this.id = props.id ?? utils.uuid()
      this.publicKeyHash = props.publicKeyHash
      this.publicKey = props.publicKey
      this.certificateChain = props.certificateChain
      this.format = props.format
      this.platform = props.platform
      this.securityLevel = props.securityLevel
      this.attestedAt = props.attestedAt
      this.expiresAt = props.expiresAt
      this.rawAttestationObject = props.rawAttestationObject
    }
  }

  /**
   * Check if this attestation is still valid (not expired)
   */
  public isValid(): boolean {
    if (!this.expiresAt) {
      // No expiry known, assume valid
      return true
    }

    const now = new Date()
    const expiry = new Date(this.expiresAt)
    return now < expiry
  }

  /**
   * Get the time until expiration in hours
   */
  public hoursUntilExpiry(): number | null {
    if (!this.expiresAt) {
      return null
    }

    const now = new Date()
    const expiry = new Date(this.expiresAt)
    const hoursLeft = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60)

    return Math.max(0, hoursLeft)
  }

  public getTags(): AttestationStorageRecordTags {
    return {
      publicKeyHash: this.publicKeyHash,
      platform: this.platform,
      isValid: this.isValid() ? 'true' : 'false',
    }
  }
}
