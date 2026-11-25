package com.attestation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.ByteArrayInputStream
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.time.Instant
import java.util.Date
import org.junit.Assert.assertTrue

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

  // ---- openssl-generated chains (see src/test/resources/gen-chains.sh) ----

  /** Fixed clock: all generated validity windows are relative to this instant. */
  private val now: Date = Date.from(Instant.parse("2026-09-30T00:00:00Z"))

  private class Chain(val root: X509Certificate, val inter: X509Certificate, val leaf: X509Certificate) {
    val full get() = listOf(leaf, inter, root)
    val withoutRoot get() = listOf(leaf, inter)
  }

  private fun chain(name: String) =
    Chain(
      loadPem("/chains/$name.root.pem"),
      loadPem("/chains/$name.int.pem"),
      loadPem("/chains/$name.leaf.pem"),
    )

  private fun validate(certs: List<X509Certificate>, anchor: X509Certificate) =
    GoogleAttestationChainValidator.validateChain(certs, listOf(anchor), now)

  @Test
  fun factoryChain_withExpiredLegacyRoot_isAccepted() {
    // Root, intermediate and leaf are all past notAfter; Google says to keep trusting it.
    val c = chain("factory_expired")
    assertTrue(c.root.notAfter.before(now))
    assertTrue(c.leaf.notAfter.before(now))
    assertTrue(validate(c.full, c.root).valid)
  }

  @Test
  fun factoryChain_withoutRootInChain_isAccepted() {
    val c = chain("factory_expired")
    assertTrue(validate(c.withoutRoot, c.root).valid)
  }

  @Test
  fun factoryChain_withValidRoot_isAccepted() {
    val c = chain("factory_valid")
    assertTrue(validate(c.full, c.root).valid)
  }

  @Test
  fun factoryChain_withNotYetValidIntermediate_fails() {
    val c = chain("factory_not_yet_valid")
    val r = validate(c.full, c.root)
    assertFalse(r.valid)
    assertTrue(r.error!!, r.error!!.contains("not yet valid"))
  }

  @Test
  fun rkpChain_withExpiredLeaf_isAccepted() {
    val c = chain("rkp_valid")
    assertTrue(c.leaf.notAfter.before(now))
    assertFalse(GoogleAttestationChainValidator.isFactoryRoot(c.root))
    assertTrue(validate(c.full, c.root).valid)
  }

  @Test
  fun rkpChain_withExpiredIntermediate_fails() {
    val c = chain("rkp_expired_intermediate")
    val r = validate(c.full, c.root)
    assertFalse(r.valid)
    assertTrue(r.error!!, r.error!!.contains("expired"))
  }

  @Test
  fun rkpChain_withExpiredRoot_fails() {
    val c = chain("rkp_expired_root")
    val r = validate(c.full, c.root)
    assertFalse(r.valid)
    assertTrue(r.error!!, r.error!!.contains("expired"))
  }

  @Test
  fun factoryRoot_isRecognisedBySubject() {
    assertTrue(GoogleAttestationChainValidator.isFactoryRoot(chain("factory_valid").root))
    assertTrue(GoogleAttestationRoots.parseRootCertificates().take(2).all { GoogleAttestationChainValidator.isFactoryRoot(it) })
    assertFalse(GoogleAttestationChainValidator.isFactoryRoot(GoogleAttestationRoots.parseRootCertificates().last()))
  }

  @Test
  fun tamperedLeaf_fails() {
    val c = chain("factory_valid")
    val bytes = c.leaf.encoded.copyOf()
    bytes[bytes.size - 1] = (bytes[bytes.size - 1].toInt() xor 0x01).toByte() // flip a signature bit
    val tampered =
      CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(bytes)) as X509Certificate
    val r = validate(listOf(tampered, c.inter, c.root), c.root)
    assertFalse(r.valid)
    assertTrue(r.error!!, r.error!!.contains("signature"))
  }

  @Test
  fun leafFromAnotherChain_fails() {
    val c = chain("factory_valid")
    val other = chain("imposter")
    assertFalse(validate(listOf(other.leaf, c.inter, c.root), c.root).valid)
  }

  @Test
  fun imposterRootWithSameSubjectButDifferentKey_fails() {
    // Matching on subject alone would accept this; the key must match too.
    val real = chain("factory_valid")
    val fake = chain("imposter")
    assertFalse(validate(fake.full, real.root).valid)
    assertFalse(validate(fake.withoutRoot, real.root).valid)
  }

  @Test
  fun unrelatedAnchors_fail() {
    val c = chain("rkp_valid")
    val r = GoogleAttestationChainValidator.validateChain(c.full, now = now)
    assertFalse(r.valid)
  }

  @Test
  fun nonCaIntermediate_fails() {
    val c = chain("factory_valid")
    // Leaf in the intermediate slot: it is not a CA.
    val r = validate(listOf(c.leaf, c.leaf, c.root), c.root)
    assertFalse(r.valid)
  }
}
