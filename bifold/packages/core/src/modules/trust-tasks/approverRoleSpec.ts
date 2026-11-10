/**
 * `approver/role-offer/0.1`: one person asks a contact to be their trusted
 * approver (docs/plans/trusted-approver-plan.md §4), over the VRC
 * relationship they already have.
 *
 * Minted under a private authority we control (`keyring.appliedtechnologylab.org`,
 * as the Approver demo's `approver/access-request/0.1` and the continuity
 * check are), per trust_tasks_subtask.md §1 point 5: not the `trusttasks.org`
 * authority, not a `trust-task*` slug. TYPE_URI / RESPONSE_TYPE_URI / SPEC /
 * RESPONSE_SPEC, the schema inlined as data.
 *
 * Both legs are signed under the sender's relationship DID and verified under
 * the one the relationship established; neither is read without that proof.
 *
 * @module trust-tasks/approverRoleSpec
 */

export const TYPE_URI = 'https://keyring.appliedtechnologylab.org/spec/approver/role-offer/0.1'
export const RESPONSE_TYPE_URI = `${TYPE_URI}#response`

/** What an approver can be asked to approve: the keys of `TRUSTED_TASKS` (trustedApprovers.ts), held equal by a test. */
export const ROLE_ACTIONS = ['shareCredential', 'joinCommunity', 'addDevice', 'changeApprovers'] as const

const DID_PATTERN = '^did:[a-z0-9]+:.+'
const CHALLENGE_PATTERN = '^[A-Za-z0-9_-]{22,}$'

/** The offer: whose agent, which actions, and a challenge the answer carries back. */
export interface RoleOfferPayload {
  /** The DID of the asking person's agent: where the approver's yes will be asked for. */
  agent: string
  actions: (typeof ROLE_ACTIONS)[number][]
  /** base64url, fresh for this offer. */
  challenge: string
}

/** The answer: yes with the DID the approver's phone approves as, or no. Both carry the challenge back. */
export interface RoleOfferResponsePayload {
  decision: 'accepted' | 'declined'
  challenge: string
  /** On `accepted`: the DID the asking agent sends its approval requests to. */
  approver?: string
  respondedAt: string
}

export const SPEC = {
  typeUri: TYPE_URI,
  isBearer: false,
  isProofRequired: true,
  isRecipientRequired: true,
  payloadSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: TYPE_URI,
    title: 'Approver Role Offer — payload',
    description:
      "One person asks a contact, over an established VRC relationship, to approve the listed actions on the person's agent.",
    type: 'object',
    additionalProperties: false,
    required: ['agent', 'actions', 'challenge'],
    properties: {
      agent: { type: 'string', pattern: DID_PATTERN },
      actions: {
        type: 'array',
        minItems: 1,
        uniqueItems: true,
        items: { type: 'string', enum: [...ROLE_ACTIONS] },
      },
      challenge: { type: 'string', pattern: CHALLENGE_PATTERN },
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
    title: 'Approver Role Offer — response payload',
    description: "The contact's signed answer. On accepted, the DID the asking agent sends approval requests to.",
    type: 'object',
    additionalProperties: false,
    required: ['decision', 'challenge', 'respondedAt'],
    properties: {
      decision: { type: 'string', enum: ['accepted', 'declined'] },
      challenge: { type: 'string', pattern: CHALLENGE_PATTERN },
      approver: { type: 'string', pattern: DID_PATTERN },
      respondedAt: { type: 'string', format: 'date-time' },
    },
  },
} as const

/**
 * `approver/role-step-down/0.1`: the approver tells the person they no longer approve for them (trusted-approver
 * plan T3, §4.4), over the same relationship. One way: nothing answers it. Signed under the approver's relationship
 * DID and verified under the one the relationship established, as the offer is.
 *
 * It only tells: the person's agent keeps the approver in its set until the person's phone writes the change, which
 * the person confirms (and which the agent may hold for the approvers' yes, as it holds any rule change they cover).
 */
export const STEP_DOWN_TYPE_URI = 'https://keyring.appliedtechnologylab.org/spec/approver/role-step-down/0.1'

/** The step-down: whose agent, and the DID the approver had said yes as. */
export interface RoleStepDownPayload {
  agent: string
  approver: string
  steppedDownAt: string
}

export const STEP_DOWN_SPEC = {
  typeUri: STEP_DOWN_TYPE_URI,
  isBearer: false,
  isProofRequired: true,
  isRecipientRequired: true,
  payloadSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: STEP_DOWN_TYPE_URI,
    title: 'Approver Role Step-down — payload',
    description:
      "An approver tells the person, over an established VRC relationship, that they no longer approve for the person's agent.",
    type: 'object',
    additionalProperties: false,
    required: ['agent', 'approver', 'steppedDownAt'],
    properties: {
      agent: { type: 'string', pattern: DID_PATTERN },
      approver: { type: 'string', pattern: DID_PATTERN },
      steppedDownAt: { type: 'string', format: 'date-time' },
    },
  },
} as const
