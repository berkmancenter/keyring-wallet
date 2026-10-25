import { DidCommMessageHandlerRegistry, DidCommMessageSender, DidCommProblemReportMessage } from '@credo-ts/didcomm'
import { EventEmitter, InjectionSymbols, JsonTransformer } from '@credo-ts/core'
import type { BaseRecord } from '@credo-ts/core'

import { counterpartySpeaksChat } from '../capability'
import { ChatCapabilityMessage } from '../messages/ChatCapabilityMessage'
import { ChatEventRecord } from '../records/ChatEventRecord'
import { ChatPeerRecord } from '../records/ChatPeerRecord'
import {
  NOTICE_RETRY_MS,
  receiveCapabilityNotice,
  receiveChatProblemReport,
  sendCapabilityNoticeIfNeeded,
  setupChatCapability,
} from '../notice'
import { RelationshipDidRepository } from '../../vrc/repositories/RelationshipDidRepository'

jest.mock('../../vrc/vrc-manager', () => ({ RCE_PROTOCOL_VERSION: 6 }))

const NOW = new Date('2026-10-25T10:00:00Z').getTime()
const EVENT_ID = '01JB3XKX6F8Q2W4E5R6T7Y8Z9V'

type Connection = { id: string; theirDid?: string; did: string; didcommVersion?: 'v1' | 'v2' }

function makeAgent(
  options: { rceVersion?: number; noRelationship?: boolean; didcommVersion?: 'v1' | 'v2'; basicFails?: boolean } = {}
) {
  const records = new Map<string, BaseRecord[]>()
  const sent: { message: unknown; connectionId: string }[] = []
  const basic: { connectionId: string; text: string }[] = []
  const handlers: { supportedMessages: unknown[]; handle: (ctx: unknown) => Promise<unknown> }[] = []
  const relationship =
    options.noRelationship === true ? null : { counterpartyRceVersion: options.rceVersion, theirDid: 'did:peer:them' }
  const relationshipUpdates: unknown[] = []

  const of = (type: string) => records.get(type) ?? records.set(type, []).get(type)!
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
    save: async (_ctx: unknown, record: BaseRecord) => {
      of(record.type).push(record)
    },
    update: async (_ctx: unknown, record: BaseRecord) => {
      const list = of(record.type)
      list.splice(
        list.findIndex((r) => r.id === record.id),
        1,
        record
      )
    },
    delete: async (_ctx: unknown, record: BaseRecord) => {
      const list = of(record.type)
      list.splice(
        list.findIndex((r) => r.id === record.id),
        1
      )
    },
    findByQuery: async (_ctx: unknown, cls: { type: string }, query: Record<string, unknown>) =>
      of(cls.type).filter((r) =>
        Object.entries(query).every(([k, v]) => (r.getTags() as unknown as Record<string, unknown>)[k] === v)
      ),
  })
  singletons.set(EventEmitter, { emit: jest.fn() })
  singletons.set(DidCommMessageSender, {
    sendMessage: async (outbound: { message: unknown; connection: Connection }) => {
      sent.push({ message: outbound.message, connectionId: outbound.connection.id })
    },
  })
  singletons.set(DidCommMessageHandlerRegistry, {
    registerMessageHandler: (handler: (typeof handlers)[number]) => {
      handlers.push(handler)
    },
  })
  singletons.set(RelationshipDidRepository, {
    findByConnectionDid: async () => relationship,
    update: async (_ctx: unknown, record: unknown) => {
      relationshipUpdates.push({ ...(record as object) })
    },
  })

  const connections: Record<string, Connection> = {
    'conn-1': { id: 'conn-1', theirDid: 'did:peer:them', did: 'did:peer:me', didcommVersion: options.didcommVersion },
    'conn-2': { id: 'conn-2', theirDid: 'did:peer:other', did: 'did:peer:me2' },
  }
  const agent = {
    context: {},
    config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
    dependencyManager: { container, resolve: container.resolve },
    modules: {
      didcomm: {
        connections: { getById: async (id: string) => connections[id] },
        basicMessages: {
          sendMessage: async (connectionId: string, text: string) => {
            if (options.basicFails) throw new Error('mediator unreachable')
            basic.push({ connectionId, text })
          },
        },
      },
    },
  }
  return {
    agent: agent as never,
    connections,
    sent,
    basic,
    handlers,
    relationship,
    relationshipUpdates,
    peers: () => of(ChatPeerRecord.type) as ChatPeerRecord[],
    events: () => of(ChatEventRecord.type) as ChatEventRecord[],
    addEvent: (record: ChatEventRecord) => of(ChatEventRecord.type).push(record),
  }
}

const notice = (rceVersion: unknown, reply?: boolean) => {
  const message = new ChatCapabilityMessage({ rceVersion: 6, reply })
  message.rceVersion = rceVersion
  return message
}

const problemReport = (parentThreadId?: string) => {
  const message = new DidCommProblemReportMessage({
    description: { en: 'The message type is not supported', code: 'message-parse-failure' },
  })
  if (parentThreadId) message.setThread({ parentThreadId })
  return message
}

const sentEvent = (connectionId: string, eventType: 'message' | 'reaction', eventId = EVENT_ID) =>
  new ChatEventRecord({
    connectionId,
    role: 'sent',
    eventId,
    eventType,
    ...(eventType === 'message'
      ? { content: { format: 'text/plain' as const, text: 'see you at noon' } }
      : { target: '01JB3XKX6F8Q2W4E5R6T7Y8Z9W', emoji: '👍' }),
  })

describe('sendCapabilityNoticeIfNeeded', () => {
  it('sends one notice announcing this phone’s version to a contact stored below 6', async () => {
    const fake = makeAgent({ rceVersion: 5 })
    expect(await sendCapabilityNoticeIfNeeded(fake.agent, 'conn-1', NOW)).toBe('sent')
    expect(fake.sent).toHaveLength(1)
    const message = fake.sent[0].message as ChatCapabilityMessage
    expect(message).toBeInstanceOf(ChatCapabilityMessage)
    expect(message.rceVersion).toBe(6)
    expect(message.reply).toBeUndefined()
    expect(fake.peers()[0]).toMatchObject({ connectionId: 'conn-1', noticeId: message.id })
  })

  it('does not send again within the retry interval, and does after it', async () => {
    const fake = makeAgent({ rceVersion: 5 })
    await sendCapabilityNoticeIfNeeded(fake.agent, 'conn-1', NOW)
    expect(await sendCapabilityNoticeIfNeeded(fake.agent, 'conn-1', NOW + NOTICE_RETRY_MS - 1)).toBe('recent')
    expect(await sendCapabilityNoticeIfNeeded(fake.agent, 'conn-1', NOW + NOTICE_RETRY_MS)).toBe('sent')
    expect(fake.sent).toHaveLength(2)
  })

  it('sends nothing to a contact already known to speak chat, or on a DIDComm v2 connection', async () => {
    const speaks = makeAgent({ rceVersion: 6 })
    expect(await sendCapabilityNoticeIfNeeded(speaks.agent, 'conn-1', NOW)).toBe('not-needed')
    const v2 = makeAgent({ rceVersion: 5, didcommVersion: 'v2' })
    expect(await sendCapabilityNoticeIfNeeded(v2.agent, 'conn-1', NOW)).toBe('not-v1')
    expect([...speaks.sent, ...v2.sent]).toHaveLength(0)
  })
})

describe('receiveCapabilityNotice', () => {
  const ctx = (fake: ReturnType<typeof makeAgent>, message: ChatCapabilityMessage, overrides = {}) =>
    ({ message, connection: fake.connections['conn-1'], senderKey: {}, ...overrides }) as never

  it('raises the stored version and answers once with a reply notice', async () => {
    const fake = makeAgent({ rceVersion: 5 })
    expect(await receiveCapabilityNotice(fake.agent, ctx(fake, notice(6)), NOW)).toBe('raised')
    expect(fake.relationship?.counterpartyRceVersion).toBe(6)
    expect(fake.relationshipUpdates).toHaveLength(1)
    expect(fake.sent).toHaveLength(1)
    expect((fake.sent[0].message as ChatCapabilityMessage).reply).toBe(true)
    // Everything it sent is a capability notice: no relationship exchange is opened.
    expect(fake.sent.every((s) => s.message instanceof ChatCapabilityMessage)).toBe(true)
  })

  it('never answers a reply, so two phones exchange two messages in all', async () => {
    const fake = makeAgent({ rceVersion: 5 })
    await receiveCapabilityNotice(fake.agent, ctx(fake, notice(6, true)), NOW)
    expect(fake.sent).toHaveLength(0)
  })

  it('never lowers the stored version', async () => {
    const fake = makeAgent({ rceVersion: 7 })
    expect(await receiveCapabilityNotice(fake.agent, ctx(fake, notice(6, true)), NOW)).toBe('unchanged')
    expect(fake.relationship?.counterpartyRceVersion).toBe(7)
    expect(fake.relationshipUpdates).toHaveLength(0)
  })

  it('drops a notice with no connection, no authenticated sender, or a malformed version', async () => {
    const fake = makeAgent({ rceVersion: 5 })
    expect(await receiveCapabilityNotice(fake.agent, ctx(fake, notice(6), { connection: undefined }), NOW)).toBe(
      'no-connection'
    )
    expect(await receiveCapabilityNotice(fake.agent, ctx(fake, notice(6), { senderKey: undefined }), NOW)).toBe(
      'no-authenticated-sender'
    )
    for (const bad of ['6', 0, 1.5, 5000, undefined]) {
      expect(await receiveCapabilityNotice(fake.agent, ctx(fake, notice(bad)), NOW)).toBe('bad-version')
    }
    expect(fake.relationship?.counterpartyRceVersion).toBe(5)
    expect(fake.sent).toHaveLength(0)
  })

  it('ignores a notice from a contact with no relationship record', async () => {
    const fake = makeAgent({ noRelationship: true })
    expect(await receiveCapabilityNotice(fake.agent, ctx(fake, notice(6)), NOW)).toBe('no-relationship')
    expect(fake.sent).toHaveLength(0)
  })

  it('does not answer on a DIDComm v2 connection', async () => {
    const fake = makeAgent({ rceVersion: 5, didcommVersion: 'v2' })
    expect(await receiveCapabilityNotice(fake.agent, ctx(fake, notice(6)), NOW)).toBe('raised')
    expect(fake.sent).toHaveLength(0)
  })
})

describe('receiveChatProblemReport', () => {
  const ctx = (fake: ReturnType<typeof makeAgent>, message: DidCommProblemReportMessage, connectionId = 'conn-1') =>
    ({ message, connection: fake.connections[connectionId] }) as never

  it('records a refused notice and sends nothing', async () => {
    const fake = makeAgent({ rceVersion: 5 })
    await sendCapabilityNoticeIfNeeded(fake.agent, 'conn-1', NOW)
    const noticeId = fake.peers()[0].noticeId as string
    expect(await receiveChatProblemReport(fake.agent, ctx(fake, problemReport(noticeId)), NOW)).toBe('notice-refused')
    expect(fake.sent).toHaveLength(1)
    expect(fake.basic).toHaveLength(0)
  })

  it('resends a refused text message as a BasicMessage, removes the chat copy, and stops chat to that contact', async () => {
    const fake = makeAgent({ rceVersion: 6 })
    fake.addEvent(sentEvent('conn-1', 'message'))
    expect(await counterpartySpeaksChat(fake.agent, 'conn-1')).toBe(true)

    expect(await receiveChatProblemReport(fake.agent, ctx(fake, problemReport(EVENT_ID)), NOW)).toBe('chat-refused')
    expect(fake.basic).toEqual([{ connectionId: 'conn-1', text: 'see you at noon' }])
    expect(fake.events()).toHaveLength(0)
    expect(fake.peers()[0].chatRefusedAt?.getTime()).toBe(NOW)
    expect(await counterpartySpeaksChat(fake.agent, 'conn-1')).toBe(false)
  })

  it('keeps the chat copy when the resend fails, so the message never vanishes unsent', async () => {
    const fake = makeAgent({ rceVersion: 6, basicFails: true })
    fake.addEvent(sentEvent('conn-1', 'message'))
    await expect(receiveChatProblemReport(fake.agent, ctx(fake, problemReport(EVENT_ID)), NOW)).rejects.toThrow(
      'mediator unreachable'
    )
    expect(fake.events()).toHaveLength(1)
  })

  it('keeps a refused message that has no text, since there is nothing to resend', async () => {
    const fake = makeAgent({ rceVersion: 6 })
    const textless = sentEvent('conn-1', 'message')
    textless.content = undefined
    fake.addEvent(textless)
    expect(await receiveChatProblemReport(fake.agent, ctx(fake, problemReport(EVENT_ID)), NOW)).toBe('chat-refused')
    expect(fake.events()).toHaveLength(1)
    expect(fake.basic).toHaveLength(0)
  })

  it('drops a refused reaction without sending anything in its place', async () => {
    const fake = makeAgent({ rceVersion: 6 })
    fake.addEvent(sentEvent('conn-1', 'reaction'))
    expect(await receiveChatProblemReport(fake.agent, ctx(fake, problemReport(EVENT_ID)), NOW)).toBe('chat-refused')
    expect(fake.basic).toHaveLength(0)
    expect(fake.events()).toHaveLength(0)
  })

  it('ignores a report citing an id sent on a different connection', async () => {
    const fake = makeAgent({ rceVersion: 6 })
    fake.addEvent(sentEvent('conn-2', 'message'))
    expect(await receiveChatProblemReport(fake.agent, ctx(fake, problemReport(EVENT_ID), 'conn-1'), NOW)).toBe(
      'ignored'
    )
    expect(fake.events()).toHaveLength(1)
    expect(fake.basic).toHaveLength(0)
    expect(await counterpartySpeaksChat(fake.agent, 'conn-1')).toBe(true)
  })

  it('ignores an unrelated report, one with no parent id, and one with no connection', async () => {
    const fake = makeAgent({ rceVersion: 6 })
    fake.addEvent(sentEvent('conn-1', 'message'))
    expect(await receiveChatProblemReport(fake.agent, ctx(fake, problemReport('some-other-message-id')), NOW)).toBe(
      'ignored'
    )
    expect(await receiveChatProblemReport(fake.agent, ctx(fake, problemReport()), NOW)).toBe('ignored')
    expect(
      await receiveChatProblemReport(fake.agent, { message: problemReport(EVENT_ID), connection: undefined } as never)
    ).toBe('ignored')
    expect(fake.events()).toHaveLength(1)
  })

  it('a new notice from the contact clears the refusal', async () => {
    const fake = makeAgent({ rceVersion: 6 })
    fake.addEvent(sentEvent('conn-1', 'message'))
    await receiveChatProblemReport(fake.agent, ctx(fake, problemReport(EVENT_ID)), NOW)
    expect(await counterpartySpeaksChat(fake.agent, 'conn-1')).toBe(false)

    await receiveCapabilityNotice(
      fake.agent,
      { message: notice(6, true), connection: fake.connections['conn-1'], senderKey: {} } as never,
      NOW
    )
    expect(await counterpartySpeaksChat(fake.agent, 'conn-1')).toBe(true)
  })
})

describe('setupChatCapability', () => {
  it('registers handlers for the notice and for the generic problem report, which never reply', async () => {
    const fake = makeAgent({ rceVersion: 6 })
    setupChatCapability(fake.agent)
    const supported = fake.handlers.flatMap((h) => h.supportedMessages)
    expect(supported).toEqual([ChatCapabilityMessage, DidCommProblemReportMessage])

    const reportHandler = fake.handlers.find((h) => h.supportedMessages.includes(DidCommProblemReportMessage))!
    const reply = await reportHandler.handle({
      message: problemReport('unrelated-id'),
      connection: fake.connections['conn-1'],
    })
    expect(reply).toBeUndefined()
  })
})

describe('ChatPeerRecord through storage', () => {
  it('keeps its dates as Dates', () => {
    const record = new ChatPeerRecord({
      connectionId: 'conn-1',
      noticeId: 'n',
      noticeSentAt: new Date(NOW),
      chatRefusedAt: new Date(NOW + 1),
    })
    const back = JsonTransformer.deserialize(JsonTransformer.serialize(record), ChatPeerRecord)
    expect(back.noticeSentAt).toBeInstanceOf(Date)
    expect(back.noticeSentAt?.getTime()).toBe(NOW)
    expect(back.chatRefusedAt?.getTime()).toBe(NOW + 1)
  })
})
