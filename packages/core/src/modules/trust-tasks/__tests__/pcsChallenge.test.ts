/**
 * Reading a `vtc/vetting/pcs-challenge/0.1` answer.
 *
 * The strictness is the point. A community compares the challenge byte for
 * byte, so a value this client "repaired" — trimmed, lower-cased, re-encoded —
 * would produce a proof bound to something the community never issued, and the
 * refusal would surface at submission with nothing to point at. Every case
 * below is one where refusing early is better than proceeding.
 */
import {
  PCS_CHALLENGE_NOT_HIDDEN,
  PCS_CHALLENGE_TYPE,
  pcsChallengeRequest,
  readPcsChallenge,
} from '../module/pcsChallenge'
import { VtiRefusal, VtiSentNoAnswer, isVtiReadTask, vtiAgent } from '../module/vtiAgent'
import { expectNoDrift, registryPath } from './fixtures/registryDrift'
import { VTC_JOIN_SCHEMA_DIR as SCHEMA_DIR, vendoredValidator } from './fixtures/vtcJoinSchemas'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

// The specification's own example answer.
const GOOD = { challenge: 'a961aa3e63df4d15c9ad565feed87c46', expiresAt: '2026-09-23T10:15:01Z' }

describe('the task itself', () => {
  it('is the published slug', () => {
    expect(PCS_CHALLENGE_TYPE).toBe('https://trusttasks.org/spec/vtc/vetting/pcs-challenge/0.1')
    expect(PCS_CHALLENGE_NOT_HIDDEN).toBe('vtc/vetting/pcs-challenge:notHiddenVetting')
  })

  it('is never a read, because asking twice replaces the challenge', () => {
    // Its own spec marks it mutating: a community holds at most one open
    // challenge per applicant. A re-send would invalidate the proof just built,
    // so it must not be in VTI_READ_TASKS — now or by someone's later tidying.
    expect(isVtiReadTask(PCS_CHALLENGE_TYPE)).toBe(false)
  })

  it('sends nothing the community does not need', () => {
    // The applicant is identified by the envelope's issuer.
    expect(pcsChallengeRequest()).toEqual({})
    expect(pcsChallengeRequest('kernel-maintainers')).toEqual({ criterionId: 'kernel-maintainers' })
  })
})

describe('a usable answer', () => {
  it('is read as the community sent it', () => {
    expect(readPcsChallenge(GOOD)).toEqual({
      challenge: { challenge: GOOD.challenge, expiresAt: GOOD.expiresAt },
    })
  })

  it('keeps the value untouched', () => {
    const read = readPcsChallenge(GOOD)
    expect('challenge' in read && read.challenge.challenge).toBe(GOOD.challenge)
  })
})

describe('an answer this client cannot use', () => {
  const problem = (payload: unknown) => {
    const read = readPcsChallenge(payload)
    return 'problem' in read ? read : undefined
  }

  it('refuses a missing payload', () => {
    expect(problem(undefined)?.problem).toBe('unreadable')
    expect(problem(null)?.problem).toBe('unreadable')
  })

  it('refuses an answer with no challenge', () => {
    expect(problem({ expiresAt: GOOD.expiresAt })?.detail).toMatch(/names no challenge/)
  })

  it('refuses the wrong length, and says what it got', () => {
    const short = problem({ ...GOOD, challenge: 'a961aa3e' })
    expect(short?.problem).toBe('unreadable')
    expect(short?.detail).toMatch(/8 characters/)
  })

  it('refuses uppercase rather than lower-casing it', () => {
    // Lower-casing would change the bytes the proof binds.
    expect(problem({ ...GOOD, challenge: GOOD.challenge.toUpperCase() })?.problem).toBe('unreadable')
  })

  it('refuses surrounding whitespace rather than trimming it', () => {
    expect(problem({ ...GOOD, challenge: ` ${GOOD.challenge} ` })?.problem).toBe('unreadable')
  })

  it('refuses non-hex characters', () => {
    expect(problem({ ...GOOD, challenge: 'g'.repeat(32) })?.problem).toBe('unreadable')
  })

  it('refuses an expiry it cannot read', () => {
    // Without a readable expiry there is nothing to tell the person, and
    // nothing to decide a rebuild against.
    expect(problem({ ...GOOD, expiresAt: 'soon' })?.detail).toMatch(/expiry/)
    expect(problem({ challenge: GOOD.challenge })?.detail).toMatch(/expiry/)
  })

  it('accepts an expiry that has already passed, which is not this layer’s call', () => {
    // Staleness is `challengeState`'s decision, with a margin. Reading is only
    // about whether the answer is well formed.
    const read = readPcsChallenge({ ...GOOD, expiresAt: '2020-01-01T00:00:00Z' })
    expect('challenge' in read).toBe(true)
  })
})

describe('the registry grades the shapes', () => {
  it('the request payload validates, with and without a criterion', () => {
    const valid = vendoredValidator('vtc-vetting-pcs-challenge.payload.schema.json')
    expect(valid(pcsChallengeRequest())).toBe(true)
    expect(valid(pcsChallengeRequest('Vetted-Member'))).toBe(true)
    // additionalProperties: false — nothing extra may ride along.
    expect(valid({ criterionId: 'x', nonce: 1 })).toBe(false)
  })

  it('an answer the reader accepts is one the schema accepts, and the reader refuses what it refuses', () => {
    const valid = vendoredValidator('vtc-vetting-pcs-challenge.payload.schema.json', 'response')
    expect(valid(GOOD)).toBe(true)
    expect('challenge' in readPcsChallenge(GOOD)).toBe(true)
    const upper = { ...GOOD, challenge: GOOD.challenge.toUpperCase() }
    expect(valid(upper)).toBe(false)
    expect('problem' in readPcsChallenge(upper)).toBe(true)
  })
})

describe('asking the community', () => {
  const COMMUNITY = 'did:webvh:QmCommunity:test-vtc.example'
  const ERROR = 'https://trusttasks.org/spec/trust-task-error/0.5'
  const answer = (payload: unknown) => ({ type: `${PCS_CHALLENGE_TYPE}#response`, body: { payload } })
  afterEach(() => jest.restoreAllMocks())

  function asking(answers: unknown[]) {
    const asked: { community: string; type: string; payload: Record<string, unknown> }[] = []
    jest.spyOn(vtiAgent, 'ask').mockImplementation(async (community, type, payload) => {
      asked.push({ community, type, payload })
      return answers.shift() as never
    })
    return asked
  }

  it('sends the task to the community and returns the challenge as issued', async () => {
    const asked = asking([answer(GOOD)])
    await expect(vtiAgent.fetchChallenge(COMMUNITY, { criterionId: 'Vetted-Member' })).resolves.toEqual(GOOD)
    expect(asked).toEqual([
      { community: COMMUNITY, type: PCS_CHALLENGE_TYPE, payload: { criterionId: 'Vetted-Member' } },
    ])
  })

  it('asks anew each time: a second call is a second request, never the first answer again', async () => {
    const second = { ...GOOD, challenge: 'b'.repeat(32) }
    const asked = asking([answer(GOOD), answer(second)])
    await expect(vtiAgent.fetchChallenge(COMMUNITY)).resolves.toEqual(GOOD)
    await expect(vtiAgent.fetchChallenge(COMMUNITY)).resolves.toEqual(second)
    expect(asked).toHaveLength(2)
  })

  it("passes the community's refusal on as itself, so notHiddenVetting can be told apart", async () => {
    asking([{ type: ERROR, body: { payload: { code: PCS_CHALLENGE_NOT_HIDDEN, message: 'no hidden criterion' } } }])
    const failure = await vtiAgent.fetchChallenge(COMMUNITY).catch((e) => e)
    expect(failure).toBeInstanceOf(VtiRefusal)
    expect(failure.code).toBe(PCS_CHALLENGE_NOT_HIDDEN)
  })

  it('says it was sent and not answered, rather than inventing a challenge', async () => {
    asking([undefined])
    await expect(vtiAgent.fetchChallenge(COMMUNITY)).rejects.toBeInstanceOf(VtiSentNoAnswer)
  })

  it('refuses an answer it cannot use, naming why', async () => {
    asking([answer({ ...GOOD, challenge: 'a961aa3e' })])
    await expect(vtiAgent.fetchChallenge(COMMUNITY)).rejects.toThrow(/8 characters/)
  })
})

describe('the vendored schemas still match the registry', () => {
  const registry = registryPath()
  const maybe = registry ? it : it.skip

  maybe('the vendored copies are byte-identical to the commit PROVENANCE names', () => {
    expectNoDrift(SCHEMA_DIR, {
      'vtc-vetting-pcs-challenge.payload.schema.json': 'specs/vtc/vetting/pcs-challenge/0.1/payload.schema.json',
      'vtc-join-requests-submit-0.3.payload.schema.json': 'specs/vtc/join-requests/submit/0.3/payload.schema.json',
      'vtc-shared-ceremony.schema.json': 'specs/vtc/_shared/0.1/ceremony.schema.json',
      'framework-0.2.schema.json': 'specs/_framework/0.2/framework.schema.json',
      'framework-0.3.schema.json': 'specs/_framework/0.3/framework.schema.json',
    })
  })
})
