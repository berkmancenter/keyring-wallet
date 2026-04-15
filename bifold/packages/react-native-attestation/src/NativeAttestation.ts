import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

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

  // Cross-platform: Hardware-backed signing key
  createSecureEnclaveKey(): Promise<Object>;
  hasHardwareSigningKey(): Promise<boolean>;
  getHardwarePublicKey(): Promise<number[]>;
  signWithHardwareBiometricAuth(dataToSign: number[]): Promise<Object>;
  deleteHardwareSigningKey(): Promise<boolean>;
  getHardwareKeyInfo(): Promise<Object>;
  isHardwareAttestationAvailable(): Promise<boolean>;

  // Platform-specific attestation
  attestHardwareSigningKey(challenge: string): Promise<Object>; // iOS
  getKeyAttestation(): Promise<Object>;                         // Android

  // Cross-platform: Native hardware evidence verification
  verifyHardwareEvidence(
    certificateChainPem: string[],
    signatureBase64: string,
    signedContent: string,
    publicKeyBase64: string,
    attestationFormat: string,
    signedContentHashBase64: string
  ): Promise<Object>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('Attestation');
