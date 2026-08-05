/**
 * @bifold/vrc-contexts
 *
 * Single source of truth for JSON-LD context definitions used in VRC/VWC credentials.
 * Both mobile app and witness server import from this package to ensure consistent
 * JSON-LD canonicalization during signing and verification.
 */

// Relationship/DTG contexts (for VRCs) and RCard context (exchanged contact card)
export {
  DTG_CONTEXT_URL,
  DTG_CONTEXT_DOCUMENT,
  RELATIONSHIP_CONTEXT_URL,
  RELATIONSHIP_CONTEXT_DOCUMENT,
  RCARD_CONTEXT_URL,
  RCARD_CONTEXT_DOCUMENT,
} from './relationshipContext'

// Witnessed Exchange context (for VWCs)
export {
  WITNESSED_EXCHANGE_CONTEXT_URL,
  WITNESSED_EXCHANGE_CONTEXT_DOCUMENT,
} from './witnessedExchangeContext'

// W3C VCDM 2.0 base context (bundled for offline resolution — credo's cache
// only ships the v1.1 credentials context)
export { CREDENTIALS_V2_CONTEXT_URL, CREDENTIALS_V2_CONTEXT_DOCUMENT } from './credentialsV2Context'

/**
 * Ed25519Signature2018 suite context URL.
 *
 * VCDM 2.0 credentials signed with Ed25519Signature2018 MUST include this in
 * their `@context` at build time: the v1.1 credentials context defined the
 * suite's proof terms, but the v2 context does not, so jsonld-signatures
 * appends this URL during signing. If it isn't already present, the signed
 * credential's `@context` no longer equals the offered/requested one and
 * credo's DIDComm holder-side equality check rejects the credential
 * ("Received credential does not match credential request").
 */
export const ED25519_2018_SUITE_CONTEXT_URL = 'https://w3id.org/security/suites/ed25519-2018/v1'

// Standard W3C / DID / security contexts pinned for offline resolution
// (extracted from credo's internal DEFAULT_CONTEXTS, which is not exported)
export { CACHED_STANDARD_CONTEXTS } from './cachedStandardContexts'

// JCS canonicalization (RFC 8785) — used for the VWC digest so wallet and
// witness-server compute identical hashes from the same VRC JSON
export { jcsCanonicalize } from './jcs'
