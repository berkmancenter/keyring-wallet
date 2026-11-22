import i18next, { type TFunction } from 'i18next'

import { formatExpiresIn, hidesText, timerLine } from '../../../src/components/chat/disappearing'
import { ChatEventRecord } from '../../../src/modules/chat/records/ChatEventRecord'
import { TIMER_CHOICES } from '../../../src/modules/chat/timer'
import en from '../../../src/localization/en/en.json'
import fr from '../../../src/localization/fr/fr.json'
import ptBr from '../../../src/localization/pt-br/pt-br.json'

// The real strings through real i18next: the jest mock of react-i18next returns keys and ignores options.
const i18n = i18next.createInstance()
let t: TFunction
beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    resources: { en: { translation: en }, fr: { translation: fr }, 'pt-BR': { translation: ptBr } },
  })
  t = i18n.t.bind(i18n) as TFunction
})

const timer = (role: 'sent' | 'received', expiresIn: number) =>
  new ChatEventRecord({
    connectionId: 'conn-1',
    eventId: '01JB3XKX6F8Q2W4E5R6T7Y8Z9A',
    eventType: 'timer',
    role,
    sentTime: new Date(Date.UTC(2026, 9, 25, 12)),
    timer: { expiresIn, version: 1 },
  })

describe("a timer's length in words", () => {
  test('each choice the setting offers', () => {
    expect(TIMER_CHOICES.filter((s) => s > 0).map((s) => formatExpiresIn(t, s))).toEqual([
      '1 hour',
      '1 day',
      '1 week',
      '4 weeks',
    ])
  })

  test('a length no choice offers names every part, and is never said shorter than it is', () => {
    // 12345 s is 3 h 25 min 45 s: said as 3 hours 26 minutes, so a message goes a little before the words, never after.
    expect(formatExpiresIn(t, 12345)).toBe('3 hours 26 minutes')
    // One second past a minute is the next minute, not the nearest one.
    expect(formatExpiresIn(t, 3 * 3600 + 25 * 60 + 1)).toBe('3 hours 26 minutes')
    expect(formatExpiresIn(t, 7 * 86400 + 3 * 3600 + 60)).toBe('1 week 3 hours 1 minute')
    expect(formatExpiresIn(t, 2 * 3600)).toBe('2 hours')
  })

  test('in French and Brazilian Portuguese too', async () => {
    const inFrench = i18n.cloneInstance({ lng: 'fr' })
    const inPortuguese = i18n.cloneInstance({ lng: 'pt-BR' })
    expect(formatExpiresIn(inFrench.t.bind(inFrench) as TFunction, 12345)).toBe('3 heures 26 minutes')
    expect(formatExpiresIn(inPortuguese.t.bind(inPortuguese) as TFunction, 604800)).toBe('1 semana')
  })
})

describe("whether a message's text stays inside its chat", () => {
  const on = { expiresIn: 3600, version: 1, eventId: 'e', setBy: 'received' as const }
  const off = { ...on, expiresIn: 0, version: 2 }

  test('shown only when certain: no timer on the chat, none on the message', () => {
    expect(hidesText(null, undefined)).toBe(false)
    expect(hidesText(off, undefined)).toBe(false)
  })

  test('hidden while the chat has a timer on', () => {
    expect(hidesText(on, undefined)).toBe(true)
  })

  test('hidden for a message sent with a timer, though the chat has since turned it off', () => {
    expect(hidesText(off, 3600)).toBe(true)
    expect(hidesText(null, 3600)).toBe(true)
  })

  test("hidden while the chat's timer is not known yet", () => {
    expect(hidesText(undefined, undefined)).toBe(true)
  })
})

describe('the line a timer change leaves in the chat', () => {
  test('who set it, and to what', () => {
    expect(timerLine(t, timer('sent', 604800), 'Ana')).toBe('You set messages to disappear after 1 week')
    expect(timerLine(t, timer('received', 3600), 'Ana')).toBe('Ana set messages to disappear after 1 hour')
    expect(timerLine(t, timer('received', 12345), 'Ana')).toBe('Ana set messages to disappear after 3 hours 26 minutes')
  })

  test('turned off', () => {
    expect(timerLine(t, timer('sent', 0), 'Ana')).toBe('You turned off disappearing messages')
    expect(timerLine(t, timer('received', 0), 'Ana')).toBe('Ana turned off disappearing messages')
  })

  test('a name is shown as written, never as entities', () => {
    expect(timerLine(t, timer('received', 3600), 'Ana/Bea & Co')).toBe(
      'Ana/Bea & Co set messages to disappear after 1 hour'
    )
    expect(timerLine(t, timer('received', 0), 'Ana/Bea & Co')).toBe('Ana/Bea & Co turned off disappearing messages')
  })

  test('no line for any other event', () => {
    const message = new ChatEventRecord({
      connectionId: 'conn-1',
      eventId: '01JB3XKX6F8Q2W4E5R6T7Y8Z9B',
      eventType: 'message',
      role: 'received',
      sentTime: new Date(),
      content: { format: 'text/plain', text: 'hi' },
    })
    expect(timerLine(t, message, 'Ana')).toBe('')
  })
})
