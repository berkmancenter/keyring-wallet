/**
 * The log-only count of text posts' signatures (`real/files/textSenderCount.ts`): what it counts, each kind reached by
 * breaking a real signed body, and above all what it must never say.
 */
import type { Agent } from '@credo-ts/core'
import { DeviceEventEmitter } from 'react-native'

import { WALLET_LOCKED_EVENT } from '../../../utils/walletLocked'
import { SENDER_RESOLVE_MS, senderResolver } from '../real/files/senderDocuments'
import type { ReadAt, ResolveSender } from '../real/files/sender'
import {
  MAX_CHECKED_CHARS,
  MAX_CHECKS_PER_UNLOCK,
  MAX_WAITING,
  TextSenderCount,
  type TextSenderCountOptions,
} from '../real/files/textSenderCount'

import { resolverOf, signBody, testAuthor } from './fixtures/signedBody'

const ROOM = 'did:webvh:room-secret.example'
const COMMUNITY = 'did:webvh:community-secret.example'
const WORDS = 'the words of a private post'
const ALICE = testAuthor('did:webvh:alice-secret.example', 7)
const MALLORY = testAuthor('did:webvh:mallory-secret.example', 9)

const unsigned = (over: Record<string, unknown> = {}) => ({
  roomId: ROOM,
  key: 'record-secret-key',
  version: 4,
  author: ALICE.did,
  body: WORDS,
  ...over,
})
const AT: ReadAt = { roomId: ROOM, key: 'record-secret-key', version: 4, hostAuthor: ALICE.did }

const FAST: TextSenderCountOptions = { startDelayMs: 0, gapMs: 0, logEveryMs: 0, whenIdle: async () => undefined }

/** A count with no pauses, whose every drain writes a line. */
function counting(resolve: ResolveSender = resolverOf(ALICE, MALLORY).resolve) {
  const lines: string[] = []
  const count = new TextSenderCount(resolve, (line) => lines.push(line), FAST)
  return { count, lines, last: () => lines[lines.length - 1] ?? '' }
}

/** A body signed for the record it is read as, so its check reaches the fetch and the verify. */
const postAt = (key: string) => signBody(ALICE, unsigned({ key }))
const atKey = (key: string): ReadAt => ({ ...AT, key })

/** Lets the background drain finish: a check takes real time, so wait on the line it writes. */
const settled = async (lines: string[], n = 1) => {
  for (let i = 0; i < 400 && lines.length < n; i++) await new Promise((r) => setTimeout(r, 5))
  expect(lines.length).toBeGreaterThanOrEqual(n)
}

/** Waits until the count has asked for this many documents. */
const settledFetches = async (fetched: jest.Mock, n: number) => {
  for (let i = 0; i < 2000 && fetched.mock.calls.length < n; i++) await new Promise((r) => setTimeout(r, 2))
}

/** One body through the count, and the single line it leaves. */
async function lineFor(body: Record<string, unknown> | null, at: ReadAt = AT, recordVersion = at.version) {
  const { count, lines, last } = counting()
  count.add(body, at, recordVersion)
  await settled(lines)
  return last()
}

afterEach(() => DeviceEventEmitter.emit(WALLET_LOCKED_EVENT))

describe('what is counted', () => {
  it('control: a body its author signed reads as confirmed, on an attributed room', async () => {
    const line = await lineFor(signBody(ALICE, unsigned()))
    expect(line).toContain('checked 1 (confirmed 1, unconfirmed 0, refused 0)')
    expect(line).toContain('attributed 1, private 0')
    expect(line).toContain('kinds: holds 1')
  })

  it('a room with no host author counts as private, and still checks the signature', async () => {
    const line = await lineFor(signBody(ALICE, unsigned()), { roomId: ROOM, key: AT.key, version: 4 })
    expect(line).toContain('attributed 0, private 1')
    expect(line).toContain('confirmed 1')
  })

  const refusals: [string, () => Record<string, unknown> | null, ReadAt?, number?][] = [
    ['not-a-body', () => null],
    ['no-author', () => signBody(ALICE, { roomId: ROOM, key: AT.key, version: 4, body: WORDS })],
    ['no-proof', () => unsigned()],
    ['wrong-location', () => signBody(ALICE, unsigned({ key: 'another-record' }))],
    ['wrong-version', () => signBody(ALICE, unsigned({ version: 3 }))],
    ['author-differs', () => signBody(MALLORY, unsigned({ author: MALLORY.did }))],
    ['signer-not-author', () => signBody(MALLORY, unsigned())],
    ['bad-signature', () => ({ ...signBody(ALICE, unsigned()), body: 'changed after signing' })],
    ['past-version', () => signBody(ALICE, unsigned({ version: 5 })), { ...AT, version: 5 }, 4],
  ]
  it.each(refusals)('%s is refused, under that word', async (kind, body, at = AT, recordVersion = at.version) => {
    const line = await lineFor(body(), at, recordVersion)
    expect(line).toContain('confirmed 0, unconfirmed 0, refused 1')
    expect(line).toContain(`kinds: ${kind} 1`)
  })

  it('a key the author no longer lists (what a rotation looks like) has its own word, apart from a bad signature', async () => {
    const rotated = testAuthor(ALICE.did, 7)
    rotated.document = { ...rotated.document, verificationMethod: [], assertionMethod: [] }
    const { count, lines, last } = counting(resolverOf(rotated).resolve)
    count.add(signBody(ALICE, unsigned()), AT, 4)
    await settled(lines)
    expect(last()).toContain('kinds: key-not-listed 1')
  })

  it('a document that cannot be had is unconfirmed, and a check that throws is too', async () => {
    const offline = counting(async () => {
      throw new Error('offline')
    })
    offline.count.add(signBody(ALICE, unsigned()), AT, 4)
    await settled(offline.lines)
    expect(offline.last()).toContain('unconfirmed 1')
    expect(offline.last()).toContain('kinds: document-unavailable 1')

    const looping: Record<string, unknown> = signBody(ALICE, unsigned())
    Object.defineProperty(looping, 'author', {
      enumerable: true,
      get() {
        throw new Error(`boom ${ROOM}`)
      },
    })
    const thrown = counting()
    thrown.count.add(looping, AT, 4)
    await settled(thrown.lines)
    expect(thrown.last()).toContain('kinds: check-threw 1')
  })

  it('a document that took too long has its own word: a host that may only be down for now', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] })
    try {
      const never = { dids: { resolveDidDocument: jest.fn(() => new Promise(() => undefined)) } } as unknown as Agent
      const { count, lines, last } = counting(senderResolver(never))
      count.add(signBody(ALICE, unsigned()), AT, 4)
      await jest.advanceTimersByTimeAsync(1) // past the count's own zero pause, to the fetch
      expect(lines).toEqual([])
      await jest.advanceTimersByTimeAsync(SENDER_RESOLVE_MS + 1)
      expect(last()).toContain('unconfirmed 1')
      expect(last()).toContain('kinds: document-timeout 1')
    } finally {
      jest.useRealTimers()
    }
  })

  it('a record version is counted once however often it is read, and a new version again', async () => {
    const { count, lines, last } = counting()
    const body = signBody(ALICE, unsigned())
    count.add(body, AT, 4)
    count.add(body, AT, 4)
    await settled(lines)
    count.add(body, AT, 4)
    count.add(signBody(ALICE, unsigned({ version: 5 })), { ...AT, version: 5 }, 5)
    await settled(lines, 2)
    expect(last()).toContain('checked 2')
    expect(last()).toContain('authors 1')
  })
})

describe('what it never says', () => {
  const secrets = [ROOM, COMMUNITY, WORDS, 'record-secret-key', 'secret.example', 'alice', 'mallory', 'offline', 'boom']

  // Each shape whose `why` names something private, through the real log path.
  const shapes: [string, () => Record<string, unknown> | null, ReadAt?][] = [
    ['confirmed', () => signBody(ALICE, unsigned())],
    ['signed elsewhere (the why names both rooms)', () => signBody(ALICE, unsigned({ roomId: COMMUNITY }))],
    ['host disagrees (the why names both authors)', () => signBody(MALLORY, unsigned({ author: MALLORY.did }))],
    ['another signer (the why names the method)', () => signBody(MALLORY, unsigned())],
    ['changed words', () => ({ ...signBody(ALICE, unsigned()), body: 'also secret.example words' })],
    ['not a body', () => null],
  ]
  it.each(shapes)('%s: the line holds counts and closed words only', async (_, body, at = AT) => {
    const line = await lineFor(body(), at)
    for (const secret of secrets) expect(line).not.toContain(secret)
  })

  it("an error's words stay out, even one naming the community and the author", async () => {
    const { count, lines, last } = counting(async () => {
      throw new Error(`offline fetching ${ALICE.did} for ${COMMUNITY}`)
    })
    count.add(signBody(ALICE, unsigned()), AT, 4)
    await settled(lines)
    for (const secret of secrets) expect(last()).not.toContain(secret)
    expect(last()).toContain('document-unavailable 1')
  })

  it('every word in a line is from the closed list', async () => {
    const line = await lineFor(signBody(MALLORY, unsigned()))
    const stripped = line
      .replace(/^rooms: text post signatures since unlock: /, '')
      .replace(
        /\b(checked|confirmed|unconfirmed|refused|attributed|private|kinds|skipped|authors|verify|ms|max|document|wait)\b/g,
        ''
      )
      .replace(/\b[a-z]+(-[a-z]+)+\b/g, '')
      .replace(/[\d\s();:,]/g, '')
    expect(stripped).toBe('')
  })
})

describe('what it costs the author’s host', () => {
  const agentWith = (resolveDidDocument: jest.Mock) => ({ dids: { resolveDidDocument } }) as unknown as Agent

  it('one fetch per author until the wallet locks, through the same resolver files use', async () => {
    const fetch = jest.fn(async (did: string) => (did === ALICE.did ? ALICE.document : MALLORY.document))
    const { count, lines, last } = counting(senderResolver(agentWith(fetch)))
    for (let i = 0; i < 5; i++) {
      count.add(signBody(ALICE, unsigned({ key: `r${i}` })), { ...AT, key: `r${i}` }, 4)
    }
    await settled(lines)
    expect(last()).toContain('confirmed 5')
    expect(fetch).toHaveBeenCalledTimes(1)
    DeviceEventEmitter.emit(WALLET_LOCKED_EVENT)
    count.lock()
    count.add(signBody(ALICE, unsigned()), AT, 4)
    await settled(lines, 2)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('stops at the cap, and says how many it skipped', async () => {
    const lines: string[] = []
    const fetched = jest.fn(async () => ALICE.document)
    const count = new TextSenderCount(fetched, (line) => lines.push(line), FAST)
    // Add in batches the queue can hold, so only the unlock's cap decides.
    for (let i = 0; i < MAX_CHECKS_PER_UNLOCK + 3; i += 1) {
      count.add(postAt(`r${i}`), atKey(`r${i}`), 4)
      if (i % 20 === 19) await settledFetches(fetched, i + 1)
    }
    await settledFetches(fetched, MAX_CHECKS_PER_UNLOCK)
    count.lock()
    const line = lines[lines.length - 1]
    expect(line).toContain('skipped 3')
    expect(line).toContain(`confirmed ${MAX_CHECKS_PER_UNLOCK}`)
    expect(fetched).toHaveBeenCalledTimes(MAX_CHECKS_PER_UNLOCK)
  }, 30000)

  it('a burst past the waiting limit is skipped, not held', async () => {
    const lines: string[] = []
    const count = new TextSenderCount(
      jest.fn(async () => ALICE.document),
      (line) => lines.push(line),
      { ...FAST, gapMs: 5 }
    )
    for (let i = 0; i < MAX_WAITING + 4; i++) count.add(postAt(`r${i}`), atKey(`r${i}`), 4)
    await settled(lines)
    expect(lines[lines.length - 1]).toContain('skipped 4')
    expect(lines[lines.length - 1]).toContain(`confirmed ${MAX_WAITING}`)
  })
})

describe('a lock', () => {
  it('says what was counted, then forgets it, waiting bodies included', async () => {
    const lines: string[] = []
    const fetched = jest.fn(async () => ALICE.document)
    const count = new TextSenderCount(fetched, (line) => lines.push(line), { ...FAST, gapMs: 5 })
    for (let i = 0; i < 6; i++) count.add(postAt(`r${i}`), atKey(`r${i}`), 4)
    await settledFetches(fetched, 2)
    count.lock()
    const asked = fetched.mock.calls.length
    const lineCount = lines.length
    expect(asked).toBeGreaterThan(0)
    expect(asked).toBeLessThan(6)
    expect(lines[lineCount - 1]).toContain('confirmed')
    await new Promise((r) => setTimeout(r, 60))
    expect(fetched.mock.calls).toHaveLength(asked)
    expect(lines).toHaveLength(lineCount)
  })

  it('a check still out at the lock is not counted after it', async () => {
    let release: (doc: typeof ALICE.document) => void = () => undefined
    const lines: string[] = []
    const count = new TextSenderCount(
      () => new Promise((resolve) => (release = resolve)),
      (line) => lines.push(line),
      FAST
    )
    count.add(signBody(ALICE, unsigned()), AT, 4)
    await new Promise((r) => setTimeout(r, 20))
    count.lock()
    release(ALICE.document)
    await new Promise((r) => setTimeout(r, 40))
    expect(lines).toEqual([])

    // And it stays out of what the next unlock says.
    count.add(postAt('after'), atKey('after'), 4)
    await new Promise((r) => setTimeout(r, 5))
    release(ALICE.document)
    await settled(lines)
    expect(lines[0]).toContain('checked 1 ')
  })

  it('logs nothing when nothing was counted', () => {
    const { count, lines } = counting()
    count.lock()
    expect(lines).toEqual([])
  })
})

describe('what it says about its own cost', () => {
  it('splits the wait for a document from the work of checking, by a clock it can read', async () => {
    let clock = 0
    const lines: string[] = []
    const count = new TextSenderCount(
      async () => {
        clock += 700
        return ALICE.document
      },
      (line) => lines.push(line),
      { ...FAST, now: () => (clock += 10) }
    )
    count.add(signBody(ALICE, unsigned()), AT, 4)
    await settled(lines)
    expect(lines[0]).toMatch(/document wait ms 7\d\d \(max 7\d\d\)/)
    expect(lines[0]).toMatch(/verify ms \d\d \(max \d\d\)/)
  })
})

describe('staying off the JS thread', () => {
  it('a body too long to verify cheaply is not verified, and no document is fetched for it', async () => {
    const resolve = jest.fn(async () => ALICE.document)
    const { count, lines, last } = counting(resolve)
    count.add(signBody(ALICE, unsigned({ body: 'x'.repeat(MAX_CHECKED_CHARS) })), AT, 4)
    await settled(lines)
    expect(last()).toContain('kinds: too-long 1')
    expect(last()).toContain('unconfirmed 1')
    expect(resolve).not.toHaveBeenCalled()
  })

  it('a body just under the limit is verified', async () => {
    const line = await lineFor(signBody(ALICE, unsigned({ body: 'x'.repeat(MAX_CHECKED_CHARS - 500) })))
    expect(line).toContain('kinds: holds 1')
  })

  it('a failure in the background reaches no one, and the next post picks the count up again', async () => {
    const whenIdle = jest.fn(async () => undefined as void)
    whenIdle.mockRejectedValueOnce(new Error('no InteractionManager'))
    const lines: string[] = []
    const count = new TextSenderCount(
      jest.fn(async () => ALICE.document),
      (line) => lines.push(line),
      { ...FAST, whenIdle }
    )
    count.add(postAt('a'), atKey('a'), 4)
    await new Promise((r) => setTimeout(r, 20))
    expect(lines).toEqual([])
    count.add(postAt('b'), atKey('b'), 4)
    await settled(lines)
    expect(lines[0]).toContain('confirmed 2')
  })

  it('nothing starts before the start delay', async () => {
    const resolve = jest.fn(async () => ALICE.document)
    const lines: string[] = []
    const count = new TextSenderCount(resolve, (line) => lines.push(line), { ...FAST, startDelayMs: 120 })
    count.add(signBody(ALICE, unsigned()), AT, 4)
    await new Promise((r) => setTimeout(r, 40))
    expect(resolve).not.toHaveBeenCalled()
    await settled(lines)
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('checks wait their gap, one after another, and only once nothing is animating', async () => {
    let inFlight = 0
    let most = 0
    const resolve = jest.fn(async () => {
      most = Math.max(most, ++inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return ALICE.document
    })
    let free: () => void = () => undefined
    const gate = new Promise<void>((r) => (free = r))
    const lines: string[] = []
    const count = new TextSenderCount(resolve, (line) => lines.push(line), { ...FAST, gapMs: 30, whenIdle: () => gate })
    for (let i = 0; i < 3; i++) count.add(postAt(`r${i}`), atKey(`r${i}`), 4)
    await new Promise((r) => setTimeout(r, 60))
    expect(resolve).not.toHaveBeenCalled() // still animating
    free()
    await new Promise((r) => setTimeout(r, 20))
    expect(resolve.mock.calls.length).toBeLessThan(3) // the gap holds the rest back
    await settled(lines)
    expect(resolve).toHaveBeenCalledTimes(3)
    expect(most).toBe(1)
  })
})

describe('how often it writes', () => {
  it('one line per drain at most every minute; the lock says the rest', async () => {
    let clock = 1000
    const lines: string[] = []
    const count = new TextSenderCount(
      jest.fn(async () => ALICE.document),
      (line) => lines.push(line),
      {
        ...FAST,
        logEveryMs: 60_000,
        now: () => clock,
      }
    )
    count.add(postAt('a'), atKey('a'), 4)
    await settled(lines)
    count.add(postAt('b'), atKey('b'), 4)
    await new Promise((r) => setTimeout(r, 60))
    expect(lines).toHaveLength(1)
    clock += 60_000
    count.add(postAt('c'), atKey('c'), 4)
    await settled(lines, 2)
    expect(lines[1]).toContain('confirmed 3')
    count.add(postAt('d'), atKey('d'), 4)
    await new Promise((r) => setTimeout(r, 60))
    count.lock()
    expect(lines[lines.length - 1]).toContain('confirmed 4')
    expect(lines).toHaveLength(3)
  })
})
