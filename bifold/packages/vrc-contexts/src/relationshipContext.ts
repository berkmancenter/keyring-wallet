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

// Real DTG registry context (cred-spec `spec/body.md`: `@context` MUST list
// `https://www.w3.org/ns/credentials/v2` first, this unversioned IRI second,
// compared as an exact string; `type` MUST include `DTGCredential` plus
// exactly one concrete subtype). Same registry namespace VSC's own
// StatementCredential/issuerScope terms already target
// (@bifold/dtg-vocab's src/namespace.ts is the canonical source for these
// strings; vrc-contexts has no dependency on dtg-vocab, so they're
// duplicated here byte-for-byte, same convention already used in
// witnessedExchangeContext.ts for StatementCredential/issuerScope).
//
// NEW ISSUANCE ONLY, VC 2.0 profile: a VRC issued from here on uses this
// context instead of DTG_CONTEXT_URL/RELATIONSHIP_CONTEXT_URL above. Those
// two are NOT removed or changed, and every document loader that resolves
// them keeps doing so -- old-format and legacy VCDM 1.1 credentials keep
// verifying exactly as before. Dual-read, same design this migration used
// for witness credentials' wd02/vsc split.
//
// RCard is deliberately excluded: cred-spec `spec/body.md` states RCard is
// "not a DTGCredential subtype" and awaits an undefined future DTG
// Verifiable Data Structures spec -- there is no real target IRI for it
// yet, so RCARD_CONTEXT_URL/RCARD_CONTEXT_DOCUMENT below are untouched.
export const REGISTRY_DTG_CONTEXT_URL = 'https://registry.trustoverip.org/dtg/context/v1'

export const REGISTRY_DTG_CONTEXT_DOCUMENT = {
  '@context': {
    '@version': 1.1,
    '@protected': true,
    DTGCredential: 'https://registry.trustoverip.org/dtg/credentials#DTGCredential',
    RelationshipCredential: 'https://registry.trustoverip.org/dtg/credentials#RelationshipCredential',
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
