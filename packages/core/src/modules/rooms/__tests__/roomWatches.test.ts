/**
 * Watches on rooms (`rooms/keys/watch/0.1`): armed after a read, grouped by member and host, one request at a time;
 * a signal (`rooms/keys/changed/0.1`) acted on only for a watch armed here; and polling kept wherever a watch can't be
 * armed. A hold for consent is kept for a day, as a batch read's is.
 */
import { CONSENT_HOLD_BACKOFF_MS, storedConsentHolds } from '../real/consentHolds'
import { RoomWatches, WATCH_LEASE_SECONDS, WATCH_ROOMS_MAX, WATCH_TIMEOUT_MS } from '../real/roomWatches'
import { ROOMS_TASK } from '../real/wire'
import { VtiRefusal } from '../../trust-tasks/module/vtiAgent'

const MEMBER = 'did:key:persona-a'
const HOST = 'did:webvh:host:a'
const HOST_B = 'did:webvh:host:b'
const T0 = Date.parse('2026-11-10T20:00:00Z')
const LATER = new Date(T0 + 7 * 24 * 3600_000).toISOString()

type Payload = { member: string; host: string; rooms: { roomId: string; sinceVersion?: number }[]; cancel?: true }
type Answer = (payload: Payload) => unknown

const armedAll: Answer = (p) => ({
  member: p.member,
  host: p.host,
  watches: p.rooms.map(({ roomId }) => ({ roomId, armed: true, expiresAt: LATER })),
})

const disk = () => {
  const kept = new Map<string, string>()
  return {
    getItem: jest.fn(async (key: string) => kept.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => void kept.set(key, value)),
  }
}

function setUp({
  answer = armedAll,
  served = [ROOMS_TASK.keysWatch01],
  holds,
  now = () => T0,
  on = () => true,
}: {
  answer?: Answer
  /** null: what the agent serves is not known yet. */
  served?: string[] | null
  holds?: ReturnType<typeof storedConsentHolds>
  now?: () => number
  on?: () => boolean
} = {}) {
  const order: string[] = []
  const agentTask = jest.fn(async (type: string, payload: Record<string, unknown>, options?: unknown) => {
    void options
    if (type !== ROOMS_TASK.keysWatch01) throw new Error(`unexpected ${type}`)
    const p = payload as unknown as Payload
    order.push(`sent ${p.host}`)
    const a = await answer(p)
    order.push(`answered ${p.host}`)
    return a
  })
  const warn = jest.fn()
  const watches = new RoomWatches({
    served: () => served ?? undefined,
    agentTask,
    consentHolds: holds,
    now,
    warn,
    logRef: (id) => id.slice(-6),
    on,
  })
  const sent = () => agentTask.mock.calls.map(([, p]) => p as unknown as Payload)
  return { watches, agentTask, sent, order, warn }
}

const signal = (roomId: string, over: Record<string, unknown> = {}) => ({
  roomId,
  member: MEMBER,
  host: HOST,
  latestVersion: 9,
  ...over,
})

describe('arming', () => {
  test('an agent that does not serve the task is sent nothing, and every room stays polled (control)', async () => {
    const s = setUp({ served: [ROOMS_TASK.keysRead] })
    s.watches.want('room:1', MEMBER, HOST, 4)
    await s.watches.idle()
    expect(s.agentTask).not.toHaveBeenCalled()
    expect(s.watches.watched('room:1')).toBe(false)
  })

  test('not knowing what the agent serves yet is the same: nothing sent', async () => {
    const s = setUp({ served: null })
    s.watches.want('room:1', MEMBER, HOST, 4)
    await s.watches.idle()
    expect(s.agentTask).not.toHaveBeenCalled()
  })

  // Why a room isn't watched is in the log once, not once per room or per listing: a report with no watch line said
  // nothing of why (IN-679).
  const unwatchedLines = (warn: jest.Mock) =>
    warn.mock.calls.map(([line]) => line as string).filter((line) => line.startsWith('rooms: no room is watched'))

  test.each([
    [
      'the agent does not serve the task',
      { served: [ROOMS_TASK.keysRead] },
      'the agent does not serve rooms/keys/watch/0.1',
    ],
    ['what it serves is not known yet', { served: null }, 'what the agent serves is not known yet'],
    ['the release switch is off', { on: () => false }, 'live delivery is off'],
  ])('%s: said once, by kind, however many rooms and listings want a watch', async (_, over, why) => {
    const s = setUp(over)
    s.watches.want('room:1', MEMBER, HOST, 4)
    s.watches.want('room:2', MEMBER, HOST_B, 4)
    s.watches.want('room:1', MEMBER, HOST, 5)
    await s.watches.idle()
    expect(unwatchedLines(s.warn)).toEqual([`rooms: no room is watched (${why}): they are polled`])
    // No room, member or host in it (log privacy rule).
    expect(unwatchedLines(s.warn)[0]).not.toMatch(/room:|persona|host:/)
  })

  test('a new reason is said again, and so is the same one once a want passed in between', async () => {
    let served: string[] | null = null
    let on = true
    const warn = jest.fn()
    const watches = new RoomWatches({
      served: () => served ?? undefined,
      agentTask: jest.fn(async (_type: string, payload: Record<string, unknown>) =>
        armedAll(payload as unknown as Payload)
      ),
      now: () => T0,
      warn,
      logRef: (id) => id.slice(-6),
      on: () => on,
    })
    watches.want('room:1', MEMBER, HOST, 4)
    served = [ROOMS_TASK.keysRead]
    watches.want('room:1', MEMBER, HOST, 4)
    served = [ROOMS_TASK.keysWatch01]
    watches.want('room:1', MEMBER, HOST, 4)
    await watches.idle()
    on = false
    watches.want('room:2', MEMBER, HOST, 4)
    on = true
    watches.want('room:3', MEMBER, HOST, 4)
    await watches.idle()
    on = false
    watches.want('room:4', MEMBER, HOST, 4)
    expect(
      unwatchedLines(warn).map((line) => line.replace(/^rooms: no room is watched \((.*)\): they are polled$/, '$1'))
    ).toEqual([
      'what the agent serves is not known yet',
      'the agent does not serve rooms/keys/watch/0.1',
      'live delivery is off',
      'live delivery is off',
    ])
  })

  test('served and on: no such line, and the watch is armed (control)', async () => {
    const s = setUp()
    s.watches.want('room:1', MEMBER, HOST, 4)
    await s.watches.idle()
    expect(unwatchedLines(s.warn)).toEqual([])
    expect(s.watches.watched('room:1')).toBe(true)
  })

  test('rooms at one host go in one request, each from its version, for a week, never waiting for consent', async () => {
    const s = setUp()
    s.watches.want('room:1', MEMBER, HOST, 4)
    s.watches.want('room:2', MEMBER, HOST, 7)
    await s.watches.idle()
    expect(s.agentTask).toHaveBeenCalledTimes(1)
    expect(s.agentTask).toHaveBeenCalledWith(
      ROOMS_TASK.keysWatch01,
      {
        member: MEMBER,
        host: HOST,
        rooms: [
          { roomId: 'room:1', sinceVersion: 4 },
          { roomId: 'room:2', sinceVersion: 7 },
        ],
        leaseSeconds: WATCH_LEASE_SECONDS,
      },
      { timeoutMs: WATCH_TIMEOUT_MS, waitForConsent: false }
    )
    expect(s.watches.watched('room:1')).toBe(true)
    expect(s.watches.watched('room:2')).toBe(true)
  })

  test('two hosts are two requests, the second sent only once the first is answered', async () => {
    const s = setUp()
    s.watches.want('room:1', MEMBER, HOST, 4)
    s.watches.want('room:b', MEMBER, HOST_B, 2)
    await s.watches.idle()
    expect(s.order).toEqual([`sent ${HOST}`, `answered ${HOST}`, `sent ${HOST_B}`, `answered ${HOST_B}`])
  })

  test('more rooms than one request takes go in as many requests as they need', async () => {
    const s = setUp()
    for (let i = 0; i < WATCH_ROOMS_MAX + 1; i++) s.watches.want(`room:${i}`, MEMBER, HOST, 1)
    await s.watches.idle()
    expect(s.sent().map((p) => p.rooms.length)).toEqual([WATCH_ROOMS_MAX, 1])
  })

  test('armed already from that version: nothing is sent again; from a later one: armed again', async () => {
    const s = setUp()
    s.watches.want('room:1', MEMBER, HOST, 4)
    await s.watches.idle()
    s.watches.want('room:1', MEMBER, HOST, 4)
    await s.watches.idle()
    expect(s.agentTask).toHaveBeenCalledTimes(1)
    s.watches.want('room:1', MEMBER, HOST, 6)
    await s.watches.idle()
    expect(s.sent().map((p) => p.rooms)).toEqual([
      [{ roomId: 'room:1', sinceVersion: 4 }],
      [{ roomId: 'room:1', sinceVersion: 6 }],
    ])
  })

  test('a watch that lapsed is not watched, and is armed again from the same version', async () => {
    let now = T0
    const s = setUp({ now: () => now })
    s.watches.want('room:1', MEMBER, HOST, 4)
    await s.watches.idle()
    now = Date.parse(LATER)
    expect(s.watches.watched('room:1')).toBe(false)
    s.watches.want('room:1', MEMBER, HOST, 4)
    await s.watches.idle()
    expect(s.agentTask).toHaveBeenCalledTimes(2)
  })
})

describe('a signal', () => {
  test('for a room armed here: read it, once; the watch is spent and the next read arms it again', async () => {
    const s = setUp()
    s.watches.want('room:1', MEMBER, HOST, 4)
    await s.watches.idle()
    expect(s.watches.signal(signal('room:1'))).toBe('room:1')
    expect(s.watches.watched('room:1')).toBe(false)
    expect(s.watches.signal(signal('room:1'))).toBeUndefined()
    s.watches.want('room:1', MEMBER, HOST, 9)
    await s.watches.idle()
    expect(s.watches.watched('room:1')).toBe(true)
  })

  test.each([
    ['another member', { member: 'did:key:someone-else' }],
    ['another host', { host: HOST_B }],
    ['a room not watched', { roomId: 'room:other' }],
    ['no latestVersion', { latestVersion: undefined }],
    ['a version that is not a whole number', { latestVersion: 1.5 }],
  ])('naming %s: nothing is read', async (_, over) => {
    const s = setUp()
    s.watches.want('room:1', MEMBER, HOST, 4)
    await s.watches.idle()
    expect(s.watches.signal(signal('room:1', over))).toBeUndefined()
    expect(s.watches.watched('room:1')).toBe(true)
  })

  test("after its lease has lapsed: still that watch's one signal, though the room no longer counts as watched", async () => {
    let now = T0
    const s = setUp({ now: () => now })
    s.watches.want('room:1', MEMBER, HOST, 4)
    await s.watches.idle()
    now = Date.parse(LATER) + 1
    expect(s.watches.watched('room:1')).toBe(false)
    expect(s.watches.signal(signal('room:1'))).toBe('room:1')
    expect(s.watches.signal(signal('room:1'))).toBeUndefined()
  })

  test('before its watch is armed (the answer not in yet): nothing is read', () => {
    const s = setUp({ answer: () => new Promise(() => undefined) })
    s.watches.want('room:1', MEMBER, HOST, 4)
    expect(s.watches.signal(signal('room:1'))).toBeUndefined()
  })

  test('a payload that is not an object: nothing', () => {
    expect(setUp().watches.signal('room:1')).toBeUndefined()
  })
})

describe('polling stays the fallback', () => {
  test('a room the host refuses is polled, says why, and is not asked again this session', async () => {
    const s = setUp({
      answer: (p) => ({
        member: p.member,
        host: p.host,
        watches: [{ roomId: 'room:1', armed: false, refused: 'hostRefused', hostCode: 'unsupportedType' }],
      }),
    })
    s.watches.want('room:1', MEMBER, HOST, 4)
    await s.watches.idle()
    expect(s.watches.watched('room:1')).toBe(false)
    expect(s.warn.mock.calls.map(([l]) => l).join('\n')).toMatch(
      /polled: its watch refused \(hostRefused: unsupportedType\)/
    )
    s.watches.want('room:1', MEMBER, HOST, 5)
    await s.watches.idle()
    expect(s.agentTask).toHaveBeenCalledTimes(1)
  })

  test("a host's code off the rooms log list is logged as other, never as the host wrote it", async () => {
    const s = setUp({
      answer: (p) => ({
        member: p.member,
        host: p.host,
        watches: [
          { roomId: 'room:1', armed: false, refused: 'hostRefused', hostCode: 'rooms/watch:did:key:zSecretName' },
        ],
      }),
    })
    s.watches.want('room:1', MEMBER, HOST, 4)
    await s.watches.idle()
    const said = s.warn.mock.calls.map(([l]) => l).join('\n')
    expect(said).toMatch(/refused \(hostRefused: other\)/)
    expect(said).not.toContain('zSecretName')
  })

  test('a watch refused whole with a code off the list is logged as other, never with the code it came with', async () => {
    const s = setUp({
      answer: () => {
        throw new VtiRefusal('taskFailed', 'no', { code: 'rooms/keys/watch:did:key:zSecretName' })
      },
    })
    s.watches.want('room:1', MEMBER, HOST, 4)
    await s.watches.idle()
    const said = s.warn.mock.calls.map(([l]) => l).join('\n')
    expect(said).toMatch(/refused \(other\)/)
    expect(said).not.toContain('zSecretName')
  })

  test('armed with no time it lapses: polled', async () => {
    const s = setUp({
      answer: (p) => ({ member: p.member, host: p.host, watches: [{ roomId: 'room:1', armed: true }] }),
    })
    s.watches.want('room:1', MEMBER, HOST, 4)
    await s.watches.idle()
    expect(s.watches.watched('room:1')).toBe(false)
  })

  test('a room the answer leaves out: polled', async () => {
    const s = setUp({ answer: (p) => ({ member: p.member, host: p.host, watches: [] }) })
    s.watches.want('room:1', MEMBER, HOST, 4)
    await s.watches.idle()
    expect(s.watches.watched('room:1')).toBe(false)
  })

  test('the task refused as a type: no watch is asked again this session, for any room', async () => {
    const s = setUp({
      answer: () => {
        throw new VtiRefusal('unsupportedType', 'no')
      },
    })
    s.watches.want('room:1', MEMBER, HOST, 4)
    await s.watches.idle()
    s.watches.want('room:2', MEMBER, HOST_B, 1)
    await s.watches.idle()
    expect(s.agentTask).toHaveBeenCalledTimes(1)
    expect(s.watches.watched('room:2')).toBe(false)
  })

  test('the member refused (memberNotPrincipal): those rooms polled, another member still armed (control)', async () => {
    const s = setUp({
      answer: (p) => {
        if (p.member === MEMBER)
          throw new VtiRefusal('taskFailed', 'no', { code: 'rooms/keys/watch:memberNotPrincipal' })
        return armedAll(p)
      },
    })
    s.watches.want('room:1', MEMBER, HOST, 4)
    s.watches.want('room:2', 'did:key:persona-b', HOST, 4)
    await s.watches.idle()
    expect(s.watches.watched('room:1')).toBe(false)
    expect(s.watches.watched('room:2')).toBe(true)
  })

  test('no answer: not watched, and asked again with the next read', async () => {
    let fail = true
    const s = setUp({
      answer: (p) => {
        if (fail) throw new Error('timed out')
        return armedAll(p)
      },
    })
    s.watches.want('room:1', MEMBER, HOST, 4)
    await s.watches.idle()
    expect(s.watches.watched('room:1')).toBe(false)
    fail = false
    s.watches.want('room:1', MEMBER, HOST, 4)
    await s.watches.idle()
    expect(s.watches.watched('room:1')).toBe(true)
  })
})

describe('a hold for consent', () => {
  const held = () => {
    throw new VtiRefusal('taskFailed', 'held', { reason: 'auth:consent_required' })
  }

  test('is kept, and neither this session nor the next asks a watch of that agent for a day', async () => {
    const storage = disk()
    const first = setUp({ answer: held, holds: storedConsentHolds(() => 'did:agent:mine', storage) })
    first.watches.want('room:1', MEMBER, HOST, 4)
    await first.watches.idle()
    first.watches.want('room:2', MEMBER, HOST_B, 1)
    await first.watches.idle()
    expect(first.agentTask).toHaveBeenCalledTimes(1)
    expect(first.warn.mock.calls.map(([l]) => l).join('\n')).toMatch(
      /held for consent: they are polled, and none is armed for a day/
    )

    const next = setUp({ holds: storedConsentHolds(() => 'did:agent:mine', storage), now: () => T0 + 60_000 })
    next.watches.want('room:1', MEMBER, HOST, 4)
    await next.watches.idle()
    expect(next.agentTask).not.toHaveBeenCalled()
    expect(next.watches.watched('room:1')).toBe(false)
  })

  test('a day later, watches are armed again (control: the back-off ends)', async () => {
    const storage = disk()
    const first = setUp({ answer: held, holds: storedConsentHolds(() => 'did:agent:mine', storage) })
    first.watches.want('room:1', MEMBER, HOST, 4)
    await first.watches.idle()
    const after = setUp({
      holds: storedConsentHolds(() => 'did:agent:mine', storage),
      now: () => T0 + CONSENT_HOLD_BACKOFF_MS,
    })
    after.watches.want('room:1', MEMBER, HOST, 4)
    await after.watches.idle()
    expect(after.watches.watched('room:1')).toBe(true)
  })

  test('a held batch read says nothing of watches: the types are kept apart (control)', async () => {
    const storage = disk()
    await storedConsentHolds(() => 'did:agent:mine', storage).noteHeld(ROOMS_TASK.keysRead02, T0)
    const s = setUp({ holds: storedConsentHolds(() => 'did:agent:mine', storage) })
    s.watches.want('room:1', MEMBER, HOST, 4)
    await s.watches.idle()
    expect(s.watches.watched('room:1')).toBe(true)
  })

  test('storage that cannot be read: no watch goes out', async () => {
    const storage = disk()
    storage.getItem.mockRejectedValue(new Error('gone'))
    const s = setUp({ holds: storedConsentHolds(() => 'did:agent:mine', storage) })
    s.watches.want('room:1', MEMBER, HOST, 4)
    await s.watches.idle()
    expect(s.agentTask).not.toHaveBeenCalled()
  })
})

describe('ending watches', () => {
  test('cancel: an armed watch is cancelled at the agent, and is no longer watched', async () => {
    const s = setUp()
    s.watches.want('room:1', MEMBER, HOST, 4)
    await s.watches.idle()
    s.watches.cancel('room:1')
    await s.watches.idle()
    expect(s.sent()[1]).toEqual({ member: MEMBER, host: HOST, rooms: [{ roomId: 'room:1' }], cancel: true })
    expect(s.watches.watched('room:1')).toBe(false)
  })

  test('cancel of a room never armed: nothing is sent (control)', async () => {
    const s = setUp()
    s.watches.cancel('room:1')
    await s.watches.idle()
    expect(s.agentTask).not.toHaveBeenCalled()
  })

  test('an answer to a request sent before a lock is not the answer for the room armed again after it', async () => {
    const releases: (() => void)[] = []
    let calls = 0
    const s = setUp({
      answer: (p) => {
        calls++
        // Before the lock: armed. After it: the host refuses. Only the second may decide.
        const reply =
          calls === 1
            ? armedAll(p)
            : { member: p.member, host: p.host, watches: [{ roomId: 'room:1', armed: false, refused: 'hostRefused' }] }
        return new Promise((r) => releases.push(() => r(reply)))
      },
    })
    s.watches.want('room:1', MEMBER, HOST, 4)
    for (let i = 0; i < 5; i++) await Promise.resolve()
    s.watches.forget()
    s.watches.want('room:1', MEMBER, HOST, 4)
    releases[0]()
    for (let i = 0; i < 10; i++) await Promise.resolve()
    releases[1]()
    await s.watches.idle()
    expect(s.agentTask).toHaveBeenCalledTimes(2)
    expect(s.watches.watched('room:1')).toBe(false)
  })

  test('forget (a lock): an answer that arrives after it is not kept, and nothing is cancelled', async () => {
    let release: (v: unknown) => void = () => undefined
    const s = setUp({ answer: (p) => new Promise((r) => (release = () => r(armedAll(p)))) })
    s.watches.want('room:1', MEMBER, HOST, 4)
    await Promise.resolve()
    await Promise.resolve()
    s.watches.forget()
    release(undefined)
    await s.watches.idle()
    expect(s.watches.watched('room:1')).toBe(false)
    expect(s.agentTask).toHaveBeenCalledTimes(1)
  })
})

describe('the release switch (liveDeliverySwitch)', () => {
  test('off: nothing is armed, and every room is polled', async () => {
    const s = setUp({ on: () => false })
    s.watches.want('room:1', MEMBER, HOST, 4)
    await s.watches.idle()
    expect(s.agentTask).not.toHaveBeenCalled()
    expect(s.watches.watched('room:1')).toBe(false)
  })

  test('turned off after a room was armed: no longer watched, and its signal reads nothing', async () => {
    let on = true
    const s = setUp({ on: () => on })
    s.watches.want('room:1', MEMBER, HOST, 4)
    await s.watches.idle()
    expect(s.watches.watched('room:1')).toBe(true)
    on = false
    expect(s.watches.watched('room:1')).toBe(false)
    expect(s.watches.signal(signal('room:1'))).toBeUndefined()
  })
})
