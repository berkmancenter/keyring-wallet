import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/** Native bridge payloads (typed loosely; index.ts maps to public interfaces). */
type NativeHardwareKeyGenerationResult = {
  success: boolean;
  publicKey: number[];
  keyType: string;
  storage: string;
};

type NativeHardwareSignatureResult = {
  success: boolean;
  signature: number[];
  algorithm: string;
  clientDataHash?: string;
  authenticationMethod?: string;
};

type NativeHardwareKeyInfo = {
  exists: boolean;
  keyType?: string;
  storage?: string;
  biometricBound?: boolean;
  algorithm?: string;
  supportsDeviceCredential?: boolean;
};

type NativeHardwareKeyAttestationResult = {
  success: boolean;
  certificateChain?: string[];
  publicKey?: string;
  securityLevel?: string;
  rawAttestationObject?: string;
};

type NativeVerificationResult = {
  valid: boolean;
  certificateChainValid?: boolean;
  signatureValid?: boolean;
  publicKeyMatchesLeafCert?: boolean;
  leafPublicKeyBase64?: string;
  errors?: unknown[];
  attestationSecurityLevel?: string;
  keymasterSecurityLevel?: string;
  verifiedBootState?: string;
  deviceLocked?: boolean;
  attestationChallengeBase64?: string;
  userAuthType?: string;
  authTimeout?: number;
  revocationChecked?: boolean;
};

/**
 * TurboModule spec for the Attestation native module.
 *
 * PLATFORM NOTES: Some methods are platform-specific (guarded by Platform.OS in index.ts).
 * On old architecture, missing native methods are safely ignored via reflection.
 * On new architecture, each platform should ideally stub missing methods with a rejection.
 *
 * iOS-only: generateKey, sha256, appleKeyAttestation, attestHardwareSigningKey
 * Android-only: isPlayIntegrityAvailable, googleAttestation, getKeyAttestation
 * Cross-platform: all others
 */
export interface Spec extends TurboModule {
  // iOS-only: App Attest key management
  generateKey(cache: boolean): Promise<string>;
  sha256(stringToHash: string): Promise<Buffer>;
  appleKeyAttestation(keyId: string, challenge: string): Promise<Buffer>;

  // Android-only: Play Integrity
  isPlayIntegrityAvailable(): Promise<boolean>;
  googleAttestation(nonce: string): Promise<string>;
  getAppStoreReceipt(): Promise<string>;

  // Cross-platform: Hardware-backed signing key
  createSecureEnclaveKey(): Promise<NativeHardwareKeyGenerationResult>;
  hasHardwareSigningKey(): Promise<boolean>;
  getHardwarePublicKey(): Promise<number[]>;
  signWithHardwareBiometricAuth(
    dataToSign: number[],
    authMode: string
  ): Promise<NativeHardwareSignatureResult>;
  deleteHardwareSigningKey(): Promise<boolean>;
  getHardwareKeyInfo(): Promise<NativeHardwareKeyInfo>;
  isHardwareAttestationAvailable(): Promise<boolean>;

  // Platform-specific attestation
  attestHardwareSigningKey(
    challenge: string
  ): Promise<NativeHardwareKeyAttestationResult>; // iOS
  getKeyAttestation(): Promise<NativeHardwareKeyAttestationResult>; // Android

  // Cross-platform: Native hardware evidence verification
  verifyHardwareEvidence(
    certificateChainPem: string[],
    signatureBase64: string,
    signedContent: string,
    publicKeyBase64: string,
    attestationFormat: string,
    signedContentHashBase64: string
  ): Promise<NativeVerificationResult>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('Attestation');
