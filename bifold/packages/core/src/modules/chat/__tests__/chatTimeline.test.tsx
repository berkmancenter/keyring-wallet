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
import { areChatMessagesEqual, chatTimelineItems, useExpiredOriginals } from '../../../hooks/chat-messages'
import { expiredIds } from '../expired'
import { ChatEventRecord, type ChatEventRecordProps } from '../records/ChatEventRecord'
import { chatEventsStore, READ_RETRY_DELAYS_MS, useChatEvents } from '../chatEventsStore'
import { isUnreadChatEvent, markChatEventsSeen } from '../seen'
import { ORPHAN_MAX_AGE_MS } from '../fold'
import { deleteChatMessages } from '../history'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('../expired', () => ({
  expiredIds: jest.fn(async () => new Set<string>()),
  recordExpired: jest.fn(),
  forgetExpired: jest.fn(async () => undefined),
}))
// No chat media folder: deleting a chat's history has no files to remove here.
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/docs',
  LibraryDirectoryPath: '/library',
  exists: async () => false,
  unlink: async () => undefined,
  readDir: async () => [],
}))

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
  config: { logger: { warn: jest.fn() } },
  events: { observable: (type: string) => (bus[type] ??= new Subject()) },
  // The chat's BasicMessages, for deleting a chat's history: none here.
  dependencyManager: { resolve: () => ({ findByQuery: async () => [], delete: jest.fn() }) },
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

  // Unknown hides a message's text everywhere outside its chat (hidesText), so a read that fails must not leave every
  // chat unknown without a word: it is logged, and tried again.
  test('a failed first read is logged and tried again, later each time; the chats are unknown until it succeeds', async () => {
    jest.useFakeTimers()
    try {
      mockRecords = [message('A', 'hi')]
      mockRepository.getAll.mockRejectedValueOnce(new Error('storage busy')).mockRejectedValueOnce(new Error('again'))
      await act(async () => chatEventsStore.attach(agent as never))
      expect(chatEventsStore.chat('A')).toBeUndefined()
      expect(agent.config.logger.warn).toHaveBeenLastCalledWith(
        '[chat] reading chat events failed (attempt 1): trying again in 1 s',
        expect.anything()
      )
      await act(async () => jest.advanceTimersByTime(READ_RETRY_DELAYS_MS[0]))
      expect(chatEventsStore.chat('A')).toBeUndefined()
      expect(agent.config.logger.warn).toHaveBeenLastCalledWith(
        '[chat] reading chat events failed (attempt 2): trying again in 5 s',
        expect.anything()
      )
      await act(async () => jest.advanceTimersByTime(READ_RETRY_DELAYS_MS[1]))
      expect(chatEventsStore.chat('A')?.map((r) => r.content?.text)).toEqual(['hi'])
      expect(mockRepository.getAll).toHaveBeenCalledTimes(3)
    } finally {
      // The store tells its watchers on the next tick: run it, or a later test's notice is never sent.
      act(() => jest.runOnlyPendingTimers())
      jest.useRealTimers()
    }
  })

  test('after the last try it says it gives up, and tries no more', async () => {
    jest.useFakeTimers()
    try {
      mockRepository.getAll.mockRejectedValue(new Error('storage gone'))
      await act(async () => chatEventsStore.attach(agent as never))
      for (const delay of READ_RETRY_DELAYS_MS) await act(async () => jest.advanceTimersByTime(delay))
      expect(agent.config.logger.warn).toHaveBeenLastCalledWith(
        `[chat] reading chat events failed (attempt ${READ_RETRY_DELAYS_MS.length + 1}): not trying again until the wallet reconnects`,
        expect.anything()
      )
      await act(async () => jest.advanceTimersByTime(10 * 60 * 1000))
      expect(mockRepository.getAll).toHaveBeenCalledTimes(READ_RETRY_DELAYS_MS.length + 1)
      expect(chatEventsStore.chat('A')).toBeUndefined()
    } finally {
      mockRepository.getAll.mockImplementation(async () => mockRecords)
      act(() => jest.runOnlyPendingTimers())
      jest.useRealTimers()
    }
  })

  test('an agent with no chat storage: the chats stay unknown, and the log says why', async () => {
    const warn = jest.fn()
    await act(async () => chatEventsStore.attach({ context: {}, config: { logger: { warn } } } as never))
    expect(chatEventsStore.chat('A')).toBeUndefined()
    expect(warn).toHaveBeenCalledWith('[chat] no chat storage on this agent: chats stay unknown', expect.anything())
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

  // A photo with no caption must not draw an empty bubble, nor a reply quoting it an empty quote (S3-3a, before the
  // image bubble lands). With a caption, the caption is its text.
  test('a photo with no caption reads as the photo label, and so does a reply quoting it', () => {
    const photo = { id: 'a1', mediaType: 'image/jpeg' as const, byteCount: 1000, width: 10, height: 10, file: 'x.jpg' }
    const bare = event({ connectionId: 'A', eventType: 'message', attachments: [photo] })
    const captioned = message('A', 'look at this', { attachments: [photo] })
    const reply = message('A', 'nice', { inReplyTo: bare.eventId })
    const items = chatTimelineItems([bare, captioned, reply], style, { photoLabel: '📷 Photo' })
    expect(items.map((i) => i.text)).toEqual(['📷 Photo', 'look at this', 'nice'])
    expect(items.find((i) => i.text === 'nice')?.replyTo).toEqual({ text: '📷 Photo' })
    // Without the label, nothing is invented.
    expect(chatTimelineItems([bare], style)[0].text).toBe('')
  })

  // An attachment this phone could not check or save is not a photo it can show: calling it one would be false.
  test('an attachment this phone cannot show reads as unsupported, never as a photo', () => {
    const unsupported = event({ connectionId: 'A', eventType: 'message', attachments: [{ unsupported: 'too-large' }] })
    const notSaved = event({
      connectionId: 'A',
      eventType: 'message',
      attachments: [{ id: 'a1', unsupported: 'not-saved' }],
    })
    const captioned = message('A', 'see this', { attachments: [{ unsupported: 'type-mismatch' }] })
    const labels = { photoLabel: '📷 Photo', unsupportedLabel: 'Unsupported attachment' }
    expect(chatTimelineItems([unsupported, notSaved, captioned], style, labels).map((i) => i.text)).toEqual([
      'Unsupported attachment',
      'Unsupported attachment',
      'see this',
    ])
  })

  test('a reply to an original that disappeared on its timer says so; one never here says it is not on this phone', () => {
    const expiredOriginal = '01JYYYYYYYYYYYYYYYYYYYYYYY'
    const neverHere = '01JZZZZZZZZZZZZZZZZZZZZZZZ'
    const toExpired = message('A', 'to something that disappeared', { inReplyTo: expiredOriginal })
    const toLost = message('A', 'to something never here', { inReplyTo: neverHere })
    const replyOf = (items: ReturnType<typeof chatTimelineItems>, text: string) =>
      items.find((i) => i.text === text)?.replyTo
    const read = chatTimelineItems([toExpired, toLost], style, { expired: new Set([expiredOriginal]) })
    expect(replyOf(read, 'to something that disappeared')).toEqual({ expired: true })
    expect(replyOf(read, 'to something never here')).toEqual({ unavailable: true })
    // While which originals disappeared is being read, a reply quotes nothing rather than something it may take back.
    const reading = chatTimelineItems([toExpired, toLost], style, { expired: 'unread' })
    expect(replyOf(reading, 'to something that disappeared')).toEqual({ unread: true })
    expect(replyOf(reading, 'to something never here')).toEqual({ unread: true })
  })

  test('a disappearing message carries the timer it was sent with; another carries none', () => {
    const timed = message('A', 'timed', { expiresIn: 3600 })
    const plain = message('A', 'plain')
    const items = chatTimelineItems([timed, plain], style)
    expect(items.find((i) => i.text === 'timed')?.expiresIn).toBe(3600)
    expect(items.find((i) => i.text === 'plain')?.expiresIn).toBeUndefined()
  })

  test('a system line reads as its words, given by whoever words it', () => {
    const timer = event({
      connectionId: 'A',
      eventType: 'timer',
      role: 'received',
      timer: { expiresIn: 3600, version: 1 },
    })
    const items = chatTimelineItems([timer], style, { systemLine: (r) => `set to ${r.timer?.expiresIn}` })
    expect(items[0]).toMatchObject({ kind: 'system', text: 'set to 3600' })
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

  test("a system line's words changing is a change (a contact renamed)", () => {
    const timer = event({
      connectionId: 'A',
      eventType: 'timer',
      role: 'received',
      timer: { expiresIn: 3600, version: 1 },
    })
    const as = (name: string) => chatTimelineItems([timer], style, { systemLine: () => `${name} set a timer` })
    expect(areChatMessagesEqual(as('Ana'), as('Ana'))).toBe(true)
    expect(areChatMessagesEqual(as('Ana'), as('Bea'))).toBe(false)
  })

  test("a reply's original found to have disappeared is a change", () => {
    const reply = message('A', 'the answer', { inReplyTo: original.eventId })
    const reading = chatTimelineItems([reply], style, { expired: 'unread' })
    const expired = chatTimelineItems([reply], style, { expired: new Set([original.eventId]) })
    const lost = chatTimelineItems([reply], style, { expired: new Set() })
    expect(areChatMessagesEqual(reading, expired)).toBe(false)
    expect(areChatMessagesEqual(expired, lost)).toBe(false)
  })

  test("a reply's original arriving later is a change", () => {
    const reply = message('A', 'the answer', { inReplyTo: original.eventId })
    expect(
      areChatMessagesEqual(chatTimelineItems([reply], style), chatTimelineItems([original, reply], style).slice(1))
    ).toBe(false)
  })
})

// Deleting a chat's history (history.ts, a removed contact or "delete chat") goes through the repository, so the
// chat's preview and unread count go with it at once, not at the next restart.
describe("a chat's history deleted", () => {
  test("the whole chat: its events leave the store, and its unread count with them; another chat's stay", async () => {
    mockRecords = [message('A', 'one'), message('A', 'two'), message('B', 'other')]
    const { result } = renderHook(() => ({ unread: useUnreadMessages(), a: useChatEvents('A') }))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(result.current.unread.unreadByConnection.A).toBe(2)
    await act(async () => {
      await deleteChatMessages(agent as never, 'A')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(result.current.a).toEqual([])
    expect(result.current.unread.unreadByConnection.A ?? 0).toBe(0)
    expect(chatEventsStore.chat('B')).toHaveLength(1)
  })

  test('one message: it leaves the timeline with its reaction, and the rest stay', async () => {
    const gone = message('A', 'gone')
    const kept = message('A', 'kept')
    const onGone = event({ connectionId: 'A', eventType: 'reaction', target: gone.eventId, emoji: '👍' })
    mockRecords = [gone, kept, onGone]
    await attach()
    await act(async () => {
      await deleteChatMessages(agent as never, 'A', { events: [gone] })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(chatTimelineItems(chatEventsStore.chat('A') ?? [], () => ({})).map((i) => i.text)).toEqual(['kept'])
    expect(chatEventsStore.chat('A')?.some((r) => r.eventType === 'reaction')).toBe(false)
  })
})

describe('a message that disappears on its timer', () => {
  test('which originals disappeared is read only for a chat with a reply whose original is missing', async () => {
    const original = message('A', 'the question')
    const reply = message('A', 'the answer', { inReplyTo: original.eventId })
    // The store hands over the same array until the chat changes; so does this.
    const events = [original, reply]
    const { result } = renderHook(() => useExpiredOriginals('A', events))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(result.current).toBeUndefined()
    expect(expiredIds).not.toHaveBeenCalled()
  })

  test('a reply whose original is missing: unread while it is read, then the ids read', async () => {
    const gone = '01JYYYYYYYYYYYYYYYYYYYYYYY'
    let answer: (ids: Set<string>) => void = () => undefined
    ;(expiredIds as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
    const reply = message('A', 'the answer', { inReplyTo: gone })
    const events = [reply]
    const { result } = renderHook(() => useExpiredOriginals('A', events))
    expect(result.current).toBe('unread')
    await act(async () => answer(new Set([gone])))
    expect(result.current).toEqual(new Set([gone]))
    expect(expiredIds).toHaveBeenCalledWith(agent, 'A')
  })

  test('unreadable: every missing original is said to be not on this phone, which is still true', async () => {
    ;(expiredIds as jest.Mock).mockRejectedValueOnce(new Error('storage unavailable'))
    const reply = message('A', 'the answer', { inReplyTo: '01JYYYYYYYYYYYYYYYYYYYYYYY' })
    const events = [reply]
    const { result } = renderHook(() => useExpiredOriginals('A', events))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(result.current).toEqual(new Set())
  })

  // The expiry sweep (expiry.ts) deletes through deleteChatMessages, as here: the store follows the repository.
  test("its reaction, and the chat list's preview of it, go at once", async () => {
    const before = message('A', 'see you at noon')
    const timed = message('A', 'the door code is 4512', { expiresIn: 3600 })
    const onTimed = event({ connectionId: 'A', eventType: 'reaction', target: timed.eventId, emoji: '👍' })
    mockRecords = [before, timed, onTimed]
    await attach()
    const preview = () =>
      chatTimelineItems(chatEventsStore.chat('A') ?? [], () => ({}))
        .filter((i) => i.kind !== 'system')
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.text
    expect(preview()).toBe('the door code is 4512')

    await act(async () => {
      await deleteChatMessages(agent as never, 'A', { events: [timed] })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(preview()).toBe('see you at noon')
    expect(chatEventsStore.chat('A')?.map((r) => r.eventId)).toEqual([before.eventId])
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
