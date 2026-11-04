/**
 * A voter's Trust Tasks: what the phone sends to read a community's polls, take a ticket, vote and keep the receipt,
 * and what it reads back.
 *
 * Three parties, and the phone holds no voting key (VTA 0.69's `pcs_voter.rs`):
 * - **The community** answers the reads and issues the ticket, blind. Reads go over the phone's community session as
 *   the member's identity, as every other community read does; the ticket request is a document the member's agent
 *   signs as that identity, sent unchanged.
 * - **The member's agent** keeps the voter key for the poll, unblinds the ticket, builds and signs each cast under a
 *   key made for that cast alone, and keeps the receipt.
 * - **The ballot box** takes the cast over HTTPS (`ballotBox.ts`) and never learns whose it is.
 *
 * The browser plugin's `elections.ts` (vta-browser-plugin #404, #406) is the reference client. Its reads go through
 * `vta/pcs/voter/read` because a browser holds no key of the member's identity; this phone's session signs as that
 * identity itself, so the read is one hop, not two.
 *
 * The types are mirrored by hand. `__tests__/pollTasks.test.ts` grades every payload built here, and the answers
 * parsed, against upstream's own bundles (`__tests__/fixtures/polls-schemas`).
 *
 * @module polls/pollTasks
 */

const SPEC = 'https://trusttasks.org/spec'

/** The tasks that don't move with a generation. */
export const POLL_TASK = {
  accept: `${SPEC}/vta/pcs/voter/accept/0.1`,
  cast: `${SPEC}/voting/ballot/cast/0.1`,
  receipt: `${SPEC}/vta/pcs/voter/receipt/0.1`,
} as const

/**
 * The versions that have to move together, newest first. The manifest a read returns goes to the agent to register and
 * to vote, and the agent's register answer holds the ticket request the community then gets (`vtc/elections/tickets/issue`
 * 0.3 from register 0.5, else 0.1; the phone sends it unchanged, so it names no version), so a read at one generation is
 * followed through at that generation. A poll is asked for at the newest one both sides serve.
 *
 * - The newest: VTC 0.19 and VTA 0.71. Its manifest can name a credential roll.
 * - The middle: VTC 0.18 and VTA 0.70. Its manifest can release written answers after fewer than 10 ballots.
 * - The oldest: VTC 0.15 and VTA 0.69. A community from 0.18 refuses it a manifest it can't carry, `unsupportedVersion`.
 *
 * A manifest's members, and so its digest, read the same at every generation that can carry it, so a ticket taken at
 * one is good at the next.
 *
 * @versionLadder
 */
export const POLL_GENERATIONS = [
  {
    list: `${SPEC}/vtc/elections/list/0.5`,
    show: `${SPEC}/vtc/elections/show/0.6`,
    register: `${SPEC}/vta/pcs/voter/register/0.5`,
    vote: `${SPEC}/vta/pcs/vote/0.4`,
  },
  {
    list: `${SPEC}/vtc/elections/list/0.3`,
    show: `${SPEC}/vtc/elections/show/0.3`,
    register: `${SPEC}/vta/pcs/voter/register/0.3`,
    vote: `${SPEC}/vta/pcs/vote/0.3`,
  },
  {
    list: `${SPEC}/vtc/elections/list/0.3`,
    show: `${SPEC}/vtc/elections/show/0.2`,
    register: `${SPEC}/vta/pcs/voter/register/0.2`,
    vote: `${SPEC}/vta/pcs/vote/0.2`,
  },
] as const

export type PollGeneration = (typeof POLL_GENERATIONS)[number]

/**
 * The generation an agent votes at, as an index into `POLL_GENERATIONS`, or -1 for an agent that serves none.
 *
 * @versionLadder
 */
export const agentGenerationIndex = (served: readonly string[]): number =>
  served.includes(POLL_TASK.accept) && served.includes(POLL_TASK.receipt)
    ? POLL_GENERATIONS.findIndex((g) => served.includes(g.register) && served.includes(g.vote))
    : -1

/** A poll's state as the community holds it (`RegistrarState`). */
export type PollState =
  | 'registered'
  | 'registration'
  | 'voting'
  | 'closed'
  | 'tallied'
  | 'cancelled'
  | 'pendingRegistration'
  | 'registrationRefused'

/** One poll as `vtc/elections/list` lists it. */
export interface PollListItem {
  electionId: string
  title?: string
  state: PollState
  votingOpensAt: string
  votingClosesAt: string
  binding: boolean
  /** Whether the community issued this caller a ticket. About the caller only. */
  ticketHeld: boolean
}

export interface QuestionOption {
  key: string
  text?: string
}

export type Question =
  | {
      key: string
      type: 'choice'
      text?: string
      options: QuestionOption[]
      minSelections: number
      maxSelections: number
      optional: boolean
    }
  | { key: string; type: 'ranking'; text?: string; options: QuestionOption[]; partial: boolean; optional: boolean }
  | {
      key: string
      type: 'score'
      text?: string
      options: QuestionOption[]
      min: number
      max: number
      optional: boolean
    }
  | { key: string; type: 'text'; text?: string; maxLength: number; optional: boolean }

export type SecrecyLevel = 'open' | 'sealed' | 'talliedEncrypted'

/** What a poll asks and how it is decided. Its digest binds every cast (VTI-VOT-010, VTI-VOT-011). */
export interface Manifest {
  electionId: string
  community: string
  title?: string
  description?: string
  questions: Question[]
  secrecy: SecrecyLevel
  roll: { rule: 'members' | 'membersAndListed' | 'listed' | 'credential'; listed?: string[]; memberOf?: string }
  registrationOpensAt: string
  votingOpensAt: string
  votingClosesAt: string
  revote: 'replace' | 'refuse'
  board: { visibility: 'public' | 'private'; auditors: string[] }
  ballotBox: string
  binding: boolean
  allowEarlyClose: boolean
  resultsBeforeClose: boolean
  textReleaseThreshold: number
  [other: string]: unknown
}

/** The community's statement about how one poll is run, shown before a ticket is taken (VTI-VOT-090). */
export interface Disclosure {
  ballotBox: string
  ballotBoxOperator: string
  sameOperator: boolean
  boardVisibility: 'public' | 'private'
  auditors: string[]
  revote: 'replace' | 'refuse'
  /** Always false upstream: a voter can prove how they voted. */
  coercionResistance: false
  [other: string]: unknown
}

export interface VotingParameters {
  suite: 'ps-ddh-bls12381'
  votingKey: string
}

export interface QuestionResult {
  question: string
  abstained: number
  choice?: Record<string, number>
  ranking?: Record<string, number[]>
  score?: Record<string, { sum: number; count: number }>
  text?: string[]
  withheld?: boolean
}

/** A certified result: what the member reads once a poll is done (`voting/result/show` refuses a voter on a private board). */
export interface Certification {
  certifiedAt: string
  result: { electionId: string; manifestDigest: string; ballotsCounted: number; questions: QuestionResult[] }
}

/** One poll read whole (`vtc/elections/show`). */
export interface PollShown {
  manifest: Manifest
  manifestDigest: string
  state: PollState
  parameters: VotingParameters
  disclosure: Disclosure
  certified?: Certification
  ticketsIssued?: number
}

/** One answer: exactly one of the members besides `question`, or `abstain` for an optional question. */
export type Answer = { question: string } & (
  | { choice: string[] }
  | { ranking: string[] }
  | { scores: Record<string, number> }
  | { text: string }
  | { abstain: true }
)

export interface Ballot {
  electionId: string
  manifestDigest: string
  answers: Answer[]
}

/** Where the member votes from: the identity the roll admits, and the agent context its voter key is made in. */
export interface VoterTarget {
  contextId: string
  community: string
  member: string
}

export interface RegisterPayload {
  contextId: string
  community: string
  member: string
  parameters: VotingParameters
  manifest: Manifest
}

/** `vta/pcs/voter/register`: the blinded request, and — `member` named — that request signed as the member. */
export function registerPayload(t: VoterTarget, shown: Pick<PollShown, 'parameters' | 'manifest'>): RegisterPayload {
  return {
    contextId: t.contextId,
    community: t.community,
    member: t.member,
    parameters: shown.parameters,
    manifest: shown.manifest,
  }
}

export function acceptPayload(
  t: VoterTarget,
  electionId: string,
  parameters: VotingParameters,
  issued: Record<string, unknown>
): Record<string, unknown> {
  return { contextId: t.contextId, community: t.community, electionId, parameters, response: issued }
}

export function votePayload(t: VoterTarget, shown: Pick<PollShown, 'parameters' | 'manifest'>, ballot: Ballot) {
  return {
    contextId: t.contextId,
    community: t.community,
    parameters: shown.parameters,
    manifest: shown.manifest,
    ballot,
  }
}

export function receiptPayload(
  t: VoterTarget,
  electionId: string,
  receipt: Record<string, unknown>
): Record<string, unknown> {
  return { contextId: t.contextId, community: t.community, electionId, receipt }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0

/** A list page's polls, each checked for the members a screen reads. One that lacks them is left out. */
export function parsePollList(payload: unknown): { polls: PollListItem[]; nextCursor?: string } {
  const page = isObject(payload) ? payload : {}
  const polls = (Array.isArray(page.elections) ? page.elections : []).filter(
    (e): e is PollListItem =>
      isObject(e) &&
      isString(e.electionId) &&
      isString(e.state) &&
      isString(e.votingOpensAt) &&
      isString(e.votingClosesAt) &&
      typeof e.binding === 'boolean' &&
      typeof e.ticketHeld === 'boolean'
  )
  return { polls, ...(isString(page.nextCursor) ? { nextCursor: page.nextCursor } : {}) }
}

/** One poll read whole, or undefined when the answer lacks what a ticket or a ballot needs. */
export function parsePollShown(payload: unknown): PollShown | undefined {
  if (!isObject(payload)) return undefined
  const { manifest, manifestDigest, state, parameters, disclosure } = payload
  if (!isObject(manifest) || !isString(manifest.electionId) || !Array.isArray(manifest.questions)) return undefined
  if (!isString(manifest.ballotBox) || !isString(manifest.secrecy)) return undefined
  if (!isString(manifestDigest) || !isString(state)) return undefined
  if (!isObject(parameters) || !isString(parameters.votingKey)) return undefined
  if (!isObject(disclosure) || !isString(disclosure.ballotBox)) return undefined
  return payload as unknown as PollShown
}

/** `vta/pcs/voter/register`'s answer. The ticket document is there only when `member` was named. */
export function parseRegistered(
  payload: unknown
): { electionId: string; manifestDigest: string; ticketDocument: Record<string, unknown> } | undefined {
  if (!isObject(payload) || !isString(payload.electionId) || !isString(payload.manifestDigest)) return undefined
  if (!isObject(payload.ticketDocument)) return undefined
  return {
    electionId: payload.electionId,
    manifestDigest: payload.manifestDigest,
    ticketDocument: payload.ticketDocument,
  }
}

/** `vta/pcs/vote`'s answer: the whole signed cast, sent as it is. */
export function parseVoted(payload: unknown): { castDocument: Record<string, unknown>; tag: string } | undefined {
  if (!isObject(payload) || !isObject(payload.castDocument) || !isString(payload.tag)) return undefined
  return { castDocument: payload.castDocument, tag: payload.tag }
}

/** The ballot box's answer to a cast (`voting/ballot/cast/0.1#response`), read from its payload. */
export function parseCastAnswer(
  payload: unknown
): { electionId: string; outcome: 'counted' | 'replaced' | 'alreadyCounted'; leafIndex: number } | undefined {
  if (!isObject(payload) || !isString(payload.electionId) || typeof payload.leafIndex !== 'number') return undefined
  const outcome = payload.outcome
  if (outcome !== 'counted' && outcome !== 'replaced' && outcome !== 'alreadyCounted') return undefined
  return { electionId: payload.electionId, outcome, leafIndex: payload.leafIndex }
}

/** The local part of a refusal's code: `vtc/elections/tickets/issue:notOpen` → `notOpen`. */
export function refusalName(code: string | undefined): string | undefined {
  if (!code) return undefined
  return code.slice(code.lastIndexOf(':') + 1) || undefined
}
