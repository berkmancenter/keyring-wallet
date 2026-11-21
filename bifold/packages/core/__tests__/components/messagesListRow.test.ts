/**
 * What a Messages row says (L2): the newest message, or a reaction newer than it, as one line; never the words of a
 * message that stays inside its chat; and when, as the chat says it.
 */
import type { ExtendedChatMessage } from '../../src/components/chat/ChatMessage'
import { rowPreview, rowTime } from '../../src/components/listItems/messagesListRow'
import { ChatEventRecord } from '../../src/modules/chat/records/ChatEventRecord'
import { Role } from '../../src/types/chat'
import type { DateWords } from '../../src/utils/localDay'

const at = (day: number, hour = 12, minute = 0) => new Date(2026, 9, day, hour, minute)
const labels = { photo: 'Photo', unsupported: 'Attachment' }
const NO_TIMER = null

const message = (over: Partial<ExtendedChatMessage> = {}): ExtendedChatMessage =>
  ({
    _id: 'm',
    text: 'Congrats!',
    createdAt: at(25, 12),
    user: { _id: Role.them },
    renderEvent: () => null,
    ...over,
  }) as unknown as ExtendedChatMessage

let next = 0
const event = (over: Partial<ConstructorParameters<typeof ChatEventRecord>[0]>) =>
  new ChatEventRecord({
    connectionId: 'c1',
    eventId: `01JB3XKX6F8Q2W4E5R6T7Y8Z${String(next++).padStart(2, '0')}`,
    eventType: 'message',
    role: 'received',
    sentTime: at(25, 12),
    ...over,
  } as never)
const said = (eventId: string, text: string, expiresIn?: number) =>
  event({
    eventId,
    eventType: 'message',
    content: { format: 'text/plain', text },
    sentTime: at(25, 11),
    ...(expiresIn ? { expiresIn } : {}),
  })
const reacted = (target: string, emoji: string, role: 'sent' | 'received', when: Date, eventId?: string) =>
  event({ eventType: 'reaction', target, emoji, role, sentTime: when, ...(eventId ? { eventId } : {}) })

describe('the newest message', () => {
  test('from them: its words', () => {
    expect(rowPreview({ message: message(), timer: NO_TIMER, labels })).toEqual({
      kind: 'message',
      mine: false,
      text: 'Congrats!',
      photo: false,
    })
  })

  test('from you: marked as yours', () => {
    expect(rowPreview({ message: message({ user: { _id: Role.me } }), timer: NO_TIMER, labels })).toMatchObject({
      kind: 'message',
      mine: true,
    })
  })

  test('a photo: marked as one, with its caption or label', () => {
    expect(
      rowPreview({ message: message({ text: 'Photo', image: 'file:///p.jpg' }), timer: NO_TIMER, labels })
    ).toMatchObject({ kind: 'message', text: 'Photo', photo: true })
  })

  test('never its words when they stay inside the chat: timer on, timer not known yet, or a disappearing message', () => {
    const on = { expiresIn: 3600 } as never
    expect(rowPreview({ message: message(), timer: on, labels })).toEqual({ kind: 'hidden' })
    expect(rowPreview({ message: message(), timer: undefined, labels })).toEqual({ kind: 'hidden' })
    expect(rowPreview({ message: message({ expiresIn: 60 }), timer: NO_TIMER, labels })).toEqual({ kind: 'hidden' })
  })

  test('nothing said yet: nothing', () => {
    expect(rowPreview({ message: undefined, timer: NO_TIMER, labels })).toEqual({ kind: 'none' })
  })
})

describe('a reaction', () => {
  const target = said('01JB3XKX6F8Q2W4E5R6T7Y8ZAA', 'Congrats!')

  test('newer than the newest message: who reacted, with what, to which words', () => {
    const events = [target, reacted(target.eventId, '💜', 'received', at(25, 13))]
    expect(rowPreview({ message: message({ createdAt: at(25, 12) }), events, timer: NO_TIMER, labels })).toEqual({
      kind: 'reaction',
      mine: false,
      emoji: '💜',
      quoted: 'Congrats!',
      at: at(25, 13),
    })
  })

  test('yours: marked as yours', () => {
    const events = [target, reacted(target.eventId, '👍', 'sent', at(25, 13))]
    expect(rowPreview({ message: message(), events, timer: NO_TIMER, labels })).toMatchObject({
      kind: 'reaction',
      mine: true,
    })
  })

  test('older than the newest message: the message', () => {
    const events = [target, reacted(target.eventId, '💜', 'received', at(25, 11, 30))]
    expect(rowPreview({ message: message({ createdAt: at(25, 12) }), events, timer: NO_TIMER, labels }).kind).toBe(
      'message'
    )
  })

  test('taken back by its author: not shown', () => {
    const reaction = reacted(target.eventId, '💜', 'received', at(25, 13), '01JB3XKX6F8Q2W4E5R6T7Y8ZBB')
    const redaction = event({
      eventType: 'redaction',
      target: reaction.eventId,
      role: 'received',
      sentTime: at(25, 14),
    })
    expect(
      rowPreview({ message: message(), events: [target, reaction, redaction], timer: NO_TIMER, labels }).kind
    ).toBe('message')
  })

  test("its quote follows the reacted-to message's own rule: none of a disappearing one, or with the timer on", () => {
    const timed = said('01JB3XKX6F8Q2W4E5R6T7Y8ZCC', 'secret', 3600)
    const events = [timed, reacted(timed.eventId, '💜', 'received', at(25, 13))]
    expect(rowPreview({ message: message(), events, timer: NO_TIMER, labels })).toMatchObject({
      kind: 'reaction',
      quoted: undefined,
    })
    const plain = [target, reacted(target.eventId, '💜', 'received', at(25, 13))]
    expect(rowPreview({ message: message(), events: plain, timer: { expiresIn: 60 } as never, labels })).toMatchObject({
      kind: 'reaction',
      quoted: undefined,
    })
  })
})

describe('when', () => {
  const words: DateWords = {
    today: 'Today',
    yesterday: 'Yesterday',
    weekdaysLong: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    thisYear: '{{weekday}} {{day}} {{month}}',
    otherYear: '{{day}} {{month}} {{year}}',
    dayMonth: '{{day}} {{month}}',
    dateTime: '{{date}}, {{time}}',
    time12: '{{hour}}:{{minute}} {{period}}',
    time24: '{{hour}}:{{minute}}',
    am: 'AM',
    pm: 'PM',
  }
  const now = at(25, 18) // a Sunday

  test('today: the time, by the phone’s clock', () => {
    expect(rowTime(at(25, 16, 5), words, true, now)).toBe('16:05')
    expect(rowTime(at(25, 16, 5), words, false, now)).toBe('4:05 PM')
  })

  test('yesterday, then the weekday within the week, then the date', () => {
    expect(rowTime(at(24, 9), words, true, now)).toBe('Yesterday')
    expect(rowTime(at(21, 9), words, true, now)).toBe('Wednesday')
    expect(rowTime(at(12, 9), words, true, now)).toBe('12 Oct')
  })

  test('another year: with its year', () => {
    expect(rowTime(new Date(2025, 11, 30, 9), words, true, now)).toBe('30 Dec 2025')
  })
})
