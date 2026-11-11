/**
 * A page's reads go out together where the agent serves `rooms/keys/read/0.2`, and one at a time where it doesn't. Each
 * key is answered on its own; only what the agent did not come to is asked again; and a batch refused whole falls back
 * to the reads of today, because 0.2's class can be held by a rule that never held 0.1.
 */
import {
  AgentRoomsService,
  READ_BATCH_MAX,
  READ_BATCH_TIMEOUT_MS,
  type RoomsBackend,
  type RoomsCommunity,
} from '../real/agentRoomsService'
import { CONSENT_HOLD_BACKOFF_MS, type ConsentHolds, storedConsentHolds } from '../real/consentHolds'
import { parseReadBatch, ROOMS_TASK } from '../real/wire'
import { VtiRefusal } from '../../trust-tasks/module/vtiAgent'

const COMMUNITY: RoomsCommunity = { did: 'did:webvh:community:a', name: 'Garden club', personaDid: 'did:key:persona-a' }
const ROOM = 'did:webvh:room:0123456789abcdef'
const HOST = 'did:webvh:community:a'
const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url')
const decode = (s: string) => Buffer.from(s, 'base64url').toString('utf8')

const record = (key: string, version = 2) => ({
  key,
  version,
  status: 'active',
  plaintext: b64url(JSON.stringify({ title: `Title ${key}`, body: `Body ${key}` })),
  verification: { priorRoots: 'noneHeld', anchor: 'none' },
})
const NOT_ATTEMPTED = { code: 'rooms/keys/read:notAttempted', message: 'not read in this request', retryable: true }

type Batch = (keys: string[], options: unknown) => unknown

function setUp(
  batch: Batch | undefined,
  served: string[] = batch ? [ROOMS_TASK.keysRead02] : [],
  {
    listing = [],
    alone,
    holds,
    now,
  }: {
    listing?: { key: string; version: number }[]
    alone?: (key: string) => unknown
    holds?: ConsentHolds
    now?: () => number
  } = {}
) {
  const agentTask = jest.fn(async (type: string, payload: Record<string, unknown>, options?: unknown) => {
    switch (type) {
      case ROOMS_TASK.keysList02:
        return { rooms: [{ roomId: ROOM, epoch: 3, earliestReadableEpoch: 1, member: 'did:key:persona-a' }] }
      case ROOMS_TASK.keysBrowse:
      case ROOMS_TASK.keysBrowse03:
      case ROOMS_TASK.keysBrowse04:
        return {
          records: listing.map((row) => ({ ...row, status: 'active' })),
          complete: true,
          verification: { priorRoots: 'noneHeld', anchor: 'none' },
        }
      case ROOMS_TASK.keysRead:
        return alone ? alone(String(payload.key)) : record(String(payload.key))
      case ROOMS_TASK.keysRead02:
        if (!batch) throw new Error('a batch to an agent that serves none')
        return batch(payload.keys as string[], options)
      default:
        throw new Error(`unexpected agent task ${type}`)
    }
  })
  const b: RoomsBackend = {
    agentLinked: () => true,
    agentServedTypes: async () => [ROOMS_TASK.keysList02, ROOMS_TASK.keysBrowse, ROOMS_TASK.keysRead, ...served],
    agentTask,
    communities: async () => [COMMUNITY],
    communityTask: jest.fn(async () => ({
      items: [
        {
          roomId: ROOM,
          host: HOST,
          label: 'Seed swap',
          visibility: 'attributed',
          actions: ['read', 'write'],
          state: 'admitted',
        },
      ],
    })),
    sendCompleted: jest.fn(async () => ({})),
    newId: () => 'id-1',
    leaveCommunity: jest.fn(async () => undefined),
    decodeBase64Url: decode,
    encodeBase64Url: b64url,
    hiddenOffers: async () => [],
    hideOffer: jest.fn(async () => undefined),
    warn: jest.fn(),
    ...(holds ? { consentHolds: holds } : {}),
  }
  const sent = (type: string) => agentTask.mock.calls.filter(([t]) => t === type)
  const batches = () => sent(ROOMS_TASK.keysRead02).map(([, payload]) => payload.keys as string[])
  const singles = () => sent(ROOMS_TASK.keysRead).map(([, payload]) => payload.key as string)
  const lines = () =>
    (b.warn as jest.Mock).mock.calls.map(([line]) => String(line)).filter((l) => l.includes('keys/read'))
  return { service: new AgentRoomsService(b, undefined, now ? { now } : {}), agentTask, batches, singles, lines }
}

/** As a screen comes to it: the room listed first, so the agent's served types are known. */
const listed = async (setup: ReturnType<typeof setUp>) => {
  await setup.service.listNotes(ROOM)
  return setup
}
const titles = async (reads: Promise<{ title?: unknown }>[]) =>
  (await Promise.all(reads)).map((note) => String(note.title))
const allRecords: Batch = (keys) => ({ roomId: ROOM, results: keys.map((key) => record(key)) })

describe('which reads go together', () => {
  test('an agent with no batch read is sent one read 0.1 per key, as before (control)', async () => {
    const setup = await listed(setUp(undefined))
    expect(await titles(setup.service.readNotes(ROOM, ['a', 'b', 'c']))).toEqual(['Title a', 'Title b', 'Title c'])
    expect(setup.singles()).toEqual(['a', 'b', 'c'])
    expect(setup.batches()).toEqual([])
  })

  test('an agent with one is sent one task for the page, in order, waited on long enough, never held for consent', async () => {
    const seen: unknown[] = []
    const setup = await listed(
      setUp((keys, options) => {
        seen.push(options)
        return allRecords(keys, options)
      })
    )
    expect(await titles(setup.service.readNotes(ROOM, ['a', 'b', 'c']))).toEqual(['Title a', 'Title b', 'Title c'])
    expect(setup.batches()).toEqual([['a', 'b', 'c']])
    expect(setup.singles()).toEqual([])
    expect(setup.agentTask).toHaveBeenCalledWith(
      ROOMS_TASK.keysRead02,
      { roomId: ROOM, host: HOST, keys: ['a', 'b', 'c'] },
      expect.anything()
    )
    expect(seen).toEqual([{ timeoutMs: READ_BATCH_TIMEOUT_MS, waitForConsent: false }])
    expect(READ_BATCH_TIMEOUT_MS).toBe(60000)
  })

  test('one record alone is one read 0.1: a batch of one buys nothing and carries the batch class', async () => {
    const setup = await listed(setUp(allRecords))
    expect(await titles(setup.service.readNotes(ROOM, ['a']))).toEqual(['Title a'])
    expect(setup.singles()).toEqual(['a'])
    expect(setup.batches()).toEqual([])
  })

  test('readNote stays one read 0.1 on an agent that serves batches', async () => {
    const setup = await listed(setUp(allRecords))
    expect(String((await setup.service.readNote(ROOM, 'a')).title)).toBe('Title a')
    expect(setup.singles()).toEqual(['a'])
    expect(setup.batches()).toEqual([])
  })

  test('before anything has said what the agent serves, one at a time', async () => {
    const setup = setUp(allRecords)
    expect(await titles(setup.service.readNotes(ROOM, ['a', 'b']))).toEqual(['Title a', 'Title b'])
    expect(setup.batches()).toEqual([])
  })

  test(`no batch names more than ${READ_BATCH_MAX} keys`, async () => {
    const setup = await listed(setUp(allRecords))
    const keys = Array.from({ length: READ_BATCH_MAX + 3 }, (_, i) => `k${i}`)
    const notes = await Promise.all(setup.service.readNotes(ROOM, keys))
    expect(notes.map((n) => n.key)).toEqual(keys)
    expect(setup.batches().map((b) => b.length)).toEqual([READ_BATCH_MAX, 3])
    expect(setup.batches().flat()).toEqual(keys)
  })

  test('a key asked twice is sent once, since a repeated key refuses the whole request, and both are answered', async () => {
    const setup = await listed(setUp(allRecords))
    expect(await titles(setup.service.readNotes(ROOM, ['a', 'b', 'a']))).toEqual(['Title a', 'Title b', 'Title a'])
    expect(setup.batches()).toEqual([['a', 'b']])
  })

  test('a record already opened is not asked for again', async () => {
    const rows = ['a', 'b', 'c', 'd'].map((key) => ({ key, version: 2 }))
    const setup = await listed(setUp(allRecords, undefined, { listing: rows }))
    await Promise.all(setup.service.readNotes(ROOM, ['a', 'b']))
    expect(await titles(setup.service.readNotes(ROOM, ['a', 'b', 'c', 'd']))).toEqual([
      'Title a',
      'Title b',
      'Title c',
      'Title d',
    ])
    expect(setup.batches()).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(setup.singles()).toEqual([])
  })

  test('a read of a key already in a batch shares its answer, and sends nothing', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const setup = await listed(
      setUp(async (keys, options) => {
        await gate
        return allRecords(keys, options)
      })
    )
    const reads = setup.service.readNotes(ROOM, ['a', 'b'])
    const alongside = setup.service.readNote(ROOM, 'a')
    const again = setup.service.readNotes(ROOM, ['a', 'b'])
    release()
    expect(await titles([...reads, alongside, ...again])).toEqual([
      'Title a',
      'Title b',
      'Title a',
      'Title a',
      'Title b',
    ])
    expect(setup.batches()).toEqual([['a', 'b']])
    expect(setup.singles()).toEqual([])
  })
})

describe('what the log says', () => {
  test('each batch is one line naming its type and how many keys it carries', async () => {
    const setup = await listed(setUp(allRecords))
    await Promise.all(setup.service.readNotes(ROOM, ['a', 'b', 'c']))
    expect(setup.lines()).toEqual([
      `rooms: ${ROOM.slice(0, 16)}…${ROOM.slice(-8)} read 3 keys in one ${ROOMS_TASK.keysRead02}`,
    ])
  })

  test('a page past the cap is one line per batch', async () => {
    const setup = await listed(setUp(allRecords))
    const keys = Array.from({ length: READ_BATCH_MAX + 1 }, (_, i) => `k${i}`)
    await Promise.all(setup.service.readNotes(ROOM, keys))
    expect(setup.lines().map((l) => l.replace(/^.* read (\d+) keys in one .*$/, '$1'))).toEqual([
      String(READ_BATCH_MAX),
      '1',
    ])
  })

  test('an agent with no batch read logs no batch line (control)', async () => {
    const setup = await listed(setUp(undefined))
    await Promise.all(setup.service.readNotes(ROOM, ['a', 'b', 'c']))
    expect(setup.lines()).toEqual([])
  })

  test('a batch refused whole says so, how many keys went one at a time, and that no more batches follow', async () => {
    const setup = await listed(
      setUp(() => {
        throw new VtiRefusal('unsupportedType', 'no')
      })
    )
    await Promise.all(setup.service.readNotes(ROOM, ['a', 'b']))
    expect(setup.lines()).toHaveLength(2)
    expect(setup.lines()[1]).toMatch(
      new RegExp(
        `${ROOMS_TASK.keysRead02.replace(/[.]/g, '\\.')} refused \\(.+\\): 2 keys read one at a time, and no more batches this session$`
      )
    )
  })

  test('not a member of this room: the refusal line says nothing of later batches (control)', async () => {
    const setup = await listed(
      setUp(() => {
        throw new VtiRefusal('taskFailed', 'no', { code: 'rooms/keys/read:notAMember' })
      })
    )
    await Promise.all(setup.service.readNotes(ROOM, ['a', 'b']).map((p) => p.catch(() => undefined)))
    expect(setup.lines()[1]).toMatch(/: 2 keys read one at a time$/)
  })
})

describe('each key answered on its own', () => {
  test("one key's refusal fails that key alone, as it would have been refused alone", async () => {
    const setup = await listed(
      setUp(() => ({
        roomId: ROOM,
        results: [
          record('a'),
          {
            key: 'b',
            error: {
              code: 'rooms/keys/read:cannotOpen',
              message: 'not held',
              details: { epoch: 4, reason: 'notDelivered' },
            },
          },
          record('c'),
        ],
      }))
    )
    const [a, b, c] = await Promise.allSettled(setup.service.readNotes(ROOM, ['a', 'b', 'c']))
    expect(a.status).toBe('fulfilled')
    expect(c.status).toBe('fulfilled')
    expect(b).toMatchObject({ status: 'rejected' })
    const refusal = (b as PromiseRejectedResult).reason
    expect(refusal).toBeInstanceOf(VtiRefusal)
    expect(refusal).toMatchObject({
      code: 'rooms/keys/read:cannotOpen',
      details: { epoch: 4, reason: 'notDelivered' },
    })
    expect(setup.singles()).toEqual([])
  })

  test('a tombstone is an answer, not a failure', async () => {
    const setup = await listed(
      setUp(() => ({
        roomId: ROOM,
        results: [record('a'), { key: 'b', version: 3, status: 'retracted', verification: {} }],
      }))
    )
    const [, b] = await Promise.all(setup.service.readNotes(ROOM, ['a', 'b']))
    expect(b.status).toBe('retracted')
    expect(String(b.body)).toBe('')
  })

  test.each([
    ['leaves a key out', () => ({ roomId: ROOM, results: [record('a')] })],
    ['answers a key with nothing readable', () => ({ roomId: ROOM, results: [record('a'), { key: 'b' }] })],
  ])('an agent that %s fails that key, and no read waits for ever', async (_what, answer) => {
    const setup = await listed(setUp(answer))
    const [a, b] = await Promise.allSettled(setup.service.readNotes(ROOM, ['a', 'b']))
    expect(a.status).toBe('fulfilled')
    expect(b.status).toBe('rejected')
  })

  test('an answer with no results fails every key', async () => {
    const setup = await listed(setUp(() => record('a')))
    const settled = await Promise.allSettled(setup.service.readNotes(ROOM, ['a', 'b']))
    expect(settled.map((s) => s.status)).toEqual(['rejected', 'rejected'])
    expect(setup.batches()).toHaveLength(1)
  })

  test('a key the agent answers but nobody asked is not kept', async () => {
    const setup = await listed(setUp(() => ({ roomId: ROOM, results: [record('a'), record('b'), record('stranger')] })))
    await Promise.all(setup.service.readNotes(ROOM, ['a', 'b']))
    const kept = (setup.service as unknown as { opened: Map<string, unknown> }).opened
    expect([...kept.keys()].some((k) => k.includes('stranger'))).toBe(false)
    expect(kept.size).toBe(2)
  })

  test('an answer that lands after a lock answers its caller but is not kept', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const setup = await listed(
      setUp(async (keys, options) => {
        await gate
        return allRecords(keys, options)
      })
    )
    const reads = setup.service.readNotes(ROOM, ['a', 'b'])
    await new Promise((r) => setImmediate(r))
    setup.service.dropOpenedRecords()
    release()
    expect(await titles(reads)).toEqual(['Title a', 'Title b'])
    expect((setup.service as unknown as { opened: Map<string, unknown> }).opened.size).toBe(0)
  })
})

describe('what the agent did not come to', () => {
  test('only those keys are asked again', async () => {
    const answers = [
      { roomId: ROOM, results: [record('a'), { key: 'b', error: NOT_ATTEMPTED }, { key: 'c', error: NOT_ATTEMPTED }] },
      { roomId: ROOM, results: [record('b'), { key: 'c', error: NOT_ATTEMPTED }] },
      { roomId: ROOM, results: [record('c')] },
    ]
    const setup = await listed(setUp(() => answers.shift()))
    expect(await titles(setup.service.readNotes(ROOM, ['a', 'b', 'c']))).toEqual(['Title a', 'Title b', 'Title c'])
    expect(setup.batches()).toEqual([['a', 'b', 'c'], ['b', 'c'], ['c']])
    expect(setup.singles()).toEqual([])
  })

  test('a batch that came to nothing stops: it is never a poll', async () => {
    let asked = 0
    const setup = await listed(
      // Answers in the end, so that a loop that doesn't stop fails here rather than running for ever.
      setUp((keys, options) =>
        ++asked > 3
          ? allRecords(keys, options)
          : { roomId: ROOM, results: keys.map((key) => ({ key, error: NOT_ATTEMPTED })) }
      )
    )
    const settled = await Promise.allSettled(setup.service.readNotes(ROOM, ['a', 'b']))
    expect(settled.map((s) => s.status)).toEqual(['rejected', 'rejected'])
    expect(setup.batches()).toEqual([['a', 'b']])
    expect(setup.singles()).toEqual([])
  })

  test('the framework code with a task code in details counts too, as a refusal alone would carry it', async () => {
    const answers = [
      {
        roomId: ROOM,
        results: [
          record('a'),
          { key: 'b', error: { code: 'taskFailed', details: { code: 'rooms/keys/read:notAttempted' } } },
        ],
      },
      { roomId: ROOM, results: [record('b')] },
    ]
    const setup = await listed(setUp(() => answers.shift()))
    await Promise.all(setup.service.readNotes(ROOM, ['a', 'b']))
    expect(setup.batches()).toEqual([['a', 'b'], ['b']])
  })
})

describe('a batch refused whole', () => {
  const held = () => {
    throw new VtiRefusal('taskFailed', 'held', { reason: 'auth:consent_required' })
  }

  test('held for consent: read one at a time at once, and this session asks no more batches', async () => {
    const setup = await listed(setUp(held))
    expect(await titles(setup.service.readNotes(ROOM, ['a', 'b']))).toEqual(['Title a', 'Title b'])
    expect(setup.singles()).toEqual(['a', 'b'])
    expect(setup.batches()).toHaveLength(1)

    expect(await titles(setup.service.readNotes(ROOM, ['c', 'd']))).toEqual(['Title c', 'Title d'])
    expect(setup.singles()).toEqual(['a', 'b', 'c', 'd'])
    expect(setup.batches()).toHaveLength(1)
  })

  test('the type refused, though it was listed: the same', async () => {
    const setup = await listed(
      setUp(() => {
        throw new VtiRefusal('unsupportedType', 'no')
      })
    )
    expect(await titles(setup.service.readNotes(ROOM, ['a', 'b']))).toEqual(['Title a', 'Title b'])
    await Promise.all(setup.service.readNotes(ROOM, ['c', 'd']))
    expect(setup.batches()).toHaveLength(1)
  })

  test('not a member of this room: says nothing about the next batch (control)', async () => {
    let first = true
    const setup = await listed(
      setUp((keys, options) => {
        if (first) {
          first = false
          throw new VtiRefusal('taskFailed', 'no', { code: 'rooms/keys/read:notAMember' })
        }
        return allRecords(keys, options)
      })
    )
    await Promise.all(setup.service.readNotes(ROOM, ['a', 'b']))
    expect(setup.singles()).toEqual(['a', 'b'])
    await Promise.all(setup.service.readNotes(ROOM, ['c', 'd']))
    expect(setup.batches()).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  test('what was already answered is kept: only what is left steps down', async () => {
    const keys = Array.from({ length: READ_BATCH_MAX + 2 }, (_, i) => `k${i}`)
    let first = true
    const setup = await listed(
      setUp((asked, options) => {
        if (first) {
          first = false
          return allRecords(asked, options)
        }
        return held()
      })
    )
    const notes = await Promise.all(setup.service.readNotes(ROOM, keys))
    expect(notes.map((n) => n.key)).toEqual(keys)
    expect(setup.singles()).toEqual(keys.slice(READ_BATCH_MAX))
  })

  test('a key refused alone after that fails alone, in the refusal a read alone gets', async () => {
    const setup = await listed(
      setUp(held, undefined, {
        alone: (key) => {
          if (key === 'b') throw new VtiRefusal('taskFailed', 'no such record', { code: 'rooms/keys/read:hostRefused' })
          return record(key)
        },
      })
    )
    const [a, b] = await Promise.allSettled(setup.service.readNotes(ROOM, ['a', 'b']))
    expect(a.status).toBe('fulfilled')
    expect((b as PromiseRejectedResult).reason).toMatchObject({ details: { code: 'rooms/keys/read:hostRefused' } })
  })

  test('a room this phone is not in is refused before anything is sent, and no read hangs on it', async () => {
    const setup = await listed(setUp(allRecords))
    const settled = await Promise.allSettled(setup.service.readNotes('did:webvh:room:elsewhere', ['a', 'b']))
    expect(settled.map((s) => s.status)).toEqual(['rejected', 'rejected'])
    expect(setup.batches()).toEqual([])
    expect(setup.singles()).toEqual([])
  })
})

describe('a hold is kept for a day, across launches', () => {
  const AGENT = 'did:webvh:agent:mine'
  const held = () => {
    throw new VtiRefusal('taskFailed', 'held', { reason: 'auth:consent_required' })
  }
  /** What AsyncStorage would keep between launches: one per test, shared by every launch in it. */
  const disk = () => {
    const kept = new Map<string, string>()
    return {
      kept,
      getItem: jest.fn(async (key: string) => kept.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => void kept.set(key, value)),
    }
  }
  const T0 = Date.parse('2026-11-10T20:00:00Z')
  /** A launch: a new service, a new store over the same disk, the clock where the test puts it. */
  const launch = async (storage: ReturnType<typeof disk>, at: number, batch: Batch, agent = AGENT) =>
    listed(setUp(batch, undefined, { holds: storedConsentHolds(() => agent, storage), now: () => at }))

  test('held: the next launch sends no batch, and reads one at a time', async () => {
    const storage = disk()
    const first = await launch(storage, T0, held)
    await Promise.all(first.service.readNotes(ROOM, ['a', 'b']))
    expect(first.batches()).toHaveLength(1)
    expect(first.lines().slice(-1)[0]).toMatch(
      /2 keys read one at a time, and no more batches to this agent for a day$/
    )

    const next = await launch(storage, T0 + 60_000, allRecords)
    expect(await titles(next.service.readNotes(ROOM, ['c', 'd']))).toEqual(['Title c', 'Title d'])
    expect(next.batches()).toEqual([])
    expect(next.singles()).toEqual(['c', 'd'])
  })

  test('a day after the hold, batches go out again (control: the back-off ends)', async () => {
    const storage = disk()
    await Promise.all((await launch(storage, T0, held)).service.readNotes(ROOM, ['a', 'b']))
    const justBefore = await launch(storage, T0 + CONSENT_HOLD_BACKOFF_MS - 1, allRecords)
    await Promise.all(justBefore.service.readNotes(ROOM, ['c', 'd']))
    expect(justBefore.batches()).toEqual([])
    const after = await launch(storage, T0 + CONSENT_HOLD_BACKOFF_MS, allRecords)
    await Promise.all(after.service.readNotes(ROOM, ['c', 'd']))
    expect(after.batches()).toEqual([['c', 'd']])
  })

  test('what is kept cannot be read: no batch (fails toward not asking)', async () => {
    const garbled = disk()
    garbled.kept.set('rooms.consentHolds.v1', '{not json')
    const g = await launch(garbled, T0, allRecords)
    await Promise.all(g.service.readNotes(ROOM, ['a', 'b']))
    expect(g.batches()).toEqual([])
    expect(g.singles()).toEqual(['a', 'b'])

    const broken = disk()
    broken.getItem.mockRejectedValue(new Error('storage is gone'))
    const k = await launch(broken, T0, allRecords)
    await Promise.all(k.service.readNotes(ROOM, ['a', 'b']))
    expect(k.batches()).toEqual([])
  })

  test('a refusal that is not a hold is not kept: the next launch batches (control)', async () => {
    const storage = disk()
    const first = await launch(storage, T0, () => {
      throw new VtiRefusal('unsupportedType', 'no')
    })
    await Promise.all(first.service.readNotes(ROOM, ['a', 'b']))
    expect(storage.setItem).not.toHaveBeenCalled()
    const next = await launch(storage, T0 + 60_000, allRecords)
    await Promise.all(next.service.readNotes(ROOM, ['c', 'd']))
    expect(next.batches()).toEqual([['c', 'd']])
  })

  test("by agent: another agent's hold does not stop this one's batch (control)", async () => {
    const storage = disk()
    await Promise.all((await launch(storage, T0, held, 'did:webvh:agent:other')).service.readNotes(ROOM, ['a', 'b']))
    const mine = await launch(storage, T0 + 60_000, allRecords)
    await Promise.all(mine.service.readNotes(ROOM, ['c', 'd']))
    expect(mine.batches()).toEqual([['c', 'd']])
  })

  test('nothing kept yet: the first launch batches (control)', async () => {
    const fresh = await launch(disk(), T0, allRecords)
    await Promise.all(fresh.service.readNotes(ROOM, ['a', 'b']))
    expect(fresh.batches()).toEqual([['a', 'b']])
  })
})

describe('no answer at all', () => {
  test('is not a refusal: the keys fail for this try, with no reads behind it, and the next batch is tried', async () => {
    let first = true
    const setup = await listed(
      setUp((keys, options) => {
        if (first) {
          first = false
          throw Object.assign(new Error('sent, no answer'), { name: 'VtaTaskTimedOut' })
        }
        return allRecords(keys, options)
      })
    )
    const settled = await Promise.allSettled(setup.service.readNotes(ROOM, ['a', 'b']))
    expect(settled.map((s) => s.status)).toEqual(['rejected', 'rejected'])
    expect(setup.singles()).toEqual([])

    expect(await titles(setup.service.readNotes(ROOM, ['a', 'b']))).toEqual(['Title a', 'Title b'])
    expect(setup.batches()).toEqual([
      ['a', 'b'],
      ['a', 'b'],
    ])
  })
})

describe('the listing', () => {
  test.each([
    ['0.4 where served', [ROOMS_TASK.keysBrowse04, ROOMS_TASK.keysBrowse03], ROOMS_TASK.keysBrowse04],
    ['0.3 where that is the newest', [ROOMS_TASK.keysBrowse03], ROOMS_TASK.keysBrowse03],
    ['0.1 where neither is', [], ROOMS_TASK.keysBrowse],
  ])('browse asks %s', async (_what, served, expected) => {
    const setup = setUp(undefined, served)
    await setup.service.listNotes(ROOM)
    expect(setup.agentTask).toHaveBeenCalledWith(expected, { roomId: ROOM, host: HOST })
  })
})

describe('parseReadBatch', () => {
  test('what a single read says in its own ext, a batch says once, by key', () => {
    const answers = parseReadBatch(
      {
        roomId: ROOM,
        results: [record('a', 7), record('b', 7), record('__proto__', 7)],
        ext: { 'org.openvtc.rooms': { sealedAt: { a: 5 }, roomProfile: ['b'] } },
      },
      decode
    )
    expect(answers?.get('a')).toMatchObject({ key: 'a', sealedAt: 5 })
    expect(answers?.get('b')).not.toHaveProperty('sealedAt')
    expect(answers?.get('__proto__')).not.toHaveProperty('sealedAt')
  })

  test('an error, however little it says, and a refusal that is not an object', () => {
    const answers = parseReadBatch(
      {
        results: [
          { key: 'a', error: { code: 'taskFailed' } },
          { key: 'b', error: 'no' },
          { key: 'c', error: { message: 'an error with no code' } },
          { error: { code: 'x' } },
          'junk',
        ],
      },
      decode
    )
    expect(answers?.get('a')).toEqual({ code: 'taskFailed', message: undefined, details: undefined })
    expect(answers?.has('b')).toBe(false)
    expect(answers?.has('c')).toBe(false)
    expect(answers?.size).toBe(1)
  })

  test.each([[undefined], [null], ['text'], [{}], [{ results: 'no' }]])('%j has no results', (payload) => {
    expect(parseReadBatch(payload, decode)).toBeUndefined()
  })
})
