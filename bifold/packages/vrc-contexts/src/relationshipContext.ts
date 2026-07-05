/**
 * Custom JSON-LD contexts for W3C VC 2.0 compliant credentials
 *
 * DTGCredential: Base credential type with validFrom/validUntil
 * RelationshipCredential: Simplified relationship credential (inherits from DTGCredential)
 *
 * IMPORTANT: This is the SINGLE SOURCE OF TRUTH for these context definitions.
 * Both mobile app and witness server MUST import from this package to ensure
 * JSON-LD canonicalization produces identical results during signing and verification.
 */

// DTGCredential base context
export const DTG_CONTEXT_URL = 'https://www.firstperson.network/dtg/v1'

export const DTG_CONTEXT_DOCUMENT = {
  '@context': {
    '@version': 1.1,
    '@protected': true,
    '@vocab': 'https://www.firstperson.network/dtg#',
    validFrom: {
      '@id': 'https://www.w3.org/2018/credentials#validFrom',
      '@type': 'http://www.w3.org/2001/XMLSchema#dateTime',
    },
    validUntil: {
      '@id': 'https://www.w3.org/2018/credentials#validUntil',
      '@type': 'http://www.w3.org/2001/XMLSchema#dateTime',
    },
  },
}

// RelationshipCredential context (simplified for W3C VC 2.0)
export const RELATIONSHIP_CONTEXT_URL = 'https://www.firstperson.network/relationship/v1'

export const RELATIONSHIP_CONTEXT_DOCUMENT = {
  '@context': {
    '@version': 1.1,
    '@protected': true,
    '@vocab': 'https://www.firstperson.network/relationship#',
    // RelationshipCredential uses only credentialSubject.id
    // All information is encoded in the issuer and credentialSubject DIDs
  },
}
