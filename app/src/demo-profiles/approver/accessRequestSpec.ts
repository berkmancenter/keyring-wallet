/**
 * `approver/access-request/0.1` — the Approver demo's own Trust Task type.
 *
 * Minted under a private authority we control
 * (`keyring.appliedtechnologylab.org`, the same host
 * docs/plans/reference-app-sdk-packaging/2026-09-01-al.md §6b's R13 names as
 * the lab's documentation address), per
 * docs/plans/openvtc-integration-plan/trust_tasks_subtask.md §1 point 5:
 * "Private specs are first-class (§6.5). Publishing under an authority we
 * control is fully conforming... The only constraint is that we must not use
 * the `trust-task*` reserved slug prefix or the `trusttasks.org` authority."
 * Neither constraint is violated: the slug is `approver/access-request`, and
 * the authority is ours.
 *
 * Shape mirrors the LOCAL-spec staging convention already used for
 * `vrc/relationships/witness-share`
 * (`bifold/packages/core/src/modules/trust-tasks/witnessShareSpec.ts`): a
 * plain TS module exporting `TYPE_URI` / `RESPONSE_TYPE_URI` / `SPEC` /
 * `RESPONSE_SPEC`, with the schema inlined as data rather than generated —
 * this is a demo-owned type, not one staged for upstream submission, so
 * there is no `@openvtc/trust-tasks` codegen step for it. The schema is ALSO
 * checked in as `payload.schema.json` alongside this file (schema-as-data and
 * schema-as-file, kept identical by hand — trust_tasks_subtask.md §1 point 4
 * expects a `payload.schema.json`; `PAYLOAD_SCHEMA` here is what the running
 * app actually validates against, since TS types are erased at runtime).
 *
 * The scenario (docs/plans/reference-app-sdk-packaging/2026-09-06-agent.md
 * records why this one): one contact asks another, over an ALREADY
 * ESTABLISHED VRC relationship, for access to something concrete — "may I
 * see your event photo album" is the demo's own worked example. `resource`
 * and `reason` are human-readable, free-text description a person reads
 * before deciding; `resourceId` is an opaque machine identifier a real
 * integration would resolve against its own access-control system (this demo
 * has no such system — it is a label, not a working grant).
 *
 * Proof is REQUIRED, verified the same way `issueProofPolicy` in
 * `ceremony.ts` verifies the issue/witness-share legs: under the sender's
 * relationship DID as an already-accepted VRC exchange established it. That
 * reuses real signing/verification infrastructure rather than inventing a
 * second identity mechanism for this one demo.
 */

export const TYPE_URI = 'https://keyring.appliedtechnologylab.org/spec/approver/access-request/0.1'
export const RESPONSE_TYPE_URI = `${TYPE_URI}#response`

/** The request payload: what is being asked for, and why. */
export interface AccessRequestPayload {
  /** Human-readable description of what access is being requested — shown to the approving person verbatim. */
  resource: string
  /** Opaque identifier for the resource in a real integration's own access-control system. Demo-only: nothing here resolves it. */
  resourceId?: string
  /** Why the requester is asking, in their own words — same "hint, not obligation" framing as vrc/relationships/propose's `reason`. */
  reason?: string
}

/** The response payload: the person's decision, signed. */
export interface AccessRequestResponsePayload {
  decision: 'approved' | 'denied'
  respondedAt: string
}

export const PAYLOAD_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: TYPE_URI,
  title: 'Approver Access Request — payload',
  description:
    'One party asks a contact — over an already-established VRC relationship — for access to a named resource. The counterparty approves or denies; either way a signed #response travels back, never a silent drop.',
  type: 'object',
  additionalProperties: false,
  required: ['resource'],
  properties: {
    resource: {
      type: 'string',
      minLength: 1,
      description:
        'Human-readable description of what access is being requested, shown to the approving person verbatim.',
    },
    resourceId: {
      type: 'string',
      description: "Opaque identifier for the resource in a real integration's own access-control system.",
    },
    reason: {
      type: 'string',
      minLength: 1,
      description:
        'Why the requester is asking, in their own words. A hint reaching a human, not an obligation the counterparty must honour.',
    },
  },
  $defs: {
    Response: {
      $anchor: 'response',
      title: 'Approver Access Request — response payload',
      description: "The counterparty's signed decision.",
      type: 'object',
      additionalProperties: false,
      required: ['decision', 'respondedAt'],
      properties: {
        decision: { type: 'string', enum: ['approved', 'denied'] },
        respondedAt: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const

export const RESPONSE_PAYLOAD_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $ref: '#/$defs/Response',
  $defs: PAYLOAD_SCHEMA.$defs,
} as const

/** SPEC.md §7.2 policy for the request variant. Proof REQUIRED: this task carries a real decision, not read-only metadata like discovery. */
export const SPEC = {
  typeUri: TYPE_URI,
  isBearer: false,
  isProofRequired: true,
  isRecipientRequired: true,
  payloadSchema: PAYLOAD_SCHEMA,
} as const

export const RESPONSE_SPEC = {
  typeUri: RESPONSE_TYPE_URI,
  isBearer: false,
  isProofRequired: true,
  isRecipientRequired: true,
  payloadSchema: RESPONSE_PAYLOAD_SCHEMA,
} as const
