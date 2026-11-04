/**
 * A voter's payloads, graded by upstream's own bundles (fixtures/polls-schemas, see its README).
 *
 * The types in pollTasks.ts are mirrored by hand, so upstream's schemas judge the shapes: every payload the phone
 * builds must validate against the task's payload schema, and every answer these tests hand the parsers must validate
 * against the task's response schema, so a parser is never tested on an answer upstream would never send.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import Ajv from 'ajv/dist/2020'

import {
  POLL_GENERATIONS,
  POLL_TASK,
  agentGenerationIndex,
  acceptPayload,
  parseCastAnswer,
  parsePollList,
  parsePollShown,
  parseVoted,
  receiptPayload,
  registerPayload,
  votePayload,
  type PollShown,
} from '../pollTasks'
import { ballotOf } from '../ballot'

const DIR = join(__dirname, 'fixtures', 'polls-schemas')
const bundle = (name: string) =>
  JSON.parse(readFileSync(join(DIR, `${name}.bundle.json`), 'utf8')) as {
    typeUri: string
    schema: object
    responseSchema: object
  }
const vectors = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'ballot-vectors.json'), 'utf8'))

/** A validator for one bundle's payload or response schema; its errors are returned so a failure says why. */
function grader(name: string, which: 'schema' | 'responseSchema') {
  const ajv = new Ajv({ strict: false, allErrors: true, logger: false, validateFormats: false })
  const validate = ajv.compile(bundle(name)[which])
  return (value: unknown) =>
    validate(value) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`)
}

/** Each generation's bundles, in `POLL_GENERATIONS`' order. */
const GENERATIONS = [
  {
    list: 'vtc-elections-list-0.5',
    show: 'vtc-elections-show-0.6',
    ticketsIssue: 'vtc-elections-tickets-issue-0.3',
    register: 'vta-pcs-voter-register-0.5',
    vote: 'vta-pcs-vote-0.4',
  },
  {
    list: 'vtc-elections-list-0.3',
    show: 'vtc-elections-show-0.3',
    ticketsIssue: 'vtc-elections-tickets-issue-0.1',
    register: 'vta-pcs-voter-register-0.3',
    vote: 'vta-pcs-vote-0.3',
  },
  {
    list: 'vtc-elections-list-0.3',
    show: 'vtc-elections-show-0.2',
    ticketsIssue: 'vtc-elections-tickets-issue-0.1',
    register: 'vta-pcs-voter-register-0.2',
    vote: 'vta-pcs-vote-0.2',
  },
] as const

const FIXED = {
  accept: 'vta-pcs-voter-accept-0.1',
  cast: 'voting-ballot-cast-0.1',
  receipt: 'vta-pcs-voter-receipt-0.1',
} as const

const BUNDLES = { ...GENERATIONS[2], ...FIXED }

const target = {
  contextId: 'vta',
  community: vectors.manifest.community,
  member: 'did:webvh:QmPersona:vtc.example.org:p',
}

const shown: PollShown = {
  manifest: vectors.manifest,
  manifestDigest: vectors.manifestDigest,
  state: 'voting',
  parameters: { suite: 'ps-ddh-bls12381', votingKey: 'z6MkvotingKey' },
  disclosure: {
    ballotBox: vectors.manifest.ballotBox,
    ballotBoxOperator: 'Vote Example',
    sameOperator: false,
    boardVisibility: 'private',
    auditors: vectors.manifest.board.auditors,
    revote: 'replace',
    coercionResistance: false,
  },
}
const showAnswer = { ...shown, checkpoints: [] }

describe('the voter tasks against upstream bundles', () => {
  test.each(Object.entries(FIXED))('%s names the version its bundle is', (key, name) => {
    expect(POLL_TASK[key as keyof typeof POLL_TASK]).toBe(bundle(name).typeUri)
  })

  test.each([0, 1, 2])('generation %i names the versions its bundles are', (i) => {
    const { ticketsIssue: _sentAsTheAgentBuiltIt, ...named } = GENERATIONS[i]
    for (const [key, name] of Object.entries(named)) {
      expect(POLL_GENERATIONS[i][key as keyof (typeof POLL_GENERATIONS)[number]]).toBe(bundle(name).typeUri)
    }
  })

  describe.each([0, 1, 2])('at generation %i', (i) => {
    const g = GENERATIONS[i]

    test('the reads the phone sends, and a show answer upstream sends', () => {
      expect(grader(g.list, 'schema')({ cursor: 'c2', state: 'voting' })).toEqual([])
      expect(grader(g.show, 'schema')({ electionId: vectors.manifest.electionId })).toEqual([])
      expect(grader(g.show, 'responseSchema')(showAnswer)).toEqual([])
    })

    test('the register and vote payloads the phone builds', () => {
      const given = Object.fromEntries(
        vectors.fullAnswers.map(({ question, ...answer }: { question: string }) => [question, answer])
      )
      const ballot = ballotOf(shown.manifest, shown.manifestDigest, given)
      expect(grader(g.register, 'schema')(registerPayload(target, shown))).toEqual([])
      expect(grader(g.vote, 'schema')(votePayload(target, shown, ballot))).toEqual([])
    })
  })

  // Why the versions move together: each manifest travels only at the generations that can carry it.
  test('a threshold under 10 travels from the middle generation; the oldest forbids it', () => {
    const manifest = { ...shown.manifest, textReleaseThreshold: 5 }
    const payload = registerPayload(target, { ...shown, manifest })
    expect(grader(GENERATIONS[0].register, 'schema')(payload)).toEqual([])
    expect(grader(GENERATIONS[1].register, 'schema')(payload)).toEqual([])
    expect(grader(GENERATIONS[2].register, 'schema')(payload)).not.toEqual([])
  })

  test('a credential roll travels only at the newest generation', () => {
    const manifest = {
      ...shown.manifest,
      roll: { rule: 'credential' as const, memberOf: 'did:webvh:QmParty:party.example.org' },
    }
    const payload = registerPayload(target, { ...shown, manifest })
    expect(grader(GENERATIONS[0].register, 'schema')(payload)).toEqual([])
    expect(grader(GENERATIONS[1].register, 'schema')(payload)).not.toEqual([])
  })

  test('the generation an agent votes at', () => {
    const fixed = [POLL_TASK.accept, POLL_TASK.receipt]
    const at = (i: number) => [POLL_GENERATIONS[i].register, POLL_GENERATIONS[i].vote]
    expect(agentGenerationIndex([...fixed, ...at(2)])).toBe(2)
    expect(agentGenerationIndex([...fixed, ...at(2), ...at(1)])).toBe(1)
    expect(agentGenerationIndex([...fixed, ...at(2), ...at(1), ...at(0)])).toBe(0)
    expect(agentGenerationIndex(at(0))).toBe(-1)
    expect(agentGenerationIndex(fixed)).toBe(-1)
    // Register and vote alone can't finish a vote: accept takes the ticket in, receipt keeps the proof.
    expect(agentGenerationIndex([POLL_TASK.accept, ...at(0)])).toBe(-1)
    expect(agentGenerationIndex([POLL_TASK.receipt, ...at(0)])).toBe(-1)
  })

  test('the list and show requests the phone sends', () => {
    expect(grader(BUNDLES.list, 'schema')({})).toEqual([])
    expect(grader(BUNDLES.list, 'schema')({ cursor: 'c2', state: 'voting' })).toEqual([])
    expect(grader(BUNDLES.show, 'schema')({ electionId: vectors.manifest.electionId })).toEqual([])
  })

  test('a show answer upstream sends is read whole; one missing what a ticket needs is not', () => {
    expect(grader(BUNDLES.show, 'responseSchema')(showAnswer)).toEqual([])
    expect(parsePollShown(showAnswer)?.manifest.electionId).toBe('agm-2027')
    const { parameters: _dropped, ...noParameters } = showAnswer
    expect(parsePollShown(noParameters)).toBeUndefined()
  })

  test('a list answer upstream sends is read, its page cursor kept', () => {
    const answer = {
      elections: [
        {
          electionId: 'agm-2027',
          title: 'Annual general meeting 2027',
          state: 'voting',
          votingOpensAt: '2026-11-03T00:00:00Z',
          votingClosesAt: '2026-11-07T18:00:00Z',
          binding: true,
          ticketHeld: false,
        },
      ],
      nextCursor: 'c2',
    }
    expect(grader(BUNDLES.list, 'responseSchema')(answer)).toEqual([])
    expect(parsePollList(answer)).toEqual({ polls: answer.elections, nextCursor: 'c2' })
  })

  test('register: the payload the phone builds', () => {
    expect(grader(BUNDLES.register, 'schema')(registerPayload(target, shown))).toEqual([])
  })

  test("accept: the payload the phone builds, around the community's issue answer", () => {
    const issued = { electionId: 'agm-2027', label: 'voter/agm-2027', preCredential: 'z3preCred' }
    expect(grader(BUNDLES.ticketsIssue, 'responseSchema')(issued)).toEqual([])
    expect(grader(BUNDLES.accept, 'schema')(acceptPayload(target, 'agm-2027', shown.parameters, issued))).toEqual([])
  })

  test("vote: the payload the phone builds, with upstream's own complete ballot", () => {
    const given = Object.fromEntries(
      vectors.fullAnswers.map(({ question, ...answer }: { question: string }) => [question, answer])
    )
    const ballot = ballotOf(shown.manifest, shown.manifestDigest, given)
    expect(grader(BUNDLES.vote, 'schema')(votePayload(target, shown, ballot))).toEqual([])
  })

  test("vote: the agent's answer is read; one without a cast is not", () => {
    const castDocument = {
      id: 'urn:uuid:5b8c3a52-8a52-4b0e-9a3e-2f1f7c6d1e01',
      type: `${POLL_TASK.cast}#request`,
      issuer: 'did:key:z6MkoneTime',
      recipient: shown.manifest.ballotBox,
      issuedAt: '2026-11-04T10:00:00Z',
      payload: { community: target.community, electionId: 'agm-2027', cast: {} },
      proof: {},
    }
    expect(grader(BUNDLES.vote, 'responseSchema')({ castDocument, tag: 'z3tag' })).toEqual([])
    expect(parseVoted({ castDocument, tag: 'z3tag' })).toEqual({ castDocument, tag: 'z3tag' })
    expect(parseVoted({ tag: 'z3tag' })).toBeUndefined()
  })

  test("the ballot box's answer to a cast is read", () => {
    const answer = {
      electionId: 'agm-2027',
      outcome: 'counted',
      leafIndex: 3,
      entryHash: vectors.manifestDigest,
      head: { electionId: 'agm-2027', treeSize: 4, rootHash: vectors.manifestDigest, issuedAt: '2026-11-04T10:00:01Z' },
      receiptToken: 'z3receipt',
    }
    expect(grader(BUNDLES.cast, 'responseSchema')(answer)).toEqual([])
    expect(parseCastAnswer(answer)).toEqual({ electionId: 'agm-2027', outcome: 'counted', leafIndex: 3 })
  })

  test('receipt: the payload the phone builds', () => {
    expect(grader(BUNDLES.receipt, 'schema')(receiptPayload(target, 'agm-2027', { type: 'x' }))).toEqual([])
  })
})
