/**
 * Witnessed Exchange Context for VWCs (Verifiable Witness Credentials)
 *
 * This context defines the JSON-LD terms used in Witnessed Credentials
 * according to the ToIP DTGWG specification.
 *
 * IMPORTANT: This is the SINGLE SOURCE OF TRUTH for these context definitions.
 * Both mobile app and witness server MUST import from this package to ensure
 * JSON-LD canonicalization produces identical results during signing and verification.
 *
 * @see https://github.com/trustoverip/dtgwg-cred-tf/blob/1-provide-draft-vrc-rcard-and-witnessed-exchange-flow/vwc.md
 */

// The context URL - matches the ToIP spec
// This URL is intercepted by the documentLoader and resolved locally
export const WITNESSED_EXCHANGE_CONTEXT_URL = 'https://trustoverip.org/credentials/witnessed-exchange/v1'

// The JSON-LD context document that defines all the terms
export const WITNESSED_EXCHANGE_CONTEXT_DOCUMENT = {
  '@context': {
    '@version': 1.1,

    // Credential types (both variants for compatibility)
    WitnessedCredential: 'https://trustoverip.org/credentials/witnessed-exchange#WitnessedCredential',
    WitnessCredential: 'https://trustoverip.org/credentials/witnessed-exchange#WitnessCredential',
    DTGCredential: 'https://www.firstperson.network/dtg#DTGCredential',

    // Schema.org terms used in issuer object (required for issuer.name to
    // canonicalize correctly in v1.1 VWCs). MUST be byte-identical to the
    // credentials/v2 base-context definition ("https://schema.org/name",
    // plain string): v2 @protects the term, and redefining a protected term
    // is only legal when the definitions match exactly — the DI signing path
    // runs JSON-LD in safe mode where a mismatch is fatal. (The pre-fix
    // http:// IRI means VWCs signed before this change canonicalize
    // differently — acceptable: VWCs expire after 7 days.)
    name: 'https://schema.org/name',

    // WitnessContext object (used in credentialSubject) - no @type so it accepts nested object
    witnessContext: 'https://trustoverip.org/credentials/witnessed-exchange#witnessContext',
    sessionId: 'https://trustoverip.org/credentials/witnessed-exchange#sessionId',
    method: 'https://trustoverip.org/credentials/witnessed-exchange#method',
    event: 'https://trustoverip.org/credentials/witnessed-exchange#event',
    // LocalityVerification object - no @type so it accepts nested object
    localityVerification: 'https://trustoverip.org/credentials/witnessed-exchange#localityVerification',
    // Hardware attestation flag - indicates if the VRC included hardware attestation evidence
    hardwareAttestationIncluded: {
      '@id': 'https://trustoverip.org/credentials/witnessed-exchange#hardwareAttestationIncluded',
      '@type': 'http://www.w3.org/2001/XMLSchema#boolean',
    },

    // Session object and its properties
    session: {
      '@id': 'https://trustoverip.org/credentials/witnessed-exchange#session',
      '@type': '@id',
    },
    witnessId: {
      '@id': 'https://trustoverip.org/credentials/witnessed-exchange#witnessId',
      '@type': '@id',
    },
    startTime: {
      '@id': 'https://trustoverip.org/credentials/witnessed-exchange#startTime',
      '@type': 'http://www.w3.org/2001/XMLSchema#dateTime',
    },
    expirationTime: {
      '@id': 'https://trustoverip.org/credentials/witnessed-exchange#expirationTime',
      '@type': 'http://www.w3.org/2001/XMLSchema#dateTime',
    },

    // Witness object and its properties
    witness: {
      '@id': 'https://trustoverip.org/credentials/witnessed-exchange#witness',
      '@type': '@id',
    },
    alsoKnownAs: {
      '@id': 'https://trustoverip.org/credentials/witnessed-exchange#alsoKnownAs',
      '@type': '@id',
      '@container': '@set',
    },
    linkageProofs: {
      '@id': 'https://trustoverip.org/credentials/witnessed-exchange#linkageProofs',
      '@container': '@set',
    },
    externalProofs: {
      '@id': 'https://trustoverip.org/credentials/witnessed-exchange#externalProofs',
      '@container': '@set',
    },
    nonce: 'https://trustoverip.org/credentials/witnessed-exchange#nonce',

    // Authorization credential reference (optional per spec)
    authorizationCredential: {
      '@id': 'https://trustoverip.org/credentials/witnessed-exchange#authorizationCredential',
      '@type': '@id',
    },
    role: 'https://trustoverip.org/credentials/witnessed-exchange#role',

    // Witnessed credentials array and its properties
    witnessedCredentials: {
      '@id': 'https://trustoverip.org/credentials/witnessed-exchange#witnessedCredentials',
      '@container': '@set',
    },
    digest: 'https://trustoverip.org/credentials/witnessed-exchange#digest',

    // Enhanced fields (extension to spec for explicit VRC identification)
    subject: {
      '@id': 'https://trustoverip.org/credentials/witnessed-exchange#subject',
      '@type': '@id',
    },

    // Trust Task Context Binding (DTG Core Credentials): the id of the
    // witness/session document that opened this session — the innermost
    // exchange attesting the witnessing (framework §4.9.1) — and the task
    // digest binding that document (§4.9.3, promoted from cred-spec #229/#236).
    taskContext: 'https://trustoverip.org/credentials/witnessed-exchange#taskContext',
    taskDigestMultibase: 'https://trustoverip.org/credentials/witnessed-exchange#taskDigestMultibase',
    // The two relationship DIDs of the witnessed exchange, as the session named them.
    parties: {
      '@id': 'https://trustoverip.org/credentials/witnessed-exchange#parties',
      '@container': '@set',
    },

    // Locality (docs/plans/locality-plan.md §7.1) — flat locality* members,
    // sibling to witnessContext.method (never nested: bbs-2023 discloses at
    // the RDF-quad level, and a nested object is a blank node whose path
    // must be revealed before disclosing anything under it). MANDATORY, not
    // conditional: a member with no term here is not merely unsigned under
    // a future bbs-2023 proof, it is undisclosable — it never enters the
    // dataset a derived proof discloses from. Authored once in
    // tsp-reference/ref-06p-locality-binding/fixtures/locality-context-terms.json
    // (act 6, 26 checks green); this is that same list, not a fresh
    // derivation — keep the two in sync if either changes.
    localityConfirmed: {
      '@id': 'https://trustoverip.org/credentials/witnessed-exchange#localityConfirmed',
      '@type': 'http://www.w3.org/2001/XMLSchema#boolean',
    },
    localityMethod: 'https://trustoverip.org/credentials/witnessed-exchange#localityMethod',
    localityTopology: 'https://trustoverip.org/credentials/witnessed-exchange#localityTopology',
    localitySensor: {
      '@id': 'https://trustoverip.org/credentials/witnessed-exchange#localitySensor',
      '@type': '@id',
    },
    localityVenue: 'https://trustoverip.org/credentials/witnessed-exchange#localityVenue',
    localityObservedAt: {
      '@id': 'https://trustoverip.org/credentials/witnessed-exchange#localityObservedAt',
      '@type': 'http://www.w3.org/2001/XMLSchema#dateTime',
    },
    localityWindowSeconds: {
      '@id': 'https://trustoverip.org/credentials/witnessed-exchange#localityWindowSeconds',
      '@type': 'http://www.w3.org/2001/XMLSchema#integer',
    },
    localityKeyMatchesCredentialSigner: {
      '@id': 'https://trustoverip.org/credentials/witnessed-exchange#localityKeyMatchesCredentialSigner',
      '@type': 'http://www.w3.org/2001/XMLSchema#boolean',
    },
    localityHardwareAttestation: 'https://trustoverip.org/credentials/witnessed-exchange#localityHardwareAttestation',
    localityEvidenceCommitment: 'https://trustoverip.org/credentials/witnessed-exchange#localityEvidenceCommitment',
    localityRttMs: {
      '@id': 'https://trustoverip.org/credentials/witnessed-exchange#localityRttMs',
      '@type': 'http://www.w3.org/2001/XMLSchema#integer',
    },
    localityRssiDbm: {
      '@id': 'https://trustoverip.org/credentials/witnessed-exchange#localityRssiDbm',
      '@type': 'http://www.w3.org/2001/XMLSchema#integer',
    },
    localityRttBoundMs: {
      '@id': 'https://trustoverip.org/credentials/witnessed-exchange#localityRttBoundMs',
      '@type': 'http://www.w3.org/2001/XMLSchema#integer',
    },
    localityReason: 'https://trustoverip.org/credentials/witnessed-exchange#localityReason',
  },
}
