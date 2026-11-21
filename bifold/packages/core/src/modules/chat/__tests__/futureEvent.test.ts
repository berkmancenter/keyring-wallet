/**
 * A timer event whose eventId claims a time more than a day ahead of this phone is refused: ties on a chat's timer go
 * to the larger eventId, so a far-future id would win every later change on both phones. Other event types are kept,
 * because a fast clock there harms only its own sender, and refusing would drop the text of anyone whose clock is
 * wrong.
 */
import { CHAT_PROFILE, MAX_EVENT_CLOCK_SKEW_MS, parseChatEvent } from '../chatEvent'
import { createEventIdFactory, decodeUlidTime } from '../eventId'

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0)
const idAt = (ms: number) => createEventIdFactory({ now: () => ms })()
const TARGET = idAt(NOW - 60_000)

const timer = (eventId: string) => ({
  profile: CHAT_PROFILE,
  type: 'timer',
  eventId,
  timer: { expiresIn: 3600, version: 2 },
})
const message = (eventId: string) => ({
  profile: CHAT_PROFILE,
  type: 'message',
  eventId,
  content: { format: 'text/plain', text: 'hi' },
})
const reaction = (eventId: string) => ({
  profile: CHAT_PROFILE,
  type: 'reaction',
  eventId,
  target: TARGET,
  emoji: '👍',
})

describe('event ids from the future', () => {
  test('decodeUlidTime reads back the time an id was made with', () => {
    for (const t of [0, NOW, NOW + MAX_EVENT_CLOCK_SKEW_MS, 2 ** 40]) expect(decodeUlidTime(idAt(t))).toBe(t)
    expect(decodeUlidTime('not a ulid!!')).toBeNaN()
  })

  test('a timer at exactly the allowed skew is accepted; one millisecond more is refused as future-event', () => {
    expect(parseChatEvent(timer(idAt(NOW + MAX_EVENT_CLOCK_SKEW_MS)), { now: NOW }).ok).toBe(true)
    expect(parseChatEvent(timer(idAt(NOW + MAX_EVENT_CLOCK_SKEW_MS + 1)), { now: NOW })).toEqual({
      ok: false,
      reason: 'future-event',
    })
    expect(parseChatEvent(timer('7ZZZZZZZZZZZZZZZZZZZZZZZZZ'), { now: NOW })).toEqual({
      ok: false,
      reason: 'future-event',
    })
  })

  test('the refusal is for timers only: a far-future message or reaction is kept, so no one loses text to a wrong clock', () => {
    const far = idAt(NOW + 365 * 24 * 60 * 60 * 1000)
    expect(parseChatEvent(message(far), { now: NOW })).toMatchObject({
      ok: true,
      event: { type: 'message', eventId: far },
    })
    expect(parseChatEvent(reaction(far), { now: NOW })).toMatchObject({ ok: true, event: { type: 'reaction' } })
  })
})
