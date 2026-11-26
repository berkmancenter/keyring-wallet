/**
 * `person/confirm-request/0.1`: "Confirm it's you". One person asks a contact, over the relationship they already
 * have, to confirm that something is really them (a call that sounds like them asking for money: the voice could be
 * cloned, the relationship's keys cannot). The contact answers "it's me" or "not me" with their phone's own lock.
 *
 * Person to person: no agent or VTA is involved, and nothing here grants anything. The answer is evidence for the
 * asker to act on (or not), signed by the key the relationship established.
 *
 * Minted under the private authority Keyring's own types use (`keyring.appliedtechnologylab.org`, as
 * `approver/role-offer/0.1` and the continuity check are), per trust_tasks_subtask.md §1 point 5.
 *
 * Both legs are signed under the sender's relationship DID and verified under the one the relationship established;
 * neither is read without that proof.
 *
 * @module trust-tasks/confirmItsYouSpec
 */

export const TYPE_URI = 'https://keyring.appliedtechnologylab.org/spec/person/confirm-request/0.1'
export const RESPONSE_TYPE_URI = `${TYPE_URI}#response`

/** The longest note, in characters: enough for a sentence or two, too short to carry anything else. */
export const NOTE_MAX = 280

const CHALLENGE_PATTERN = '^[A-Za-z0-9_-]{22,}$'

/** The request: a note the asker wrote, a challenge the answer carries back, and when it stops being answerable. */
export interface ConfirmRequestPayload {
  /** base64url, fresh for this request. */
  challenge: string
  /** Plain text, shown as it is (never as links or markup). */
  note: string
  /** After this, the asked phone does not show it and the asking phone treats it as unanswered. */
  expiresAt: string
}

export type ConfirmDecision = 'itsMe' | 'notMe'

/** What the answering phone's lock was, as that phone says (for the words only: "confirmed with Face ID"). */
export const CONFIRM_LOCKS = [
  'faceId',
  'touchId',
  'opticId',
  'fingerprint',
  'face',
  'iris',
  'screenLock',
  'unknown',
] as const
export type ConfirmLock = (typeof CONFIRM_LOCKS)[number]

/** The answer: it's me, or not me. Carries the challenge back. */
export interface ConfirmResponsePayload {
  decision: ConfirmDecision
  challenge: string
  respondedAt: string
  /** The lock the answer was confirmed with, as the answering phone names it. */
  confirmedWith?: ConfirmLock
}

export const SPEC = {
  typeUri: TYPE_URI,
  isBearer: false,
  isProofRequired: true,
  isRecipientRequired: true,
  payloadSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: TYPE_URI,
    title: "Confirm It's You — payload",
    description:
      'One person asks a contact, over an established relationship, to confirm that a request made in their name is really theirs.',
    type: 'object',
    additionalProperties: false,
    required: ['challenge', 'note', 'expiresAt'],
    properties: {
      challenge: { type: 'string', pattern: CHALLENGE_PATTERN },
      note: { type: 'string', minLength: 1, maxLength: NOTE_MAX },
      expiresAt: { type: 'string', format: 'date-time' },
    },
  },
} as const

export const RESPONSE_SPEC = {
  typeUri: RESPONSE_TYPE_URI,
  isBearer: false,
  isProofRequired: true,
  isRecipientRequired: true,
  // No $id: a fragment-bearing $id ("…#response") is invalid to ajv (witnessShareSpec.ts).
  payloadSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: "Confirm It's You — response payload",
    description: "The contact's signed answer: it's me, or not me.",
    type: 'object',
    additionalProperties: false,
    required: ['decision', 'challenge', 'respondedAt'],
    properties: {
      decision: { type: 'string', enum: ['itsMe', 'notMe'] },
      challenge: { type: 'string', pattern: CHALLENGE_PATTERN },
      respondedAt: { type: 'string', format: 'date-time' },
      confirmedWith: { type: 'string', enum: [...CONFIRM_LOCKS] },
    },
  },
} as const
