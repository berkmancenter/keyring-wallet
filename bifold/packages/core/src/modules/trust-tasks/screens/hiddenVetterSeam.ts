/**
 * hiddenVetterSeam — what the private-vetter screens ask of the module that
 * lets this person vouch privately in a community that runs hidden vetting:
 * their agent enrols as a vetter for each period, draws tokens on each tick,
 * and attests from a token after a session, so the community learns that
 * enough members vouched, never which. The screens never call that module
 * directly: it registers itself here, and a build without it registers
 * nothing, so nothing private is offered.
 *
 * @module trust-tasks/screens/hiddenVetterSeam
 */

import type { Agent } from '@credo-ts/core'

import type { VtiCriterion } from '../module/joinManifest'

/** Where this person's agent stands as a private vetter for one community. */
export interface HiddenVetterStanding {
  /** Enrolled for the community's current vetter period. */
  enrolled: boolean
  /** The period's label, as the community names it ("vetter/2026-10"). */
  period?: string
  /** When this period's enrolment ends. */
  enrolledUntil?: string
  /** Free tokens for the current token label (the agent's tokensFree): how many people they can still vouch for now. */
  tokens: number
  tokenLabel?: string
  /** When this phone last drew. Kept by the phone, not the agent: unknown on a new or restored phone. */
  lastDrawAt?: string
  /** When the next draw is due (last draw plus the community's tick). Unknown without a last draw. */
  nextDrawAt?: string
  /** When the current tick ends: a tick not drawn by then is lost. */
  lapsesAt?: string
  /**
   * Why this vetter cannot vouch privately here at all, when they cannot.
   * `memberMismatch`: the agent was enrolled under another identity by an
   * earlier build, which the agent cannot change.
   */
  stuck?: 'memberMismatch'
}

/** A private vetting request waiting for this vetter. They meet the person, so they know who it is. */
export interface HiddenVetterRequest {
  id: string
  applicantDid: string
  /** The name the applicant shared, if any. */
  applicantName?: string
  receivedAt: string
  /** The way the applicant asked to be vetted, when they said. */
  method?: string
}

/**
 * How the vetter knows the person, as they declare it. Required by the
 * attestation and a human judgement, so it is asked, never filled in.
 */
export const DECLARED_RELATIONSHIPS = ['none', 'family', 'sameEmployer', 'closeFriend', 'other'] as const
export type DeclaredRelationship = (typeof DECLARED_RELATIONSHIPS)[number]

/** How the vetter met the person: only those the criterion accepts are offered. */
export const VOUCH_METHODS = ['inPerson', 'video', 'priorAcquaintance'] as const
export type VouchMethod = (typeof VOUCH_METHODS)[number]

/** What the vetter confirms after the session; the module fills in the rest from the request and the criterion. */
export interface HiddenVetterStatement {
  method: VouchMethod
  claimsVerified: string[]
  livenessConfirmed: boolean
  declaredRelationship: DeclaredRelationship
}

export interface HiddenVetterSeam {
  /**
   * Where the agent stands (vta/pcs/vetter/show). Not free: the agent's
   * policy may ask an approver, so only on a screen the person opened or a
   * tap, never to decorate a list. `vetter/show:notFound`: never enrolled.
   */
  standing(agent: Agent, communityDid: string, criterion: VtiCriterion): Promise<HiddenVetterStanding>
  /** Enrol for the current period. Only on the person's tap. */
  enrol(agent: Agent, communityDid: string, criterion: VtiCriterion): Promise<void>
  /** Draw this tick's tokens. On a tap, and when the screen opens with a draw due. */
  drawTokens(agent: Agent, communityDid: string, criterion: VtiCriterion): Promise<{ drawn: number }>
  requests(agent: Agent, communityDid: string): Promise<HiddenVetterRequest[]>
  /** Attest from a token. The attestation goes to the applicant; nothing names this vetter to the community. */
  attest(agent: Agent, requestId: string, statement: HiddenVetterStatement): Promise<void>
  decline(agent: Agent, requestId: string): Promise<void>
}

let registered: HiddenVetterSeam | undefined

/** The private-vetter module registers itself; a test registers a fake. `undefined` takes it away. */
export function registerHiddenVetter(seam: HiddenVetterSeam | undefined): void {
  registered = seam
}

/** The registered module, or undefined in a build that does not carry it. */
export function hiddenVetterSeam(): HiddenVetterSeam | undefined {
  return registered
}

/**
 * Whether a draw is due now: only when the next draw time is known and has
 * come. Unknown (a new or restored phone has no last draw) is not "due": the
 * screen offers a draw when no tokens are left, and says nothing else.
 */
export function drawDue(standing: HiddenVetterStanding | undefined, now: number): boolean {
  if (!standing?.enrolled || !standing.nextDrawAt) return false
  return Date.parse(standing.nextDrawAt) <= now
}
