/**
 * `vrc/relationships/witness-share/0.1` — LOCAL spec staging (subtask §9
 * step 7). The third relationship task: after a witnessed exchange, each
 * party ships the counterparty its presentation bundle — the VWC wrapped in
 * a signed VP plus the retained outcome-evidence pair — so the peer can
 * verify the witnessing (cred-spec Outcome Interpretability pairing) and
 * only then treat the relationship as witnessed. This replaces the legacy
 * witness-side cross-distribution with holder-controlled disclosure.
 *
 * The VP's challenge is the exchange thread id and its domain is the fixed
 * `WITNESS_SHARE_DOMAIN`: freshness inside the DIDComm channel comes from
 * the channel and the thread binding, and replay across exchanges fails the
 * challenge check.
 *
 * Shape mirrors the published `@openvtc/trust-tasks` payload modules
 * (TYPE_URI / SPEC / RESPONSE_SPEC with the four flags the runtime reads);
 * it moves upstream with the `vrc/*` batch (step 2 owns the authoring).
 */

const DIGEST_MULTIBASE_PATTERN = '^(z[1-9A-HJ-NP-Za-km-z]+|u[A-Za-z0-9_-]+)$'

export const TYPE_URI = 'https://trusttasks.org/spec/vrc/relationships/witness-share/0.1'
export const RESPONSE_TYPE_URI = `${TYPE_URI}#response`

/** The domain every witness-share VP is bound to (challenge = exchange id). */
export const WITNESS_SHARE_DOMAIN = 'vrc:witness-share'

export const SPEC = {
  typeUri: TYPE_URI,
  isBearer: false,
  isProofRequired: true,
  isRecipientRequired: true,
  payloadSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: TYPE_URI,
    title: 'VRC Relationships Witness Share — payload',
    description:
      "Delivers the sending party's Verifiable Witness Credential to the counterparty of a witnessed relationship exchange, as a presentation bundle: the VWC wrapped in a Verifiable Presentation signed by the holder and bound to {challenge: the exchange thread id, domain: vrc:witness-share}, together with the matching Trust Task outcome-evidence pair. The receiver MUST run the Outcome Interpretability pairing over the bundle and store the credential only on a passing verdict.",
    type: 'object',
    additionalProperties: false,
    required: ['presentation', 'outcomeEvidence'],
    properties: {
      presentation: {
        type: 'object',
        description:
          "A signed W3C Verifiable Presentation wrapping exactly the sender's VWC, challenge-bound as described above.",
      },
      outcomeEvidence: {
        type: 'object',
        additionalProperties: false,
        required: ['initiating', 'terminal'],
        description:
          "The retained outcome-evidence pair for the VWC's taskContext: the witness session's initiating document and the terminal success response, each carrying its own proof.",
        properties: {
          initiating: { type: 'object' },
          terminal: { type: 'object' },
        },
      },
      ext: { type: 'object' },
    },
  },
} as const

export const RESPONSE_SPEC = {
  typeUri: RESPONSE_TYPE_URI,
  isBearer: false,
  isProofRequired: false,
  isRecipientRequired: true,
  // NOTE: no $id here — a fragment-bearing $id ("…#response") is invalid to
  // ajv and made every receipt consume throw; the package's own response
  // schemas carry no $id either.
  payloadSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'VRC Relationships Witness Share — response payload',
    description:
      'The verification receipt: the receiver ran the pairing algorithm, stored the VWC, and names which one. A failed verification is a trust-task-error, never a receipt reporting failure.',
    type: 'object',
    additionalProperties: false,
    required: ['vwcDigestMultibase'],
    properties: {
      vwcDigestMultibase: {
        type: 'string',
        minLength: 16,
        pattern: DIGEST_MULTIBASE_PATTERN,
        description: 'Digest over the RFC 8785 canonicalization of the VWC as stored.',
      },
      ext: { type: 'object' },
    },
  },
} as const
