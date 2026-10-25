import { DidCommMessageHandlerRegistry } from '@credo-ts/didcomm'
import { EventEmitter, InjectionSymbols } from '@credo-ts/core'

import { CHAT_PROFILE } from '../chatEvent'
import { ChatEventMessage } from '../messages/ChatEventMessage'
import { ChatEventRecord } from '../records/ChatEventRecord'
import { receiveChatEventMessage, setupChatInbound } from '../inbound'
import type { ChatInboundVerdict } from '../inbound'
import { RelationshipDidRepository } from '../../vrc/repositories/RelationshipDidRepository'
import { writeChatMedia } from '../media/store'
import { REAL, bytesOf, descriptorFor } from '../media/__tests__/fixtures/images'

// The order of writes and saves across both, so a test can say which came first.
const mockOrder: string[] = []
jest.mock('../media/store', () => ({
  writeChatMedia: jest.fn(async (_c: string, eventId: string) => {
    mockOrder.push('write')
    return `${eventId}.jpg`
  }),
}))
const write = writeChatMedia as jest.Mock

const EVENT_ID = '01JB3XKX6F8Q2W4E5R6T7Y8Z9V'
const TARGET = '01JB3XKX6F8Q2W4E5R6T7Y8Z9W'

function makeFakeAgent(options: { counterpartyRceVersion?: number; relationshipFails?: boolean } = {}) {
  const stored: ChatEventRecord[] = []
  let capturedHandler: ((ctx: unknown) => Promise<unknown>) | undefined
  const registrations = new Map<unknown, { useFactory: (c: unknown) => unknown }>()
  const singletons = new Map<unknown, unknown>()
  const container = {
    isRegistered: (token: unknown) => registrations.has(token) || singletons.has(token),
    register: (token: unknown, provider: { useFactory: (c: unknown) => unknown }) => registrations.set(token, provider),
    resolve: (token: unknown): unknown => {
      if (singletons.has(token)) return singletons.get(token)
      const registration = registrations.get(token)
      if (registration) {
        const instance = registration.useFactory(container)
        singletons.set(token, instance)
        return instance
      }
      throw new Error(`fake container cannot resolve ${String(token)}`)
    },
  }
  singletons.set(InjectionSymbols.StorageService, {
    save: async (_ctx: unknown, record: ChatEventRecord) => {
      mockOrder.push('save')
      stored.push(record)
    },
    findByQuery: async (_ctx: unknown, _cls: unknown, query: Record<string, string>) =>
      stored.filter((r) =>
        Object.entries(query).every(([k, v]) => (r.getTags() as unknown as Record<string, unknown>)[k] === v)
      ),
  })
  singletons.set(EventEmitter, { emit: jest.fn() })
  // The contact's relationship, when a test needs one (noteChatFromContact reads and raises its stored version).
  const relationship =
    options.counterpartyRceVersion === undefined ? null : { counterpartyRceVersion: options.counterpartyRceVersion }
  singletons.set(RelationshipDidRepository, {
    findByConnectionDid: async () => {
      if (options.relationshipFails) throw new Error('store unavailable')
      return relationship
    },
    update: async () => undefined,
  })
  singletons.set(DidCommMessageHandlerRegistry, {
    // setupChatInbound also registers the notice and problem-report handlers
    // (notice.ts), so keep the one for chat events rather than the last one.
    registerMessageHandler: (handler: { supportedMessages: unknown[]; handle: (ctx: unknown) => Promise<unknown> }) => {
      if (handler.supportedMessages.includes(ChatEventMessage)) capturedHandler = handler.handle
    },
  })
  const agent = {
    context: {},
    config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
    dependencyManager: { container, resolve: container.resolve },
  }
  return { agent: agent as never, stored, handler: () => capturedHandler, relationship }
}

const connection = { id: 'conn-1', theirDid: 'did:peer:them', did: 'did:peer:me' }

function inbound(event: unknown, overrides: Record<string, unknown> = {}) {
  return { message: new ChatEventMessage({ event: event as never }), connection, senderKey: {}, ...overrides } as never
}

describe('receiveChatEventMessage', () => {
  it('stores a valid message as a received record on its connection', async () => {
    const fake = makeFakeAgent()
    const verdict = await receiveChatEventMessage(
      fake.agent,
      inbound({
        profile: CHAT_PROFILE,
        type: 'message',
        eventId: EVENT_ID,
        content: { format: 'text/plain', text: 'hi' },
      })
    )
    expect(verdict).toBe('stored')
    expect(fake.stored).toHaveLength(1)
    expect(fake.stored[0]).toMatchObject({
      connectionId: 'conn-1',
      role: 'received',
      eventId: EVENT_ID,
      eventType: 'message',
      content: { format: 'text/plain', text: 'hi' },
    })
    expect(fake.stored[0].getTags()).toMatchObject({ connectionId: 'conn-1', role: 'received', eventType: 'message' })
  })

  it('stores a reaction with its target and emoji, tagged by target', async () => {
    const fake = makeFakeAgent()
    await receiveChatEventMessage(
      fake.agent,
      inbound({ profile: CHAT_PROFILE, type: 'reaction', eventId: EVENT_ID, target: TARGET, emoji: '👍' })
    )
    expect(fake.stored[0]).toMatchObject({ eventType: 'reaction', target: TARGET, emoji: '👍' })
    expect(fake.stored[0].getTags().target).toBe(TARGET)
  })

  it('ignores a second delivery of the same event', async () => {
    const fake = makeFakeAgent()
    const event = { profile: CHAT_PROFILE, type: 'redaction', eventId: EVENT_ID, target: TARGET }
    expect(await receiveChatEventMessage(fake.agent, inbound(event))).toBe('stored')
    expect(await receiveChatEventMessage(fake.agent, inbound(event))).toBe('duplicate')
    expect(fake.stored).toHaveLength(1)
  })

  it('refuses a message with no connection or no authenticated sender', async () => {
    const fake = makeFakeAgent()
    const event = { profile: CHAT_PROFILE, type: 'redaction', eventId: EVENT_ID, target: TARGET }
    expect(await receiveChatEventMessage(fake.agent, inbound(event, { connection: undefined }))).toBe('no-connection')
    expect(await receiveChatEventMessage(fake.agent, inbound(event, { senderKey: undefined }))).toBe(
      'no-authenticated-sender'
    )
    expect(fake.stored).toHaveLength(0)
  })

  it('refuses an invalid event', async () => {
    const fake = makeFakeAgent()
    expect(await receiveChatEventMessage(fake.agent, inbound({ profile: 'other', type: 'message' }))).toBe(
      'wrong-profile'
    )
    expect(fake.stored).toHaveLength(0)
  })
})

describe('receiving a photo (plan §4.3, §5)', () => {
  const photo = (attachment: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    inbound({ profile: CHAT_PROFILE, type: 'message', eventId: EVENT_ID, attachments: [attachment], ...extra })
  const jpeg = () => descriptorFor(bytesOf(REAL.jpeg), { mediaType: 'image/jpeg', width: 5, height: 3 })

  beforeEach(() => {
    mockOrder.length = 0
    write.mockClear()
  })

  it('writes the file, named by the eventId and the type read from the bytes, before storing the record', async () => {
    const fake = makeFakeAgent()
    expect(await receiveChatEventMessage(fake.agent, photo(jpeg()))).toBe('stored')
    expect(write).toHaveBeenCalledWith('conn-1', EVENT_ID, 'image/jpeg', REAL.jpeg)
    expect(mockOrder).toEqual(['write', 'save'])
    expect(fake.stored[0].attachments).toEqual([
      {
        id: 'a1',
        mediaType: 'image/jpeg',
        byteCount: bytesOf(REAL.jpeg).length,
        width: 5,
        height: 3,
        file: `${EVENT_ID}.jpg`,
      },
    ])
  })

  it('keeps no image data, and no sender-supplied filename, in the record', async () => {
    const fake = makeFakeAgent()
    await receiveChatEventMessage(fake.agent, photo(jpeg()))
    const kept = JSON.stringify(fake.stored[0])
    expect(kept).not.toContain(REAL.jpeg.slice(0, 40))
    expect(kept).not.toContain('IMG_0412')
  })

  it('stores the message with the attachment unsupported, writing nothing, when the photo fails a check', async () => {
    const fake = makeFakeAgent()
    expect(
      await receiveChatEventMessage(
        fake.agent,
        photo({ ...jpeg(), width: 6 }, { content: { format: 'text/plain', text: 'hi' } })
      )
    ).toBe('stored')
    expect(write).not.toHaveBeenCalled()
    expect(fake.stored[0].content?.text).toBe('hi')
    expect(fake.stored[0].attachments).toEqual([{ id: 'a1', unsupported: 'dimension-mismatch' }])
  })

  it('stores the message with the attachment unsupported when the file cannot be written', async () => {
    const fake = makeFakeAgent()
    write.mockRejectedValueOnce(new Error('disk full'))
    expect(await receiveChatEventMessage(fake.agent, photo(jpeg()))).toBe('stored')
    expect(fake.stored[0].attachments).toEqual([{ id: 'a1', unsupported: 'not-saved' }])
  })

  it('writes nothing for a duplicate', async () => {
    const fake = makeFakeAgent()
    await receiveChatEventMessage(fake.agent, photo(jpeg()))
    write.mockClear()
    expect(await receiveChatEventMessage(fake.agent, photo(jpeg()))).toBe('duplicate')
    expect(write).not.toHaveBeenCalled()
  })
})

// A peer that copied the eventId of a message this phone sent could otherwise reach it through every lookup by eventId:
// deleting its own message, or letting it expire, would take this phone's with it.
describe('an eventId this phone sent', () => {
  const sentHere = (connectionId: string) =>
    new ChatEventRecord({
      connectionId,
      role: 'sent',
      eventId: EVENT_ID,
      eventType: 'message',
      content: { format: 'text/plain', text: 'mine' },
    })
  const theirs = () =>
    inbound({
      profile: CHAT_PROFILE,
      type: 'message',
      eventId: EVENT_ID,
      content: { format: 'text/plain', text: 'gone in an hour' },
      expiresIn: 3600,
    })

  it('is refused when a peer sends it back on the same connection, storing nothing', async () => {
    const fake = makeFakeAgent()
    fake.stored.push(sentHere('conn-1'))
    expect(await receiveChatEventMessage(fake.agent, theirs())).toBe('reused-event-id')
    expect(fake.stored).toHaveLength(1)
  })

  // This repo's jest pins Date.now() to 2024-01-01, before these ids (2024-10). A timer dated more than a day ahead of
  // now is refused as future-event (#579) before the reuse check is reached, so the clock is set to after them here.
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 25, 12, 0, 0))
  })
  afterEach(() => jest.restoreAllMocks())

  it.each([
    ['a reaction', { type: 'reaction', target: '01JB3XKX6F8Q2W4E5R6T7Y8Z9W', emoji: '👍' }],
    ['a redaction', { type: 'redaction', target: '01JB3XKX6F8Q2W4E5R6T7Y8Z9W' }],
    ['a timer', { type: 'timer', timer: { expiresIn: 3600, version: 1 } }],
  ])('is refused whatever the event, here %s', async (_label, fields) => {
    const fake = makeFakeAgent()
    fake.stored.push(sentHere('conn-1'))
    expect(
      await receiveChatEventMessage(fake.agent, inbound({ profile: CHAT_PROFILE, eventId: EVENT_ID, ...fields }))
    ).toBe('reused-event-id')
    expect(fake.stored).toHaveLength(1)
  })

  it('is no concern when it was sent on another connection', async () => {
    const fake = makeFakeAgent()
    fake.stored.push(sentHere('conn-2'))
    expect(await receiveChatEventMessage(fake.agent, theirs())).toBe('stored')
  })
})

// The two-phone run, 2026-10-25: a contact that upgraded after pairing may never send its notice. Its first chat event
// is the evidence, so this phone answers it in chat from then on.
describe('a stored chat event', () => {
  it('raises the contact stored below 6 to 6', async () => {
    const fake = makeFakeAgent({ counterpartyRceVersion: 5 })
    const verdict = await receiveChatEventMessage(
      fake.agent,
      inbound({
        profile: CHAT_PROFILE,
        type: 'message',
        eventId: EVENT_ID,
        content: { format: 'text/plain', text: 'hi' },
      })
    )
    expect(verdict).toBe('stored')
    expect(fake.relationship?.counterpartyRceVersion).toBe(6)
  })

  it('is still stored when recording the contact fails', async () => {
    const fake = makeFakeAgent({ relationshipFails: true })
    const verdict = await receiveChatEventMessage(
      fake.agent,
      inbound({
        profile: CHAT_PROFILE,
        type: 'message',
        eventId: EVENT_ID,
        content: { format: 'text/plain', text: 'hi' },
      })
    )
    expect(verdict).toBe('stored')
    expect(fake.stored).toHaveLength(1)
  })
})

describe('setupChatInbound', () => {
  it('registers a handler that stores events and reports its verdict', async () => {
    const fake = makeFakeAgent()
    const verdicts: ChatInboundVerdict[] = []
    setupChatInbound(fake.agent, (v) => verdicts.push(v))
    const handle = fake.handler()
    expect(handle).toBeDefined()
    await handle!(
      inbound({
        profile: CHAT_PROFILE,
        type: 'message',
        eventId: EVENT_ID,
        content: { format: 'text/plain', text: 'hi' },
      })
    )
    expect(verdicts).toEqual(['stored'])
    expect(fake.stored).toHaveLength(1)
  })
})

describe('a received reaction that is not one emoji of the pinned set', () => {
  // Unread counts and chat-list previews are built from stored chat events (chatEventsStore), and the
  // store hears about a record only through the repository's events. A dropped reaction must leave
  // neither: no record, and no event that could wake a watcher (plan §5, "Emoji validation").
  const reaction = (emoji: string) => ({
    profile: CHAT_PROFILE,
    type: 'reaction',
    eventId: EVENT_ID,
    target: TARGET,
    emoji,
  })

  it('is dropped with nothing stored and nothing announced, so no phantom unread or preview', async () => {
    const fake = makeFakeAgent()
    const emitter = (
      fake.agent as never as { dependencyManager: { resolve: (t: unknown) => { emit: jest.Mock } } }
    ).dependencyManager.resolve(EventEmitter)
    for (const emoji of ['👍👍', 'toString', 'hello']) {
      expect(await receiveChatEventMessage(fake.agent, inbound(reaction(emoji)))).toBe('bad-emoji')
    }
    expect(fake.stored).toHaveLength(0)
    expect(emitter.emit).not.toHaveBeenCalled()
  })

  it('is stored fully-qualified and announced when valid (the control for the test above)', async () => {
    const fake = makeFakeAgent()
    const emitter = (
      fake.agent as never as { dependencyManager: { resolve: (t: unknown) => { emit: jest.Mock } } }
    ).dependencyManager.resolve(EventEmitter)
    expect(await receiveChatEventMessage(fake.agent, inbound(reaction('❤')))).toBe('stored')
    expect(fake.stored[0]).toMatchObject({ eventType: 'reaction', emoji: '❤️' })
    expect(emitter.emit).toHaveBeenCalled()
  })
})
