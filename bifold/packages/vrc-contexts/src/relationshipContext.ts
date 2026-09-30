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

// The real registry `v1` document, verbatim. dtgwg-cred-spec (`spec/body.md`,
// Context Versions) states `v1` is byte-frozen and gives its SHA-256 digest;
// verifiers SHOULD use a local copy matching it. The bytes are kept here as a
// string (not a hand-written object) so the pin can be checked against exactly
// what is bundled: `REGISTRY_DTG_CONTEXT_SHA256_HEX` / `_DIGEST_MULTIBASE` are
// asserted against these bytes in core's registryContextPin.test.ts. Source:
// dtgwg-vsc-registry `contexts/v1.jsonld` (pinned under external/).
export const REGISTRY_DTG_CONTEXT_SOURCE = String.raw`{
  "@context": {
    "@version": 1.1,
    "@protected": true,

    "id": "@id",
    "type": "@type",

    "DTGCredential": "https://registry.trustoverip.org/dtg/credentials#DTGCredential",
    "MembershipCredential": "https://registry.trustoverip.org/dtg/credentials#MembershipCredential",
    "RelationshipCredential": "https://registry.trustoverip.org/dtg/credentials#RelationshipCredential",
    "DelegationCredential": "https://registry.trustoverip.org/dtg/credentials#DelegationCredential",
    "InvitationCredential": "https://registry.trustoverip.org/dtg/credentials#InvitationCredential",
    "PersonaCredential": "https://registry.trustoverip.org/dtg/credentials#PersonaCredential",
    "StatementCredential": "https://registry.trustoverip.org/dtg/credentials#StatementCredential",
    "AuthorityCredential": "https://registry.trustoverip.org/dtg/credentials#AuthorityCredential",

    "issuerScope": "https://registry.trustoverip.org/dtg/credentials#issuerScope",
    "taskContext": "https://registry.trustoverip.org/dtg/credentials#taskContext",
    "taskDigestMultibase": {
      "@id": "https://registry.trustoverip.org/dtg/credentials#taskDigestMultibase",
      "@type": "https://w3id.org/security#multibase"
    },

    "predicate": {
      "@id": "https://registry.trustoverip.org/dtg/credentials#predicate",
      "@type": "@id"
    },
    "object": {
      "@id": "https://registry.trustoverip.org/dtg/credentials#object",
      "@context": {
        "@protected": true,
        "value": {
          "@id": "https://registry.trustoverip.org/dtg/credentials#value",
          "@type": "@json"
        }
      }
    },
    "witnessContext": {
      "@id": "https://registry.trustoverip.org/dtg/credentials#witnessContext",
      "@context": {
        "@protected": true,
        "event": "https://registry.trustoverip.org/dtg/credentials#event",
        "sessionId": "https://registry.trustoverip.org/dtg/credentials#sessionId",
        "method": "https://registry.trustoverip.org/dtg/credentials#method"
      }
    },

    "delegation": {
      "@id": "https://registry.trustoverip.org/dtg/credentials#delegation",
      "@context": {
        "@protected": true,
        "scope": {
          "@id": "https://registry.trustoverip.org/dtg/credentials#delegationScope",
          "@container": "@set"
        },
        "parent": {
          "@id": "https://registry.trustoverip.org/dtg/credentials#parent",
          "@type": "https://w3id.org/security#multibase"
        },
        "maxDepth": {
          "@id": "https://registry.trustoverip.org/dtg/credentials#maxDepth",
          "@type": "http://www.w3.org/2001/XMLSchema#integer"
        },
        "accepts": {
          "@id": "https://registry.trustoverip.org/dtg/credentials#accepts",
          "@type": "https://w3id.org/security#multibase"
        }
      }
    },

    "authority": {
      "@id": "https://registry.trustoverip.org/dtg/credentials#authority",
      "@context": {
        "@protected": true,
        "scope": {
          "@id": "https://registry.trustoverip.org/dtg/credentials#authorityScope",
          "@type": "@id"
        },
        "actions": {
          "@id": "https://registry.trustoverip.org/dtg/credentials#actions",
          "@container": "@set"
        },
        "parent": {
          "@id": "https://registry.trustoverip.org/dtg/credentials#parent",
          "@type": "https://w3id.org/security#multibase"
        },
        "maxAttenuation": {
          "@id": "https://registry.trustoverip.org/dtg/credentials#maxAttenuation",
          "@type": "http://www.w3.org/2001/XMLSchema#integer"
        }
      }
    }
  }
}
`

// SHA-256 of REGISTRY_DTG_CONTEXT_SOURCE as the spec states it: lowercase hex,
// and the same digest as a Multihash in Multibase base58btc.
export const REGISTRY_DTG_CONTEXT_SHA256_HEX = '3e1376acf401016a0162c1cdb31e44a85a7dd56749caed94a1dc0a0be6cbb448'
export const REGISTRY_DTG_CONTEXT_DIGEST_MULTIBASE = 'zQmSWyCagdx8oPfXn3piSUx6yqVy5MZ7ZG7nW1TC64QvKZh'

export const REGISTRY_DTG_CONTEXT_DOCUMENT = JSON.parse(REGISTRY_DTG_CONTEXT_SOURCE) as {
  '@context': Record<string, unknown>
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
