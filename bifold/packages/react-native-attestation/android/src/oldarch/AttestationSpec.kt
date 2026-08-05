package com.attestation

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableArray

abstract class AttestationSpec internal constructor(context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  abstract fun isPlayIntegrityAvailable(promise: Promise)
  abstract fun googleAttestation(nonce: String, promise: Promise)
  // iOS-only methods, mirrored so old/new arch spec surfaces stay identical
  abstract fun generateKey(cache: Boolean, promise: Promise)
  abstract fun sha256(stringToHash: String, promise: Promise)
  abstract fun appleKeyAttestation(keyId: String, challenge: String, promise: Promise)
  abstract fun getAppStoreReceipt(promise: Promise)
  abstract fun attestHardwareSigningKey(challenge: String, promise: Promise)
  abstract fun verifyHardwareEvidence(
    certificateChainPem: ReadableArray,
    signatureBase64: String,
    signedContent: String,
    publicKeyBase64: String,
    attestationFormat: String,
    signedContentHashBase64: String,
    promise: Promise
  )
  abstract fun createSecureEnclaveKey(promise: Promise)
  abstract fun hasHardwareSigningKey(promise: Promise)
  abstract fun getHardwarePublicKey(promise: Promise)
  abstract fun signWithHardwareBiometricAuth(dataToSign: ReadableArray, authMode: String?, promise: Promise)
  abstract fun deleteHardwareSigningKey(promise: Promise)
  abstract fun getHardwareKeyInfo(promise: Promise)
  abstract fun getKeyAttestation(promise: Promise)
  abstract fun isHardwareAttestationAvailable(promise: Promise)
}
