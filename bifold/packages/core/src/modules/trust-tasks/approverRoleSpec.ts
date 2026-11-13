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

/**
 * An approver's phone sends the person's phone its state Guardian card (trusted-approver plan, stage 2, S1), after it
 * said yes: the KERI/ACDC chain from a State root to the Guardian credential naming the person as ward, as inert text.
 * One way and only told, like the step-down: the person's phone checks it on its own (sedi/guardian, verifyGuardian)
 * and nothing answers it. A separate type rather than a field on the role-offer response, so the response's 0.1 shape
 * is unchanged.
 *
 * It says only what the card says. The card names a KERI holder; nothing here proves the approver's phone controls
 * that holder (that waits for the approver's own KERI identity, stage 3).
 */
export const GUARDIAN_EVIDENCE_TYPE_URI = 'https://keyring.appliedtechnologylab.org/spec/approver/guardian-evidence/0.1'

/**
 * The most evidence (kels, tels and creds, as UTF-8 JSON) sent or taken. The K0 chain (root → org → agent → Guardian:
 * four KELs, three registries, three credentials) is 13,234 bytes of raw text; 64 KiB leaves room for a longer chain
 * or rotated KELs, and refuses anything far past a real one, both before sending and on arrival.
 */
export const GUARDIAN_EVIDENCE_MAX_BYTES = 64 * 1024
/** Per list: a chain longer than this is not one Keyring checks. */
const EVIDENCE_MAX_ITEMS = 16

/** The card: whose agent, the DID the approver said yes as, the Guardian credential, its holder, and the chain. */
export interface GuardianEvidencePayload {
  agent: string
  approver: string
  guardianSaid: string
  holder: string
  /** KEL streams, text-domain CESR. */
  kels: string[]
  tels: { ripText: string; updateTexts: string[] }[]
  /** Each credential's proof: ACDC text followed by its state disclosure. */
  creds: string[]
  /**
   * 0.2 only, optional: the host the card came with (a state office's QR; stateRoots K1_WEBS_HOST 'fromCard'), so the
   * person's phone fetches the state from that host only, if the state names it.
   */
  stateHost?: string
  /** 0.2 only, optional: the Social Authorization the guardian issued the person, chained to this card (the S2 build). */
  social?: { said: string }
  sentAt: string
}

const AID_PATTERN = '^[A-Za-z0-9_-]{44}$'
const evidenceText = { type: 'string', minLength: 1, maxLength: GUARDIAN_EVIDENCE_MAX_BYTES } as const

export const GUARDIAN_EVIDENCE_SPEC = {
  typeUri: GUARDIAN_EVIDENCE_TYPE_URI,
  isBearer: false,
  isProofRequired: true,
  isRecipientRequired: true,
  payloadSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: GUARDIAN_EVIDENCE_TYPE_URI,
    title: 'Approver Guardian Evidence — payload',
    description:
      "An approver's phone sends, over an established VRC relationship, the state Guardian credential chain naming the person as ward, for the person's phone to check.",
    type: 'object',
    additionalProperties: false,
    required: ['agent', 'approver', 'guardianSaid', 'holder', 'kels', 'tels', 'creds', 'sentAt'],
    properties: {
      agent: { type: 'string', pattern: DID_PATTERN },
      approver: { type: 'string', pattern: DID_PATTERN },
      guardianSaid: { type: 'string', pattern: AID_PATTERN },
      holder: { type: 'string', minLength: 1, maxLength: 64 },
      kels: { type: 'array', minItems: 1, maxItems: EVIDENCE_MAX_ITEMS, items: evidenceText },
      tels: {
        type: 'array',
        maxItems: EVIDENCE_MAX_ITEMS,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['ripText', 'updateTexts'],
          properties: {
            ripText: evidenceText,
            updateTexts: { type: 'array', maxItems: EVIDENCE_MAX_ITEMS, items: evidenceText },
          },
        },
      },
      creds: { type: 'array', minItems: 1, maxItems: EVIDENCE_MAX_ITEMS, items: evidenceText },
      sentAt: { type: 'string', format: 'date-time' },
    },
  },
} as const

/**
 * guardian-evidence/0.2: 0.1's payload plus two OPTIONAL members, `stateHost` (the host a K1 card came with) and
 * `social` (the Social Authorization chained to the card). A new version rather than new members in 0.1 (ac,
 * 2026-11-13): a phone that knows only 0.1 refuses a 0.2 document by its type before reading its payload, so the
 * refusal says what it is, never a schema failure. A K1 card (one with a host or a Social Authorization) goes as 0.2;
 * a K0 card stays 0.1, byte-identical to what 278.18 sends. A phone on this build takes both.
 */
export const GUARDIAN_EVIDENCE_V2_TYPE_URI =
  'https://keyring.appliedtechnologylab.org/spec/approver/guardian-evidence/0.2'

const V1_SCHEMA = GUARDIAN_EVIDENCE_SPEC.payloadSchema

export const GUARDIAN_EVIDENCE_V2_SPEC = {
  ...GUARDIAN_EVIDENCE_SPEC,
  typeUri: GUARDIAN_EVIDENCE_V2_TYPE_URI,
  payloadSchema: {
    ...V1_SCHEMA,
    $id: GUARDIAN_EVIDENCE_V2_TYPE_URI,
    title: 'Approver Guardian Evidence 0.2 — payload',
    properties: {
      ...V1_SCHEMA.properties,
      // A bare hostname, lower case, as the receiving phone requires; it is fetched only if the state names it.
      stateHost: { type: 'string', minLength: 1, maxLength: 253, pattern: '^[a-z0-9.:-]+$' },
      social: {
        type: 'object',
        additionalProperties: false,
        required: ['said'],
        properties: { said: { type: 'string', pattern: AID_PATTERN } },
      },
    },
  },
} as const
