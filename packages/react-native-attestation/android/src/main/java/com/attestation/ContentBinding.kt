package com.attestation

import java.security.MessageDigest

/**
 * Binds a hardware signature to the content a verifier holds.
 *
 * The verifier always recomputes SHA-256 of the signed content. A hash carried
 * in the evidence is only ever compared against that recomputation; it never
 * replaces it, because the evidence author chooses it.
 *
 * Kept free of Android and React Native types so it runs under plain JUnit.
 * Uses java.util.Base64: android.util.Base64 returns defaults under
 * `unitTests.returnDefaultValues = true`.
 */
object ContentBinding {
  /** Stable prefix JS matches on to map a binding failure to `signatureValid: false`. */
  const val MISMATCH_PREFIX = "contentBindingMismatch"

  sealed class Result {
    /** The recomputed SHA-256 of the content, to use as the App Attest clientDataHash. */
    class Ok(val hash: ByteArray) : Result()

    class Fail(val error: String) : Result()
  }

  /**
   * @param content the signed content bytes (UTF-8 of the reconstructed credential)
   * @param suppliedB64 a caller- or evidence-supplied base64 SHA-256, or empty when absent
   */
  fun resolveClientDataHash(content: ByteArray, suppliedB64: String): Result {
    if (content.isEmpty()) {
      return Result.Fail("signedContent is required: hardware evidence cannot be verified without the content it signs")
    }
    val computed = MessageDigest.getInstance("SHA-256").digest(content)

    val sanitized = suppliedB64.trim().replace("\\s".toRegex(), "")
    if (sanitized.isEmpty()) return Result.Ok(computed)

    val supplied =
      try {
        java.util.Base64.getDecoder().decode(sanitized)
      } catch (e: IllegalArgumentException) {
        return Result.Fail("$MISMATCH_PREFIX: supplied content hash is not valid base64")
      }
    if (supplied.size != computed.size || !MessageDigest.isEqual(supplied, computed)) {
      return Result.Fail("$MISMATCH_PREFIX: supplied content hash does not equal SHA-256 of the signed content")
    }
    return Result.Ok(computed)
  }
}
