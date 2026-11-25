/**
 * The live watch (`rooms/keys/watch/0.2`): the room a screen holds is watched live where its host allows it, renewed
 * before its two-minute lease ends, and never spent by a signal; every other outcome leaves the room watched one
 * signal at a time at 0.1, exactly as roomWatches.test.ts proves it, and live is asked again after a wait.
 */
import { storedConsentHolds } from '../real/consentHolds'
import {
  LIVE_LEASE_SECONDS,
  LIVE_NO_ANSWER_MS,
  LIVE_RENEW_BEFORE_MS,
  LIVE_RETRY_MS,
  RoomWatches,
  WATCH_LEASE_SECONDS,
} from '../real/roomWatches'
import { LIVE_NOT_PERMITTED, parseWatch, ROOMS_TASK } from '../real/wire'
import { VtiRefusal } from '../../trust-tasks/module/vtiAgent'

const MEMBER = 'did:key:persona-a'
const HOST = 'did:webvh:host:a'
const ROOM = 'did:webvh:room:one'
const T0 = Date.parse('2026-11-24T20:00:00Z')
const WEEK = 7 * 24 * 3600_000

type Payload = {
  member: string
  host: string
  rooms: { roomId: string; sinceVersion?: number }[]
  cancel?: true
  live?: true
  leaseSeconds?: number
}
type Sent = { type: string; payload: Payload }
type Answer = (sent: Sent, now: number) => unknown

const iso = (ms: number) => new Date(ms).toISOString()

/** A host that arms a live watch live (its room's signal delay is `none`), and a one-shot watch as ever. */
const liveHost: Answer = ({ type, payload }, now) => ({
  member: payload.member,
  host: payload.host,
  watches: payload.rooms.map(({ roomId }) =>
    payload.cancel
      ? { roomId, armed: false }
      : type === ROOMS_TASK.keysWatch02 && payload.live
        ? { roomId, armed: true, expiresAt: iso(now + LIVE_LEASE_SECONDS * 1000), live: true }
        : { roomId, armed: true, expiresAt: iso(now + WEEK) }
  ),
})

/** A host whose room keeps the randomised signal delay: a live watch is refused, a one-shot one armed. */
const delayedHost: Answer = (sent, now) =>
  sent.type === ROOMS_TASK.keysWatch02 && sent.payload.live
    ? {
        member: sent.payload.member,
        host: sent.payload.host,
        watches: sent.payload.rooms.map(({ roomId }) => ({
          roomId,
          armed: false,
          refused: 'hostRefused',
          hostCode: LIVE_NOT_PERMITTED,
        })),
      }
    : liveHost(sent, now)

/** An agent or host that takes 0.2 and arms the watch for one signal (`live` absent), with the lease it was asked. */
const oneShotOnly: Answer = (sent, now) =>
  sent.type === ROOMS_TASK.keysWatch02 && sent.payload.live
    ? {
        member: sent.payload.member,
        host: sent.payload.host,
        watches: sent.payload.rooms.map(({ roomId }) => ({
          roomId,
          armed: true,
          expiresAt: iso(now + (sent.payload.leaseSeconds ?? 0) * 1000),
        })),
      }
    : liveHost(sent, now)

const disk = () => {
  const kept = new Map<string, string>()
  return {
    getItem: jest.fn(async (key: string) => kept.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => void kept.set(key, value)),
  }
}

function setUp({
  answer = liveHost,
  served = [ROOMS_TASK.keysWatch01, ROOMS_TASK.keysWatch02],
  liveOn = () => true,
  holds,
}: {
  answer?: Answer
  served?: string[]
  liveOn?: (() => boolean) | null
  holds?: ReturnType<typeof storedConsentHolds>
} = {}) {
  const clock = { now: T0 }
  const replies = { answer }
  const sent: Sent[] = []
  const agentTask = jest.fn(async (type: string, payload: Record<string, unknown>) => {
    const s = { type, payload: payload as unknown as Payload }
    sent.push(s)
    return replies.answer(s, clock.now)
  })
  const warn = jest.fn()
  const watches = new RoomWatches({
    served: () => served,
    agentTask,
    consentHolds: holds,
    now: () => clock.now,
    warn,
    logRef: (id) => id.slice(-3),
    on: () => true,
    ...(liveOn ? { liveOn } : {}),
  })
  const lines = () => warn.mock.calls.map(([line]) => line as string)
  /** What went to the agent, in order: `0.2 live`, `0.1`, `0.1 cancel`. */
  const asked = () =>
    sent.map(
      ({ type, payload }) =>
        `${type === ROOMS_TASK.keysWatch02 ? '0.2' : '0.1'}${payload.live ? ' live' : ''}${payload.cancel ? ' cancel' : ''}`
    )
  /** Settles every request, including the ones a request's answer asked for. */
  const settled = async () => {
    for (let i = 0; i < 4; i++) await watches.idle()
  }
  return { watches, agentTask, sent, asked, clock, replies, lines, settled }
}

const signal = (over: Record<string, unknown> = {}) => ({
  roomId: ROOM,
  member: MEMBER,
  host: HOST,
  latestVersion: 9,
  ...over,
})

describe('a room held on screen', () => {
  test('is asked live at 0.2, with live: true and the two-minute lease, and is live where its outcome says so', async () => {
    const s = setUp()
    s.watches.want(ROOM, MEMBER, HOST, 4, { live: true })
    await s.settled()
    expect(s.sent).toEqual([
      {
        type: ROOMS_TASK.keysWatch02,
        payload: {
          member: MEMBER,
          host: HOST,
          rooms: [{ roomId: ROOM, sinceVersion: 4 }],
          leaseSeconds: LIVE_LEASE_SECONDS,
          live: true,
        },
      },
    ])
    expect(s.watches.watched(ROOM)).toBe(true)
    expect(s.lines()).toContain('rooms: one is watched live')
  })

  test('a room nobody holds is armed at 0.1 with the week lease and no live member, as before (control)', async () => {
    const s = setUp()
    s.watches.want(ROOM, MEMBER, HOST, 4)
    await s.settled()
    expect(s.sent).toEqual([
      {
        type: ROOMS_TASK.keysWatch01,
        payload: {
          member: MEMBER,
          host: HOST,
          rooms: [{ roomId: ROOM, sinceVersion: 4 }],
          leaseSeconds: WATCH_LEASE_SECONDS,
        },
      },
    ])
  })

  test.each([
    ['the release switch is off', { liveOn: () => false }],
    ['no switch is given', { liveOn: null }],
    ['the agent does not serve 0.2', { served: [ROOMS_TASK.keysWatch01] }],
  ])('%s: the held room is armed one-shot at 0.1, and nothing goes at 0.2', async (_, over) => {
    const s = setUp(over)
    s.watches.want(ROOM, MEMBER, HOST, 4, { live: true })
    await s.settled()
    s.watches.renew(ROOM)
    await s.settled()
    expect(s.asked()).toEqual(['0.1'])
    expect(s.watches.watched(ROOM)).toBe(true)
  })

  test('a signal does not spend a live watch: each change is told, and nothing is armed between them', async () => {
    const s = setUp()
    s.watches.want(ROOM, MEMBER, HOST, 4, { live: true })
    await s.settled()
    expect(s.watches.signal(signal({ latestVersion: 5 }))).toBe(ROOM)
    // The read that follows a signal arms the room again; a live watch needs nothing.
    s.watches.want(ROOM, MEMBER, HOST, 5)
    expect(s.watches.signal(signal({ latestVersion: 6 }))).toBe(ROOM)
    s.watches.want(ROOM, MEMBER, HOST, 6)
    await s.settled()
    expect(s.watches.watched(ROOM)).toBe(true)
    expect(s.asked()).toEqual(['0.2 live'])
  })

  test('a one-shot watch is spent by its first signal (control)', async () => {
    const s = setUp()
    s.watches.want(ROOM, MEMBER, HOST, 4)
    await s.settled()
    expect(s.watches.signal(signal())).toBe(ROOM)
    expect(s.watches.signal(signal())).toBeUndefined()
    expect(s.watches.watched(ROOM)).toBe(false)
  })

  test('a signal naming another member or host is not a live watch either', async () => {
    const s = setUp()
    s.watches.want(ROOM, MEMBER, HOST, 4, { live: true })
    await s.settled()
    expect(s.watches.signal(signal({ member: 'did:key:someone-else' }))).toBeUndefined()
    expect(s.watches.signal(signal({ host: 'did:webvh:host:b' }))).toBeUndefined()
  })

  test("Messages' rows arming the same room never end its live watch", async () => {
    const s = setUp()
    s.watches.want(ROOM, MEMBER, HOST, 4, { live: true })
    await s.settled()
    s.watches.want(ROOM, MEMBER, HOST, 9)
    await s.settled()
    expect(s.asked()).toEqual(['0.2 live'])
    expect(s.watches.signal(signal())).toBe(ROOM)
    expect(s.watches.signal(signal())).toBe(ROOM)
  })
})

describe('renewing', () => {
  test('nothing goes while more than a minute of the lease is left; one renewal once less is, and the lease moves', async () => {
    const s = setUp()
    s.watches.want(ROOM, MEMBER, HOST, 4, { live: true })
    await s.settled()
    const leaseMs = LIVE_LEASE_SECONDS * 1000
    s.clock.now = T0 + leaseMs - LIVE_RENEW_BEFORE_MS - 1
    s.watches.renew(ROOM)
    await s.settled()
    expect(s.asked()).toEqual(['0.2 live'])
    s.clock.now = T0 + leaseMs - LIVE_RENEW_BEFORE_MS
    s.watches.renew(ROOM)
    s.watches.renew(ROOM)
    await s.settled()
    expect(s.asked()).toEqual(['0.2 live', '0.2 live'])
    expect(s.sent[1].payload.rooms).toEqual([{ roomId: ROOM, sinceVersion: 4 }])
    // The renewed lease: watched past the end of the first one.
    s.clock.now = T0 + leaseMs + 1
    expect(s.watches.watched(ROOM)).toBe(true)
  })

  test('a live watch nobody renewed stops counting as watched at its lease end, so the room is polled (control)', async () => {
    const s = setUp()
    s.watches.want(ROOM, MEMBER, HOST, 4, { live: true })
    await s.settled()
    s.clock.now = T0 + LIVE_LEASE_SECONDS * 1000 + 1
    expect(s.watches.watched(ROOM)).toBe(false)
  })

  test('a renewal carries the newest version a read reported since', async () => {
    const s = setUp()
    s.watches.want(ROOM, MEMBER, HOST, 4, { live: true })
    await s.settled()
    s.watches.want(ROOM, MEMBER, HOST, 7)
    s.clock.now = T0 + 70_000
    s.watches.renew(ROOM)
    await s.settled()
    expect(s.sent[1].payload.rooms).toEqual([{ roomId: ROOM, sinceVersion: 7 }])
  })

  test('renew sends nothing for a room no screen holds, and never arms a one-shot watch', async () => {
    const s = setUp()
    s.watches.renew(ROOM)
    s.watches.want(ROOM, MEMBER, HOST, 4)
    await s.settled()
    s.watches.signal(signal())
    s.clock.now = T0 + WEEK
    s.watches.renew(ROOM)
    await s.settled()
    expect(s.asked()).toEqual(['0.1'])
  })

  test('a renewal the host refuses: the live watch is gone, and the room is armed one-shot at once', async () => {
    const s = setUp()
    s.watches.want(ROOM, MEMBER, HOST, 4, { live: true })
    await s.settled()
    // The room went back to the randomised delay: the host ends every live watch, and refuses the renewal.
    s.replies.answer = delayedHost
    s.clock.now = T0 + 70_000
    s.watches.renew(ROOM)
    await s.settled()
    expect(s.asked()).toEqual(['0.2 live', '0.2 live', '0.1'])
    expect(s.sent[2].payload.leaseSeconds).toBe(WATCH_LEASE_SECONDS)
    // One-shot now: the first signal spends it.
    expect(s.watches.signal(signal())).toBe(ROOM)
    expect(s.watches.signal(signal())).toBeUndefined()
  })
})

describe('a host with no live watch to give', () => {
  test('liveNotPermitted: said once with its reason, armed one-shot at 0.1, and not asked live again for ten minutes', async () => {
    const s = setUp({ answer: delayedHost })
    s.watches.want(ROOM, MEMBER, HOST, 4, { live: true })
    await s.settled()
    expect(s.asked()).toEqual(['0.2 live', '0.1'])
    expect(s.watches.watched(ROOM)).toBe(true)
    expect(s.lines().filter((l) => l.includes('not watched live'))).toEqual([
      "rooms: one is not watched live (the room's signal delay is not none): it signals once per watch",
    ])
    // Reads, ticks and a signal's arming in the next ten minutes ask nothing live.
    s.clock.now = T0 + LIVE_RETRY_MS - 1
    s.watches.renew(ROOM)
    s.watches.want(ROOM, MEMBER, HOST, 4, { live: true })
    await s.settled()
    expect(s.asked()).toEqual(['0.2 live', '0.1'])
  })

  test('after the wait, the tick asks live again; a host that now allows it makes the room live', async () => {
    const s = setUp({ answer: delayedHost })
    s.watches.want(ROOM, MEMBER, HOST, 4, { live: true })
    await s.settled()
    s.replies.answer = liveHost
    s.clock.now = T0 + LIVE_RETRY_MS
    s.watches.renew(ROOM)
    await s.settled()
    expect(s.asked()).toEqual(['0.2 live', '0.1', '0.2 live'])
    expect(s.watches.signal(signal())).toBe(ROOM)
    expect(s.watches.signal(signal())).toBe(ROOM)
  })

  test('a one-shot watch already armed is kept when live is refused: the agent left it in place', async () => {
    const s = setUp({ answer: delayedHost })
    s.watches.want(ROOM, MEMBER, HOST, 4)
    await s.settled()
    s.watches.want(ROOM, MEMBER, HOST, 4, { live: true })
    await s.settled()
    // Asked live once, refused; nothing armed again, and the watch armed before still answers its signal.
    expect(s.asked()).toEqual(['0.1', '0.2 live'])
    expect(s.watches.watched(ROOM)).toBe(true)
    expect(s.watches.signal(signal())).toBe(ROOM)
  })

  test('armed without live (an agent or host that arms 0.2 one-shot): armed again at 0.1 with the week lease, not left on two minutes', async () => {
    const s = setUp({ answer: oneShotOnly })
    s.watches.want(ROOM, MEMBER, HOST, 4, { live: true })
    await s.settled()
    expect(s.asked()).toEqual(['0.2 live', '0.1'])
    expect(s.sent[1].payload.leaseSeconds).toBe(WATCH_LEASE_SECONDS)
    s.clock.now = T0 + LIVE_LEASE_SECONDS * 1000 + 1
    expect(s.watches.watched(ROOM)).toBe(true)
    expect(s.lines()).toContain('rooms: one is not watched live (armed for one signal only): it signals once per watch')
  })

  test('no answer: the room is armed one-shot, and live is asked again after a minute, not before', async () => {
    const s = setUp({
      answer: (sent, now) => {
        if (sent.type === ROOMS_TASK.keysWatch02) throw new Error('timed out')
        return liveHost(sent, now)
      },
    })
    s.watches.want(ROOM, MEMBER, HOST, 4, { live: true })
    await s.settled()
    expect(s.asked()).toEqual(['0.2 live', '0.1'])
    s.clock.now = T0 + LIVE_NO_ANSWER_MS - 1
    s.watches.renew(ROOM)
    await s.settled()
    expect(s.asked()).toEqual(['0.2 live', '0.1'])
    s.replies.answer = liveHost
    s.clock.now = T0 + LIVE_NO_ANSWER_MS
    s.watches.renew(ROOM)
    await s.settled()
    expect(s.asked()).toEqual(['0.2 live', '0.1', '0.2 live'])
  })

  test('the agent refuses the task itself: no live watch is asked again this session, and one-shot watches go on', async () => {
    const s = setUp({
      answer: (sent, now) => {
        if (sent.type === ROOMS_TASK.keysWatch02) throw new VtiRefusal('unsupportedType', 'no such task')
        return liveHost(sent, now)
      },
    })
    s.watches.want(ROOM, MEMBER, HOST, 4, { live: true })
    await s.settled()
    s.clock.now = T0 + LIVE_RETRY_MS * 3
    s.watches.renew(ROOM)
    s.watches.want('did:webvh:room:two', MEMBER, HOST, 1, { live: true })
    await s.settled()
    expect(s.asked()).toEqual(['0.2 live', '0.1', '0.1'])
  })

  test('an agent that serves the watch at 0.1 only: the same, no live watch is asked again this session', async () => {
    // What an agent from before the live watch answers: it knows the task, not this version of it.
    const s = setUp({
      answer: (sent, now) => {
        if (sent.type === ROOMS_TASK.keysWatch02) throw new VtiRefusal('unsupportedVersion', 'served: 0.1')
        return liveHost(sent, now)
      },
    })
    s.watches.want(ROOM, MEMBER, HOST, 4, { live: true })
    await s.settled()
    expect(s.watches.watched(ROOM)).toBe(true)
    s.clock.now = T0 + LIVE_RETRY_MS * 3
    s.watches.renew(ROOM)
    s.watches.want('did:webvh:room:two', MEMBER, HOST, 1, { live: true })
    await s.settled()
    expect(s.asked()).toEqual(['0.2 live', '0.1', '0.1'])
  })

  test('a hold of 0.2 noted in the last day: nothing goes at 0.2, and the room is armed one-shot', async () => {
    const holds = storedConsentHolds(() => 'did:agent:mine', disk())
    await holds.noteHeld(ROOMS_TASK.keysWatch02, T0 - 1000)
    const s = setUp({ holds })
    s.watches.want(ROOM, MEMBER, HOST, 4, { live: true })
    await s.settled()
    expect(s.asked()).toEqual(['0.1'])
    expect(s.watches.watched(ROOM)).toBe(true)
  })
})

describe('letting go', () => {
  test('the screen lets go: the one-shot watch is armed at 0.1 from the newest version, which ends the live one', async () => {
    const s = setUp()
    s.watches.want(ROOM, MEMBER, HOST, 4, { live: true })
    await s.settled()
    s.watches.want(ROOM, MEMBER, HOST, 6, { live: false })
    await s.settled()
    expect(s.asked()).toEqual(['0.2 live', '0.1'])
    expect(s.sent[1].payload.rooms).toEqual([{ roomId: ROOM, sinceVersion: 6 }])
    // One-shot again, and no longer renewed.
    expect(s.watches.signal(signal())).toBe(ROOM)
    expect(s.watches.signal(signal())).toBeUndefined()
    s.clock.now = T0 + 70_000
    s.watches.renew(ROOM)
    await s.settled()
    expect(s.asked()).toEqual(['0.2 live', '0.1'])
  })

  test('letting go of a room that was never live sends nothing when its one-shot watch is armed from that version', async () => {
    const s = setUp({ answer: delayedHost })
    s.watches.want(ROOM, MEMBER, HOST, 4, { live: true })
    await s.settled()
    s.watches.want(ROOM, MEMBER, HOST, 4, { live: false })
    await s.settled()
    expect(s.asked()).toEqual(['0.2 live', '0.1'])
  })

  test('let go while the live request is out: its live answer is not kept, and the room is armed one-shot', async () => {
    let release: (() => void) | undefined
    const s = setUp({
      answer: async (sent, now) => {
        if (sent.type === ROOMS_TASK.keysWatch02) await new Promise<void>((r) => (release = r))
        return liveHost(sent, now)
      },
    })
    s.watches.want(ROOM, MEMBER, HOST, 4)
    await s.settled()
    s.watches.want(ROOM, MEMBER, HOST, 4, { live: true })
    while (!release) await Promise.resolve()
    // Out of view before the host answered. The one-shot watch looks armed from this version, so nothing is queued here.
    s.watches.want(ROOM, MEMBER, HOST, 4, { live: false })
    release?.()
    await s.settled()
    // The host armed it live meanwhile, on a two-minute lease nobody will renew: a one-shot watch replaces it.
    expect(s.asked()).toEqual(['0.1', '0.2 live', '0.1'])
    s.clock.now = T0 + LIVE_LEASE_SECONDS * 1000 + 1
    expect(s.watches.watched(ROOM)).toBe(true)
    expect(s.watches.signal(signal())).toBe(ROOM)
    expect(s.watches.signal(signal())).toBeUndefined()
  })

  test('the member left the room: a live watch is cancelled at the agent, and nothing is renewed after', async () => {
    const s = setUp()
    s.watches.want(ROOM, MEMBER, HOST, 4, { live: true })
    await s.settled()
    s.watches.cancel(ROOM)
    await s.settled()
    expect(s.asked()).toEqual(['0.2 live', '0.1 cancel'])
    expect(s.watches.signal(signal())).toBeUndefined()
    s.clock.now = T0 + 70_000
    s.watches.renew(ROOM)
    await s.settled()
    expect(s.asked()).toEqual(['0.2 live', '0.1 cancel'])
  })

  test('the wallet locked: every live watch is forgotten, and a signal for one is not acted on', async () => {
    const s = setUp()
    s.watches.want(ROOM, MEMBER, HOST, 4, { live: true })
    await s.settled()
    s.watches.forget()
    expect(s.watches.watched(ROOM)).toBe(false)
    expect(s.watches.signal(signal())).toBeUndefined()
    s.watches.renew(ROOM)
    await s.settled()
    expect(s.asked()).toEqual(['0.2 live'])
  })
})

describe('a watch answer', () => {
  const answer = (watch: Record<string, unknown>) => ({ member: MEMBER, host: HOST, watches: [watch] })

  test('live is kept only as the literal true of an armed watch', () => {
    const at = iso(T0)
    expect(parseWatch(answer({ roomId: ROOM, armed: true, expiresAt: at, live: true })).watches[0].live).toBe(true)
    expect(parseWatch(answer({ roomId: ROOM, armed: true, expiresAt: at })).watches[0].live).toBeUndefined()
    expect(
      parseWatch(answer({ roomId: ROOM, armed: true, expiresAt: at, live: 'true' })).watches[0].live
    ).toBeUndefined()
    expect(parseWatch(answer({ roomId: ROOM, armed: false, live: true })).watches[0].live).toBeUndefined()
  })
})
