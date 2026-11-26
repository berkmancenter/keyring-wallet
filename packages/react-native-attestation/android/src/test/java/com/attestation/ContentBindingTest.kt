package com.attestation

import java.security.MessageDigest
import java.util.Base64
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class ContentBindingTest {
  private val content = """{"@context":["a"],"type":["VerifiableCredential"]}""".toByteArray(Charsets.UTF_8)
  private fun sha(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b)
  private fun b64(b: ByteArray) = Base64.getEncoder().encodeToString(b)

  private fun ok(r: ContentBinding.Result): ByteArray =
    (r as? ContentBinding.Result.Ok)?.hash ?: fail("expected Ok, got ${(r as ContentBinding.Result.Fail).error}").let { ByteArray(0) }

  private fun failure(r: ContentBinding.Result): String =
    (r as? ContentBinding.Result.Fail)?.error ?: fail("expected Fail").let { "" }

  @Test
  fun suppliedHashEqual_returnsComputedHash() {
    assertArrayEquals(sha(content), ok(ContentBinding.resolveClientDataHash(content, b64(sha(content)))))
  }

  @Test
  fun suppliedHashWithWhitespace_isSanitizedAndAccepted() {
    val s = b64(sha(content))
    assertArrayEquals(sha(content), ok(ContentBinding.resolveClientDataHash(content, " ${s.substring(0, 10)}\n${s.substring(10)} ")))
  }

  @Test
  fun suppliedHashAbsent_usesComputedHash() {
    assertArrayEquals(sha(content), ok(ContentBinding.resolveClientDataHash(content, "")))
  }

  @Test
  fun suppliedHashOfOtherContent_isMismatch() {
    val err = failure(ContentBinding.resolveClientDataHash(content, b64(sha("other".toByteArray()))))
    assertTrue(err.startsWith(ContentBinding.MISMATCH_PREFIX))
  }

  @Test
  fun suppliedHashWrongLength_isMismatchNotSilentFallback() {
    val err = failure(ContentBinding.resolveClientDataHash(content, b64(ByteArray(16))))
    assertTrue(err.startsWith(ContentBinding.MISMATCH_PREFIX))
  }

  @Test
  fun suppliedHashUndecodable_isMismatch() {
    val err = failure(ContentBinding.resolveClientDataHash(content, "!!not base64!!"))
    assertTrue(err.startsWith(ContentBinding.MISMATCH_PREFIX))
  }

  @Test
  fun emptyContent_isRejectedEvenWithMatchingHash() {
    val err = failure(ContentBinding.resolveClientDataHash(ByteArray(0), b64(sha(ByteArray(0)))))
    assertTrue(err.contains("signedContent is required"))
  }

  @Test
  fun emptyContentAndNoHash_isRejected() {
    failure(ContentBinding.resolveClientDataHash(ByteArray(0), ""))
  }
}
