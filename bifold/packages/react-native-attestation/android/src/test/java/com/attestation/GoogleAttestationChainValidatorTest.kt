package com.attestation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.ByteArrayInputStream
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate

class GoogleAttestationChainValidatorTest {
  private fun loadPem(resourcePath: String): X509Certificate {
    val stream =
      checkNotNull(javaClass.getResourceAsStream(resourcePath)) {
        "Missing test resource: $resourcePath"
      }
    val pem = stream.readBytes().toString(Charsets.UTF_8)
    val factory = CertificateFactory.getInstance("X.509")
    return factory.generateCertificate(ByteArrayInputStream(pem.toByteArray())) as X509Certificate
  }

  @Test
  fun validateChain_emptyList_fails() {
    val result = GoogleAttestationChainValidator.validateChain(emptyList())
    assertFalse(result.valid)
    assertEquals("No certificates in chain", result.error)
  }

  @Test
  fun validateChain_selfSignedRootOnly_fails() {
    val fake = loadPem("/fake_self_signed_root.pem")
    val result = GoogleAttestationChainValidator.validateChain(listOf(fake))
    assertFalse(result.valid)
  }

  @Test
  fun validateChain_selfSignedTerminalRoot_failsWithoutSelfAsAnchor() {
    // Regression: trusting certs.last() as an anchor let self-signed terminal roots pass.
    val fake = loadPem("/fake_self_signed_root.pem")
    val result = GoogleAttestationChainValidator.validateChain(listOf(fake, fake))
    assertFalse(result.valid)
  }

  @Test
  fun validateChain_googleRootOnly_failsWithoutPath() {
    val googleRoot = GoogleAttestationRoots.parseRootCertificates().first()
    val result = GoogleAttestationChainValidator.validateChain(listOf(googleRoot))
    assertFalse(result.valid)
    assertEquals("No certificate path to validate", result.error)
  }
}
