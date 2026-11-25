package com.attestation

import java.security.PublicKey
import java.security.cert.X509Certificate
import java.util.Date
import javax.security.auth.x500.X500Principal

/**
 * Validation for Android key attestation certificate chains.
 *
 * This ports the chain rules of Google's android/keyattestation verifier rather
 * than running plain PKIX at the current time, which wrongly rejects genuine
 * factory-provisioned chains once the legacy root's validity has lapsed
 * (the legacy root expired 2026-05-24; Google's guidance is to keep trusting
 * chains that terminate in the root with SERIALNUMBER=f92009e853b6b045).
 *
 * Rules:
 * - The chain must terminate in (or be signed by) a published Google root. A
 *   root is matched by subject AND public key, never by serial number alone and
 *   never by trusting whatever certificate happens to be last.
 * - Every certificate must be signed by the next one; each issuer/subject must
 *   line up; every non-leaf certificate must be a CA.
 * - The leaf's validity period is not checked (it is the attested key's own
 *   certificate and its validity comes from key parameters).
 * - Factory chains (root subject SERIALNUMBER=f92009e853b6b045): expiry is
 *   ignored for the rest of the chain, because those devices cannot be
 *   re-provisioned. A certificate that is not yet valid still fails.
 * - RKP chains (any other Google root): the full validity period of every
 *   non-leaf certificate is enforced.
 */
object GoogleAttestationChainValidator {
  data class Result(val valid: Boolean, val error: String? = null)

  /** Subject of the legacy/re-signed factory roots (they share subject and key). */
  val FACTORY_ROOT_SUBJECT = X500Principal("SERIALNUMBER=f92009e853b6b045")

  fun validateChain(
    certs: List<X509Certificate>,
    anchors: List<X509Certificate> = GoogleAttestationRoots.parseRootCertificates(),
    now: Date = Date(),
  ): Result {
    if (certs.isEmpty()) {
      return Result(false, "No certificates in chain")
    }

    val last = certs.last()
    val lastAnchor = matchAnchor(last, anchors)

    // Certificates below the root, leaf first.
    val path: List<X509Certificate>
    val root: X509Certificate
    if (lastAnchor != null) {
      if (certs.size == 1) return Result(false, "No certificate path to validate")
      path = certs.dropLast(1)
      root = lastAnchor
      // A chain-supplied root must be self-signed with the anchor's key.
      if (!verifiesWith(last, lastAnchor.publicKey)) {
        return Result(false, "Root certificate signature is invalid")
      }
    } else {
      path = certs
      root =
        anchors.firstOrNull { it.subjectX500Principal == last.issuerX500Principal && verifiesWith(last, it.publicKey) }
          ?: return Result(false, "Certificate chain does not terminate in a recognized Google attestation root")
    }

    val factory = isFactoryRoot(root)

    // Signature and name linkage: path[i] is signed by path[i+1]; path.last() by root.
    for (i in path.indices) {
      val issuer = if (i + 1 < path.size) path[i + 1] else root
      if (path[i].issuerX500Principal != issuer.subjectX500Principal) {
        return Result(false, "Certificate ${i} issuer does not match its parent subject")
      }
      if (!verifiesWith(path[i], issuer.publicKey)) {
        return Result(false, "Certificate ${i} signature is invalid")
      }
    }

    // Non-leaf certificates must be CAs (path[0] is the leaf).
    for (i in 1 until path.size) {
      if (path[i].basicConstraints < 0) {
        return Result(false, "Certificate ${i} is not a CA")
      }
    }

    // Validity: skip the leaf; root and intermediates follow the factory/RKP rules.
    val checked = path.drop(1) + root
    for ((idx, cert) in checked.withIndex()) {
      if (now.before(cert.notBefore)) {
        return Result(false, "Certificate ${idx + 1} is not yet valid")
      }
      if (!factory && now.after(cert.notAfter)) {
        return Result(false, "Certificate ${idx + 1} has expired")
      }
    }

    return Result(true)
  }

  fun isFactoryRoot(root: X509Certificate): Boolean =
    root.subjectX500Principal == FACTORY_ROOT_SUBJECT

  private fun matchAnchor(cert: X509Certificate, anchors: List<X509Certificate>): X509Certificate? =
    anchors.firstOrNull {
      it.subjectX500Principal == cert.subjectX500Principal &&
        it.publicKey.encoded.contentEquals(cert.publicKey.encoded)
    }

  private fun verifiesWith(cert: X509Certificate, key: PublicKey): Boolean =
    try {
      cert.verify(key)
      true
    } catch (e: Exception) {
      false
    }
}
