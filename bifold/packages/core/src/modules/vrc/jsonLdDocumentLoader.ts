import {
  DTG_CONTEXT_URL,
  DTG_CONTEXT_DOCUMENT,
  RELATIONSHIP_CONTEXT_URL,
  RELATIONSHIP_CONTEXT_DOCUMENT,
  RCARD_CONTEXT_URL,
  RCARD_CONTEXT_DOCUMENT,
} from './types/relationshipContext'
import { WITNESSED_EXCHANGE_CONTEXT_URL, WITNESSED_EXCHANGE_CONTEXT_DOCUMENT } from './types/witnessedExchangeContext'
import { CREDENTIALS_V2_CONTEXT_URL, CREDENTIALS_V2_CONTEXT_DOCUMENT } from '@bifold/vrc-contexts'

/**
 * Custom contexts for W3C VC 2.0 compliant credentials
 * These contexts are registered with the Credo document loader to resolve locally
 *
 * DTG_CONTEXT: Base credential type context
 * RELATIONSHIP_CONTEXT: RelationshipCredential context
 * WITNESSED_EXCHANGE_CONTEXT: WitnessedCredential context (VWC)
 *
 * To use: Import these objects and spread them into your document loader contexts
 * Example:
 *   const CUSTOM_CONTEXTS = {
 *     ...DTG_CONTEXT,
 *     ...RELATIONSHIP_CONTEXT,
 *     ...WITNESSED_EXCHANGE_CONTEXT
 *   }
 */
export const DTG_CONTEXT = {
  [DTG_CONTEXT_URL]: DTG_CONTEXT_DOCUMENT,
}

export const RELATIONSHIP_CONTEXT = {
  [RELATIONSHIP_CONTEXT_URL]: RELATIONSHIP_CONTEXT_DOCUMENT,
}

export const WITNESSED_EXCHANGE_CONTEXT = {
  [WITNESSED_EXCHANGE_CONTEXT_URL]: WITNESSED_EXCHANGE_CONTEXT_DOCUMENT,
}

export const RCARD_CONTEXT = {
  [RCARD_CONTEXT_URL]: RCARD_CONTEXT_DOCUMENT,
}

// W3C VCDM 2.0 base context — bundled because credo's offline cache only
// ships the v1.1 credentials context
export const CREDENTIALS_V2_CONTEXT = {
  [CREDENTIALS_V2_CONTEXT_URL]: CREDENTIALS_V2_CONTEXT_DOCUMENT,
}

// Combined export for convenience
export const CUSTOM_CONTEXTS = {
  ...DTG_CONTEXT,
  ...RELATIONSHIP_CONTEXT,
  ...WITNESSED_EXCHANGE_CONTEXT,
  ...RCARD_CONTEXT,
  ...CREDENTIALS_V2_CONTEXT,
}

// Re-export URL constants for use in other modules
export {
  DTG_CONTEXT_URL,
  RELATIONSHIP_CONTEXT_URL,
  WITNESSED_EXCHANGE_CONTEXT_URL,
  RCARD_CONTEXT_URL,
  CREDENTIALS_V2_CONTEXT_URL,
}
