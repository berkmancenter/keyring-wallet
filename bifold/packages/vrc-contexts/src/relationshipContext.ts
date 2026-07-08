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

// RelationshipCard (RCard) context — the exchanged contact-card credential
// defined by the DTG spec (type: ["VerifiableCredential", "RelationshipCard"]).
//
// `card` carries a jCard (RFC 7095) — a deeply nested JSON array. It is
// declared as a JSON literal (`@type: @json`, JSON-LD 1.1) so the exact
// structure and ordering survive RDF canonicalization; JSON literals are
// canonicalized with JCS (RFC 8785) by the JSON-LD processor.
export const RCARD_CONTEXT_URL = 'https://www.firstperson.network/rcard/v1'

export const RCARD_CONTEXT_DOCUMENT = {
  '@context': {
    '@version': 1.1,
    '@protected': true,
    RelationshipCard: {
      '@id': 'https://www.firstperson.network/rcard#RelationshipCard',
      '@context': {
        '@version': 1.1,
        '@protected': true,
        card: {
          '@id': 'https://www.firstperson.network/rcard#card',
          '@type': '@json',
        },
      },
    },
  },
}
