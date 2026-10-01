/**
 * The DTG Credentials v1 context, `https://registry.trustoverip.org/dtg/context/v1`,
 * byte for byte as the registry publishes it.
 *
 * The cred-spec (Base Structure) puts it second in every DTG credential's
 * `@context`, after VCDM 2.0, compared byte-exact, and freezes v1: a verifier
 * may pin its digest instead of fetching it. Communities on VTI 0.47.0
 * (#1859, f9d924f9) and later issue every card under it, and Credo expands a
 * card's JSON-LD when it stores, signs or verifies one, so without this
 * document here no such card can be kept (the fetch fallback reaches an HTML
 * page unless it asks for JSON-LD, and a phone may be offline).
 *
 * Source: trustoverip/dtgwg-vsc-registry `contexts/v1.jsonld` at 0d309410,
 * identical to the document the URL serves for `Accept: application/ld+json`
 * (checked 2026-09-30). Its sha256 is `DTG_REGISTRY_CONTEXT_V1_SHA256`; the
 * tests of every loader that serves it check the text against it.
 *
 * Never list this context and the older firstperson DTG context in one
 * credential: both are `@protected` and define the same terms.
 */
export const DTG_REGISTRY_CONTEXT_V1_URL = 'https://registry.trustoverip.org/dtg/context/v1'

/** sha256 of `DTG_REGISTRY_CONTEXT_V1_TEXT`, as the cred-spec states it for v1. */
export const DTG_REGISTRY_CONTEXT_V1_SHA256 = '3e1376acf401016a0162c1cdb31e44a85a7dd56749caed94a1dc0a0be6cbb448'

/** The published bytes, unchanged (ASCII, with the trailing newline). */
export const DTG_REGISTRY_CONTEXT_V1_TEXT =
  '{\n  "@context": {\n    "@version": 1.1,\n    "@protected": true,\n\n    "id": "@id",\n    "type": "@type",\n\n    "DTGCredential": "https://registry.trustoverip.org/dtg/credentials#DTGCredential",\n    "MembershipCredential": "https://registry.trustoverip.org/dtg/credentials#MembershipCredential",\n    "RelationshipCredential": "https://registry.trustoverip.org/dtg/credentials#RelationshipCredential",\n    "DelegationCredential": "https://registry.trustoverip.org/dtg/credentials#DelegationCredential",\n    "InvitationCredential": "https://registry.trustoverip.org/dtg/credentials#InvitationCredential",\n    "PersonaCredential": "https://registry.trustoverip.org/dtg/credentials#PersonaCredential",\n    "StatementCredential": "https://registry.trustoverip.org/dtg/credentials#StatementCredential",\n    "AuthorityCredential": "https://registry.trustoverip.org/dtg/credentials#AuthorityCredential",\n\n    "issuerScope": "https://registry.trustoverip.org/dtg/credentials#issuerScope",\n    "taskContext": "https://registry.trustoverip.org/dtg/credentials#taskContext",\n    "taskDigestMultibase": {\n      "@id": "https://registry.trustoverip.org/dtg/credentials#taskDigestMultibase",\n      "@type": "https://w3id.org/security#multibase"\n    },\n\n    "predicate": {\n      "@id": "https://registry.trustoverip.org/dtg/credentials#predicate",\n      "@type": "@id"\n    },\n    "object": {\n      "@id": "https://registry.trustoverip.org/dtg/credentials#object",\n      "@context": {\n        "@protected": true,\n        "value": {\n          "@id": "https://registry.trustoverip.org/dtg/credentials#value",\n          "@type": "@json"\n        }\n      }\n    },\n    "witnessContext": {\n      "@id": "https://registry.trustoverip.org/dtg/credentials#witnessContext",\n      "@context": {\n        "@protected": true,\n        "event": "https://registry.trustoverip.org/dtg/credentials#event",\n        "sessionId": "https://registry.trustoverip.org/dtg/credentials#sessionId",\n        "method": "https://registry.trustoverip.org/dtg/credentials#method"\n      }\n    },\n\n    "delegation": {\n      "@id": "https://registry.trustoverip.org/dtg/credentials#delegation",\n      "@context": {\n        "@protected": true,\n        "scope": {\n          "@id": "https://registry.trustoverip.org/dtg/credentials#delegationScope",\n          "@container": "@set"\n        },\n        "parent": {\n          "@id": "https://registry.trustoverip.org/dtg/credentials#parent",\n          "@type": "https://w3id.org/security#multibase"\n        },\n        "maxDepth": {\n          "@id": "https://registry.trustoverip.org/dtg/credentials#maxDepth",\n          "@type": "http://www.w3.org/2001/XMLSchema#integer"\n        },\n        "accepts": {\n          "@id": "https://registry.trustoverip.org/dtg/credentials#accepts",\n          "@type": "https://w3id.org/security#multibase"\n        }\n      }\n    },\n\n    "authority": {\n      "@id": "https://registry.trustoverip.org/dtg/credentials#authority",\n      "@context": {\n        "@protected": true,\n        "scope": {\n          "@id": "https://registry.trustoverip.org/dtg/credentials#authorityScope",\n          "@type": "@id"\n        },\n        "actions": {\n          "@id": "https://registry.trustoverip.org/dtg/credentials#actions",\n          "@container": "@set"\n        },\n        "parent": {\n          "@id": "https://registry.trustoverip.org/dtg/credentials#parent",\n          "@type": "https://w3id.org/security#multibase"\n        },\n        "maxAttenuation": {\n          "@id": "https://registry.trustoverip.org/dtg/credentials#maxAttenuation",\n          "@type": "http://www.w3.org/2001/XMLSchema#integer"\n        }\n      }\n    }\n  }\n}\n'

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

/** The parsed document a JSON-LD document loader returns for the URL. */
export const DTG_REGISTRY_CONTEXT_V1_DOCUMENT: Record<string, unknown> = deepFreeze(
  JSON.parse(DTG_REGISTRY_CONTEXT_V1_TEXT) as Record<string, unknown>
)
