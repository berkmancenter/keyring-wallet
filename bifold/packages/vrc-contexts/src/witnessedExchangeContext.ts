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

    // Schema.org terms used in issuer object (required for issuer.name to canonicalize correctly)
    name: 'http://schema.org/name',

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
  },
}
