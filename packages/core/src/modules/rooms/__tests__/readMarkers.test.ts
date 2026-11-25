/**
 * Read markers kept by the person's agent (`rooms/keys/read-marker/set/0.1`): told when a room's screen shows a post,
 * forward only, one at a time for a room after a settle time; the agent's answer, its key list and its `moved` notice
 * adopted; and nothing sent where the agent can't keep one, holds the task for consent, or refuses it.
 */
import { CONSENT_HOLD_BACKOFF_MS, storedConsentHolds } from '../real/consentHolds'
import { furtherOn, READ_MARKER_SETTLE_MS, READ_MARKER_TIMEOUT_MS, RoomReadMarkers } from '../real/readMarkers'
import { parseKeysList, parseReadMarkerMoved, parseReadMarkerSet, ROOMS_TASK, type ReadMarker } from '../real/wire'
import { VtiRefusal } from '../../trust-tasks/module/vtiAgent'

const MEMBER = 'did:key:persona-a'
const OTHER = 'did:key:persona-b'
const T0 = Date.parse('2026-11-25T06:00:00Z')
const SET = ROOMS_TASK.keysReadMarkerSet01

type Payload = { roomId: string; member: string; readMarker: ReadMarker; rewind?: true }
type Answer = (payload: Payload) => unknown

/** The agent keeps what it is sent. */
const kept: Answer = (p) => ({ roomId: p.roomId, member: p.member, readMarker: p.readMarker, moved: true })

const disk = () => {
  const rows = new Map<string, string>()
  return {
    getItem: jest.fn(async (key: string) => rows.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => void rows.set(key, value)),
  }
}

function setUp({
  answer = kept,
  served = [SET],
  holds,
  on = () => true,
  held = () => true,
}: {
  answer?: Answer
  /** null: what the agent serves is not known yet. */
  served?: string[] | null
  holds?: ReturnType<typeof storedConsentHolds>
  on?: () => boolean
  held?: (roomId: string, member: string) => boolean
} = {}) {
  let now = T0
  const timers: { run: () => void; ms: number }[] = []
  const agentTask = jest.fn(async (type: string, payload: Record<string, unknown>, options?: unknown) => {
    void options
    if (type !== SET) throw new Error(`unexpected ${type}`)
    return answer(payload as unknown as Payload)
  })
  const warn = jest.fn()
  const heard = jest.fn()
  const markers = new RoomReadMarkers({
    served: () => served ?? undefined,
    agentTask,
    consentHolds: holds,
    now: () => now,
    warn,
    on,
    holds: held,
    later: (run, ms) => void timers.push({ run, ms }),
  })
  markers.onHeard(heard)
  /** The settle time passes: every set waiting goes, and its answer is in. */
  const settle = async () => {
    for (const timer of timers.splice(0)) timer.run()
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }
  const sent = () => agentTask.mock.calls.map(([, p]) => p as unknown as Payload)
  return { markers, agentTask, sent, warn, heard, timers, settle, pass: (ms: number) => void (now += ms) }
}

describe('which marker is further on', () => {
  test.each<[string, ReadMarker, ReadMarker | undefined, boolean]>([
    ['a greater version', { version: 5 }, { version: 4, createdAt: '2026-11-25T06:00:00Z' }, true],
    ['a lesser version, whatever its time', { version: 3, createdAt: '2026-11-25T07:00:00Z' }, { version: 4 }, false],
    [
      'the same version, a later time',
      { version: 4, createdAt: '2026-11-25T06:00:01Z' },
      { version: 4, createdAt: '2026-11-25T06:00:00Z' },
      true,
    ],
    [
      'the same version, the same instant written another way',
      { version: 4, createdAt: '2026-11-25T06:00:00.000Z' },
      { version: 4, createdAt: '2026-11-25T06:00:00Z' },
      false,
    ],
    ['the same version, a time against none', { version: 4, createdAt: '2026-11-25T06:00:00Z' }, { version: 4 }, true],
    ['the same version, none against a time', { version: 4 }, { version: 4, createdAt: '2026-11-25T06:00:00Z' }, false],
    ['the same marker', { version: 4 }, { version: 4 }, false],
    ['any marker against none held', { version: 0 }, undefined, true],
  ])('%s', (_, a, b, further) => expect(furtherOn(a, b)).toBe(further))
})

describe('what the room screen shows is told to the agent', () => {
  test('one set, after the settle time, as the member, never waiting for consent', async () => {
    const s = setUp()
    s.markers.read('room:1', MEMBER, { version: 7, createdAt: '2026-11-25T05:59:00Z' })
    expect(s.agentTask).not.toHaveBeenCalled()
    expect(s.timers.map((t) => t.ms)).toEqual([READ_MARKER_SETTLE_MS])
    await s.settle()
    expect(s.agentTask.mock.calls).toEqual([
      [
        SET,
        { roomId: 'room:1', member: MEMBER, readMarker: { version: 7, createdAt: '2026-11-25T05:59:00Z' } },
        { timeoutMs: READ_MARKER_TIMEOUT_MS, waitForConsent: false },
      ],
    ])
    expect(s.markers.held('room:1', MEMBER)).toEqual({ version: 7, createdAt: '2026-11-25T05:59:00Z' })
    // The agent kept what was sent: nothing for the rows to adopt, and nothing said.
    expect(s.heard).not.toHaveBeenCalled()
    expect(s.warn).not.toHaveBeenCalled()
  })

  test('several posts seen within the settle time are one set, of the furthest', async () => {
    const s = setUp()
    for (const version of [5, 6, 9, 8]) s.markers.read('room:1', MEMBER, { version })
    await s.settle()
    expect(s.sent().map((p) => p.readMarker)).toEqual([{ version: 9 }])
  })

  test('what is seen while a set is out goes next, once it is answered', async () => {
    let release: () => void = () => undefined
    let calls = 0
    const s = setUp({
      answer: (p) => (++calls === 1 ? new Promise((r) => (release = () => r(kept(p)))) : kept(p)),
    })
    s.markers.read('room:1', MEMBER, { version: 5 })
    await s.settle()
    s.markers.read('room:1', MEMBER, { version: 6 })
    s.markers.read('room:1', MEMBER, { version: 7 })
    // No second wait is started, and nothing goes while the first is out.
    expect(s.timers).toHaveLength(0)
    expect(s.agentTask).toHaveBeenCalledTimes(1)
    release()
    await s.settle()
    expect(s.sent().map((p) => p.readMarker.version)).toEqual([5, 7])
  })

  test('what the agent already holds is not sent again, and neither is anything behind it', async () => {
    const s = setUp()
    s.markers.read('room:1', MEMBER, { version: 7 })
    await s.settle()
    s.markers.read('room:1', MEMBER, { version: 7 })
    s.markers.read('room:1', MEMBER, { version: 3 })
    await s.settle()
    expect(s.agentTask).toHaveBeenCalledTimes(1)
  })

  test('rooms and members are kept apart', async () => {
    const s = setUp()
    s.markers.read('room:1', MEMBER, { version: 7 })
    s.markers.read('room:2', MEMBER, { version: 2 })
    s.markers.read('room:1', OTHER, { version: 4 })
    await s.settle()
    expect(s.sent().map((p) => [p.roomId, p.member, p.readMarker.version])).toEqual([
      ['room:1', MEMBER, 7],
      ['room:2', MEMBER, 2],
      ['room:1', OTHER, 4],
    ])
  })

  test('another device had read further: the answer is adopted, and the rows are told', async () => {
    const s = setUp({ answer: (p) => ({ ...kept(p), readMarker: { version: 12 }, moved: false }) })
    s.markers.read('room:1', MEMBER, { version: 7 })
    await s.settle()
    expect(s.markers.held('room:1', MEMBER)).toEqual({ version: 12 })
    expect(s.heard.mock.calls).toEqual([['room:1', MEMBER, { version: 12 }, 'further']])
    // What this phone sees next is behind it: nothing goes.
    s.markers.read('room:1', MEMBER, { version: 9 })
    await s.settle()
    expect(s.agentTask).toHaveBeenCalledTimes(1)
  })
})

describe('where nothing can be kept at the agent', () => {
  const lines = (warn: jest.Mock) => warn.mock.calls.map(([line]) => line as string)

  test.each([
    [
      'the agent does not serve the task',
      { served: [ROOMS_TASK.keysRead] },
      'the agent does not serve rooms/keys/read-marker/set',
    ],
    ['what it serves is not known yet', { served: null }, 'what the agent serves is not known yet'],
    ['the release switch is off', { on: () => false }, 'read markers are off'],
  ])('%s: nothing is sent, and it is said once', async (_, over, why) => {
    const s = setUp(over)
    s.markers.read('room:1', MEMBER, { version: 7 })
    s.markers.read('room:2', MEMBER, { version: 2 })
    await s.settle()
    expect(s.agentTask).not.toHaveBeenCalled()
    expect(lines(s.warn)).toEqual([`rooms: what is read is kept on this phone only (${why})`])
  })

  test('the switch off: a marker the agent holds is not taken either', () => {
    const s = setUp({ on: () => false })
    s.markers.listed([
      { roomId: 'room:1', epoch: 1, earliestReadableEpoch: 1, member: MEMBER, readMarker: { version: 9 } },
    ])
    s.markers.moved({ roomId: 'room:1', member: MEMBER, readMarker: { version: 9 } })
    expect(s.heard).not.toHaveBeenCalled()
    expect(s.markers.held('room:1', MEMBER)).toBeUndefined()
  })

  test('the task refused as a type: no set goes again this session, for any room', async () => {
    const s = setUp({
      answer: () => {
        throw new VtiRefusal('unsupportedType', 'no')
      },
    })
    s.markers.read('room:1', MEMBER, { version: 7 })
    await s.settle()
    s.markers.read('room:2', MEMBER, { version: 2 })
    await s.settle()
    expect(s.agentTask).toHaveBeenCalledTimes(1)
    expect(lines(s.warn)).toHaveLength(1)
  })

  test('a room the agent refuses (not held as that member): that room is not asked again, another still is (control)', async () => {
    const s = setUp({
      answer: (p) => {
        if (p.roomId === 'room:1')
          throw new VtiRefusal('taskFailed', 'no', { code: 'rooms/keys/read-marker/set:notHeld' })
        return kept(p)
      },
    })
    s.markers.read('room:1', MEMBER, { version: 7 })
    await s.settle()
    s.markers.read('room:1', MEMBER, { version: 8 })
    s.markers.read('room:2', MEMBER, { version: 2 })
    await s.settle()
    expect(s.sent().map((p) => p.roomId)).toEqual(['room:1', 'room:2'])
    expect(s.markers.held('room:2', MEMBER)).toEqual({ version: 2 })
    // A refusal of one room is not a reason to tell the person anything.
    expect(s.warn).not.toHaveBeenCalled()
  })

  test('no answer: nothing is held, and the next post seen asks again', async () => {
    let fail = true
    const s = setUp({
      answer: (p) => {
        if (fail) throw new Error('timed out')
        return kept(p)
      },
    })
    s.markers.read('room:1', MEMBER, { version: 7 })
    await s.settle()
    expect(s.markers.held('room:1', MEMBER)).toBeUndefined()
    fail = false
    s.markers.read('room:1', MEMBER, { version: 7 })
    await s.settle()
    expect(s.markers.held('room:1', MEMBER)).toEqual({ version: 7 })
  })
})

describe('a hold for consent', () => {
  const heldForConsent = () => new VtiRefusal('taskFailed', 'held', { reason: 'auth:consent_required' })

  test('is kept: neither this session nor the next sends a set to that agent for a day', async () => {
    const storage = disk()
    const holds = storedConsentHolds(() => 'did:agent:mine', storage)
    const s = setUp({
      holds,
      answer: () => {
        throw heldForConsent()
      },
    })
    s.markers.read('room:1', MEMBER, { version: 7 })
    await s.settle()
    s.markers.read('room:2', MEMBER, { version: 2 })
    await s.settle()
    expect(s.agentTask).toHaveBeenCalledTimes(1)
    expect(await holds.heldRecently(SET, T0 + CONSENT_HOLD_BACKOFF_MS - 1)).toBe(true)
    // The next session, the same day: nothing is sent.
    const next = setUp({ holds: storedConsentHolds(() => 'did:agent:mine', storage) })
    next.markers.read('room:1', MEMBER, { version: 7 })
    await next.settle()
    expect(next.agentTask).not.toHaveBeenCalled()
    expect(next.warn.mock.calls).toEqual([
      ['rooms: what is read is kept on this phone only (held for consent in the last day)'],
    ])
  })

  test('a held watch says nothing of read markers: the types are kept apart (control)', async () => {
    const storage = disk()
    const holds = storedConsentHolds(() => 'did:agent:mine', storage)
    await holds.noteHeld(ROOMS_TASK.keysWatch02, T0)
    const s = setUp({ holds })
    s.markers.read('room:1', MEMBER, { version: 7 })
    await s.settle()
    expect(s.agentTask).toHaveBeenCalledTimes(1)
  })
})

describe("the agent's key list", () => {
  const entry = (roomId: string, readMarker?: ReadMarker, member = MEMBER) => ({
    roomId,
    epoch: 1,
    earliestReadableEpoch: 1,
    member,
    ...(readMarker ? { readMarker } : {}),
  })

  test("each room's marker is held, and the rows are told it may move them forward", () => {
    const s = setUp()
    s.markers.listed([entry('room:1', { version: 9 }), entry('room:2'), entry('room:3', { version: 0 })])
    expect(s.heard.mock.calls).toEqual([
      ['room:1', MEMBER, { version: 9 }, 'further'],
      ['room:3', MEMBER, { version: 0 }, 'further'],
    ])
    expect(s.markers.held('room:2', MEMBER)).toBeUndefined()
  })

  test('the same marker listed again says nothing', () => {
    const s = setUp()
    s.markers.listed([entry('room:1', { version: 9 })])
    s.markers.listed([entry('room:1', { version: 9 })])
    expect(s.heard).toHaveBeenCalledTimes(1)
  })

  test("a marker behind the agent's last is a room marked unread elsewhere: taken as it is", () => {
    const s = setUp()
    s.markers.listed([entry('room:1', { version: 9 })])
    s.markers.listed([entry('room:1', { version: 4 })])
    expect(s.heard.mock.calls[1]).toEqual(['room:1', MEMBER, { version: 4 }, 'moved'])
    expect(s.markers.held('room:1', MEMBER)).toEqual({ version: 4 })
  })

  test('a room with a set waiting or out is left to that answer', async () => {
    const s = setUp()
    s.markers.read('room:1', MEMBER, { version: 9 })
    s.markers.listed([entry('room:1', { version: 4 })])
    expect(s.heard).not.toHaveBeenCalled()
    await s.settle()
    expect(s.markers.held('room:1', MEMBER)).toEqual({ version: 9 })
  })

  test('a list asked before a set was answered is the older word, and does not take the room back', async () => {
    const s = setUp()
    const askedAt = T0
    s.pass(1000)
    s.markers.read('room:1', MEMBER, { version: 9 })
    await s.settle()
    s.markers.listed([entry('room:1', { version: 4 })], askedAt)
    expect(s.heard).not.toHaveBeenCalled()
    expect(s.markers.held('room:1', MEMBER)).toEqual({ version: 9 })
    // Control: a list asked after it is the newer word.
    s.pass(1000)
    s.markers.listed([entry('room:1', { version: 4 })])
    expect(s.heard.mock.calls).toEqual([['room:1', MEMBER, { version: 4 }, 'moved']])
  })

  test('what the list says the agent holds is not sent back to it', async () => {
    const s = setUp()
    s.markers.listed([entry('room:1', { version: 9 })])
    s.markers.read('room:1', MEMBER, { version: 9 })
    s.markers.read('room:1', MEMBER, { version: 6 })
    await s.settle()
    expect(s.agentTask).not.toHaveBeenCalled()
  })
})

describe("the agent's notice that a marker moved on another device", () => {
  test('further on: held, and the rows are told', () => {
    const s = setUp()
    s.markers.moved({ roomId: 'room:1', member: MEMBER, readMarker: { version: 9 } })
    expect(s.heard.mock.calls).toEqual([['room:1', MEMBER, { version: 9 }, 'moved']])
    expect(s.markers.held('room:1', MEMBER)).toEqual({ version: 9 })
  })

  test('behind (marked unread elsewhere): taken as it is', () => {
    const s = setUp()
    s.markers.listed([
      { roomId: 'room:1', epoch: 1, earliestReadableEpoch: 1, member: MEMBER, readMarker: { version: 9 } },
    ])
    s.markers.moved({ roomId: 'room:1', member: MEMBER, readMarker: { version: 0 } })
    expect(s.heard.mock.calls[1]).toEqual(['room:1', MEMBER, { version: 0 }, 'moved'])
  })

  test('for a room the agent does not hold as that member: nothing', () => {
    const s = setUp({ held: (roomId, member) => roomId === 'room:1' && member === MEMBER })
    s.markers.moved({ roomId: 'room:1', member: OTHER, readMarker: { version: 9 } })
    s.markers.moved({ roomId: 'room:2', member: MEMBER, readMarker: { version: 9 } })
    expect(s.heard).not.toHaveBeenCalled()
  })

  test.each([
    ['not an object', 'room:1'],
    ['no marker', { roomId: 'room:1', member: MEMBER }],
    ['a version that is not a whole number', { roomId: 'room:1', member: MEMBER, readMarker: { version: 1.5 } }],
    ['a version below none', { roomId: 'room:1', member: MEMBER, readMarker: { version: -1 } }],
  ])('a payload that is not a notice (%s): nothing', (_, payload) => {
    const s = setUp()
    s.markers.moved(payload)
    expect(s.heard).not.toHaveBeenCalled()
  })

  test('a set still waiting that is no further on is dropped; one further on still goes (control)', async () => {
    const s = setUp()
    s.markers.read('room:1', MEMBER, { version: 7 })
    s.markers.read('room:2', MEMBER, { version: 7 })
    s.markers.moved({ roomId: 'room:1', member: MEMBER, readMarker: { version: 9 } })
    s.markers.moved({ roomId: 'room:2', member: MEMBER, readMarker: { version: 5 } })
    await s.settle()
    expect(s.sent().map((p) => [p.roomId, p.readMarker.version])).toEqual([['room:2', 7]])
  })
})

describe('a lock', () => {
  test('forget: nothing waiting is sent, an answer that arrives after it is not kept, and nothing held is left', async () => {
    let release: () => void = () => undefined
    const s = setUp({ answer: (p) => new Promise((r) => (release = () => r(kept(p)))) })
    s.markers.read('room:1', MEMBER, { version: 7 })
    await s.settle()
    s.markers.read('room:2', MEMBER, { version: 2 })
    s.markers.forget()
    release()
    await s.settle()
    expect(s.agentTask).toHaveBeenCalledTimes(1)
    expect(s.markers.held('room:1', MEMBER)).toBeUndefined()
    expect(s.markers.held('room:2', MEMBER)).toBeUndefined()
  })
})

describe('the wire', () => {
  test('a key list entry carries its marker where it has one (0.3), and none where it has none', () => {
    const rooms = parseKeysList({
      rooms: [
        {
          roomId: 'room:1',
          epoch: 2,
          earliestReadableEpoch: 1,
          member: MEMBER,
          readMarker: { version: 9, createdAt: '2026-11-25T05:59:00Z' },
        },
        { roomId: 'room:2', epoch: 2, earliestReadableEpoch: 1, member: MEMBER },
        { roomId: 'room:3', epoch: 2, earliestReadableEpoch: 1, member: MEMBER, readMarker: { version: 'nine' } },
        {
          roomId: 'room:4',
          epoch: 2,
          earliestReadableEpoch: 1,
          member: MEMBER,
          readMarker: { version: 3, createdAt: 'yesterday' },
        },
      ],
    })
    expect(rooms.map((r) => r.readMarker)).toEqual([
      { version: 9, createdAt: '2026-11-25T05:59:00Z' },
      undefined,
      undefined,
      { version: 3 },
    ])
  })

  test("a set's answer: the marker in force and whether it moved; no marker, no answer", () => {
    expect(parseReadMarkerSet({ roomId: 'r', member: MEMBER, readMarker: { version: 4 }, moved: true })).toEqual({
      readMarker: { version: 4 },
      moved: true,
    })
    expect(parseReadMarkerSet({ roomId: 'r', member: MEMBER, readMarker: { version: 4 } })?.moved).toBe(false)
    expect(parseReadMarkerSet({ roomId: 'r', member: MEMBER, moved: true })).toBeUndefined()
  })

  test('a moved notice names the room, the member and the marker', () => {
    expect(parseReadMarkerMoved({ roomId: 'r', member: MEMBER, readMarker: { version: 0 } })).toEqual({
      roomId: 'r',
      member: MEMBER,
      readMarker: { version: 0 },
    })
    expect(parseReadMarkerMoved({ roomId: 'r', readMarker: { version: 0 } })).toBeUndefined()
  })
})
