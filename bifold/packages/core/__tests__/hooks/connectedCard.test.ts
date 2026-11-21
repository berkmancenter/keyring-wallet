/**
 * The "You connected" card is always the oldest item, so it must never be dated after the message below it, or the
 * day it falls on gets a second pill further down (simulator check on #604, "Today" twice).
 */
import { withConnectedCard } from '../../src/hooks/connectedCard'
import { localDayKey } from '../../src/utils/localDay'

type Item = { _id: string; createdAt: Date }
const at = (_id: string, iso: string): Item => ({ _id, createdAt: new Date(iso) })

/** The days gifted-chat opens, oldest first: a new pill wherever two neighbours differ. */
function pills(items: Item[]): string[] {
  const oldestFirst = [...items].reverse()
  return oldestFirst.map((item) => localDayKey(item.createdAt)).filter((day, i, days) => i === 0 || day !== days[i - 1])
}

describe('the connected card', () => {
  const card = at('connected', '2026-10-26T10:00:00')

  test('a message dated before the connection: the card takes its time, and the day opens once', () => {
    // A contact's clock running behind: their first reply reads as yesterday evening.
    const messages = [at('m2', '2026-10-26T10:05:00'), at('m1', '2026-10-25T22:00:00')]
    const result = withConnectedCard(messages, card)
    expect(result[result.length - 1]).toEqual({ _id: 'connected', createdAt: new Date('2026-10-25T22:00:00') })
    expect(pills(result)).toEqual(['2026-10-25', '2026-10-26'])
  })

  test('the control: left at the connection time, the same chat opens today twice', () => {
    const messages = [at('m2', '2026-10-26T10:05:00'), at('m1', '2026-10-25T22:00:00')]
    expect(pills([...messages, card])).toEqual(['2026-10-26', '2026-10-25', '2026-10-26'])
  })

  test('messages after the connection leave the card at its own time', () => {
    const messages = [at('m1', '2026-10-26T10:05:00')]
    expect(withConnectedCard(messages, card)).toEqual([messages[0], card])
  })

  test('a chat with no messages yet is the card alone', () => {
    expect(withConnectedCard([], card)).toEqual([card])
  })
})
