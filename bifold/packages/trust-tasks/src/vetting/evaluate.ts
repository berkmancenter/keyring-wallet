/**
 * What the community will make of the statements an applicant has gathered.
 *
 * The community decides; this is the applicant's advance copy of that
 * decision, and it exists so nobody submits an application that was never
 * going to count. Every rule here is one a community actually applies at
 * intake (`openvtc/docs/design/vetting-process.md` §6.2, §9.3, §10.2), and the
 * failure mode it prevents is the silent one: a statement that verifies
 * perfectly, is discounted for a reason the applicant was never shown, and
 * comes back as an unexplained refusal.
 *
 * Deliberately advisory, and deliberately not a re-implementation of the
 * community's policy engine. Two limits are worth stating plainly because
 * they are structural, not temporary:
 *
 *   - Distinct vetters are counted here **by DID**, while a community counts
 *     them by member record. One person holding two DIDs is two vetters to
 *     this code and one to the community, so the client can be optimistic
 *     where the community is not. It can never be the other way round.
 *   - Declared relationships are self-declared by the vetter. A cap being
 *     within its limit here means nobody *said* otherwise, which is a weaker
 *     claim than the community's, and is reported as such rather than as a
 *     pass.
 *
 * @module vetting/evaluate
 */

import { expiryUnder } from './duration'

/** The community's published vetting requirement, as much of it as bears on counting. */
export interface VettingRequirements {
  minStatements: number
  /** Per-method floors, e.g. at least one `inPerson`. */
  minByMethod?: Record<string, number>
  /** Methods that count at all. Absent means the community accepts any. */
  acceptedMethods?: string[]
  /** ISO 8601 duration. A statement older than this at submit does not count. */
  maxStatementAge?: string
  independence?: {
    maxByDeclaredRelationship?: Record<string, number>
    requireConsistentIdentityCommitment?: boolean
  }
}

/** Why a gathered statement will not count. */
export type DiscountReason =
  | 'method-not-accepted'
  | 'too-old'
  | 'expired'
  | 'duplicate-vetter'
  | 'commitment-mismatch'
  | 'wrong-subject'

/** One statement as this evaluation reads it. */
export interface StatementFacts {
  /** The vetter who signed it. */
  issuer: string
  /** Who it is about — must be this application's join DID. */
  subject?: string
  signedAt?: string
  expiresAt?: string
  method?: string
  identityCommitment?: string
  declaredRelationship?: string
}

export interface VettingEvaluation {
  /** Statements that will count. */
  counted: StatementFacts[]
  /** Statements that will not, each with the reason. */
  discounted: { statement: StatementFacts; reason: DiscountReason }[]
  /** What is still missing, in the community's terms. */
  needs: { kind: 'statements' | 'method'; method?: string; n: number }[]
  meets: boolean
  /**
   * False when a declared-relationship cap is exceeded. The community refers
   * these for review rather than refusing them, so this does not make `meets`
   * false on its own — it is a warning that a human will look.
   */
  independenceOk: boolean
  /** Caps that are over, for saying which. */
  exceededCaps: { relationship: string; limit: number; seen: number }[]
  /**
   * Set when `maxStatementAge` was published but could not be parsed. No age
   * limit was applied, and that is a thing to say rather than to swallow: the
   * applicant's count is then more optimistic than the community's.
   */
  unreadableMaxAge?: string
}

/**
 * Read the facts this evaluation needs out of an endorsement credential.
 * Tolerates a credential that is missing pieces — a statement that says
 * nothing about its method is judged on what it does say.
 */
export function statementFacts(credential: Record<string, unknown>): StatementFacts {
  const subject = credential.credentialSubject as { id?: string; endorsement?: Record<string, unknown> } | undefined
  const endorsement = subject?.endorsement ?? {}
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
  return {
    issuer: str(credential.issuer) ?? str((credential.issuer as { id?: string })?.id) ?? '',
    subject: str(subject?.id),
    signedAt: str(credential.validFrom) ?? str((credential as { issuanceDate?: string }).issuanceDate),
    expiresAt: str(credential.validUntil),
    method: str(endorsement.method),
    identityCommitment: str(endorsement.identityCommitment),
    declaredRelationship: str(endorsement.declaredRelationship),
  }
}

/**
 * Evaluate gathered statements against the published requirement.
 *
 * `joinDid` is this application's subject; `at` is the moment to judge ages
 * against, which is the submit, not when the statements arrived.
 */
export function evaluateStatements(
  statements: StatementFacts[],
  requirements: VettingRequirements,
  joinDid: string,
  at: Date = new Date()
): VettingEvaluation {
  const discounted: VettingEvaluation['discounted'] = []
  const drop = (statement: StatementFacts, reason: DiscountReason) => {
    discounted.push({ statement, reason })
    return false
  }

  let unreadableMaxAge: string | undefined
  const accepted = requirements.acceptedMethods
  const surviving = statements.filter((s) => {
    if (s.subject && s.subject !== joinDid) return drop(s, 'wrong-subject')
    if (accepted?.length && s.method && !accepted.includes(s.method)) return drop(s, 'method-not-accepted')
    // A statement carries its own expiry, which the vetter set from the
    // community's limit at signing time. Both are checked: the community may
    // have shortened the limit since, and the statement's own expiry binds
    // even when the published limit is unreadable.
    if (s.expiresAt && new Date(s.expiresAt).getTime() <= at.getTime()) return drop(s, 'expired')
    if (requirements.maxStatementAge && s.signedAt) {
      const expiry = expiryUnder(s.signedAt, requirements.maxStatementAge)
      if (!expiry) unreadableMaxAge = requirements.maxStatementAge
      else if (expiry.getTime() <= at.getTime()) return drop(s, 'too-old')
    }
    return true
  })

  // Distinct vetters. The community counts by member record; this counts by
  // DID, so the first statement from a DID stands and any later one from the
  // same DID is surplus rather than a second voice.
  const seenVetters = new Set<string>()
  const distinct = surviving.filter((s) => {
    if (seenVetters.has(s.issuer)) return drop(s, 'duplicate-vetter')
    seenVetters.add(s.issuer)
    return true
  })

  // The commitment ties every statement to the same declared face. When the
  // community requires consistency, the majority commitment stands and the
  // odd one out is the one that does not count — a vetter who endorsed a
  // different set of claims did not endorse this application.
  let counted = distinct
  if (requirements.independence?.requireConsistentIdentityCommitment && distinct.length > 1) {
    const tally = new Map<string, number>()
    for (const s of distinct) if (s.identityCommitment) tally.set(s.identityCommitment, (tally.get(s.identityCommitment) ?? 0) + 1)
    const [majority] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
    if (majority) counted = distinct.filter((s) => !s.identityCommitment || s.identityCommitment === majority)
    for (const s of distinct) if (!counted.includes(s)) discounted.push({ statement: s, reason: 'commitment-mismatch' })
  }

  const needs: VettingEvaluation['needs'] = []
  const short = requirements.minStatements - counted.length
  if (short > 0) needs.push({ kind: 'statements', n: short })
  for (const [method, floor] of Object.entries(requirements.minByMethod ?? {})) {
    const have = counted.filter((s) => s.method === method).length
    if (have < floor) needs.push({ kind: 'method', method, n: floor - have })
  }

  // Relationship caps are the community's, applied to what vetters declared
  // about themselves. Over a cap is a referral, not a refusal, so it does not
  // enter `needs` — it is surfaced on its own.
  const exceededCaps: VettingEvaluation['exceededCaps'] = []
  for (const [relationship, limit] of Object.entries(requirements.independence?.maxByDeclaredRelationship ?? {})) {
    const seen = counted.filter((s) => s.declaredRelationship === relationship).length
    if (seen > limit) exceededCaps.push({ relationship, limit, seen })
  }

  return {
    counted,
    discounted,
    needs,
    meets: needs.length === 0,
    independenceOk: exceededCaps.length === 0,
    exceededCaps,
    unreadableMaxAge,
  }
}
