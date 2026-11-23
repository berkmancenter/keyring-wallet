import { JsonTransformer } from '@credo-ts/core'

import { foldChatEvents, prunableOrphans } from '../fold'
import { ChatEventRecord } from '../records/ChatEventRecord'

// Askar stores JsonTransformer.serialize(record) and reads it back with
// JsonTransformer.deserialize (recordToInstance), so this is a real reload.
const reload = (record: ChatEventRecord) =>
  JsonTransformer.deserialize(JsonTransformer.serialize(record), ChatEventRecord)

const id = (n: number) => `01JB3XKX6F8Q2W4E5R6T7Y${String(n).padStart(4, '0')}`

describe('ChatEventRecord through storage', () => {
  it('keeps sentTime a Date, with the same instant', () => {
    const sentTime = new Date('2026-10-25T10:00:00.123Z')
    const back = reload(
      new ChatEventRecord({ connectionId: 'c', role: 'sent', eventId: id(1), eventType: 'message', sentTime })
    )
    expect(back.sentTime).toBeInstanceOf(Date)
    expect(back.sentTime.getTime()).toBe(sentTime.getTime())
    expect(back.createdAt).toBeInstanceOf(Date)
  })

  it('defaults sentTime to createdAt, and that survives too', () => {
    const back = reload(
      new ChatEventRecord({ connectionId: 'c', role: 'received', eventId: id(2), eventType: 'message' })
    )
    expect(back.sentTime).toBeInstanceOf(Date)
    expect(back.sentTime.getTime()).toBe(back.createdAt.getTime())
  })

  it('lets the timeline fold and prune reloaded records', () => {
    const base = new Date('2026-10-25T10:00:00Z').getTime()
    const records = [
      new ChatEventRecord({
        connectionId: 'c',
        role: 'received',
        eventId: id(3),
        eventType: 'message',
        content: { format: 'text/plain', text: 'later' },
        sentTime: new Date(base + 60_000),
      }),
      new ChatEventRecord({
        connectionId: 'c',
        role: 'sent',
        eventId: id(4),
        eventType: 'message',
        content: { format: 'text/plain', text: 'earlier' },
        sentTime: new Date(base),
      }),
      new ChatEventRecord({
        connectionId: 'c',
        role: 'received',
        eventId: id(5),
        eventType: 'reaction',
        target: id(99),
        emoji: '👍',
        sentTime: new Date(base),
      }),
    ].map(reload)

    const folded = foldChatEvents(records)
    expect(folded.messages.map((m) => m.eventId)).toEqual([id(4), id(3)])
    expect(prunableOrphans(folded.orphans, base + 8 * 24 * 60 * 60 * 1000).map((o) => o.eventId)).toEqual([id(5)])
  })
})
