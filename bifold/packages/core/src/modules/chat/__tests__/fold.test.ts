import { ORPHAN_MAX_AGE_MS, ORPHAN_MAX_COUNT, foldChatEvents, prunableOrphans } from '../fold'
import { ChatEventRecord } from '../records/ChatEventRecord'
import type { ChatEventRole } from '../records/ChatEventRecord'

// Ids sort in the order a sender made them, as real ULIDs do.
const id = (n: number) => `01JB3XKX6F8Q2W4E5R6T7Y${String(n).padStart(4, '0')}`

const base = new Date('2026-10-25T10:00:00Z').getTime()

function message(n: number, role: ChatEventRole, minute = n) {
  return new ChatEventRecord({
    connectionId: 'conn-1',
    role,
    eventId: id(n),
    eventType: 'message',
    content: { format: 'text/plain', text: `m${n}` },
    sentTime: new Date(base + minute * 60_000),
  })
}

function reaction(n: number, role: ChatEventRole, target: number, emoji: string, minute = n) {
  return new ChatEventRecord({
    connectionId: 'conn-1',
    role,
    eventId: id(n),
    eventType: 'reaction',
    target: id(target),
    emoji,
    sentTime: new Date(base + minute * 60_000),
  })
}

function redaction(n: number, role: ChatEventRole, target: number, minute = n) {
  return new ChatEventRecord({
    connectionId: 'conn-1',
    role,
    eventId: id(n),
    eventType: 'redaction',
    target: id(target),
    sentTime: new Date(base + minute * 60_000),
  })
}

describe('foldChatEvents', () => {
  it('orders messages by time and leaves reactions out of the message list', () => {
    const folded = foldChatEvents([message(2, 'received'), reaction(3, 'sent', 1, '👍'), message(1, 'sent')])
    expect(folded.messages.map((m) => m.eventId)).toEqual([id(1), id(2)])
    expect(folded.reactions.get(id(1))).toEqual([{ author: 'sent', emoji: '👍', eventId: id(3) }])
  })

  it('keeps one reaction per person: a later one replaces an earlier one', () => {
    const folded = foldChatEvents([
      message(1, 'sent'),
      reaction(2, 'received', 1, '👍'),
      reaction(3, 'received', 1, '❤️'),
    ])
    expect(folded.reactions.get(id(1))).toEqual([{ author: 'received', emoji: '❤️', eventId: id(3) }])
  })

  it('shows both people’s reactions on the same message', () => {
    const folded = foldChatEvents([message(1, 'sent'), reaction(2, 'received', 1, '👍'), reaction(3, 'sent', 1, '😂')])
    expect(folded.reactions.get(id(1))).toHaveLength(2)
  })

  it('removes a reaction when its author redacts it, and does not bring back the older one', () => {
    const folded = foldChatEvents([
      message(1, 'sent'),
      reaction(2, 'received', 1, '👍'),
      reaction(3, 'received', 1, '❤️'),
      redaction(4, 'received', 3),
    ])
    expect(folded.reactions.get(id(1))).toBeUndefined()
  })

  it('resolves "change, then remove" the same way when the events arrive in reverse', () => {
    const inOrder = [
      message(1, 'sent'),
      reaction(2, 'received', 1, '👍'),
      reaction(3, 'received', 1, '❤️'),
      redaction(4, 'received', 3),
    ]
    const reversed = [...inOrder].reverse()
    expect(foldChatEvents(reversed).reactions.get(id(1))).toBeUndefined()
    expect(foldChatEvents(inOrder).reactions.get(id(1))).toBeUndefined()
  })

  it('ignores a redaction from someone who did not write the reaction', () => {
    const folded = foldChatEvents([message(1, 'sent'), reaction(2, 'sent', 1, '👍'), redaction(3, 'received', 2)])
    expect(folded.reactions.get(id(1))).toEqual([{ author: 'sent', emoji: '👍', eventId: id(2) }])
  })

  it('ignores a redaction that targets a message (delete for everyone is not in the minimum)', () => {
    const folded = foldChatEvents([message(1, 'received'), redaction(2, 'received', 1)])
    expect(folded.messages).toHaveLength(1)
    expect(folded.orphans).toHaveLength(0)
  })

  it('keeps a reaction whose message has not arrived yet, and applies it once the message is stored', () => {
    const early = reaction(2, 'received', 1, '👍')
    const before = foldChatEvents([early])
    expect(before.orphans).toEqual([early])
    expect(before.reactions.size).toBe(0)

    const after = foldChatEvents([early, message(1, 'sent')])
    expect(after.orphans).toHaveLength(0)
    expect(after.reactions.get(id(1))).toHaveLength(1)
  })

  it('treats a redaction of a reaction that has not arrived yet as an orphan', () => {
    const folded = foldChatEvents([message(1, 'sent'), redaction(3, 'received', 2)])
    expect(folded.orphans.map((o) => o.eventId)).toEqual([id(3)])
  })

  it('does not count a reaction to a reaction', () => {
    const folded = foldChatEvents([message(1, 'sent'), reaction(2, 'received', 1, '👍'), reaction(3, 'sent', 2, '👍')])
    expect(folded.reactions.get(id(2))).toBeUndefined()
    expect(folded.orphans.map((o) => o.eventId)).toEqual([id(3)])
  })
})

describe('prunableOrphans', () => {
  it('drops orphans older than the age limit', () => {
    const old = reaction(1, 'received', 99, '👍', 0)
    const recent = reaction(2, 'received', 99, '👍', 0)
    recent.sentTime = new Date(base + ORPHAN_MAX_AGE_MS)
    const now = base + ORPHAN_MAX_AGE_MS + 60_000
    expect(prunableOrphans([old, recent], now)).toEqual([old])
  })

  it('keeps only the newest orphans past the count limit', () => {
    const orphans = Array.from({ length: ORPHAN_MAX_COUNT + 3 }, (_, i) => reaction(i + 1, 'received', 9999, '👍', i))
    const pruned = prunableOrphans(orphans, base + 10 * 60_000)
    expect(pruned).toHaveLength(3)
    expect(pruned.map((o) => o.eventId)).toEqual([id(3), id(2), id(1)])
  })
})
