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
    // NOT updated to the real DTG registry namespace (registry.trustoverip.org)
    // as part of the VSC migration (docs/plans/vsc-migration-plan.md): DTGCredential
    // is the shared type of every DTG credential, not just the VWC/VSC, so changing
    // its IRI here would affect canonicalization of every already-issued VRC/VMC/etc,
    // a far wider blast radius than this migration's scope. Flagged for a separate
    // decision, not fixed here.
    DTGCredential: 'https://www.firstperson.network/dtg#DTGCredential',
    // StatementCredential (plan D1): the VSC's one concrete type, replacing
    // WitnessCredential/EndorsementCredential. New term, real DTG registry
    // vocabulary namespace (settled in @bifold/dtg-vocab's src/namespace.ts,
    // V1) — nothing has issued under this type yet, so no legacy blast radius.
    StatementCredential: 'https://registry.trustoverip.org/dtg/credentials#StatementCredential',

    // VSC predicate (plan D2): an absolute IRI naming the statement's meaning,
    // e.g. one of @bifold/dtg-vocab's PREDICATE_WITNESSED/PREDICATE_ENDORSES.
    // @type: @id so the value itself is treated as an IRI, never expanded as
    // a nested node — cred-spec's Predicate Handling matches it byte-exact,
    // unprocessed by JSON-LD, but a VSC's proof still canonicalizes the
    // credential as a whole, so the member needs a term or it never enters
    // the signed graph at all (ref-07h's `safe: true` finding).
    predicate: {
      '@id': 'https://registry.trustoverip.org/dtg/credentials#predicate',
      '@type': '@id',
    },
    // VSC object (plan D2, D3): what the statement says about the subject.
    // Scopes only `value` (@type: @json, an opaque canonicalized literal for
    // a structured payload) — `id` already has its context-wide `@id` alias,
    // and `digestMultibase` MUST NOT be redefined here: the base
    // credentials/v2 context (credentialsV2Context.ts) already defines and
    // @protects it (security#digestMultibase), and safe-mode JSON-LD treats
    // redefining a protected term as fatal (verified directly against the
    // bundled v2 context bytes, not assumed).
    object: {
      '@id': 'https://registry.trustoverip.org/dtg/credentials#object',
      '@context': {
        '@protected': true,
        value: {
          '@id': 'https://registry.trustoverip.org/dtg/credentials#value',
          '@type': '@json',
        },
      },
    },

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
