/**
 * Types for the standalone hardware-signing service.
 *
 * This directory is deliberately free of `@credo-ts/*` — see `./index.ts` for
 * why. Every type here describes a device key, a signature over an arbitrary
 * payload, or the W3C-shaped evidence block that proves both; none of them
 * describes a credential, a DIDComm message or a Credo agent.
 *
 * @module hardware-signing/types
 */

/**
 * Minimal logger the service needs. Structurally satisfied by `console` and by
 * Credo's `Logger` (`agent.config.logger`), so callers on either side of the
 * Credo boundary can pass what they already have.
 */
export interface HardwareSigningLogger {
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void
}

/** Where the private key lives. */
export type HardwareKeyStorage = 'SecureEnclave' | 'StrongBox' | 'TEE' | 'Software' | 'Unknown'

/** Platform that created the key. */
export type HardwarePlatform = 'ios' | 'android'

/** Attestation document format, per platform. */
export type AttestationFormat = 'apple-appattest-v1' | 'android-key-attestation-v3'

/**
 * Authentication method type — biometric or device credential
 */
export type AuthenticationMethodType = 'FaceID' | 'TouchID' | 'Fingerprint' | 'Face' | 'Iris' | 'DevicePasscode'

/**
 * Biometric method details (kept for backward compatibility)
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
 * Authentication method details — superset of BiometricMethod, includes passcode
 */
export interface AuthenticationMethod {
  /** How the user authenticated */
  type: AuthenticationMethodType
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
  keyStorage: HardwareKeyStorage
  /** Platform that created the key */
  platform: HardwarePlatform
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
  format: AttestationFormat
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
 * Evidence type arrays:
 * - BiometricAttestation + HardwareKeyAttestation: user authenticated via biometric
 * - DeviceAuthentication + HardwareKeyAttestation: user authenticated via passcode/PIN/pattern
 */
export type EvidenceTypeArray =
  | ['BiometricAttestation', 'HardwareKeyAttestation']
  | ['DeviceAuthentication', 'HardwareKeyAttestation']

/**
 * Complete hardware attestation evidence block.
 *
 * Shaped after W3C VC Data Model 1.1 §5.7 Evidence
 * (https://www.w3.org/TR/vc-data-model-1.1/#evidence) so it can be dropped
 * straight into a credential's `evidence` array — but it carries no credential
 * fields of its own, so it is equally usable as a free-standing object.
 *
 * This evidence proves:
 * 1. A human approved the payload via biometric or device passcode (authenticationMethod)
 * 2. The signing key is in secure hardware (hardwareBinding)
 * 3. Apple/Google vouch for the hardware key (attestation.certificateChain)
 * 4. The hardware key signed this specific payload (signature)
 */
export interface HardwareAttestationEvidence {
  /** Unique identifier for this evidence (URN UUID) */
  id: string
  /** Evidence types — distinguishes biometric vs device credential authentication */
  type: EvidenceTypeArray
  /** When the evidence was created (ISO 8601) */
  created: string
  /** Authentication method details (superset of biometricMethod, includes passcode) */
  authenticationMethod?: AuthenticationMethod
  /** @deprecated Use authenticationMethod. Kept for backward compatibility with existing evidence. */
  biometricMethod?: BiometricMethod
  /** Hardware key binding information */
  hardwareBinding: HardwareBinding
  /** Attestation certificate chain from Apple/Google */
  attestation: AttestationCertificateChain
  /** The hardware signature over the signed content */
  signature: HardwareSignature
}

/**
 * Input for building evidence
 */
export interface BuildEvidenceInput {
  /** How the user authenticated */
  authenticationMethodType: AuthenticationMethodType
  /** Key storage type */
  keyStorage: HardwareKeyStorage
  /** Platform */
  platform: HardwarePlatform
  /** Base64-encoded public key */
  publicKey: string
  /** Base64-encoded signature */
  signature: string
  /** Attestation format */
  attestationFormat: AttestationFormat
  /** PEM-encoded certificate chain */
  certificateChain: string[]
  /** Base64-encoded SHA256 hash of the signed content (for cross-platform verification) */
  signedContentHash?: string
}

/** A hardware signature over an arbitrary payload, before evidence assembly. */
export interface HardwareKeySignature {
  type: 'HardwareBackedBiometric'
  /** Base64-encoded EC P-256 public key */
  publicKey: string
  /** Base64-encoded ECDSA signature */
  signature: string
  algorithm: 'ECDSA-SHA256'
  /** ISO timestamp of signing */
  timestamp: string
  keyStorage: HardwareKeyStorage
  platform: HardwarePlatform
  /** Base64-encoded SHA256 of the signed content */
  clientDataHash?: string
  authenticationMethod?: AuthenticationMethodType
}

/** Outcome of a signing attempt. */
export interface HardwareSigningResult {
  success: boolean
  signature?: HardwareKeySignature
  error?: string
  reason: 'signed' | 'cancelled' | 'error' | 'key_not_found' | 'not_available'
  retryable?: boolean
}

/**
 * A payload plus the evidence that a specific attested device key signed it.
 *
 * This is the portable unit a standalone caller ("prove this login challenge
 * was signed by this device") hands to a relying party: it is self-contained,
 * so `verifySignedPayload` needs nothing else to check it. Deliberately not a
 * credential and not a `credentialSubject` fragment — a credential embeds one
 * of these in its `evidence` array instead.
 */
export interface SignedPayloadAttestation {
  /** The exact string that was signed, byte for byte. */
  payload: string
  /** Base64-encoded SHA256 of `payload`, as reported by the native signer. */
  payloadHash?: string
  /** ISO timestamp of signing. */
  signedAt: string
  /** The evidence block proving hardware provenance of the signature. */
  evidence: HardwareAttestationEvidence
}
