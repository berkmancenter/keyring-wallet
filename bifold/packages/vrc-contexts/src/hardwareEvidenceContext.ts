/**
 * Hardware-attestation evidence context for VC 2.0 VRCs.
 *
 * Defines the terms of the `evidence` block the wallet attaches to a VRC when
 * the signing key lives in secure hardware (Secure Enclave / StrongBox): the
 * evidence types, `created`, and the opaque envelope members
 * `authenticationMethod`, `biometricMethod`, `hardwareBinding`, `attestation`
 * and `signature`. The shape is produced by HardwareEvidenceBuilder in
 * `@bifold/core` (`src/hardware-signing/evidence.ts`).
 *
 * Design:
 * - No `@vocab`. Every member is an explicit term, so a misspelled or unknown
 *   member of the evidence block is rejected by JSON-LD safe-mode signing
 *   instead of being silently signed under a catch-all vocabulary.
 * - Members are `@type: @json`. Their contents (certificate chains, key
 *   material, signature bytes) are an opaque literal, canonicalized with JCS
 *   (RFC 8785), so array order — the leaf/intermediate/root certificate chain
 *   order — is preserved exactly. Plain JSON-LD arrays are unordered sets and
 *   would not preserve it.
 * - The member terms are scoped to `HardwareKeyAttestation` (every evidence
 *   block the wallet emits carries that type alongside
 *   `BiometricAttestation` or `DeviceAuthentication`).
 *
 * PROVISIONAL IRI: this context is not published by, or agreed with, the
 * owners of `www.firstperson.network`; the IRI and the namespace below were
 * chosen to follow the convention of the other Keyring contexts in this
 * package (`<base>/<name>/v1`, terms under `<base>/<name>#`) while the editors
 * of the DTG credential specifications settle where, and whether, a
 * hardware-evidence vocabulary is published upstream. Both strings live only
 * in HARDWARE_EVIDENCE_CONTEXT_URL and HARDWARE_EVIDENCE_NAMESPACE here, so
 * re-pointing them is a one-place change. The document is bundled by every
 * document loader and resolved offline; nothing dereferences the IRI.
 * Credentials issued against the provisional IRI carry it in `@context` and
 * would need that IRI to keep resolving locally for as long as they verify.
 */
export const HARDWARE_EVIDENCE_CONTEXT_URL = 'https://www.firstperson.network/hardware-evidence/v1'

/** Term namespace for HARDWARE_EVIDENCE_CONTEXT_DOCUMENT. Provisional, see above. */
export const HARDWARE_EVIDENCE_NAMESPACE = 'https://www.firstperson.network/hardware-evidence#'

const XSD_DATETIME = 'http://www.w3.org/2001/XMLSchema#dateTime'
const DCTERMS_CREATED = 'http://purl.org/dc/terms/created'

export const HARDWARE_EVIDENCE_CONTEXT_DOCUMENT = {
  '@context': {
    '@version': 1.1,
    '@protected': true,
    BiometricAttestation: `${HARDWARE_EVIDENCE_NAMESPACE}BiometricAttestation`,
    DeviceAuthentication: `${HARDWARE_EVIDENCE_NAMESPACE}DeviceAuthentication`,
    HardwareKeyAttestation: {
      '@id': `${HARDWARE_EVIDENCE_NAMESPACE}HardwareKeyAttestation`,
      '@context': {
        '@version': 1.1,
        '@protected': true,
        created: { '@id': DCTERMS_CREATED, '@type': XSD_DATETIME },
        authenticationMethod: { '@id': `${HARDWARE_EVIDENCE_NAMESPACE}authenticationMethod`, '@type': '@json' },
        biometricMethod: { '@id': `${HARDWARE_EVIDENCE_NAMESPACE}biometricMethod`, '@type': '@json' },
        hardwareBinding: { '@id': `${HARDWARE_EVIDENCE_NAMESPACE}hardwareBinding`, '@type': '@json' },
        attestation: { '@id': `${HARDWARE_EVIDENCE_NAMESPACE}attestation`, '@type': '@json' },
        signature: { '@id': `${HARDWARE_EVIDENCE_NAMESPACE}signature`, '@type': '@json' },
      },
    },
  },
}
