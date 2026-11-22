/**
 * A ballot from the member's answers, and why the ballot box would refuse one.
 *
 * The same rules as upstream's `vti_voting::rules::check_ballot` and the browser plugin's `ballotRefusal`, checked here
 * so the member hears about a mistake on the ballot screen, not as a refusal after the cast is built. The agent and
 * the ballot box check again. A refusal names its reason and the question, never the answer given: what a member
 * chose appears nowhere but the ballot and the cast.
 *
 * @module polls/ballot
 */
import type { Answer, Ballot, Manifest, Question } from './pollTasks'

export type BallotRefusalReason =
  | 'otherPoll'
  | 'unknownQuestion'
  | 'answeredTwice'
  | 'notOneAnswer'
  | 'notOptional'
  | 'wrongKind'
  | 'unknownOption'
  | 'selections'
  | 'rankSome'
  | 'rankAll'
  | 'scoreAll'
  | 'scoreRange'
  | 'tooLong'
  | 'unanswered'
  | 'unsupportedQuestion'

export interface BallotRefusal {
  reason: BallotRefusalReason
  /** The question's key, when the reason is about one question. */
  question?: string
}

const KINDS = ['choice', 'ranking', 'scores', 'text', 'abstain'] as const

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Characters as the ballot box counts them (Unicode scalar values), not UTF-16 code units. */
const scalarLength = (s: string) => [...s].length

const optionKeys = (q: Question): Set<string> => new Set(q.type === 'text' ? [] : q.options.map((o) => o.key))

/** Why `ballot` would be refused for `manifest`, or undefined when the ballot box admits it. */
export function ballotRefusal(manifest: Manifest, manifestDigest: string, ballot: Ballot): BallotRefusal | undefined {
  if (ballot.electionId !== manifest.electionId || ballot.manifestDigest !== manifestDigest)
    return { reason: 'otherPoll' }
  const answered = new Set<string>()
  for (const a of ballot.answers as (Answer & Record<string, unknown>)[]) {
    const question = a.question
    const q = manifest.questions.find((x) => x.key === question)
    if (!q) return { reason: 'unknownQuestion', question }
    if (answered.has(question)) return { reason: 'answeredTwice', question }
    answered.add(question)
    // As upstream counts members: an empty `scores` is no answer.
    const present = (k: (typeof KINDS)[number]) =>
      k === 'scores' ? isMap(a.scores) && Object.keys(a.scores).length > 0 : a[k] !== undefined
    if (KINDS.filter(present).length !== 1) return { reason: 'notOneAnswer', question }
    if (a.abstain !== undefined) {
      if (a.abstain !== true) return { reason: 'wrongKind', question }
      if (!q.optional) return { reason: 'notOptional', question }
      continue
    }
    const options = optionKeys(q)
    const unknownOrRepeated = (keys: unknown[]) =>
      new Set(keys).size !== keys.length || keys.some((k) => typeof k !== 'string' || !options.has(k))
    switch (q.type) {
      case 'choice': {
        const c = a.choice
        if (!Array.isArray(c)) return { reason: 'wrongKind', question }
        if (unknownOrRepeated(c)) return { reason: 'unknownOption', question }
        if (c.length < q.minSelections || c.length > q.maxSelections) return { reason: 'selections', question }
        break
      }
      case 'ranking': {
        const r = a.ranking
        if (!Array.isArray(r)) return { reason: 'wrongKind', question }
        if (unknownOrRepeated(r)) return { reason: 'unknownOption', question }
        if (q.partial ? r.length === 0 : r.length !== options.size)
          return { reason: q.partial ? 'rankSome' : 'rankAll', question }
        break
      }
      case 'score': {
        const s = a.scores
        if (!isMap(s)) return { reason: 'wrongKind', question }
        const scored = Object.keys(s)
        if (scored.length !== options.size || scored.some((k) => !options.has(k)))
          return { reason: 'scoreAll', question }
        if (Object.values(s).some((v) => typeof v !== 'number' || !Number.isInteger(v) || v < q.min || v > q.max))
          return { reason: 'scoreRange', question }
        break
      }
      case 'text': {
        if (typeof a.text !== 'string') return { reason: 'wrongKind', question }
        if (scalarLength(a.text) > q.maxLength) return { reason: 'tooLong', question }
        break
      }
      default:
        return { reason: 'unsupportedQuestion', question }
    }
  }
  const missing = manifest.questions.find((q) => !answered.has(q.key))
  return missing ? { reason: 'unanswered', question: missing.key } : undefined
}

/** One answer member for a question, as a screen collects it. */
export type GivenAnswer =
  | { choice: string[] }
  | { ranking: string[] }
  | { scores: Record<string, number> }
  | { text: string }

/** A ballot from the answers given, every question left unanswered abstained, in the manifest's order. */
export function ballotOf(manifest: Manifest, manifestDigest: string, given: Record<string, GivenAnswer>): Ballot {
  return {
    electionId: manifest.electionId,
    manifestDigest,
    answers: manifest.questions.map((q): Answer => {
      const answer = given[q.key]
      return answer ? ({ question: q.key, ...answer } as Answer) : { question: q.key, abstain: true }
    }),
  }
}
