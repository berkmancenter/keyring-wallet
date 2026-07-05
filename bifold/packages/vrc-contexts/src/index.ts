/**
 * @bifold/vrc-contexts
 *
 * Single source of truth for JSON-LD context definitions used in VRC/VWC credentials.
 * Both mobile app and witness server import from this package to ensure consistent
 * JSON-LD canonicalization during signing and verification.
 */

// Relationship/DTG contexts (for VRCs)
export {
  DTG_CONTEXT_URL,
  DTG_CONTEXT_DOCUMENT,
  RELATIONSHIP_CONTEXT_URL,
  RELATIONSHIP_CONTEXT_DOCUMENT,
} from './relationshipContext'

// Witnessed Exchange context (for VWCs)
export {
  WITNESSED_EXCHANGE_CONTEXT_URL,
  WITNESSED_EXCHANGE_CONTEXT_DOCUMENT,
} from './witnessedExchangeContext'
