/**
 * `contacts/continuity-check/0.1` — Keyring's own Trust Task type for a phone to confirm that two of its relationships
 * with someone are the same person, at the other person's word.
 *
 * Minted under a private authority we control (`keyring.appliedtechnologylab.org`, as the Approver demo's
 * access-request is), not `trusttasks.org`: it is wallet-to-wallet convenience, not interop, and could be proposed
 * upstream later by changing the authority. Shape follows the in-core local-spec convention (witnessShareSpec.ts):
 * TYPE_URI / RESPONSE_TYPE_URI / SPEC / RESPONSE_SPEC, the schema inlined as data.
 *
 * The request carries one sealed box: a random challenge sealed to the recipient's pairwise relationship DID from an
 * EARLIER relationship. Only the holder of that DID's key can open it. The response carries the challenge back and
 * nothing else — not which relationship opened it.
 */

export const TYPE_URI = 'https://keyring.appliedtechnologylab.org/spec/contacts/continuity-check/0.1'
export const RESPONSE_TYPE_URI = `${TYPE_URI}#response`

export interface ContinuityCheckPayload {
  /** base64url of a sealed box (X25519 / XSalsa20-Poly1305) holding the challenge. */
  sealed: string
}

export interface ContinuityCheckResponsePayload {
  /** base64url of the challenge, as opened. */
  challenge: string
}

const BASE64URL = '^[A-Za-z0-9_-]+$'

export const SPEC = {
  typeUri: TYPE_URI,
  isBearer: false,
  isProofRequired: false,
  isRecipientRequired: true,
  payloadSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: TYPE_URI,
    title: 'Contacts Continuity Check — payload',
    description:
      'A challenge sealed to a relationship DID the recipient used in an earlier relationship with the sender. The recipient answers only if the challenge opens with one of its own keys and its person confirms.',
    type: 'object',
    additionalProperties: false,
    required: ['sealed'],
    properties: {
      sealed: { type: 'string', minLength: 16, maxLength: 512, pattern: BASE64URL },
    },
  },
} as const

export const RESPONSE_SPEC = {
  typeUri: RESPONSE_TYPE_URI,
  isBearer: false,
  isProofRequired: false,
  isRecipientRequired: true,
  // No $id: a fragment-bearing $id ("…#response") is invalid to ajv (see witnessShareSpec.ts).
  payloadSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Contacts Continuity Check — response payload',
    description: 'The opened challenge, and nothing else.',
    type: 'object',
    additionalProperties: false,
    required: ['challenge'],
    properties: {
      challenge: { type: 'string', minLength: 16, maxLength: 128, pattern: BASE64URL },
    },
  },
} as const
