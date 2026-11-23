/**
 * The ballot rules give upstream's answers on upstream's own cases (fixtures/ballot-vectors.json, from
 * vti-voting/tests/rules_and_tally.rs at VTI 3139e00e: `vot_032_a_complete_ballot_passes`,
 * `vot_011_a_ballot_for_another_manifest_is_a_mismatch`, `vot_032_ballot_rules_are_enforced`).
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import { ballotOf, ballotRefusal } from '../ballot'
import type { Answer, Ballot } from '../pollTasks'

const v = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'ballot-vectors.json'), 'utf8'))

const ballot = (answers: unknown[], digest: string = v.manifestDigest): Ballot => ({
  electionId: v.manifest.electionId,
  manifestDigest: digest,
  answers: answers as Answer[],
})

const mutate = (index: number, answer: unknown) => {
  const answers = [...v.fullAnswers]
  answers[index] = answer
  return ballot(answers)
}

describe("the ballot rules, on upstream's cases", () => {
  test('a complete ballot passes', () => {
    expect(ballotRefusal(v.manifest, v.manifestDigest, ballot(v.fullAnswers))).toBeUndefined()
  })

  test('a ballot for another manifest is refused as another poll', () => {
    expect(ballotRefusal(v.manifest, v.manifestDigest, ballot(v.fullAnswers, 'zQmOther'))).toEqual({
      reason: 'otherPoll',
    })
  })

  const refusedCases: [number, number, unknown][] = v.refused.map(
    (c: { index: number; answer: unknown }, i: number) => [i, c.index, c.answer]
  )
  test.each(refusedCases)('case %i is refused', (_i, index, answer) => {
    expect(ballotRefusal(v.manifest, v.manifestDigest, mutate(index, answer))).toBeDefined()
  })

  test('an optional question is answered with abstain, never left out', () => {
    expect(ballotRefusal(v.manifest, v.manifestDigest, ballot(v.fullAnswers.slice(0, -1)))).toEqual({
      reason: 'unanswered',
      question: 'improve',
    })
    const { index, answer } = v.admittedAbstainingTheLast
    expect(ballotRefusal(v.manifest, v.manifestDigest, mutate(index, answer))).toBeUndefined()
  })

  test('a refusal names the question, never the answer given', () => {
    const refusal = ballotRefusal(
      v.manifest,
      v.manifestDigest,
      mutate(4, { question: 'improve', text: 'x'.repeat(41) })
    )
    expect(refusal).toEqual({ reason: 'tooLong', question: 'improve' })
    expect(JSON.stringify(refusal)).not.toContain('xxxx')
  })
})

describe('a ballot from the answers given', () => {
  test("every question in the manifest's order; an unanswered one abstains", () => {
    const b = ballotOf(v.manifest, v.manifestDigest, { budget: { choice: ['no'] }, workshop: { choice: [] } })
    expect(b.answers).toEqual([
      { question: 'budget', choice: ['no'] },
      { question: 'workshop', choice: [] },
      { question: 'formats', abstain: true },
      { question: 'venue', abstain: true },
      { question: 'improve', abstain: true },
    ])
    expect(ballotRefusal(v.manifest, v.manifestDigest, b)).toBeUndefined()
  })
})
