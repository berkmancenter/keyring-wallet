/**
 * React Native Attestation Module
 * 
 * JavaScript wrapper for native iOS/Android attestation and hardware signing.
 * 
 * CAPABILITIES:
 * - Hardware key creation (Secure Enclave / StrongBox / TEE)
 * - Biometric-authenticated signing (ECDSA-SHA256)
 * - Hardware key attestation (certificate chain from Apple/Google)
 * 
 * NATIVE MODULES:
 * - iOS: Attestation.mm (Secure Enclave, App Attest)
 * - Android: AttestationModule.kt (KeyStore, StrongBox/TEE)
 */

import { NativeModules, Platform } from 'react-native';
import { Buffer } from 'buffer';

import NativeAttestationSpec from './NativeAttestation';

const LINKING_ERROR =
  `The package 'react-native-attestation' doesn't seem to be linked. Make sure: \n\n` +
  Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
  '- You rebuilt the app after installing the package\n' +
  '- You are not using Expo Go\n';

// @ts-expect-error TurboModule proxy check
const isTurboModuleEnabled = global.__turboModuleProxy != null;

const AttestationModule = isTurboModuleEnabled
  ? NativeAttestationSpec
  : NativeModules.Attestation;

const Attestation = AttestationModule || new Proxy({}, {
  get() { throw new Error(LINKING_ERROR); }
});

// =============================================================================
// iOS-only: App Attest and Play Integrity
// =============================================================================

/** SHA-256 hash of a string (iOS only) */
export const sha256 = async (stringToHash: string): Promise<Buffer> => {
  if (Platform.OS !== 'ios') throw new Error('sha256 is only available on iOS');
  const bytes: Uint8Array = await Attestation.sha256(stringToHash);
  return Buffer.from(bytes);
};

/** Generate App Attest key (iOS only) */
export const generateKey = async (cache: boolean = false): Promise<string> => {
  if (Platform.OS !== 'ios') throw new Error('generateKey is only available on iOS');
  return Attestation.generateKey(cache);
};

/** Get Apple key attestation (iOS only) */
export const appleKeyAttestation = async (keyId: string, challenge: string): Promise<Buffer> => {
  if (Platform.OS !== 'ios') throw new Error('appleKeyAttestation is only available on iOS');
  const bytes: Uint8Array = await Attestation.appleKeyAttestation(keyId, challenge);
  return Buffer.from(bytes);
};

/** Get Apple attestation (iOS only) — alias for appleKeyAttestation */
export const appleAttestation = async (keyId: string, challenge: string): Promise<Buffer> => {
  return appleKeyAttestation(keyId, challenge);
};

/** Get Google Play Integrity token (Android only) */
export const googleAttestation = async (nonce: string): Promise<string> => {
  if (Platform.OS !== 'android') throw new Error('googleAttestation is only available on Android');
  return Attestation.googleAttestation(nonce);
};

/** Check if Play Integrity is available (Android only) */
export const isPlayIntegrityAvailable = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') throw new Error('isPlayIntegrityAvailable is only available on Android');
  return Attestation.isPlayIntegrityAvailable();
};

// =============================================================================
// Hardware-Backed Signing Key (Cross-Platform)
// =============================================================================

export interface HardwareKeyGenerationResult {
  success: boolean;
  publicKey: Buffer;                                        // EC P-256 public key
  keyType: 'EC-P256';
  storage: 'SecureEnclave' | 'StrongBox' | 'TEE' | 'Software';
}

export interface HardwareSignatureResult {
  success: boolean;
  signature: Buffer;                                        // DER-encoded ECDSA signature
  algorithm: 'ECDSA-SHA256';
  clientDataHash?: string;                                  // Base64-encoded SHA256 of the signed content
}

export interface HardwareKeyInfo {
  exists: boolean;
  keyType?: 'EC-P256';
  storage?: 'SecureEnclave' | 'StrongBox' | 'TEE' | 'Software';
  biometricBound?: boolean;
  algorithm?: 'ECDSA-SHA256';
}

/** Create hardware signing key in Secure Enclave (iOS) or KeyStore (Android) */
export const createSecureEnclaveKey = async (): Promise<HardwareKeyGenerationResult> => {
  const result = await Attestation.createSecureEnclaveKey();
  return {
    success: result.success,
    publicKey: Buffer.from(result.publicKey as number[]),
    keyType: result.keyType,
    storage: result.storage,
  };
};

/** Check if hardware signing key exists */
export const hasHardwareSigningKey = async (): Promise<boolean> => {
  return Attestation.hasHardwareSigningKey();
};

/** Get public key of hardware signing key */
export const getHardwarePublicKey = async (): Promise<Buffer> => {
  const bytes: number[] = await Attestation.getHardwarePublicKey();
  return Buffer.from(bytes);
};

/**
 * Sign data with hardware key (triggers biometric authentication).
 * @param data - Data to sign (VRC content as UTF-8 bytes)
 */
export const signWithHardwareBiometricAuth = async (data: Buffer): Promise<HardwareSignatureResult> => {
  const dataArray: number[] = Array.from(data);
  const result = await Attestation.signWithHardwareBiometricAuth(dataArray);
  return {
    success: result.success,
    signature: Buffer.from(result.signature as number[]),
    algorithm: result.algorithm,
    clientDataHash: result.clientDataHash,
  };
};

/** Delete hardware signing key */
export const deleteHardwareSigningKey = async (): Promise<boolean> => {
  return Attestation.deleteHardwareSigningKey();
};

/** Get information about the hardware signing key */
export const getHardwareKeyInfo = async (): Promise<HardwareKeyInfo> => {
  return Attestation.getHardwareKeyInfo();
};

// =============================================================================
// Hardware Key Attestation (Cross-Platform)
// =============================================================================

const LOG_PREFIX = '[VRC:Attest]';

export interface HardwareKeyAttestationResult {
  success: boolean;
  format: 'apple-appattest-v1' | 'android-key-attestation-v3';
  certificateChain: string[];                               // PEM-encoded certs [leaf, ...intermediates, root]
  publicKey: string;                                        // Base64-encoded public key
  securityLevel: 'SecureEnclave' | 'StrongBox' | 'TEE' | 'Software' | 'Unknown';
  platform: 'ios' | 'android';
  rawAttestationObject?: string;                            // iOS: Base64 CBOR attestation object
}

/**
 * Get attestation for the hardware signing key.
 * Returns certificate chain proving key is in secure hardware.
 * 
 * NOTE: iOS requires internet connection (calls Apple servers).
 * @param challenge - Optional challenge for freshness (iOS only)
 */
export const getHardwareKeyAttestation = async (challenge?: string): Promise<HardwareKeyAttestationResult> => {
  if (Platform.OS === 'ios') {
    return getIOSAttestation(challenge);
  } else if (Platform.OS === 'android') {
    return getAndroidAttestation();
  }
  throw new Error(`Hardware key attestation is not supported on ${Platform.OS}`);
};

/** iOS attestation via App Attest (CBOR parsing done natively in Attestation.mm) */
async function getIOSAttestation(challenge?: string): Promise<HardwareKeyAttestationResult> {
  try {
    const result = await Attestation.attestHardwareSigningKey(challenge || '');
    
    if (!result.success) {
      throw new Error('Attestation failed on native side');
    }
    
    const certificateChain: string[] = Array.isArray(result.certificateChain) 
      ? result.certificateChain 
      : [];
    
    console.log(`${LOG_PREFIX} iOS attestation [${certificateChain.length} certs]`);
    
    return {
      success: true,
      format: 'apple-appattest-v1',
      certificateChain,
      publicKey: result.publicKey || '',
      securityLevel: 'SecureEnclave',
      platform: 'ios',
      rawAttestationObject: result.attestationObject,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Use warn instead of error - retries are expected on iOS fresh install
    console.warn(`${LOG_PREFIX} iOS attestation attempt failed: ${errorMessage}`);
    throw error;
  }
}

/** Android attestation from KeyStore certificate chain */
async function getAndroidAttestation(): Promise<HardwareKeyAttestationResult> {
  try {
    const result = await Attestation.getKeyAttestation();
    
    if (!result.success) {
      throw new Error('Attestation failed on native side');
    }
    
    const certificateChain: string[] = Array.isArray(result.certificateChain) 
      ? result.certificateChain.map((cert: any) => String(cert))
      : [];
    
    console.log(`${LOG_PREFIX} Android attestation [${certificateChain.length} certs, ${result.securityLevel}]`);
    
    return {
      success: true,
      format: 'android-key-attestation-v3',
      certificateChain,
      publicKey: result.publicKey || '',
      securityLevel: result.securityLevel as HardwareKeyAttestationResult['securityLevel'],
      platform: 'android',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Use warn instead of error - retries are expected
    console.warn(`${LOG_PREFIX} Android attestation attempt failed: ${errorMessage}`);
    throw error;
  }
}

/** Check if hardware key attestation is available */
export const isHardwareAttestationAvailable = async (): Promise<boolean> => {
  try {
    return await Attestation.isHardwareAttestationAvailable();
  } catch {
    return false;
  }
};

// =============================================================================
// Native Hardware Evidence Verification (Cross-Platform)
// =============================================================================

/** Result from native hardware evidence verification */
export interface NativeVerificationResult {
  valid: boolean
  certificateChainValid: boolean
  signatureValid: boolean
  publicKeyMatchesLeafCert: boolean
  leafPublicKeyBase64: string
  errors: string[]
  // Android attestation extension fields (only present for android-key-attestation-v3):
  attestationSecurityLevel?: string    // "TEE" | "StrongBox" | "Software"
  keymasterSecurityLevel?: string      // "TEE" | "StrongBox" | "Software"
  verifiedBootState?: string           // "Verified" | "SelfSigned" | "Unverified" | "Failed"
  deviceLocked?: boolean
  attestationChallengeBase64?: string
  userAuthType?: string                // "NONE" | "PASSWORD" | "BIOMETRIC" | "BOTH"
  authTimeout?: number
  revocationChecked?: boolean          // Android only
}

/**
 * Verify hardware attestation evidence natively.
 * 
 * Performs production-grade verification:
 * - Full X.509 certificate chain validation (signatures, expiry, constraints)
 * - Public key extraction from leaf cert and comparison to evidence
 * - ECDSA signature verification (or App Attest assertion verification on iOS)
 * - Android: Attestation extension parsing (security level, verified boot, etc.)
 * - Android: Google CRL revocation checking
 * 
 * @param certificateChainPem - PEM-encoded certs [leaf, intermediates, root]
 * @param signatureBase64 - Base64-encoded signature or CBOR assertion
 * @param signedContent - The VRC content string that was signed
 * @param publicKeyBase64 - Base64-encoded public key from evidence
 * @param attestationFormat - 'apple-appattest-v1' or 'android-key-attestation-v3'
 * @param signedContentHashBase64 - Optional pre-computed SHA256 hash of signed content (base64)
 */
export const verifyHardwareEvidence = async (
  certificateChainPem: string[],
  signatureBase64: string,
  signedContent: string,
  publicKeyBase64: string,
  attestationFormat: string,
  signedContentHashBase64?: string
): Promise<NativeVerificationResult> => {
  const result = await Attestation.verifyHardwareEvidence(
    certificateChainPem,
    signatureBase64,
    signedContent,
    publicKeyBase64,
    attestationFormat,
    signedContentHashBase64 || ''
  );
  
  // Map native result to typed interface
  return {
    valid: result.valid,
    certificateChainValid: result.certificateChainValid,
    signatureValid: result.signatureValid,
    publicKeyMatchesLeafCert: result.publicKeyMatchesLeafCert,
    leafPublicKeyBase64: result.leafPublicKeyBase64 || '',
    errors: Array.isArray(result.errors) ? result.errors.map((e: any) => String(e)) : [],
    attestationSecurityLevel: result.attestationSecurityLevel,
    keymasterSecurityLevel: result.keymasterSecurityLevel,
    verifiedBootState: result.verifiedBootState,
    deviceLocked: result.deviceLocked,
    attestationChallengeBase64: result.attestationChallengeBase64,
    userAuthType: result.userAuthType,
    authTimeout: result.authTimeout,
    revocationChecked: result.revocationChecked,
  };
};
