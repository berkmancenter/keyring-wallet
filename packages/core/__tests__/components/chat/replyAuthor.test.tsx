import { chatTimelineItems } from '../../../src/hooks/chat-messages'
import { ChatEventRecord } from '../../../src/modules/chat/records/ChatEventRecord'

const id = (n: number) => `01JB3XKX6F8Q2W4E5R6T7Y${String(n).padStart(4, '0')}`
const message = (n: number, role: 'sent' | 'received', text: string, inReplyTo?: string) =>
  new ChatEventRecord({
    connectionId: 'c',
    role,
    eventId: id(n),
    eventType: 'message',
    content: { format: 'text/plain', text },
    inReplyTo,
    sentTime: new Date(Date.UTC(2026, 9, 25, 10, n)),
  })

describe('a reply’s quoted author', () => {
  const names = { authorNames: { me: 'You', them: 'Alice' } }
  const replyOf = (items: ReturnType<typeof chatTimelineItems>, eventId: string) =>
    items.find((m) => m.chatEventId === eventId)?.replyTo

  it('is this phone’s person for an original this phone sent, and the contact for one it received', () => {
    const items = chatTimelineItems(
      [
        message(1, 'sent', 'on my way'),
        message(2, 'received', 'see you'),
        message(3, 'received', 'ok', id(1)),
        message(4, 'sent', 'great', id(2)),
      ],
      () => ({}),
      names
    )
    expect(replyOf(items, id(3))).toEqual({ text: 'on my way', author: 'You' })
    expect(replyOf(items, id(4))).toEqual({ text: 'see you', author: 'Alice' })
  })

  it('has no author when the original is not on this phone', () => {
    const items = chatTimelineItems([message(3, 'received', 'ok', id(1))], () => ({}), names)
    expect(replyOf(items, id(3))).toEqual({ unavailable: true })
  })
})
