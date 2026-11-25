package com.attestation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GoogleAttestationRootsTest {
  @Test
  fun parseRootCertificates_returnsAllThreePublishedRoots() {
    val roots = GoogleAttestationRoots.parseRootCertificates()
    assertEquals(3, roots.size)
  }

  @Test
  fun isRecognizedGoogleRoot_recognizesEachEmbeddedRoot() {
    GoogleAttestationRoots.parseRootCertificates().forEach { root ->
      assertTrue(GoogleAttestationRoots.isRecognizedGoogleRoot(root))
    }
  }

  @Test
  fun daysUntilEarliestRootExpiry_reflectsEarliestEmbeddedRoot() {
    val days = GoogleAttestationRoots.daysUntilEarliestRootExpiry()
    assertNotNull(days)
    val now = System.currentTimeMillis()
    val expectedMin =
      GoogleAttestationRoots.parseRootCertificates()
        .map { (it.notAfter.time - now) / (1000L * 60 * 60 * 24) }
        .minOrNull()
    assertEquals(expectedMin, days)
    // Legacy factory RSA root (first) expired 2026-05-24; resigned RSA and RKP roots remain valid.
    assertTrue(GoogleAttestationRoots.parseRootCertificates().drop(1).isNotEmpty())
  }
}
