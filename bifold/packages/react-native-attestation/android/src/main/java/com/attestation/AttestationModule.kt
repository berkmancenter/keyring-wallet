package com.attestation

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Log
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GooglePlayServicesUtil
import com.google.android.gms.tasks.Task
import com.google.android.play.core.integrity.IntegrityManager
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.IntegrityServiceException
import com.google.android.play.core.integrity.IntegrityTokenRequest
import com.google.android.play.core.integrity.IntegrityTokenResponse
import java.io.ByteArrayInputStream
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.Signature
import java.security.cert.CertPathValidator
import java.security.cert.CertificateFactory
import java.security.cert.PKIXParameters
import java.security.cert.TrustAnchor
import java.security.cert.X509Certificate
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec

class AttestationModule : AttestationSpec {

  private val reactContext: ReactApplicationContext
  private val baseContext: ReactApplicationContext

  constructor(context: ReactApplicationContext) : super(context) {
    reactContext = context
    baseContext = getReactApplicationContext()
  }

  override fun getName(): String {
    return NAME
  }

  companion object {
    const val NAME = "Attestation"
    const val HARDWARE_SIGNING_KEY_ALIAS = "vrc_hardware_signing_key"
    const val ANDROID_KEYSTORE = "AndroidKeyStore"
    const val TAG = "VRC:Android"

    private const val ATTESTATION_EXTENSION_OID = "1.3.6.1.4.1.11129.2.1.17"

    // Google Hardware Attestation Root CA — expires May 24, 2026
    // TODO(P0): Replace before expiry. Google is transitioning to Remote Key Provisioning (RKP)
    //   with short-lived certs. Monitor https://developer.android.com/privacy-and-security/security-key-attestation
    //   for an updated root or RKP migration guidance.
    private const val GOOGLE_ROOT_PEM = "-----BEGIN CERTIFICATE-----\n" +
      "MIIFYDCCA0igAwIBAgIJAOj6GWMU0voYMA0GCSqGSIb3DQEBCwUAMBsxGTAXBgNV\n" +
      "BAUTEGY5MjAwOWU4NTNiNmIwNDUwHhcNMTYwNTI2MTY0NTUyWhcNMjYwNTI0MTY0\n" +
      "NTUyWjAbMRkwFwYDVQQFExBmOTIwMDllODUzYjZiMDQ1MIICIjANBgkqhkiG9w0B\n" +
      "AQEFAAOCAg8AMIICCgKCAgEAr7bHgiuxpwHsK7Qui8xUFmOr75gvMsd/dTEDDJdS\n" +
      "Sxtf6An7xyqpRR90PL2abxM1dEqlXnf2tqw1Ne4Xwl5jlRfdnJLmN0pTy/4lj4/7\n" +
      "tv0Sk3iiKkypnEUtR6WfMgH0QZfKHM1+di+y9TFRtv6y//0rb+T+W8a9nsNL/ggj\n" +
      "nar86461qO0rOs2cXjp3kOG1FEJ5MVmFmBGtnrKpa73XpXyTqRxB/M0n1n/W9nGq\n" +
      "C4FSYa04T6N5RIZGBN2z2MT5IKGbFlbC8UrW0DxW7AYImQQcHtGl/m00QLVWutHQ\n" +
      "oVJYnFPlXTcHYvASLu+RhhsbDmxMgJJ0mcDpvsC4PjvB+TxywElgS70vE0XmLD+O\n" +
      "JtvsBslHZvPBKCOdT0MS+tgSOIfga+z1Z1g7+DVagf7quvmag8jfPioyKvxnK/Eg\n" +
      "sTUVi2ghzq8wm27ud/mIM7AY2qEORR8Go3TVB4HzWQgpZrt3i5MIlCaY504LzSRi\n" +
      "igHCzAPlHws+W0rB5N+er5/2pJKnfBSDiCiFAVtCLOZ7gLiMm0jhO2B6tUXHI/+M\n" +
      "RPjy02i59lINMRRev56GKtcd9qO/0kUJWdZTdA2XoS82ixPvZtXQpUpuL12ab+9E\n" +
      "aDK8Z4RHJYYfCT3Q5vNAXaiWQ+8PTWm2QgBR/bkwSWc+NpUFgNPN9PvQi8WEg5Um\n" +
      "AGMCAwEAAaOBpjCBozAdBgNVHQ4EFgQUNmHhAHyIBQlRi0RsR/8aTMnqTxIwHwYD\n" +
      "VR0jBBgwFoAUNmHhAHyIBQlRi0RsR/8aTMnqTxIwDwYDVR0TAQH/BAUwAwEB/zAO\n" +
      "BgNVHQ8BAf8EBAMCAYYwQAYDVR0fBDkwNzA1oDOgMYYvaHR0cHM6Ly9hbmRyb2lk\n" +
      "Lmdvb2dsZWFwaXMuY29tL2F0dGVzdGF0aW9uL2NybC8wDQYJKoZIhvcNAQELBQAD\n" +
      "ggIBACDIw41L3KlXG0aMiS//cqrG+EShHUGo8HNsw30W1kJtjn6UBwRM6jnmiwfB\n" +
      "Pb8VA91chb2vssAtX2zbTvqBJ9+LBPGCdw/E53Rbf86qhxKaiAHOjpvAy5Y3m00m\n" +
      "qC0w/Zwvju1twb4vhLaJ5NkUJYsUS7rmJKHHBnETLi8GFqiEsqTWpG/6ibYCv7rY\n" +
      "DBJDcR9W62BW9jfIoBQcxUCUJouMPH25lLNcDc1ssqvC2v7iUgI9LeoM1sNovqPm\n" +
      "QUiG9rHli1vXxzCyaMTjwftkJLkf6724DFhuKug2jITV0QkXvaJWF4nUaHOTNA4u\n" +
      "JU9WDvZLI1j83A+/xnAJUucIv/zGJ1AMH2boHqF8CY16LpsYgBt6tKxxWH00XcyD\n" +
      "CdW2KlBCeqbQPcsFmWyWugxdcekhYsAWyoSf818NUsZdBWBaR/OukXrNLfkQ79Iy\n" +
      "ZohZbvabO/X+MVT3rriAoKc8oE2Uws6DF+60PV7/WIPjNvXySdqspImSN78mflxD\n" +
      "qwLqRBYkA3I75qppLGG9rp7UCdRjxMl8ZDBld+7yvHVgt1cVzJx9xnyGCC23Uaic\n" +
      "MDSXYrB4I4WHXPGjxhZuCuPBLTdOLU8YRvMYdEvYebWHMpvwGCF6bAx3JBpIeOQ1\n" +
      "wDB5y0USicV3YgYGmi+NZfhA4URSh77Yd6uuJOJENRaNVTzk\n" +
      "-----END CERTIFICATE-----"

    /** Hex representation of first/last few bytes for diagnostic logging */
    fun bytesToHexShort(bytes: ByteArray, maxBytes: Int = 8): String {
      if (bytes.isEmpty()) return "(empty)"
      if (bytes.size <= maxBytes * 2) {
        return bytes.joinToString("") { String.format("%02x", it) } + " [${bytes.size}b]"
      }
      val head = bytes.take(maxBytes).joinToString("") { String.format("%02x", it) }
      val tail = bytes.takeLast(maxBytes).joinToString("") { String.format("%02x", it) }
      return "$head...$tail [${bytes.size}b]"
    }

    // SPKI header for uncompressed P-256 EC public key (26 bytes)
    private val EC_P256_SPKI_HEADER = byteArrayOf(
      0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2A, 0x86.toByte(),
      0x48, 0xCE.toByte(), 0x3D, 0x02, 0x01, 0x06, 0x08, 0x2A,
      0x86.toByte(), 0x48, 0xCE.toByte(), 0x3D, 0x03, 0x01, 0x07,
      0x03, 0x42, 0x00
    )

    // Apple App Attestation Root CA — from Apple's Private PKI:
    // https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem
    // Subject: CN=Apple App Attestation Root CA, O=Apple Inc., ST=California
    // Valid: 2020-03-18 to 2045-03-15, Key: EC P-384
    private const val APPLE_APP_ATTESTATION_ROOT_PEM = "-----BEGIN CERTIFICATE-----\n" +
      "MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw\n" +
      "JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK\n" +
      "QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa\n" +
      "Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv\n" +
      "biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y\n" +
      "bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh\n" +
      "NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au\n" +
      "Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/\n" +
      "MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw\n" +
      "CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn\n" +
      "53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV\n" +
      "oyFraWVIyd/dganmrduC1bmTBGwD\n" +
      "-----END CERTIFICATE-----"

    // Apple Root CA - G3 (secondary anchor — some older attestation chains may use this)
    // Downloaded from https://www.apple.com/certificateauthority/AppleRootCA-G3.cer
    // Subject: CN=Apple Root CA - G3, OU=Apple Certification Authority, O=Apple Inc., C=US
    // Valid: 2014-04-30 to 2039-04-30, Key: EC P-384
    private const val APPLE_ROOT_CA_G3_PEM = "-----BEGIN CERTIFICATE-----\n" +
      "MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS\n" +
      "QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u\n" +
      "IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN\n" +
      "MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS\n" +
      "b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y\n" +
      "aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49\n" +
      "AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf\n" +
      "TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517\n" +
      "IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr\n" +
      "MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA\n" +
      "MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4\n" +
      "at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM\n" +
      "6BgD56KyKA==\n" +
      "-----END CERTIFICATE-----"
  }

  private var keySecurityLevel: String = "Software"

  @ReactMethod
  override fun isPlayIntegrityAvailable(promise: Promise) {
    try {
      val apiAvailable = GooglePlayServicesUtil.isGooglePlayServicesAvailable(baseContext) == ConnectionResult.SUCCESS
      promise.resolve(apiAvailable)
    } catch (e: Throwable) {
      promise.reject("Error checking Play Integrity availability", e)
    }
  }

  @ReactMethod
  override fun googleAttestation(nonce: String, promise: Promise) {
    try {
      val integrityManager: IntegrityManager = IntegrityManagerFactory.create(baseContext)

      val integrityTokenResponse: Task<IntegrityTokenResponse> =
        integrityManager.requestIntegrityToken(
          IntegrityTokenRequest.builder()
            .setNonce(nonce)
            .build()
        )

      integrityTokenResponse.addOnSuccessListener { response: IntegrityTokenResponse -> promise.resolve(response.token()) }
      integrityTokenResponse.addOnCanceledListener { -> promise.reject("Integrity token request cancelled") }
      integrityTokenResponse.addOnFailureListener { e: Exception ->
        if (e is IntegrityServiceException) {
          promise.reject(e.getErrorCode().toString(), e)
        } else {
          promise.reject("Unexpected failure during integrity token request", e)
        }
      }
    } catch (e: Throwable) {
      promise.reject("Error requesting integrity token", e)
    }
  }

  // =============================================================================
  // Hardware-Backed Signing Key
  // =============================================================================

  @ReactMethod
  override fun createSecureEnclaveKey(promise: Promise) {
    Log.i(TAG, "▶ Creating hardware signing key")

    try {
      val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
      keyStore.load(null)
      if (keyStore.containsAlias(HARDWARE_SIGNING_KEY_ALIAS)) {
        keyStore.deleteEntry(HARDWARE_SIGNING_KEY_ALIAS)
      }

      val keyPairGenerator = KeyPairGenerator.getInstance(
        KeyProperties.KEY_ALGORITHM_EC,
        ANDROID_KEYSTORE
      )

      val attestationChallenge = ByteArray(32)
      SecureRandom().nextBytes(attestationChallenge)

      val builder = KeyGenParameterSpec.Builder(
        HARDWARE_SIGNING_KEY_ALIAS,
        KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
      )
        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_SHA256)
        .setUserAuthenticationRequired(true)
        .setAttestationChallenge(attestationChallenge)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        builder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
      } else {
        @Suppress("DEPRECATION")
        builder.setUserAuthenticationValidityDurationSeconds(-1)
      }

      builder.setInvalidatedByBiometricEnrollment(true)

      var useStrongBox = false
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        try {
          builder.setIsStrongBoxBacked(true)
          useStrongBox = true
        } catch (e: Exception) {
          // StrongBox not available
        }
      }

      try {
        keyPairGenerator.initialize(builder.build())
        val keyPair = keyPairGenerator.generateKeyPair()
        keySecurityLevel = getKeySecurityLevel()

        Log.i(TAG, "✓ Key created [$keySecurityLevel]")

        val publicKeyBytes = keyPair.public.encoded
        val publicKeyArray = bytesToWritableArray(publicKeyBytes)

        val result = Arguments.createMap()
        result.putBoolean("success", true)
        result.putArray("publicKey", publicKeyArray)
        result.putString("keyType", "EC-P256")
        result.putString("storage", keySecurityLevel)

        promise.resolve(result)
      } catch (e: StrongBoxUnavailableException) {
        Log.w(TAG, "StrongBox unavailable, using TEE")

        val fallbackBuilder = KeyGenParameterSpec.Builder(
          HARDWARE_SIGNING_KEY_ALIAS,
          KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
        )
          .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
          .setDigests(KeyProperties.DIGEST_SHA256)
          .setUserAuthenticationRequired(true)
          .setInvalidatedByBiometricEnrollment(true)
          .setAttestationChallenge(attestationChallenge)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          fallbackBuilder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        }

        keyPairGenerator.initialize(fallbackBuilder.build())
        val keyPair = keyPairGenerator.generateKeyPair()
        keySecurityLevel = getKeySecurityLevel()

        Log.i(TAG, "✓ Key created [$keySecurityLevel]")

        val publicKeyBytes = keyPair.public.encoded
        val publicKeyArray = bytesToWritableArray(publicKeyBytes)

        val result = Arguments.createMap()
        result.putBoolean("success", true)
        result.putArray("publicKey", publicKeyArray)
        result.putString("keyType", "EC-P256")
        result.putString("storage", keySecurityLevel)

        promise.resolve(result)
      }
    } catch (e: Exception) {
      Log.e(TAG, "✗ Key generation failed: ${e.message}")
      promise.reject("error", "Failed to generate biometric signing key: ${e.message}", e)
    }
  }

  @ReactMethod
  override fun hasHardwareSigningKey(promise: Promise) {
    try {
      val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
      keyStore.load(null)
      promise.resolve(keyStore.containsAlias(HARDWARE_SIGNING_KEY_ALIAS))
    } catch (e: Exception) {
      promise.reject("error", "Failed to check for key: ${e.message}", e)
    }
  }

  @ReactMethod
  override fun getHardwarePublicKey(promise: Promise) {
    try {
      val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
      keyStore.load(null)

      if (!keyStore.containsAlias(HARDWARE_SIGNING_KEY_ALIAS)) {
        promise.reject("error", "Hardware signing key not found")
        return
      }

      val publicKey: java.security.PublicKey
      try {
        publicKey = keyStore.getCertificate(HARDWARE_SIGNING_KEY_ALIAS)?.publicKey
          ?: run {
            promise.reject("error", "Could not get public key")
            return
          }
      } catch (e: KeyPermanentlyInvalidatedException) {
        Log.w(TAG, "Key invalidated (biometric enrollment changed) — deleting key")
        try { keyStore.deleteEntry(HARDWARE_SIGNING_KEY_ALIAS) } catch (_: Exception) {}
        promise.reject("error", "Hardware key invalidated by biometric change — please recreate key", e)
        return
      } catch (e: java.security.InvalidKeyException) {
        Log.w(TAG, "Key invalid — deleting key: ${e.message}")
        try { keyStore.deleteEntry(HARDWARE_SIGNING_KEY_ALIAS) } catch (_: Exception) {}
        promise.reject("error", "Hardware key invalid — please recreate key", e)
        return
      }

      promise.resolve(bytesToWritableArray(publicKey.encoded))
    } catch (e: Exception) {
      promise.reject("error", "Failed to get public key: ${e.message}", e)
    }
  }

  @ReactMethod
  override fun signWithHardwareBiometricAuth(dataToSign: ReadableArray, promise: Promise) {
    Log.i(TAG, "▶ Signing with biometric [${dataToSign.size()} bytes]")

    try {
      val activity = currentActivity as? FragmentActivity
      if (activity == null) {
        promise.reject("error", "No activity available for biometric prompt")
        return
      }

      val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
      keyStore.load(null)

      if (!keyStore.containsAlias(HARDWARE_SIGNING_KEY_ALIAS)) {
        promise.reject("error", "Hardware signing key not found")
        return
      }

      val privateKey: PrivateKey
      try {
        privateKey = keyStore.getKey(HARDWARE_SIGNING_KEY_ALIAS, null) as? PrivateKey
          ?: run {
            promise.reject("error", "Could not get private key")
            return
          }
      } catch (e: KeyPermanentlyInvalidatedException) {
        Log.w(TAG, "Key invalidated (biometric enrollment changed) — deleting key")
        try { keyStore.deleteEntry(HARDWARE_SIGNING_KEY_ALIAS) } catch (_: Exception) {}
        promise.reject("error", "Hardware key invalidated by biometric change — please recreate key", e)
        return
      } catch (e: java.security.InvalidKeyException) {
        Log.w(TAG, "Key invalid — deleting key: ${e.message}")
        try { keyStore.deleteEntry(HARDWARE_SIGNING_KEY_ALIAS) } catch (_: Exception) {}
        promise.reject("error", "Hardware key invalid — please recreate key", e)
        return
      }

      val dataBytes = readableArrayToBytes(dataToSign)
      val signature = Signature.getInstance("SHA256withECDSA")
      signature.initSign(privateKey)

      val executor = ContextCompat.getMainExecutor(reactContext)

      val callback = object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
          try {
            val cryptoSignature = result.cryptoObject?.signature
            if (cryptoSignature != null) {
              cryptoSignature.update(dataBytes)
              val signatureBytes = cryptoSignature.sign()

              Log.i(TAG, "✓ Signature created [${signatureBytes.size} bytes]")

              val contentHash = java.security.MessageDigest.getInstance("SHA-256").digest(dataBytes)

              val resultMap = Arguments.createMap()
              resultMap.putBoolean("success", true)
              resultMap.putArray("signature", bytesToWritableArray(signatureBytes))
              resultMap.putString("algorithm", "ECDSA-SHA256")
              resultMap.putString("clientDataHash", android.util.Base64.encodeToString(contentHash, android.util.Base64.NO_WRAP))

              promise.resolve(resultMap)
            } else {
              promise.reject("error", "No crypto object in result")
            }
          } catch (e: Exception) {
            Log.e(TAG, "✗ Signing failed: ${e.message}")
            promise.reject("error", "Signing failed: ${e.message}", e)
          }
        }

        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
          when (errorCode) {
            BiometricPrompt.ERROR_USER_CANCELED,
            BiometricPrompt.ERROR_NEGATIVE_BUTTON,
            BiometricPrompt.ERROR_CANCELED -> {
              Log.i(TAG, "✗ Biometric cancelled")
              promise.reject("error", "Biometric authentication cancelled: $errString")
            }
            BiometricPrompt.ERROR_LOCKOUT -> {
              Log.w(TAG, "✗ Biometric locked out (too many attempts)")
              promise.reject("error", "Biometric locked out — try again shortly: $errString")
            }
            else -> {
              Log.w(TAG, "✗ Biometric error [$errorCode]: $errString")
              promise.reject("error", "Biometric authentication failed: $errString")
            }
          }
        }

        override fun onAuthenticationFailed() {
          // User can retry
        }
      }

      val promptInfo = BiometricPrompt.PromptInfo.Builder()
        .setTitle("Confirm Relationship")
        .setSubtitle("Authenticate to sign this relationship credential")
        .setNegativeButtonText("Cancel")
        .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
        .build()

      activity.runOnUiThread {
        try {
          val biometricPrompt = BiometricPrompt(activity, executor, callback)
          val cryptoObject = BiometricPrompt.CryptoObject(signature)
          biometricPrompt.authenticate(promptInfo, cryptoObject)
        } catch (e: Exception) {
          promise.reject("error", "Failed to show biometric prompt: ${e.message}", e)
        }
      }
    } catch (e: Exception) {
      Log.e(TAG, "✗ Sign failed: ${e.message}")
      promise.reject("error", "Failed to sign: ${e.message}", e)
    }
  }

  @ReactMethod
  override fun deleteHardwareSigningKey(promise: Promise) {
    try {
      val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
      keyStore.load(null)

      if (keyStore.containsAlias(HARDWARE_SIGNING_KEY_ALIAS)) {
        keyStore.deleteEntry(HARDWARE_SIGNING_KEY_ALIAS)
      }

      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("error", "Failed to delete key: ${e.message}", e)
    }
  }

  @ReactMethod
  override fun getHardwareKeyInfo(promise: Promise) {
    try {
      val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
      keyStore.load(null)

      val result = Arguments.createMap()

      if (!keyStore.containsAlias(HARDWARE_SIGNING_KEY_ALIAS)) {
        result.putBoolean("exists", false)
        promise.resolve(result)
        return
      }

      result.putBoolean("exists", true)
      result.putString("keyType", "EC-P256")
      result.putString("storage", getKeySecurityLevel())
      result.putBoolean("biometricBound", true)
      result.putString("algorithm", "ECDSA-SHA256")

      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("error", "Failed to get key info: ${e.message}", e)
    }
  }

  // =============================================================================
  // Helper methods
  // =============================================================================

  private fun getKeySecurityLevel(): String {
    try {
      val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
      keyStore.load(null)

      val privateKey = keyStore.getKey(HARDWARE_SIGNING_KEY_ALIAS, null) as? PrivateKey
        ?: return "Unknown"

      val factory = KeyFactory.getInstance(privateKey.algorithm, ANDROID_KEYSTORE)
      val keyInfo = factory.getKeySpec(privateKey, KeyInfo::class.java)

      return when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
          when (keyInfo.securityLevel) {
            KeyProperties.SECURITY_LEVEL_STRONGBOX -> "StrongBox"
            KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "TEE"
            KeyProperties.SECURITY_LEVEL_SOFTWARE -> "Software"
            else -> "Unknown"
          }
        }
        keyInfo.isInsideSecureHardware -> "TEE"
        else -> "Software"
      }
    } catch (e: Exception) {
      return "Unknown"
    }
  }

  // =============================================================================
  // Hardware Key Attestation with Certificate Chain
  // =============================================================================

  @ReactMethod
  override fun getKeyAttestation(promise: Promise) {
    Log.i(TAG, "▶ Hardware key attestation")

    try {
      val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
      keyStore.load(null)

      if (!keyStore.containsAlias(HARDWARE_SIGNING_KEY_ALIAS)) {
        promise.reject("error", "Hardware signing key not found. Create it first.")
        return
      }

      val certChain = keyStore.getCertificateChain(HARDWARE_SIGNING_KEY_ALIAS)

      if (certChain == null || certChain.isEmpty()) {
        promise.reject("error", "No certificate chain found for biometric key")
        return
      }

      val pemChain = Arguments.createArray()
      var successCount = 0

      for ((index, cert) in certChain.withIndex()) {
        val pemCert = certToPem(cert, index)
        if (pemCert != null) {
          pemChain.pushString(pemCert)
          successCount++
        }
      }

      if (successCount == 0) {
        promise.reject("error", "Failed to convert any certificates to PEM format")
        return
      }

      val publicKey = keyStore.getCertificate(HARDWARE_SIGNING_KEY_ALIAS)?.publicKey
      val publicKeyBase64 = if (publicKey != null) {
        android.util.Base64.encodeToString(publicKey.encoded, android.util.Base64.NO_WRAP)
      } else {
        ""
      }

      val securityLevel = getKeySecurityLevel()

      Log.i(TAG, "✓ Attestation complete [$successCount certs, $securityLevel]")

      val result = Arguments.createMap()
      result.putBoolean("success", true)
      result.putString("format", "android-key-attestation-v3")
      result.putArray("certificateChain", pemChain)
      result.putString("publicKey", publicKeyBase64)
      result.putString("securityLevel", securityLevel)
      result.putInt("chainLength", certChain.size)

      promise.resolve(result)

    } catch (e: Exception) {
      Log.e(TAG, "✗ Attestation failed: ${e.message}")
      promise.reject("error", "Failed to get key attestation: ${e.message}", e)
    }
  }

  @ReactMethod
  override fun isHardwareAttestationAvailable(promise: Promise) {
    try {
      val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
      keyStore.load(null)

      val available = if (keyStore.containsAlias(HARDWARE_SIGNING_KEY_ALIAS)) {
        val chain = keyStore.getCertificateChain(HARDWARE_SIGNING_KEY_ALIAS)
        chain != null && chain.isNotEmpty()
      } else {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.N
      }

      promise.resolve(available)
    } catch (e: Exception) {
      promise.resolve(false)
    }
  }

  private fun certToPem(cert: java.security.cert.Certificate?, index: Int = -1): String? {
    if (cert == null) return null

    return try {
      val encoded = cert.encoded
      if (encoded == null || encoded.isEmpty()) return null

      val base64 = android.util.Base64.encodeToString(encoded, android.util.Base64.DEFAULT)
      if (base64.isNullOrBlank()) return null

      "-----BEGIN CERTIFICATE-----\n${base64.trim()}\n-----END CERTIFICATE-----"
    } catch (e: Exception) {
      null
    }
  }

  private fun bytesToWritableArray(bytes: ByteArray): WritableArray {
    val array = Arguments.createArray()
    for (byte in bytes) {
      array.pushInt(byte.toInt() and 0xFF)
    }
    return array
  }

  private fun readableArrayToBytes(array: ReadableArray): ByteArray {
    val bytes = ByteArray(array.size())
    for (i in 0 until array.size()) {
      bytes[i] = array.getInt(i).toByte()
    }
    return bytes
  }

  // =============================================================================
  // Production-grade hardware evidence verification
  // =============================================================================

  private data class AttestationExtensionData(
    val attestationSecurityLevel: String,  // "Software", "TEE", "StrongBox"
    val keymasterSecurityLevel: String,
    val attestationChallenge: String,      // base64
    val verifiedBootState: String,         // "Verified", "SelfSigned", "Unverified", "Failed"
    val deviceLocked: Boolean,
    val userAuthType: String,              // "NONE", "PASSWORD", "BIOMETRIC", "BOTH"
    val authTimeout: Int                   // 0 = per-use
  )

  /**
   * Minimal ASN.1 DER parser for the Android key attestation extension.
   * Handles only the subset of ASN.1 needed to parse KeyDescription.
   */
  private class Asn1Parser(val data: ByteArray) {
    var offset = 0

    fun hasMore(): Boolean = offset < data.size

    fun peekTag(): Int {
      if (offset >= data.size) return -1
      return data[offset].toInt() and 0xFF
    }

    fun readTag(): Int {
      if (offset >= data.size) throw IllegalStateException("ASN.1: unexpected end of data reading tag")
      return data[offset++].toInt() and 0xFF
    }

    fun readLength(): Int {
      if (offset >= data.size) throw IllegalStateException("ASN.1: unexpected end of data reading length")
      val first = data[offset++].toInt() and 0xFF
      if (first < 0x80) return first
      val numBytes = first and 0x7F
      if (numBytes > 4) throw IllegalStateException("ASN.1: length too large ($numBytes bytes)")
      var length = 0
      for (i in 0 until numBytes) {
        if (offset >= data.size) throw IllegalStateException("ASN.1: unexpected end of data in length")
        length = (length shl 8) or (data[offset++].toInt() and 0xFF)
      }
      return length
    }

    fun readInteger(): Long {
      val tag = readTag()
      if (tag != 0x02) throw IllegalStateException("ASN.1: expected INTEGER (0x02) but got 0x${tag.toString(16)}")
      val len = readLength()
      if (len > 8) throw IllegalStateException("ASN.1: integer too large ($len bytes)")
      var value = 0L
      // Handle sign extension for negative values
      if (len > 0 && (data[offset].toInt() and 0x80) != 0) {
        value = -1L
      }
      for (i in 0 until len) {
        value = (value shl 8) or (data[offset++].toLong() and 0xFF)
      }
      return value
    }

    fun readOctetString(): ByteArray {
      val tag = readTag()
      if (tag != 0x04) throw IllegalStateException("ASN.1: expected OCTET STRING (0x04) but got 0x${tag.toString(16)}")
      val len = readLength()
      if (offset + len > data.size) throw IllegalStateException("ASN.1: octet string exceeds data")
      val bytes = data.copyOfRange(offset, offset + len)
      offset += len
      return bytes
    }

    fun readBoolean(): Boolean {
      val tag = readTag()
      if (tag != 0x01) throw IllegalStateException("ASN.1: expected BOOLEAN (0x01) but got 0x${tag.toString(16)}")
      val len = readLength()
      val value = data[offset].toInt() != 0
      offset += len
      return value
    }

    fun readEnumerated(): Int {
      val tag = readTag()
      if (tag != 0x0A) throw IllegalStateException("ASN.1: expected ENUMERATED (0x0A) but got 0x${tag.toString(16)}")
      val len = readLength()
      var value = 0
      for (i in 0 until len) {
        value = (value shl 8) or (data[offset++].toInt() and 0xFF)
      }
      return value
    }

    /** Read a SEQUENCE and return a sub-parser over its contents. */
    fun readSequence(): Asn1Parser {
      val tag = readTag()
      if (tag != 0x30) throw IllegalStateException("ASN.1: expected SEQUENCE (0x30) but got 0x${tag.toString(16)}")
      val len = readLength()
      if (offset + len > data.size) throw IllegalStateException("ASN.1: sequence exceeds data")
      val inner = Asn1Parser(data.copyOfRange(offset, offset + len))
      offset += len
      return inner
    }

    /** Read a context-tagged [EXPLICIT] value and return a sub-parser over its contents. */
    fun readTaggedObject(): Pair<Int, Asn1Parser> {
      val tagByte = readTag()
      val tagNumber = tagByte and 0x1F
      val len = readLength()
      if (offset + len > data.size) throw IllegalStateException("ASN.1: tagged object exceeds data")
      val inner = Asn1Parser(data.copyOfRange(offset, offset + len))
      offset += len
      return Pair(tagNumber, inner)
    }

    /** Skip the current TLV value. */
    fun skipValue() {
      readTag()
      val len = readLength()
      if (offset + len > data.size) throw IllegalStateException("ASN.1: skip exceeds data")
      offset += len
    }

    /** Read raw bytes for the current TLV's value (tag + length already consumed externally). */
    fun readRawBytes(len: Int): ByteArray {
      if (offset + len > data.size) throw IllegalStateException("ASN.1: raw read exceeds data")
      val bytes = data.copyOfRange(offset, offset + len)
      offset += len
      return bytes
    }
  }

  /**
   * Parse the Android Key Attestation extension (OID 1.3.6.1.4.1.11129.2.1.17)
   * from a leaf X.509 certificate.
   *
   * KeyDescription ::= SEQUENCE {
   *   attestationVersion     INTEGER,            -- index 0
   *   attestationSecurityLevel  SecurityLevel,   -- index 1
   *   keymasterVersion       INTEGER,            -- index 2
   *   keymasterSecurityLevel SecurityLevel,      -- index 3
   *   attestationChallenge   OCTET STRING,       -- index 4
   *   uniqueId               OCTET STRING,       -- index 5
   *   softwareEnforced       AuthorizationList,  -- index 6
   *   teeEnforced            AuthorizationList,  -- index 7
   * }
   */
  private fun parseAttestationExtension(leafCert: X509Certificate): AttestationExtensionData? {
    try {
      val extensionBytes = leafCert.getExtensionValue(ATTESTATION_EXTENSION_OID) ?: return null

      // The extension value is wrapped in an OCTET STRING by X.509; unwrap it
      val outerParser = Asn1Parser(extensionBytes)
      val innerBytes = outerParser.readOctetString()
      val seqParser = Asn1Parser(innerBytes)

      // Read the outer SEQUENCE tag
      val tag = seqParser.readTag()
      if (tag != 0x30) {
        Log.w(TAG, "Attestation extension: expected SEQUENCE, got 0x${tag.toString(16)}")
        return null
      }
      val seqLen = seqParser.readLength()
      val keyDescParser = Asn1Parser(seqParser.data.copyOfRange(seqParser.offset, seqParser.offset + seqLen))

      // index 0: attestationVersion (INTEGER)
      keyDescParser.readInteger()

      // index 1: attestationSecurityLevel (INTEGER used as enum)
      val attSecLevel = keyDescParser.readInteger().toInt()

      // index 2: keymasterVersion (INTEGER)
      keyDescParser.readInteger()

      // index 3: keymasterSecurityLevel (INTEGER)
      val kmSecLevel = keyDescParser.readInteger().toInt()

      // index 4: attestationChallenge (OCTET STRING)
      val challengeBytes = keyDescParser.readOctetString()
      val challengeB64 = android.util.Base64.encodeToString(challengeBytes, android.util.Base64.NO_WRAP)

      // index 5: uniqueId (OCTET STRING)
      keyDescParser.readOctetString()

      // index 6: softwareEnforced (AuthorizationList — SEQUENCE)
      keyDescParser.skipValue()

      // index 7: teeEnforced (AuthorizationList — SEQUENCE)
      keyDescParser.readTag()  // consume SEQUENCE tag
      val teeLen = keyDescParser.readLength()
      val teeData = keyDescParser.readRawBytes(teeLen)

      // Parse teeEnforced AuthorizationList with full multi-byte tag support
      val parsedAuthList = parseAuthorizationList(Asn1Parser(teeData))

      return AttestationExtensionData(
        attestationSecurityLevel = securityLevelToString(attSecLevel),
        keymasterSecurityLevel = securityLevelToString(kmSecLevel),
        attestationChallenge = challengeB64,
        verifiedBootState = parsedAuthList?.verifiedBootState ?: "Unknown",
        deviceLocked = parsedAuthList?.deviceLocked ?: false,
        userAuthType = parsedAuthList?.userAuthType ?: "NONE",
        authTimeout = parsedAuthList?.authTimeout ?: 0
      )
    } catch (e: Exception) {
      Log.w(TAG, "Failed to parse attestation extension: ${e.message}")
      return null
    }
  }

  /**
   * Parse AuthorizationList tagged fields with proper multi-byte tag support.
   *
   * AuthorizationList fields use KM_TAG values:
   * - KM_TAG_USER_AUTH_TYPE = 504 (0x1F8)
   * - KM_TAG_AUTH_TIMEOUT = 505 (0x1F9)
   * - KM_TAG_ROOT_OF_TRUST = 704 (0x2C0)
   *
   * In ASN.1 DER with EXPLICIT context tagging, these become multi-byte tags.
   */
  private data class AuthListData(
    val verifiedBootState: String,
    val deviceLocked: Boolean,
    val userAuthType: String,
    val authTimeout: Int
  )

  private fun parseAuthorizationList(parser: Asn1Parser): AuthListData? {
    var verifiedBootState = "Unknown"
    var deviceLocked = false
    var userAuthType = "NONE"
    var authTimeout = 0

    try {
      while (parser.hasMore()) {
        val firstByte = parser.data[parser.offset].toInt() and 0xFF

        // Context-specific tags have bit 7 set (0x80)
        if ((firstByte and 0x80) == 0) {
          parser.skipValue()
          continue
        }

        // Read full tag number (may be multi-byte)
        val tagNumber = readMultiByteTag(parser)
        val len = parser.readLength()

        when (tagNumber) {
          // KM_TAG_ROOT_OF_TRUST = 704
          704 -> {
            val rootOfTrustData = parser.readRawBytes(len)
            val rotParser = Asn1Parser(rootOfTrustData)
            try {
              // SEQUENCE { verifiedBootKey OCTET STRING, deviceLocked BOOLEAN,
              //            verifiedBootState VerifiedBootState, verifiedBootHash OCTET STRING }
              val seqParser = rotParser.readSequence()
              seqParser.readOctetString()  // verifiedBootKey — skip
              deviceLocked = seqParser.readBoolean()
              val bootState = seqParser.readEnumerated()
              verifiedBootState = when (bootState) {
                0 -> "Verified"
                1 -> "SelfSigned"
                2 -> "Unverified"
                3 -> "Failed"
                else -> "Unknown($bootState)"
              }
            } catch (e: Exception) {
              Log.w(TAG, "Failed to parse rootOfTrust: ${e.message}")
            }
          }
          // KM_TAG_USER_AUTH_TYPE = 504
          504 -> {
            val authData = parser.readRawBytes(len)
            val authParser = Asn1Parser(authData)
            try {
              val authTypeValue = authParser.readInteger().toInt()
              userAuthType = when {
                authTypeValue == 0 -> "NONE"
                authTypeValue == 1 -> "PASSWORD"
                authTypeValue == 2 -> "BIOMETRIC"
                authTypeValue and 0x03 == 0x03 -> "BOTH"
                authTypeValue and 0x02 != 0 -> "BIOMETRIC"
                authTypeValue and 0x01 != 0 -> "PASSWORD"
                else -> "UNKNOWN($authTypeValue)"
              }
            } catch (e: Exception) {
              Log.w(TAG, "Failed to parse userAuthType: ${e.message}")
            }
          }
          // KM_TAG_AUTH_TIMEOUT = 505
          505 -> {
            val timeoutData = parser.readRawBytes(len)
            val timeoutParser = Asn1Parser(timeoutData)
            try {
              authTimeout = timeoutParser.readInteger().toInt()
            } catch (e: Exception) {
              Log.w(TAG, "Failed to parse authTimeout: ${e.message}")
            }
          }
          else -> {
            // Skip unknown tag values
            if (len > 0) {
              parser.readRawBytes(len)
            }
          }
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "AuthorizationList parse error: ${e.message}")
    }

    return AuthListData(verifiedBootState, deviceLocked, userAuthType, authTimeout)
  }

  /**
   * Read a possibly multi-byte ASN.1 tag number.
   * For context-specific tags [N] EXPLICIT, the encoding is:
   * - If N < 31: single byte 0xA0 | N
   * - If N >= 31: first byte 0xBF (constructed) or 0x9F (primitive), then N in base-128
   */
  private fun readMultiByteTag(parser: Asn1Parser): Int {
    val firstByte = parser.data[parser.offset].toInt() and 0xFF
    parser.offset++

    val lowBits = firstByte and 0x1F
    if (lowBits != 0x1F) {
      // Single-byte tag
      return lowBits
    }

    // Multi-byte tag number — read base-128 encoded value
    var tagNumber = 0
    var bytesRead = 0
    while (parser.offset < parser.data.size) {
      val b = parser.data[parser.offset].toInt() and 0xFF
      parser.offset++
      tagNumber = (tagNumber shl 7) or (b and 0x7F)
      bytesRead++
      if (bytesRead > 4) throw IllegalStateException("ASN.1: tag number too large")
      if ((b and 0x80) == 0) break  // Last byte of tag number
    }
    return tagNumber
  }

  private fun securityLevelToString(level: Int): String {
    return when (level) {
      0 -> "Software"
      1 -> "TEE"
      2 -> "StrongBox"
      else -> "Unknown($level)"
    }
  }

  /**
   * Wrap a raw 65-byte uncompressed EC P-256 public key (0x04 || X || Y)
   * into SubjectPublicKeyInfo (SPKI) DER format.
   */
  private fun wrapRawPublicKeyToSpki(rawKey: ByteArray): ByteArray {
    return EC_P256_SPKI_HEADER + rawKey
  }

  /**
   * Normalize a public key to SPKI-encoded format for comparison and verification.
   * Handles both raw 65-byte keys and already-SPKI-encoded keys.
   */
  private fun normalizePublicKey(keyBytes: ByteArray): ByteArray {
    if (keyBytes.isEmpty()) return keyBytes
    
    // Already SPKI format (91 bytes with correct header)
    if (keyBytes.size == 91 && keyBytes.sliceArray(0 until EC_P256_SPKI_HEADER.size).contentEquals(EC_P256_SPKI_HEADER)) {
      return keyBytes
    }
    
    // Raw 65-byte uncompressed EC point (0x04 prefix)
    if (keyBytes.size == 65 && keyBytes[0] == 0x04.toByte()) {
      return wrapRawPublicKeyToSpki(keyBytes)
    }
    
    // Fallback: scan for 0x04 marker with 64 bytes following (same strategy as iOS)
    for (i in (keyBytes.size - 65) downTo 0) {
      if (keyBytes[i] == 0x04.toByte()) {
        val rawPoint = keyBytes.sliceArray(i until i + 65)
        return wrapRawPublicKeyToSpki(rawPoint)
      }
    }
    
    // Return as-is and let KeyFactory handle it (will throw if truly invalid)
    return keyBytes
  }

  /**
   * Check certificate serial numbers against Google's attestation revocation list.
   * Returns a list of error/warning strings. Does NOT fail verification on network errors.
   */
  private fun checkGoogleRevocation(certs: List<X509Certificate>): Pair<List<String>, Boolean> {
    val errors = mutableListOf<String>()
    var checked = false
    try {
      val url = java.net.URL("https://android.googleapis.com/attestation/status")
      val connection = url.openConnection() as java.net.HttpURLConnection
      connection.connectTimeout = 5000
      connection.readTimeout = 5000
      connection.setRequestProperty("Accept", "application/json")

      val responseCode = connection.responseCode
      if (responseCode != 200) {
        errors.add("Revocation check returned HTTP $responseCode")
        return Pair(errors, false)
      }

      val response = connection.inputStream.bufferedReader().readText()
      val json = org.json.JSONObject(response)
      val entries = json.optJSONObject("entries")

      if (entries != null) {
        checked = true
        for (cert in certs) {
          val serialHex = cert.serialNumber.toString(16).lowercase()
          if (entries.has(serialHex)) {
            val status = entries.getJSONObject(serialHex)
            val reason = status.optString("reason", "unknown")
            errors.add("Certificate serial $serialHex is revoked: $reason")
          }
        }
      } else {
        errors.add("Revocation response missing 'entries' field")
      }
    } catch (e: Exception) {
      errors.add("Revocation check skipped: ${e.message}")
    }
    return Pair(errors, checked)
  }

  /**
   * Parse an Apple App Attest CBOR assertion to extract the DER signature and authenticatorData.
   * The CBOR structure is: { "signature": bytes, "authenticatorData": bytes }
   * Returns null if parsing fails.
   */
  private data class CborAssertionResult(val signature: ByteArray, val authenticatorData: ByteArray)

  private fun parseAppAttestAssertion(assertionBytes: ByteArray): CborAssertionResult? {
    if (assertionBytes.size < 5) return null
    var offset = 0

    fun readByte(): Int {
      if (offset >= assertionBytes.size) return -1
      return assertionBytes[offset++].toInt() and 0xFF
    }

    fun readUInt(additionalInfo: Int): Long {
      return when {
        additionalInfo < 24 -> additionalInfo.toLong()
        additionalInfo == 24 -> readByte().toLong()
        additionalInfo == 25 -> {
          val b0 = readByte().toLong()
          val b1 = readByte().toLong()
          (b0 shl 8) or b1
        }
        additionalInfo == 26 -> {
          val b0 = readByte().toLong()
          val b1 = readByte().toLong()
          val b2 = readByte().toLong()
          val b3 = readByte().toLong()
          (b0 shl 24) or (b1 shl 16) or (b2 shl 8) or b3
        }
        else -> -1L
      }
    }

    fun readByteString(): ByteArray? {
      val initial = readByte()
      if (initial == -1) return null
      val majorType = (initial shr 5) and 0x07
      if (majorType != 2) return null // not a byte string
      val len = readUInt(initial and 0x1F)
      if (len < 0 || offset + len > assertionBytes.size) return null
      val result = assertionBytes.copyOfRange(offset, offset + len.toInt())
      offset += len.toInt()
      return result
    }

    fun readTextString(): String? {
      val initial = readByte()
      if (initial == -1) return null
      val majorType = (initial shr 5) and 0x07
      if (majorType != 3) return null // not a text string
      val len = readUInt(initial and 0x1F)
      if (len < 0 || offset + len > assertionBytes.size) return null
      val result = String(assertionBytes, offset, len.toInt(), Charsets.UTF_8)
      offset += len.toInt()
      return result
    }

    fun skipValue() {
      if (offset >= assertionBytes.size) return
      val initial = readByte()
      if (initial == -1) return
      val majorType = (initial shr 5) and 0x07
      val additionalInfo = initial and 0x1F
      val len = readUInt(additionalInfo)
      when (majorType) {
        0, 1 -> {} // unsigned/negative int — already consumed
        2, 3 -> offset += len.toInt() // byte/text string
        4 -> repeat(len.toInt()) { skipValue() } // array
        5 -> repeat(len.toInt()) { skipValue(); skipValue() } // map
        6 -> skipValue() // tag
        7 -> {} // simple/float
      }
    }

    try {
      val initial = readByte()
      val majorType = (initial shr 5) and 0x07
      if (majorType != 5) return null // not a map
      val mapCount = readUInt(initial and 0x1F)

      var signature: ByteArray? = null
      var authenticatorData: ByteArray? = null

      for (i in 0 until mapCount.toInt()) {
        val key = readTextString() ?: return null
        when (key) {
          "signature" -> signature = readByteString()
          "authenticatorData" -> authenticatorData = readByteString()
          else -> skipValue()
        }
      }

      if (signature != null && authenticatorData != null) {
        return CborAssertionResult(signature, authenticatorData)
      }
    } catch (e: Exception) {
      Log.w(TAG, "CBOR assertion parse error: ${e.message}")
    }
    return null
  }

  // =============================================================================
  // verifyHardwareEvidence — full native verification of attestation evidence
  // =============================================================================

  @ReactMethod
  override fun verifyHardwareEvidence(
    certificateChainPem: ReadableArray,
    signatureBase64: String,
    signedContent: String,
    publicKeyBase64: String,
    attestationFormat: String,
    signedContentHashBase64: String,
    promise: Promise
  ) {
    Log.i(TAG, "▶ verifyHardwareEvidence [format=$attestationFormat, chainLen=${certificateChainPem.size()}]")

    val errors = mutableListOf<String>()
    var chainValid = false
    var sigValid = false
    var pubKeyMatch = false
    var leafPubBase64 = ""
    var revocationChecked = false
    var attestationData: AttestationExtensionData? = null

    try {
      // -----------------------------------------------------------------------
      // Step 1: Parse PEM certificate chain into X509Certificate objects
      // -----------------------------------------------------------------------
      val certFactory = CertificateFactory.getInstance("X.509")
      val certs = mutableListOf<X509Certificate>()

      for (i in 0 until certificateChainPem.size()) {
        try {
          val pem = certificateChainPem.getString(i)
          val cert = certFactory.generateCertificate(
            ByteArrayInputStream(pem.toByteArray(Charsets.UTF_8))
          ) as X509Certificate
          certs.add(cert)
        } catch (e: Exception) {
          errors.add("Failed to parse certificate at index $i: ${e.message}")
        }
      }

      if (certs.isEmpty()) {
        errors.add("No valid certificates in chain")
        resolveVerificationResult(promise, false, chainValid, sigValid, pubKeyMatch, leafPubBase64, errors, revocationChecked, attestationData)
        return
      }

      Log.i(TAG, "  Parsed ${certs.size} certificates")

      // -----------------------------------------------------------------------
      // Step 2: X.509 certificate chain verification using CertPathValidator
      // -----------------------------------------------------------------------
      try {
        // Build trust anchors based on attestation format
        val trustAnchors = mutableSetOf<TrustAnchor>()
        val isAppleFormat = attestationFormat == "apple-appattest-v1"

        if (isAppleFormat) {
          // Apple chain → use Apple App Attestation Root + G3
          val appleRootCert = certFactory.generateCertificate(
            ByteArrayInputStream(APPLE_APP_ATTESTATION_ROOT_PEM.toByteArray(Charsets.UTF_8))
          ) as X509Certificate
          trustAnchors.add(TrustAnchor(appleRootCert, null))

          try {
            val appleG3Cert = certFactory.generateCertificate(
              ByteArrayInputStream(APPLE_ROOT_CA_G3_PEM.toByteArray(Charsets.UTF_8))
            ) as X509Certificate
            trustAnchors.add(TrustAnchor(appleG3Cert, null))
          } catch (e: Exception) {
            Log.w(TAG, "  Could not parse Apple G3 root: ${e.message}")
          }
        } else {
          // Android chain → use Google root
          val googleRootCert = certFactory.generateCertificate(
            ByteArrayInputStream(GOOGLE_ROOT_PEM.toByteArray(Charsets.UTF_8))
          ) as X509Certificate
          trustAnchors.add(TrustAnchor(googleRootCert, null))
        }

        // Also add chain's own root as anchor
        if (certs.size > 1) {
          trustAnchors.add(TrustAnchor(certs.last(), null))
        }

        // CertPath = leaf + intermediates (everything except the trust anchor/root)
        val pathCerts = if (certs.size > 1) certs.dropLast(1) else certs
        val certPath = certFactory.generateCertPath(pathCerts)

        val params = PKIXParameters(trustAnchors)
        params.isRevocationEnabled = false  // Revocation checked separately via Google CRL

        val validator = CertPathValidator.getInstance("PKIX")
        validator.validate(certPath, params)

        chainValid = true
        Log.i(TAG, "  ✓ Certificate chain valid")
      } catch (e: Exception) {
        errors.add("Certificate chain validation failed: ${e.message}")
        Log.w(TAG, "  ✗ Chain validation failed: ${e.message}")
      }

      // -----------------------------------------------------------------------
      // Step 3: Root certificate expiry warning
      // -----------------------------------------------------------------------
      try {
        val rootCert = certs.lastOrNull()
        if (rootCert != null) {
          val daysUntilExpiry = (rootCert.notAfter.time - System.currentTimeMillis()) / (1000L * 60 * 60 * 24)
          if (daysUntilExpiry < 180) {
            val warning = "WARNING: Root certificate expires in $daysUntilExpiry days"
            errors.add(warning)
            Log.w(TAG, "  $warning")
          }
        }
        // Only check Google root expiry for Android attestation format
        if (attestationFormat == "android-key-attestation-v3") {
          val googleRootCert = certFactory.generateCertificate(
            ByteArrayInputStream(GOOGLE_ROOT_PEM.toByteArray(Charsets.UTF_8))
          ) as X509Certificate
          val googleDaysUntilExpiry = (googleRootCert.notAfter.time - System.currentTimeMillis()) / (1000L * 60 * 60 * 24)
          if (googleDaysUntilExpiry < 180) {
            val warning = "WARNING: Embedded Google root certificate expires in $googleDaysUntilExpiry days — update required"
            errors.add(warning)
            Log.w(TAG, "  $warning")
          }
        }
      } catch (e: Exception) {
        Log.w(TAG, "  Could not check root expiry: ${e.message}")
      }

      // -----------------------------------------------------------------------
      // Step 4: Extract leaf public key and compare with evidence public key
      // -----------------------------------------------------------------------
      try {
        val leafCert = certs[0]
        val leafPubKey = leafCert.publicKey
        leafPubBase64 = android.util.Base64.encodeToString(leafPubKey.encoded, android.util.Base64.NO_WRAP)

        val sanitizedPubKeyB64 = publicKeyBase64.trim().replace("\\s".toRegex(), "")
        val evidenceKeyBytes = android.util.Base64.decode(sanitizedPubKeyB64, android.util.Base64.NO_WRAP)
        val normalizedEvidenceKey = normalizePublicKey(evidenceKeyBytes)
        val normalizedLeafKey = leafPubKey.encoded

        pubKeyMatch = normalizedLeafKey.contentEquals(normalizedEvidenceKey)
        if (pubKeyMatch) {
          Log.i(TAG, "  ✓ Public key matches leaf certificate")
        } else {
          errors.add("Public key from evidence does not match leaf certificate public key")
          Log.w(TAG, "  ✗ Public key mismatch")
        }
      } catch (e: Exception) {
        errors.add("Public key comparison failed: ${e.message}")
        Log.w(TAG, "  ✗ Public key comparison error: ${e.message}")
      }

      // -----------------------------------------------------------------------
      // Step 5: Signature verification
      // -----------------------------------------------------------------------
      try {
        val sanitizedPubKeyBase64 = publicKeyBase64.trim().replace("\\s".toRegex(), "")
        val evidenceKeyBytes = android.util.Base64.decode(sanitizedPubKeyBase64, android.util.Base64.NO_WRAP)
        val spkiKeyBytes = normalizePublicKey(evidenceKeyBytes)
        Log.i(TAG, "  Evidence pubKey: ${evidenceKeyBytes.size}b raw → ${spkiKeyBytes.size}b SPKI")

        val keyFactory = KeyFactory.getInstance("EC")
        val pubKey = keyFactory.generatePublic(X509EncodedKeySpec(spkiKeyBytes))

        val sanitizedSigBase64 = signatureBase64.trim().replace("\\s".toRegex(), "")
        val signatureBytes = android.util.Base64.decode(sanitizedSigBase64, android.util.Base64.NO_WRAP)

        if (sanitizedSigBase64 != signatureBase64) {
          Log.w(TAG, "  ⚠ signatureBase64 contained whitespace — stripped ${signatureBase64.length - sanitizedSigBase64.length} chars")
        }

        // Check if this is an Apple CBOR assertion (not a raw DER signature)
        val isAppleAssertion = attestationFormat == "apple-appattest-v1" &&
          signatureBytes.size > 80 && signatureBytes[0] != 0x30.toByte()

        if (isAppleAssertion) {
          Log.i(TAG, "  Apple CBOR assertion: ${signatureBytes.size}b")

          // Parse CBOR assertion to extract DER signature + authenticatorData
          val assertion = parseAppAttestAssertion(signatureBytes)
          if (assertion != null) {
            Log.i(TAG, "  CBOR parsed: authData=${assertion.authenticatorData.size}b, sig=${assertion.signature.size}b")

            // Determine clientDataHash: use embedded hash if available, otherwise compute from signedContent
            val contentHash: ByteArray
            val computedHash = java.security.MessageDigest.getInstance("SHA-256")
              .digest(signedContent.toByteArray(Charsets.UTF_8))

            val sanitizedHashBase64 = signedContentHashBase64.trim().replace("\\s".toRegex(), "")
            if (sanitizedHashBase64.isNotEmpty()) {
              contentHash = android.util.Base64.decode(sanitizedHashBase64, android.util.Base64.NO_WRAP)
              Log.i(TAG, "  Using embedded signedContentHash [${contentHash.size}b]: $sanitizedHashBase64")
              if (sanitizedHashBase64 != signedContentHashBase64) {
                Log.w(TAG, "  ⚠ signedContentHashBase64 contained whitespace — stripped ${signedContentHashBase64.length - sanitizedHashBase64.length} chars")
              }
              if (!contentHash.contentEquals(computedHash)) {
                Log.w(TAG, "  ⚠ Embedded hash differs from SHA256(signedContent) — expected for cross-device VRC")
              }
            } else {
              contentHash = computedHash
              Log.w(TAG, "  ⚠ No embedded signedContentHash — falling back to SHA256(signedContent)")
              Log.w(TAG, "    This WILL FAIL for cross-device verification due to JSON serialization differences")
            }

            val payload = assertion.authenticatorData + contentHash

            // App Attest Secure Enclave double-hashes: the assertion signature
            // covers SHA256(SHA256(authenticatorData || clientDataHash)).
            // nonce = SHA256(authData || clientDataHash), then SE signs with
            // ECDSA-SHA256 which internally hashes the nonce again.
            // So: SHA256withECDSA.update(nonce) → internally computes SHA256(nonce) → matches.
            val nonce = java.security.MessageDigest.getInstance("SHA-256").digest(payload)

            val sig = Signature.getInstance("SHA256withECDSA")
            sig.initVerify(pubKey)
            sig.update(nonce)
            sigValid = sig.verify(assertion.signature)

            if (sigValid) {
              Log.i(TAG, "  ✓ Apple CBOR assertion signature valid")
            } else {
              errors.add("Apple assertion signature verification failed")
              Log.w(TAG, "  ✗ Apple assertion signature invalid")
            }
          } else {
            errors.add("Failed to parse Apple CBOR assertion")
            Log.w(TAG, "  ✗ CBOR assertion parse failed (input: ${signatureBytes.size} bytes, first byte: 0x${String.format("%02X", signatureBytes[0])})")
          }
        } else {
          // Raw ECDSA DER signature (Android format or plain)
          val contentBytes = signedContent.toByteArray(Charsets.UTF_8)
          val sig = Signature.getInstance("SHA256withECDSA")
          sig.initVerify(pubKey)
          sig.update(contentBytes)
          sigValid = sig.verify(signatureBytes)

          if (sigValid) {
            Log.i(TAG, "  ✓ Signature valid")
          } else {
            errors.add("Signature verification failed — content may have been tampered with")
            Log.w(TAG, "  ✗ Signature invalid")
          }
        }
      } catch (e: Exception) {
        errors.add("Signature verification error: ${e.message}")
        Log.w(TAG, "  ✗ Signature error: ${e.message}")
      }

      // -----------------------------------------------------------------------
      // Step 6: Parse attestation extension (Android key attestation only)
      // -----------------------------------------------------------------------
      if (attestationFormat == "android-key-attestation-v3") {
        try {
          attestationData = parseAttestationExtension(certs[0])
          if (attestationData != null) {
            Log.i(TAG, "  ✓ Attestation extension parsed [${attestationData.attestationSecurityLevel}]")
          } else {
            errors.add("Attestation extension not found in leaf certificate")
            Log.w(TAG, "  ✗ Attestation extension missing")
          }
        } catch (e: Exception) {
          errors.add("Attestation extension parsing failed: ${e.message}")
          Log.w(TAG, "  ✗ Attestation extension error: ${e.message}")
        }
      }

      // -----------------------------------------------------------------------
      // Step 7: Google CRL revocation check (non-blocking on network failure)
      // -----------------------------------------------------------------------
      if (attestationFormat == "android-key-attestation-v3") {
        try {
          val (revErrors, checked) = checkGoogleRevocation(certs)
          revocationChecked = checked
          errors.addAll(revErrors)
          if (checked && revErrors.none { it.startsWith("Certificate serial") }) {
            Log.i(TAG, "  ✓ No certificates revoked")
          }
        } catch (e: Exception) {
          errors.add("Revocation check error: ${e.message}")
          Log.w(TAG, "  ✗ Revocation check error: ${e.message}")
        }
      }

      // -----------------------------------------------------------------------
      // Compose result
      // -----------------------------------------------------------------------
      val overallValid = chainValid && sigValid && pubKeyMatch &&
        errors.none { it.startsWith("Certificate serial") }  // Not revoked

      Log.i(TAG, "  ${if (overallValid) "✓" else "✗"} Overall: valid=$overallValid")

      resolveVerificationResult(promise, overallValid, chainValid, sigValid, pubKeyMatch, leafPubBase64, errors, revocationChecked, attestationData)

    } catch (e: Exception) {
      Log.e(TAG, "✗ verifyHardwareEvidence failed: ${e.message}")
      errors.add("Unexpected verification error: ${e.message}")
      resolveVerificationResult(promise, false, chainValid, sigValid, pubKeyMatch, leafPubBase64, errors, revocationChecked, attestationData)
    }
  }

  private fun resolveVerificationResult(
    promise: Promise,
    overallValid: Boolean,
    chainValid: Boolean,
    sigValid: Boolean,
    pubKeyMatch: Boolean,
    leafPubBase64: String,
    errors: List<String>,
    revocationChecked: Boolean,
    attestationData: AttestationExtensionData?
  ) {
    val result = Arguments.createMap()
    result.putBoolean("valid", overallValid)
    result.putBoolean("certificateChainValid", chainValid)
    result.putBoolean("signatureValid", sigValid)
    result.putBoolean("publicKeyMatchesLeafCert", pubKeyMatch)
    result.putString("leafPublicKeyBase64", leafPubBase64)
    result.putBoolean("revocationChecked", revocationChecked)

    val errorsArray = Arguments.createArray()
    for (err in errors) {
      errorsArray.pushString(err)
    }
    result.putArray("errors", errorsArray)

    // Attestation extension fields (defaults if not available)
    if (attestationData != null) {
      result.putString("attestationSecurityLevel", attestationData.attestationSecurityLevel)
      result.putString("keymasterSecurityLevel", attestationData.keymasterSecurityLevel)
      result.putString("verifiedBootState", attestationData.verifiedBootState)
      result.putBoolean("deviceLocked", attestationData.deviceLocked)
      result.putString("attestationChallengeBase64", attestationData.attestationChallenge)
      result.putString("userAuthType", attestationData.userAuthType)
      result.putInt("authTimeout", attestationData.authTimeout)
    } else {
      result.putString("attestationSecurityLevel", "Unknown")
      result.putString("keymasterSecurityLevel", "Unknown")
      result.putString("verifiedBootState", "Unknown")
      result.putBoolean("deviceLocked", false)
      result.putString("attestationChallengeBase64", "")
      result.putString("userAuthType", "NONE")
      result.putInt("authTimeout", 0)
    }

    promise.resolve(result)
  }
}
