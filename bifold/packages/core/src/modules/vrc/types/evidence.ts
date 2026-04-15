/**
 * W3C VC Evidence Types for VRC Hardware Attestation
 *
 * These types define the structure of the evidence block that proves
 * a VRC was signed by a hardware-backed key with biometric authentication.
 *
 * Based on W3C VC Data Model 1.1 Section 5.7 Evidence:
 * https://www.w3.org/TR/vc-data-model-1.1/#evidence
 *
 * @module vrc/types/evidence
 */

/**
 * Biometric method details
 */
export interface BiometricMethod {
  /** Type of biometric used */
  type: 'FaceID' | 'TouchID' | 'Fingerprint' | 'Face' | 'Iris'
  /** W3C WebAuthn authenticator type */
  authenticatorType: 'platform'
  /** User verification requirement */
  userVerification: 'required'
}

/**
 * Hardware binding information
 */
export interface HardwareBinding {
  /** Where the private key is stored */
  keyStorage: 'SecureEnclave' | 'StrongBox' | 'TEE' | 'Software' | 'Unknown'
  /** Platform that created the key */
  platform: 'ios' | 'android'
  /** Key type */
  keyType: 'EC-P256'
  /** Signing algorithm */
  algorithm: 'ECDSA-SHA256'
  /** Base64-encoded public key */
  publicKey: string
}

/**
 * Attestation certificate chain
 */
export interface AttestationCertificateChain {
  /** Attestation format identifier */
  format: 'apple-appattest-v1' | 'android-key-attestation-v3'
  /** PEM-encoded certificate chain [leaf, intermediate, root] */
  certificateChain: string[]
}

/**
 * Signature details
 */
export interface HardwareSignature {
  /** Base64-encoded signature value */
  value: string
  /** Signature algorithm */
  algorithm: 'ECDSA-SHA256'
  /** Base64-encoded SHA256 hash of the exact content that was signed (for cross-platform verification) */
  signedContentHash?: string
}

/**
 * Complete hardware attestation evidence block for W3C VC
 *
 * This evidence proves:
 * 1. A human biometrically approved the VRC (biometricMethod)
 * 2. The signing key is in secure hardware (hardwareBinding)
 * 3. Apple/Google vouch for the hardware key (attestation.certificateChain)
 * 4. The hardware key signed this specific VRC (signature)
 */
export interface HardwareAttestationEvidence {
  /** Unique identifier for this evidence (URN UUID) */
  id: string
  /** Evidence types */
  type: ['BiometricAttestation', 'HardwareKeyAttestation']
  /** When the evidence was created (ISO 8601) */
  created: string
  /** Biometric authentication details */
  biometricMethod: BiometricMethod
  /** Hardware key binding information */
  hardwareBinding: HardwareBinding
  /** Attestation certificate chain from Apple/Google */
  attestation: AttestationCertificateChain
  /** The hardware signature over the VRC content */
  signature: HardwareSignature
}

/**
 * Input for building evidence
 */
export interface BuildEvidenceInput {
  /** Biometric type used */
  biometricType: 'FaceID' | 'TouchID' | 'Fingerprint' | 'Face' | 'Iris'
  /** Key storage type */
  keyStorage: 'SecureEnclave' | 'StrongBox' | 'TEE' | 'Software' | 'Unknown'
  /** Platform */
  platform: 'ios' | 'android'
  /** Base64-encoded public key */
  publicKey: string
  /** Base64-encoded signature */
  signature: string
  /** Attestation format */
  attestationFormat: 'apple-appattest-v1' | 'android-key-attestation-v3'
  /** PEM-encoded certificate chain */
  certificateChain: string[]
  /** Base64-encoded SHA256 hash of the signed content (for cross-platform verification) */
  signedContentHash?: string
}

/**
 * VRC credential structure with evidence
 */
export interface VrcCredentialWithEvidence {
  '@context': string[]
  type: string[]
  issuer: {
    id: string
    name: string
    email?: string
    organization?: string
  }
  issuanceDate: string
  validFrom: string
  credentialSubject: {
    id: string
  }
  /** W3C evidence block containing hardware attestation */
  evidence: HardwareAttestationEvidence[]
}
