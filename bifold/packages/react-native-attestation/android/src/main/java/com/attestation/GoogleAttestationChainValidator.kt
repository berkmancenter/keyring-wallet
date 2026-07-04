package com.attestation

import java.security.cert.CertPathValidator
import java.security.cert.CertificateFactory
import java.security.cert.PKIXParameters
import java.security.cert.X509Certificate

/**
 * PKIX validation for Android key attestation certificate chains.
 *
 * Trust anchors are limited to published Google attestation roots only.
 * Chains must validate against those anchors — terminal certificates that are
 * not recognized Google roots are never accepted as trust anchors.
 */
object GoogleAttestationChainValidator {
  data class Result(val valid: Boolean, val error: String? = null)

  fun validateChain(certs: List<X509Certificate>): Result {
    if (certs.isEmpty()) {
      return Result(false, "No certificates in chain")
    }

    val trustAnchors = GoogleAttestationRoots.trustAnchors()
    val lastCert = certs.last()
    val lastIsGoogleRoot = GoogleAttestationRoots.isRecognizedGoogleRoot(lastCert)

    // When the chain ends with a published Google root, exclude it from the path
    // (it is already a trust anchor). A chain that is only a root has no leaf path.
    val pathCerts =
      when {
        lastIsGoogleRoot && certs.size > 1 -> certs.dropLast(1)
        lastIsGoogleRoot -> emptyList()
        else -> certs
      }

    if (pathCerts.isEmpty()) {
      return Result(false, "No certificate path to validate")
    }

    return try {
      val certFactory = CertificateFactory.getInstance("X.509")
      val certPath = certFactory.generateCertPath(pathCerts)
      val params = PKIXParameters(trustAnchors)
      params.isRevocationEnabled = false
      CertPathValidator.getInstance("PKIX").validate(certPath, params)
      Result(true)
    } catch (e: Exception) {
      Result(false, e.message ?: "Certificate chain validation failed")
    }
  }
}
