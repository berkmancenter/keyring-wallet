import {
  CHAT_PROFILE,
  MAX_EVENT_JSON_LENGTH,
  MAX_EXPIRES_IN,
  MAX_TEXT_LENGTH,
  isUlid,
  parseChatEvent,
  MAX_TIMER_VERSION,
  MIN_EXPIRES_IN,
} from '../chatEvent'

const ID = '01JB3XKX6F8Q2W4E5R6T7Y8Z9V'
const TARGET = '01JB3XKX6F8Q2W4E5R6T7Y8Z9W'

const message = (extra: Record<string, unknown> = {}) => ({
  profile: CHAT_PROFILE,
  type: 'message',
  eventId: ID,
  content: { format: 'text/plain', text: 'look at this 🐱' },
  ...extra,
})

describe('isUlid', () => {
  it('accepts 26 Crockford base32 characters and nothing else', () => {
    expect(isUlid(ID)).toBe(true)
    expect(isUlid(ID.toLowerCase())).toBe(false)
    expect(isUlid('01JB3XKX6F8Q2W4E5R6T7Y8Z9I')).toBe(false) // I is not Crockford
    expect(isUlid(ID.slice(1))).toBe(false)
    expect(isUlid(42)).toBe(false)
  })
})

describe('parseChatEvent', () => {
  it('accepts a text message and keeps only known members', () => {
    const result = parseChatEvent(message({ inReplyTo: TARGET, somethingNew: true, clientTs: '2026-10-25T10:00:00Z' }))
    expect(result).toEqual({
      ok: true,
      event: {
        profile: CHAT_PROFILE,
        type: 'message',
        eventId: ID,
        clientTs: '2026-10-25T10:00:00Z',
        content: { format: 'text/plain', text: 'look at this 🐱' },
        inReplyTo: TARGET,
      },
    })
  })

  it('accepts a reaction, a redaction and a timer', () => {
    expect(
      parseChatEvent({ profile: CHAT_PROFILE, type: 'reaction', eventId: ID, target: TARGET, emoji: '👍' }).ok
    ).toBe(true)
    expect(parseChatEvent({ profile: CHAT_PROFILE, type: 'redaction', eventId: ID, target: TARGET }).ok).toBe(true)
    expect(
      parseChatEvent({ profile: CHAT_PROFILE, type: 'timer', eventId: ID, timer: { expiresIn: 604800, version: 3 } })
    ).toEqual({
      ok: true,
      event: { profile: CHAT_PROFILE, type: 'timer', eventId: ID, timer: { expiresIn: 604800, version: 3 } },
    })
  })

  it.each([
    ['not an object', 'hello', 'not-an-object'],
    ['an array', [message()], 'not-an-object'],
    ['the wrong profile', message({ profile: 'org.openvtc.msg/1' }), 'wrong-profile'],
    ['an unknown type', message({ type: 'edit' }), 'unknown-type'],
    ['a bad event id', message({ eventId: 'not-a-ulid' }), 'bad-event-id'],
    ['a long clientTs', message({ clientTs: 'x'.repeat(41) }), 'bad-client-ts'],
    ['no content', message({ content: undefined }), 'bad-content'],
    ['an empty text', message({ content: { format: 'text/plain', text: '' } }), 'bad-content'],
    ['another format', message({ content: { format: 'text/markdown', text: 'hi' } }), 'bad-content'],
    [
      'too long a text',
      message({ content: { format: 'text/plain', text: 'a'.repeat(MAX_TEXT_LENGTH + 1) } }),
      'bad-content',
    ],
    ['a bad inReplyTo', message({ inReplyTo: 'nope' }), 'bad-in-reply-to'],
    ['a negative expiresIn', message({ expiresIn: -1 }), 'bad-expires-in'],
    ['too long an expiresIn', message({ expiresIn: MAX_EXPIRES_IN + 1 }), 'bad-expires-in'],
    ['an attachment', message({ attachments: [{ id: 'a1' }] }), 'attachments-unsupported'],
  ])('rejects %s', (_label, input, reason) => {
    expect(parseChatEvent(input)).toEqual({ ok: false, reason })
  })

  it('accepts an empty attachments array, which carries nothing', () => {
    expect(parseChatEvent(message({ attachments: [] })).ok).toBe(true)
  })

  it('rejects reactions without a valid target or emoji', () => {
    const reaction = { profile: CHAT_PROFILE, type: 'reaction', eventId: ID, target: TARGET, emoji: '👍' }
    expect(parseChatEvent({ ...reaction, target: 'x' })).toEqual({ ok: false, reason: 'bad-target' })
    expect(parseChatEvent({ ...reaction, emoji: '' })).toEqual({ ok: false, reason: 'bad-emoji' })
    expect(parseChatEvent({ ...reaction, emoji: '😀'.repeat(17) })).toEqual({ ok: false, reason: 'bad-emoji' })
  })

  it('rejects malformed timers', () => {
    const timer = (t: unknown) => ({ profile: CHAT_PROFILE, type: 'timer', eventId: ID, timer: t })
    expect(parseChatEvent(timer(undefined))).toEqual({ ok: false, reason: 'bad-timer' })
    expect(parseChatEvent(timer({ expiresIn: 60, version: -1 }))).toEqual({ ok: false, reason: 'bad-timer' })
    expect(parseChatEvent(timer({ expiresIn: 1.5, version: 0 }))).toEqual({ ok: false, reason: 'bad-timer' })
    // The version is bounded like expiresIn: one above the cap is refused, the cap itself is not.
    expect(parseChatEvent(timer({ expiresIn: 3600, version: MAX_TIMER_VERSION + 1 }))).toEqual({
      ok: false,
      reason: 'bad-timer',
    })
    expect(parseChatEvent(timer({ expiresIn: 3600, version: Number.MAX_SAFE_INTEGER }))).toEqual({
      ok: false,
      reason: 'bad-timer',
    })
    expect(parseChatEvent(timer({ expiresIn: 3600, version: MAX_TIMER_VERSION })).ok).toBe(true)
  })

  it('rejects an event larger than the size cap', () => {
    const big = message({ padding: 'x'.repeat(MAX_EVENT_JSON_LENGTH) })
    expect(parseChatEvent(big)).toEqual({ ok: false, reason: 'too-large' })
  })

  it('refuses a timer shorter than an hour, so the chat keeps its setting; accepts an hour, two hours and off', () => {
    const timer = (t: unknown) => ({ profile: CHAT_PROFILE, type: 'timer', eventId: ID, timer: t })
    expect(parseChatEvent(timer({ expiresIn: 1, version: 2 }))).toEqual({ ok: false, reason: 'bad-timer' })
    expect(parseChatEvent(timer({ expiresIn: MIN_EXPIRES_IN - 1, version: 2 }))).toEqual({
      ok: false,
      reason: 'bad-timer',
    })
    for (const expiresIn of [MIN_EXPIRES_IN, 2 * 3600, 0]) {
      expect(parseChatEvent(timer({ expiresIn, version: 2 }))).toMatchObject({
        ok: true,
        event: { timer: { expiresIn } },
      })
    }
  })

  it('keeps a message with a timer shorter than an hour, raised to an hour, rather than dropping its text', () => {
    expect(parseChatEvent(message({ expiresIn: 1 }))).toMatchObject({ ok: true, event: { expiresIn: MIN_EXPIRES_IN } })
    expect(parseChatEvent(message({ expiresIn: 2 * 3600 }))).toMatchObject({ ok: true, event: { expiresIn: 2 * 3600 } })
  })

  it('drops a zero expiresIn rather than storing it', () => {
    const result = parseChatEvent(message({ expiresIn: 0 }))
    expect(result.ok && 'expiresIn' in result.event).toBe(false)
  })
})
