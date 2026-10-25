/**
 * The read side of keyring/chat (rich-messaging-plan.md §5, B3a): every chat event read once and kept current, one
 * chat's events as timeline items, and what counts as unread. Against a fake repository and event bus, so no
 * agent runs here.
 */
import { JsonTransformer, RepositoryEventTypes } from '@credo-ts/core'
import { act, renderHook } from '@testing-library/react-native'
import { Subject } from 'rxjs'

import { useAgent } from '@bifold/react-hooks'

import { Role } from '../../../types/chat'
import { useUnreadMessages } from '../../../hooks/useUnreadMessages'
import { areChatMessagesEqual, chatTimelineItems } from '../../../hooks/chat-messages'
import { ChatEventRecord, type ChatEventRecordProps } from '../records/ChatEventRecord'
import { chatEventsStore, useChatEvents } from '../chatEventsStore'
import { isUnreadChatEvent, markChatEventsSeen } from '../seen'
import { ORPHAN_MAX_AGE_MS } from '../fold'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

let mockRecords: ChatEventRecord[] = []
const bus: Record<string, Subject<{ payload: { record: unknown } }>> = {}
const emit = (type: string, record: unknown) => bus[type].next({ payload: { record } })
const mockRepository = {
  getAll: jest.fn(async () => mockRecords),
  findByConnection: jest.fn(async (_ctx: unknown, connectionId: string) =>
    mockRecords.filter((r) => r.connectionId === connectionId)
  ),
  update: jest.fn(async (_ctx: unknown, record: ChatEventRecord) => emit(RepositoryEventTypes.RecordUpdated, record)),
  delete: jest.fn(async (_ctx: unknown, record: ChatEventRecord) => {
    mockRecords = mockRecords.filter((r) => r.id !== record.id)
    emit(RepositoryEventTypes.RecordDeleted, record)
  }),
  deleteById: jest.fn(async (_ctx: unknown, id: string) => {
    mockRecords = mockRecords.filter((r) => r.id !== id)
    // Credo's deleteById emits only the id and type, no fields.
    emit(RepositoryEventTypes.RecordDeleted, { id, type: ChatEventRecord.type })
  }),
}
jest.mock('../ChatModule', () => ({ getChatEventRepository: () => mockRepository }))

const agent = {
  context: {},
  events: { observable: (type: string) => (bus[type] ??= new Subject()) },
}

let n = 0
const event = (props: Partial<ChatEventRecordProps> & Pick<ChatEventRecordProps, 'connectionId' | 'eventType'>) =>
  new ChatEventRecord({
    role: 'received',
    eventId: `01J${String(++n).padStart(23, '0')}`,
    sentTime: new Date(Date.UTC(2026, 9, 25, 12, n)),
    ...props,
  })
const message = (connectionId: string, text: string, props: Partial<ChatEventRecordProps> = {}) =>
  event({ connectionId, eventType: 'message', content: { format: 'text/plain', text }, ...props })

const attach = async () => {
  await act(async () => {
    chatEventsStore.attach(agent as never)
  })
}

beforeEach(() => {
  chatEventsStore.forget()
  mockRecords = []
  Object.values(mockRepository).forEach((fn) => fn.mockClear())
  ;(useAgent as jest.Mock).mockReturnValue({ agent })
})

describe('every chat event, read once and kept current', () => {
  test('unknown until read, then each chat its own slice; a chat with none is an empty one, not unknown', async () => {
    mockRecords = [message('A', 'hello')]
    expect(chatEventsStore.chat('A')).toBeUndefined()
    await attach()
    expect(chatEventsStore.chat('A')?.map((r) => r.content?.text)).toEqual(['hello'])
    expect(chatEventsStore.chat('B')).toEqual([])
    expect(chatEventsStore.chat('B')).toBe(chatEventsStore.chat('C'))
  })

  test("a change to one chat leaves every other chat's slice the same", async () => {
    mockRecords = [message('A', 'a'), message('B', 'b')]
    await attach()
    const before = chatEventsStore.chat('A')
    await act(async () => emit(RepositoryEventTypes.RecordSaved, message('B', 'b again')))
    expect(chatEventsStore.chat('A')).toBe(before)
    expect(chatEventsStore.chat('B')).toHaveLength(2)
  })

  test('a deleted event leaves its chat, whether deleted with its record or by id alone', async () => {
    const first = message('A', 'one')
    const second = message('A', 'two')
    mockRecords = [first, second]
    await attach()
    await act(async () => mockRepository.delete({}, first))
    expect(chatEventsStore.chat('A')?.map((r) => r.id)).toEqual([second.id])
    await act(async () => mockRepository.deleteById({}, second.id))
    expect(chatEventsStore.chat('A')).toEqual([])
  })

  test('an event saved while the first read runs is kept', async () => {
    let release: () => void = () => undefined
    mockRepository.getAll.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve([message('A', 'stored')])))
    )
    chatEventsStore.attach(agent as never)
    await act(async () => emit(RepositoryEventTypes.RecordSaved, message('A', 'just arrived')))
    await act(async () => release())
    expect(
      chatEventsStore
        .chat('A')
        ?.map((r) => r.content?.text)
        .sort()
    ).toEqual(['just arrived', 'stored'])
  })

  test('a reaction whose target never came is deleted once it is older than the mediator keeps it', async () => {
    const stale = event({
      connectionId: 'A',
      eventType: 'reaction',
      target: 'missing',
      emoji: '👍',
      sentTime: new Date(Date.now() - ORPHAN_MAX_AGE_MS - 60_000),
    })
    const fresh = event({
      connectionId: 'A',
      eventType: 'reaction',
      target: 'missing',
      emoji: '👍',
      sentTime: new Date(),
    })
    mockRecords = [stale, fresh]
    await attach()
    expect(mockRepository.delete).toHaveBeenCalledTimes(1)
    expect(mockRepository.delete.mock.calls[0][1]).toBe(stale)
  })
})

describe("one chat's events as timeline items", () => {
  const style = () => ({})

  test('a message carries its event id and its reactions; a reaction aimed at another chat never lands here', async () => {
    const hello = message('A', 'hello')
    const reactionHere = event({ connectionId: 'A', eventType: 'reaction', target: hello.eventId, emoji: '👍' })
    // Chat B's event, aimed at chat A's message id.
    const reactionElsewhere = event({
      connectionId: 'B',
      eventType: 'reaction',
      role: 'sent',
      target: hello.eventId,
      emoji: '🎉',
    })
    mockRecords = [hello, reactionHere, reactionElsewhere]
    await attach()
    const items = chatTimelineItems(chatEventsStore.chat('A') ?? [], style)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ chatEventId: hello.eventId, text: 'hello', user: { _id: Role.them } })
    expect(items[0].reactions?.map((r) => r.emoji)).toEqual(['👍'])
  })

  test('a reply quotes what it answers, or says it is not on this phone', () => {
    const original = message('A', 'the question')
    const reply = message('A', 'the answer', { inReplyTo: original.eventId })
    const lost = message('A', 'to something gone', { inReplyTo: '01JZZZZZZZZZZZZZZZZZZZZZZZ' })
    const items = chatTimelineItems([original, reply, lost], style)
    expect(items.find((i) => i.text === 'the answer')?.replyTo).toEqual({ text: 'the question' })
    expect(items.find((i) => i.text === 'to something gone')?.replyTo).toEqual({ unavailable: true })
  })

  test("a timer is a system line carrying its event; order is this phone's time, never the sender's", () => {
    const early = message('A', 'first', {
      sentTime: new Date(Date.UTC(2026, 9, 25, 9)),
      clientTs: '2030-01-01T00:00:00Z',
    })
    const timer = event({
      connectionId: 'A',
      eventType: 'timer',
      role: 'sent',
      timer: { expiresIn: 604800, version: 1 },
      sentTime: new Date(Date.UTC(2026, 9, 25, 10)),
    })
    const items = chatTimelineItems([timer, early], style)
    const line = items.find((i) => i.kind === 'system')
    expect(line).toMatchObject({ kind: 'system', chatEventId: timer.eventId, chatEvent: timer })
    expect(items.find((i) => i.text === 'first')?.createdAt).toEqual(early.sentTime)
  })
})

describe('records as storage gives them back', () => {
  // Storage turns a record into JSON and back (AskarStorageService's recordToInstance). Built in memory, as every
  // other test here is, a record never goes through it: `sentTime` came back a string until ChatEventRecord revived
  // it as a Date, and the timeline's sort threw on every chat read from the phone.
  test('a chat read back from storage folds into the timeline, in order', () => {
    const stored = [
      message('A', 'second', { sentTime: new Date(Date.UTC(2026, 9, 25, 11)) }),
      message('A', 'first', { sentTime: new Date(Date.UTC(2026, 9, 25, 10)) }),
    ]
    const readBack = stored.map((r) => JsonTransformer.deserialize(JsonTransformer.serialize(r), ChatEventRecord))
    // Read back, not the records built here: what storage returns, with its time a Date again.
    expect(readBack[0]).not.toBe(stored[0])
    expect(readBack.every((r) => r.sentTime instanceof Date)).toBe(true)
    expect(chatTimelineItems(readBack, () => ({})).map((i) => i.text)).toEqual(['first', 'second'])
  })
})

describe('the timeline is redrawn when what a chat item shows changes', () => {
  const style = () => ({})
  const hello = message('A', 'hello')
  const original = message('A', 'the question')

  test('a reaction added, changed or removed is a change', () => {
    const reaction = event({ connectionId: 'A', eventType: 'reaction', target: hello.eventId, emoji: '👍' })
    const changed = event({ connectionId: 'A', eventType: 'reaction', target: hello.eventId, emoji: '🎉' })
    const none = chatTimelineItems([hello], style)
    const liked = chatTimelineItems([hello, reaction], style)
    expect(areChatMessagesEqual(none, chatTimelineItems([hello], style))).toBe(true)
    expect(areChatMessagesEqual(none, liked)).toBe(false)
    expect(areChatMessagesEqual(liked, chatTimelineItems([hello, reaction, changed], style))).toBe(false)
  })

  test("a reply's original arriving later is a change", () => {
    const reply = message('A', 'the answer', { inReplyTo: original.eventId })
    expect(
      areChatMessagesEqual(chatTimelineItems([reply], style), chatTimelineItems([original, reply], style).slice(1))
    ).toBe(false)
  })
})

describe('what counts as unread', () => {
  test('a received message until it is seen; never a sent one, a reaction, a redaction or a system line', () => {
    expect(isUnreadChatEvent(message('A', 'hi'))).toBe(true)
    expect(isUnreadChatEvent(message('A', 'mine', { role: 'sent' }))).toBe(false)
    expect(isUnreadChatEvent(event({ connectionId: 'A', eventType: 'reaction', target: 'x', emoji: '👍' }))).toBe(false)
    expect(isUnreadChatEvent(event({ connectionId: 'A', eventType: 'redaction', target: 'x' }))).toBe(false)
    expect(
      isUnreadChatEvent(event({ connectionId: 'A', eventType: 'timer', timer: { expiresIn: 60, version: 1 } }))
    ).toBe(false)
  })

  test('marking a chat seen writes only what was unseen, so opening it again writes nothing', async () => {
    mockRecords = [
      message('A', 'one'),
      message('A', 'two'),
      message('A', 'mine', { role: 'sent' }),
      message('B', 'other'),
    ]
    await markChatEventsSeen(agent as never, 'A')
    expect(mockRepository.update).toHaveBeenCalledTimes(2)
    expect(mockRecords.filter((r) => r.connectionId === 'A').some(isUnreadChatEvent)).toBe(false)
    expect(isUnreadChatEvent(mockRecords[3])).toBe(true)
    mockRepository.update.mockClear()
    await markChatEventsSeen(agent as never, 'A')
    expect(mockRepository.update).not.toHaveBeenCalled()
  })

  test("marking a chat's unread messages seen tells the store's watchers once, not once per message", async () => {
    mockRecords = [message('A', 'one'), message('A', 'two'), message('A', 'three')]
    await attach()
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    const told = jest.fn()
    const stop = chatEventsStore.subscribe(told)
    await act(async () => {
      await markChatEventsSeen(agent as never, 'A')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    stop()
    expect(mockRepository.update).toHaveBeenCalledTimes(3)
    expect(told).toHaveBeenCalledTimes(1)
  })

  test('the unread counts take received chat messages, and drop them once seen', async () => {
    mockRecords = [
      message('A', 'one'),
      message('A', 'two'),
      event({ connectionId: 'A', eventType: 'reaction', target: 'x', emoji: '👍' }),
    ]
    const { result } = renderHook(() => ({ unread: useUnreadMessages(), events: useChatEvents('A') }))
    // The store tells its watchers on the next tick (changes that land together are told once).
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    // No BasicMessage of the test agent is in chat A: what counts here is the chat events alone.
    expect(result.current.unread.unreadByConnection.A).toBe(2)
    await act(async () => {
      await markChatEventsSeen(agent as never, 'A')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(result.current.unread.unreadByConnection.A ?? 0).toBe(0)
  })
})
