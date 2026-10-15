/**
 * The vetter's seven `vta/pcs/*` payloads, mirrored from the registry.
 *
 * The applicant's five are in `pcsVtaPayloads.ts`; these are the other half of
 * the twelve. Same division of labour: the **agent** holds the vetter's root
 * credential, its tokens and its key, and builds every attestation; Keyring
 * carries messages and never sees a secret.
 *
 * Written out by hand for the same reason as the applicant's five — the
 * generated types ship in `@openvtc/trust-tasks` 0.26.1 and this repository is
 * pinned at 0.9.0 behind the Cypress lock, which has no `vta/pcs` types at all.
 * `__tests__/pcsVetterTasks.test.ts` grades every payload here against the
 * registry's own schemas, so upstream checks our shapes while the dependency
 * stays put.
 *
 * @module trust-tasks/module/pcsVetterTasks
 */
import { HIDDEN_VETTING_SUITE, type PublishedConfig } from './pcsVtaPayloads'

/** The seven task types of the vetter's side. */
export const PCS_VETTER_TASK = {
  /** The engine's summary: labels, token counts, draws in flight. A read. */
  vetterShow: 'https://trusttasks.org/spec/vta/pcs/vetter/show/0.1',
  /** Ask the agent to build an enrolment request for a period's label. */
  rootRequest: 'https://trusttasks.org/spec/vta/pcs/root-request/0.1',
  /** Hand the community's answer back to the agent, which keeps the credential. */
  rootAccept: 'https://trusttasks.org/spec/vta/pcs/root-accept/0.1',
  /** Ask the agent to build a token draw for this tick. */
  tokensRequest: 'https://trusttasks.org/spec/vta/pcs/tokens/request/0.1',
  /** Hand the community's tokens back to the agent. */
  tokensAccept: 'https://trusttasks.org/spec/vta/pcs/tokens/accept/0.1',
  /** Give up a draw that cannot be completed, so the next one is not refused. */
  tokensAbandon: 'https://trusttasks.org/spec/vta/pcs/tokens/abandon/0.1',
  /** Build an attestation for an applicant, spending one token. */
  attest: 'https://trusttasks.org/spec/vta/pcs/attest/0.1',
} as const

/** What the community's own tasks are called, which the phone carries the vetter's documents to. */
export const VTC_VETTER_TASK = {
  pcsRoot: 'https://trusttasks.org/spec/vtc/vetting/vetters/pcs-root/0.1',
  pcsTokens: 'https://trusttasks.org/spec/vtc/vetting/vetters/pcs-tokens/0.1',
} as const

/** `vta/pcs/vetter/show/0.1`. */
export interface VetterShowPayload {
  contextId: string
  community: string
}

/**
 * What the agent reports about this vetter, for one community.
 *
 * Note what is **not** here: no draw times and no enrolment expiry. The agent
 * holds no clock for either, so a screen that wants "next draw" or "enrolled
 * until" cannot be told by the agent — see `hiddenVetterAdapter`, which keeps
 * the draw time locally and leaves the expiry undefined rather than inferring
 * one from the label's name.
 */
export interface VetterStanding {
  contextId: string
  community: string
  memberDid?: string
  suite?: string
  /** The vetter's PCS identifier. Not a secret, and never sent to a community. */
  id?: string
  enrolledLabels?: string[]
  pendingLabels?: string[]
  /** Unspent tokens: how many more people this vetter can vouch for now. */
  tokensFree?: number
  /** Every token drawn for the label, spent or not. */
  tokensHeld?: number
  drawsInFlight?: unknown[]
  attested?: number
}

/** `vta/pcs/root-request/0.1`. The agent builds the request; the phone carries it to the community. */
export interface RootRequestPayload {
  contextId: string
  community: string
  /** The vetter's member DID at this community — what the community knows them as. */
  memberDid: string
  parameters: PublishedConfig
  /** The period being enrolled for, e.g. `vetter/2026-10`. */
  label: string
}

/**
 * `vta/pcs/root-accept/0.1`. The community's enrolment answer, handed back.
 *
 * **Not an opaque blob**, though it is tempting to treat it as one: the schema
 * declares `label` and `preCredential` and refuses anything else, so the
 * community's answer has to be unwrapped to those two members rather than
 * forwarded whole. Writing it as `unknown` compiled and would have been
 * refused by the agent.
 */
export interface RootAcceptPayload {
  contextId: string
  community: string
  parameters: PublishedConfig
  response: {
    /** The period this enrolment is for, as the community issued it. */
    label: string
    /** The blinded credential the agent completes with its own key. */
    preCredential: string
  }
}

/** `vta/pcs/tokens/request/0.1`. */
export interface TokensRequestPayload {
  contextId: string
  community: string
  parameters: PublishedConfig
  /** The token label being drawn against, e.g. `token/2026-10`. */
  label: string
  /** Which tick this draw is for. A community refuses a draw ahead of its tick. */
  tick: number
  /** Never more than the published `dripPerTick`; the agent refuses `countExceedsDrip`. */
  count: number
}

/**
 * `vta/pcs/tokens/accept/0.1`. The drawn tokens, as the community issued them.
 *
 * Like `root-accept`, the response is declared and closed: `label`, `tick` and
 * a list of `preCredentials`, one per token drawn.
 */
export interface TokensAcceptPayload {
  contextId: string
  community: string
  parameters: PublishedConfig
  response: {
    label: string
    /** The tick these tokens were drawn for; the agent checks it against the draw. */
    tick: number
    preCredentials: string[]
  }
}

/** `vta/pcs/tokens/abandon/0.1`. */
export interface TokensAbandonPayload {
  contextId: string
  community: string
  /**
   * The draw being given up, named the way the engine names one: a `TokenDraw`
   * of `{label, tick}`, not an opaque id. `drawsInFlight` lists them in the
   * same shape.
   */
  draw: { label: string; tick: number }
}

/** The relationship a vetter declares, exactly as the registry's enum has it. */
export const DECLARED_RELATIONSHIPS = ['none', 'family', 'sameEmployer', 'closeFriend', 'other'] as const
/** How the vetting was done. A community publishes which of these it accepts. */
export const VOUCH_METHODS = ['inPerson', 'video', 'priorAcquaintance'] as const

/**
 * The ten members of an attestation's `meta`, all required.
 *
 * Only three are a person's answer — `method`, `claimsVerified`,
 * `livenessConfirmed` — plus `declaredRelationship`, which is a judgement the
 * vetter makes and nothing else can supply. The rest are read from the
 * request, the criterion and the clock.
 */
export interface AttestMeta {
  community: string
  /** The criterion's digest, as the community serves it now: the proof binds to it. */
  requirementsDigest: string
  method: (typeof VOUCH_METHODS)[number]
  claimsVerified: string[]
  livenessConfirmed: boolean
  declaredRelationship: (typeof DECLARED_RELATIONSHIPS)[number]
  /** The applicant's commitment, from their request. */
  identityCommitment: string
  /** The Vetting Card the vetter was shown, by digest. */
  cardDigestMultibase: string
  validFrom: string
  validUntil: string
}

/** `vta/pcs/attest/0.1`. One token is spent; the attestation names no vetter. */
export interface AttestPayload {
  contextId: string
  community: string
  parameters: PublishedConfig
  /** The applicant's PCS id, from their request's hidden-vetting ext. */
  applicantId: string
  meta: AttestMeta
  /** Which token label to spend from, when the vetter holds more than one. */
  preferLabel?: string
}

/**
 * The vetter-side refusals, as `payload.code` of a `trust-task-error`.
 *
 * Grouped by what a person can do about them, because that is what a screen
 * has to say — not by which task raised them.
 */
export const PCS_VETTER_ERROR = {
  /** Not enrolled for this period: enrol first. */
  attestNotEnrolled: 'vta/pcs/attest:notEnrolled',
  /** No unspent token: draw at the next tick. */
  attestNoToken: 'vta/pcs/attest:noToken',
  /** The applicant's id is not one this engine can attest to. */
  attestApplicantInvalid: 'vta/pcs/attest:applicantInvalid',
  attestCommunityMismatch: 'vta/pcs/attest:communityMismatch',
  /** The community closed the label; nothing the vetter can do but wait for the next. */
  rootLabelNotLive: 'vta/pcs/root-request:labelNotLive',
  tokensLabelNotLive: 'vta/pcs/tokens/request:labelNotLive',
  /** Asked for more than this tick allows. */
  countExceedsDrip: 'vta/pcs/tokens/request:countExceedsDrip',
  /** A draw is already running, or an answer arrived twice. */
  drawAlreadyInFlight: 'vta/pcs/tokens/request:alreadyInFlight',
  noDrawInFlight: 'vta/pcs/tokens/accept:noDrawInFlight',
  /** No vetter engine for this community at this agent: not a vetter here. */
  vetterNotFound: 'vta/pcs/vetter/show:notFound',
  rootNoRequestInFlight: 'vta/pcs/root-accept:noRequestInFlight',
} as const

/** Whether an error means "this phone is not a vetter for that community", which reads as "not enrolled". */
export function isNotAVetter(code: string | undefined): boolean {
  return code === PCS_VETTER_ERROR.vetterNotFound
}

/**
 * The parameters to send on a vetter task, which are the community's published
 * ones unchanged — the same object the applicant side sends.
 *
 * Re-exported rather than re-derived so the two halves cannot drift: a vetter
 * and an applicant must be working under the same published keys or the
 * attestation will not verify.
 */
export { HIDDEN_VETTING_SUITE }
export type { PublishedConfig }
