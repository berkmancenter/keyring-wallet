/**
 * A cast's receipt is believed only once it is the ballot box's, answers this cast, and is for this poll; a refusal
 * only once the ballot box signed it.
 */
import { CastFailure, MAX_CAST_DELAY_MS, castDelayMs, postCast, type BallotBoxDoor } from '../ballotBox'
import { POLL_TASK } from '../pollTasks'

const BOX = 'did:webvh:QmVote:vote.example.net'
const ONE_TIME = 'did:key:z6MkoneTime'

const cast = {
  id: 'urn:uuid:5b8c3a52-8a52-4b0e-9a3e-2f1f7c6d1e01',
  type: `${POLL_TASK.cast}#request`,
  issuer: ONE_TIME,
  recipient: BOX,
  payload: { community: 'did:webvh:QmCommunity:vtc.example.org', electionId: 'agm-2027', cast: {} },
  proof: {},
}

const receipt = (over: Record<string, unknown> = {}) => ({
  id: 'urn:uuid:9e1a1f6c-0c1d-4a55-8d22-1b2c3d4e5f60',
  type: `${POLL_TASK.cast}#response`,
  issuer: BOX,
  recipient: ONE_TIME,
  threadId: cast.id,
  payload: { electionId: 'agm-2027', outcome: 'counted', leafIndex: 0 },
  proof: {},
  ...over,
})

function door(answer: { status: number; body: unknown } | Error, signer = BOX): BallotBoxDoor & { posted: unknown[] } {
  const posted: unknown[] = []
  return {
    posted,
    endpointOf: async () => 'https://vote.example.net/trust-tasks',
    post: async (_url, document) => {
      posted.push(document)
      if (answer instanceof Error) throw answer
      return answer
    },
    verify: async () => ({ ok: true, signer: `${signer}#key-1` }),
  }
}

const failureOf = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e as CastFailure
  }
  throw new Error('expected a failure')
}

describe('a cast and its receipt', () => {
  test('the cast is sent exactly as the agent built it, and its receipt returned whole', async () => {
    const d = door({ status: 200, body: receipt() })
    await expect(postCast(cast, BOX, d)).resolves.toEqual(receipt())
    expect(d.posted).toEqual([cast])
  })

  test.each([
    ['signed by someone else', door({ status: 200, body: receipt() }, 'did:webvh:QmOther:x')],
    ['naming another issuer', door({ status: 200, body: receipt({ issuer: 'did:webvh:QmOther:x' }) })],
    ['answering another cast', door({ status: 200, body: receipt({ threadId: 'urn:uuid:other' }) })],
    ['addressed to someone else', door({ status: 200, body: receipt({ recipient: 'did:key:z6Mkother' }) })],
    [
      'for another poll',
      door({ status: 200, body: receipt({ payload: { electionId: 'other', outcome: 'counted', leafIndex: 0 } }) }),
    ],
    ['of another type', door({ status: 200, body: receipt({ type: `${POLL_TASK.cast}#request` }) })],
  ])('a receipt %s is not believed', async (_why, d) => {
    expect((await failureOf(postCast(cast, BOX, d))).kind).toBe('receiptInvalid')
  })

  test("a receipt whose proof doesn't verify is not believed", async () => {
    const d = {
      ...door({ status: 200, body: receipt() }),
      verify: async () => ({ ok: false as const, detail: 'proof' }),
    }
    expect((await failureOf(postCast(cast, BOX, d))).kind).toBe('receiptInvalid')
  })

  test('a signed refusal is a refusal, read by its code', async () => {
    const refusal = {
      type: 'https://trusttasks.org/spec/trust-task-error/0.1',
      issuer: BOX,
      payload: { code: 'voting/ballot/cast:notOpen' },
    }
    const failure = await failureOf(postCast(cast, BOX, door({ status: 400, body: refusal })))
    expect([failure.kind, failure.code]).toEqual(['refused', 'voting/ballot/cast:notOpen'])
  })

  test("a refusal the ballot box didn't sign is not believed: the same cast is tried again", async () => {
    const refusal = { type: 'https://trusttasks.org/spec/trust-task-error/0.1', payload: { code: 'x:alreadyVoted' } }
    const d = door({ status: 400, body: refusal }, 'did:webvh:QmOther:x')
    expect((await failureOf(postCast(cast, BOX, d))).kind).toBe('unreachable')
  })

  test('no answer, or no document, is tried again', async () => {
    expect((await failureOf(postCast(cast, BOX, door(new Error('offline'))))).kind).toBe('unreachable')
    expect((await failureOf(postCast(cast, BOX, door({ status: 502, body: undefined })))).kind).toBe('unreachable')
  })

  test('a cast addressed to another ballot box than the poll names is never sent', async () => {
    const d = door({ status: 200, body: receipt() })
    expect((await failureOf(postCast({ ...cast, recipient: 'did:webvh:QmOther:x' }, BOX, d))).kind).toBe('refused')
    expect(d.posted).toEqual([])
  })
})

describe('the pause before a cast', () => {
  test('is from 0 up to, never at, the bound', () => {
    expect(castDelayMs(() => 0)).toBe(0)
    expect(castDelayMs(() => 0.999999)).toBeLessThan(MAX_CAST_DELAY_MS)
    expect(MAX_CAST_DELAY_MS).toBe(20_000)
  })
})
