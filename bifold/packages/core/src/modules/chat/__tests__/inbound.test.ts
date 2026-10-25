import { DidCommMessageHandlerRegistry } from '@credo-ts/didcomm'
import { EventEmitter, InjectionSymbols } from '@credo-ts/core'

import { CHAT_PROFILE } from '../chatEvent'
import { ChatEventMessage } from '../messages/ChatEventMessage'
import { ChatEventRecord } from '../records/ChatEventRecord'
import { receiveChatEventMessage, setupChatInbound } from '../inbound'
import type { ChatInboundVerdict } from '../inbound'

const EVENT_ID = '01JB3XKX6F8Q2W4E5R6T7Y8Z9V'
const TARGET = '01JB3XKX6F8Q2W4E5R6T7Y8Z9W'

function makeFakeAgent() {
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
      stored.push(record)
    },
    findByQuery: async (_ctx: unknown, _cls: unknown, query: Record<string, string>) =>
      stored.filter((r) =>
        Object.entries(query).every(([k, v]) => (r.getTags() as unknown as Record<string, unknown>)[k] === v)
      ),
  })
  singletons.set(EventEmitter, { emit: jest.fn() })
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
  return { agent: agent as never, stored, handler: () => capturedHandler }
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

  it('refuses an invalid event, and an attachment until Step 3', async () => {
    const fake = makeFakeAgent()
    expect(await receiveChatEventMessage(fake.agent, inbound({ profile: 'other', type: 'message' }))).toBe(
      'wrong-profile'
    )
    expect(
      await receiveChatEventMessage(
        fake.agent,
        inbound({
          profile: CHAT_PROFILE,
          type: 'message',
          eventId: EVENT_ID,
          content: { format: 'text/plain', text: 'photo' },
          attachments: [{ id: 'a1' }],
        })
      )
    ).toBe('attachments-unsupported')
    expect(fake.stored).toHaveLength(0)
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
