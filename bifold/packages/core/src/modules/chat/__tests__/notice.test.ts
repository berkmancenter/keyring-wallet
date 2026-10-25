import {
  DidCommBasicMessageRepository,
  DidCommMessageHandlerRegistry,
  DidCommMessageSender,
  DidCommProblemReportMessage,
} from '@credo-ts/didcomm'
import { EventEmitter, InjectionSymbols, JsonTransformer } from '@credo-ts/core'
import type { BaseRecord } from '@credo-ts/core'

import RNFS from 'react-native-fs'

import { counterpartySpeaksChat } from '../capability'
import { ChatCapabilityMessage } from '../messages/ChatCapabilityMessage'
import { ChatEventRecord } from '../records/ChatEventRecord'
import { ChatPeerRecord } from '../records/ChatPeerRecord'
import {
  NOTICE_RETRY_MS,
  noteChatFromContact,
  receiveCapabilityNotice,
  receiveChatProblemReport,
  sendCapabilityNoticeIfNeeded,
  setupChatCapability,
} from '../notice'
import { RelationshipDidRepository } from '../../vrc/repositories/RelationshipDidRepository'

// This phone's version, changed per test to simulate a later bump.
let mockRceVersion = 6
jest.mock('../../vrc/vrc-manager', () => ({
  get RCE_PROTOCOL_VERSION() {
    return mockRceVersion
  },
}))
beforeEach(() => {
  mockRceVersion = 6
})
// The refusal path deletes through history.ts, which reads the chat's media folder. This chat has no media.
// Explicit, rather than jest's automock, whose shape follows whichever react-native-fs build is installed.
jest.mock('react-native-fs', () => ({
  LibraryDirectoryPath: '/lib',
  DocumentDirectoryPath: '/files',
  exists: jest.fn(async () => false),
  readDir: jest.fn(async () => []),
  unlink: jest.fn(async () => undefined),
}))

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
  // Delete for me's cascade (history.ts) also looks at plain BasicMessages; this chat has none.
  singletons.set(DidCommBasicMessageRepository, { findByQuery: async () => [], delete: async () => undefined })
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
    // A contact this phone has already told a version, in a notice it did not refuse.
    told: (announcedVersion: number) =>
      of(ChatPeerRecord.type).push(new ChatPeerRecord({ connectionId: 'conn-1', announcedVersion })),
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

  it('does not send again once the contact has heard it', async () => {
    const fake = makeAgent({ rceVersion: 5 })
    await sendCapabilityNoticeIfNeeded(fake.agent, 'conn-1', NOW)
    expect(await sendCapabilityNoticeIfNeeded(fake.agent, 'conn-1', NOW + NOTICE_RETRY_MS)).toBe('not-needed')
    expect(fake.sent).toHaveLength(1)
  })

  it('tells a contact that refused the notice again, but not within the retry interval', async () => {
    const fake = makeAgent({ rceVersion: 5 })
    await sendCapabilityNoticeIfNeeded(fake.agent, 'conn-1', NOW)
    await receiveChatProblemReport(
      fake.agent,
      { message: problemReport(fake.peers()[0].noticeId as string), connection: fake.connections['conn-1'] } as never,
      NOW
    )
    expect(await sendCapabilityNoticeIfNeeded(fake.agent, 'conn-1', NOW + NOTICE_RETRY_MS - 1)).toBe('recent')
    expect(await sendCapabilityNoticeIfNeeded(fake.agent, 'conn-1', NOW + NOTICE_RETRY_MS)).toBe('sent')
    expect(fake.sent).toHaveLength(2)
  })

  it('after an upgrade, tells a contact that heard only the older version, once', async () => {
    mockRceVersion = 7
    const fake = makeAgent({ rceVersion: 7 })
    fake.told(6)
    expect(await sendCapabilityNoticeIfNeeded(fake.agent, 'conn-1', NOW)).toBe('sent')
    expect((fake.sent[0].message as ChatCapabilityMessage).rceVersion).toBe(7)
    expect(fake.peers()[0].announcedVersion).toBe(7)
    expect(await sendCapabilityNoticeIfNeeded(fake.agent, 'conn-1', NOW + NOTICE_RETRY_MS)).toBe('not-needed')
  })

  // The two-phone run, 2026-10-25: this phone paired while on a build without chat, so the contact's handshake
  // already said 6 and the contact heard only this phone's older version. After this phone upgrades, the contact's
  // stored version is no reason to stay quiet.
  it('tells a contact paired before this phone upgraded, whatever that contact is stored at', async () => {
    const fake = makeAgent({ rceVersion: 6 })
    expect(await sendCapabilityNoticeIfNeeded(fake.agent, 'conn-1', NOW)).toBe('sent')
  })

  it('notices again a contact that refused a chat event, even one stored at this version', async () => {
    const fake = makeAgent({ rceVersion: 6 })
    fake.addEvent(sentEvent('conn-1', 'reaction'))
    await receiveChatProblemReport(
      fake.agent,
      { message: problemReport(EVENT_ID), connection: fake.connections['conn-1'] } as never,
      NOW
    )
    expect(await sendCapabilityNoticeIfNeeded(fake.agent, 'conn-1', NOW)).toBe('sent')
  })

  it('sends nothing to a contact already told this version, or on a DIDComm v2 connection', async () => {
    const speaks = makeAgent({ rceVersion: 6 })
    speaks.told(6)
    expect(await sendCapabilityNoticeIfNeeded(speaks.agent, 'conn-1', NOW)).toBe('not-needed')
    const v2 = makeAgent({ rceVersion: 5, didcommVersion: 'v2' })
    expect(await sendCapabilityNoticeIfNeeded(v2.agent, 'conn-1', NOW)).toBe('not-v1')
    expect([...speaks.sent, ...v2.sent]).toHaveLength(0)
  })
})

describe('receiveCapabilityNotice', () => {
  const ctx = (fake: ReturnType<typeof makeAgent>, message: ChatCapabilityMessage, overrides = {}) =>
    ({ message, connection: fake.connections['conn-1'], senderKey: {}, ...overrides }) as never

  it('records the version it told the contact in its answer', async () => {
    const fake = makeAgent({ rceVersion: 5 })
    await receiveCapabilityNotice(fake.agent, ctx(fake, notice(6)), NOW)
    expect(fake.peers()[0].announcedVersion).toBe(6)
  })

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

  it('forgets a refused notice was heard, so the contact is told again after the interval', async () => {
    const fake = makeAgent({ rceVersion: 5 })
    await sendCapabilityNoticeIfNeeded(fake.agent, 'conn-1', NOW)
    const noticeId = fake.peers()[0].noticeId as string
    await receiveChatProblemReport(fake.agent, ctx(fake, problemReport(noticeId)), NOW)
    expect(fake.peers()[0].announcedVersion).toBeUndefined()
    expect(await sendCapabilityNoticeIfNeeded(fake.agent, 'conn-1', NOW + NOTICE_RETRY_MS)).toBe('sent')
  })

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

  describe('a refused photo', () => {
    const FALLBACK = '📷 Photo — update Keyring to see it'
    const sentPhoto = (caption?: string) => {
      const record = sentEvent('conn-1', 'message')
      record.content = caption ? { format: 'text/plain', text: caption } : undefined
      record.attachments = [
        { id: 'a1', mediaType: 'image/jpeg', byteCount: 1000, width: 10, height: 10, file: `${EVENT_ID}.jpg` },
      ]
      record.fallbackText = caption ? `${FALLBACK}\n\n${caption}` : FALLBACK
      return record
    }

    it('resends the words it would have gone as to a contact without chat, caption included', async () => {
      const fake = makeAgent({ rceVersion: 6 })
      fake.addEvent(sentPhoto('look at this'))
      expect(await receiveChatProblemReport(fake.agent, ctx(fake, problemReport(EVENT_ID)), NOW)).toBe('chat-refused')
      expect(fake.basic).toEqual([{ connectionId: 'conn-1', text: `${FALLBACK}\n\nlook at this` }])
      expect(fake.events()).toHaveLength(0)
    })

    it('resends the fallback when it has no caption, rather than keeping it unsent', async () => {
      const fake = makeAgent({ rceVersion: 6 })
      fake.addEvent(sentPhoto())
      expect(await receiveChatProblemReport(fake.agent, ctx(fake, problemReport(EVENT_ID)), NOW)).toBe('chat-refused')
      expect(fake.basic).toEqual([{ connectionId: 'conn-1', text: FALLBACK }])
      expect(fake.events()).toHaveLength(0)
    })

    it('deletes its media file only after the resend has gone', async () => {
      const fake = makeAgent({ rceVersion: 6 })
      fake.addEvent(sentPhoto())
      const folder = '/lib/Application Support/chat-media/conn-1'
      let sentBeforeUnlink: number | undefined
      ;(RNFS.exists as jest.Mock).mockResolvedValueOnce(true)
      ;(RNFS.readDir as jest.Mock).mockResolvedValueOnce([
        { name: `${EVENT_ID}.jpg`, path: `${folder}/${EVENT_ID}.jpg` },
      ])
      ;(RNFS.unlink as jest.Mock).mockImplementationOnce(async () => {
        sentBeforeUnlink = fake.basic.length
      })
      await receiveChatProblemReport(fake.agent, ctx(fake, problemReport(EVENT_ID)), NOW)
      expect(RNFS.unlink).toHaveBeenCalledWith(`${folder}/${EVENT_ID}.jpg`)
      expect(sentBeforeUnlink).toBe(1)
    })
  })

  it('removes a refused message together with the reactions on it', async () => {
    const fake = makeAgent({ rceVersion: 6 })
    fake.addEvent(sentEvent('conn-1', 'message'))
    fake.addEvent(
      new ChatEventRecord({
        connectionId: 'conn-1',
        role: 'received',
        eventId: '01JB3XKX6F8Q2W4E5R6T7Y8Z9X',
        eventType: 'reaction',
        target: EVENT_ID,
        emoji: '👍',
      })
    )
    expect(await receiveChatProblemReport(fake.agent, ctx(fake, problemReport(EVENT_ID)), NOW)).toBe('chat-refused')
    expect(fake.events()).toHaveLength(0)
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

describe('noteChatFromContact', () => {
  it('raises a contact stored below 6 to 6, so this phone answers in chat events', async () => {
    const fake = makeAgent({ rceVersion: 5 })
    await noteChatFromContact(fake.agent, fake.connections['conn-1'] as never)
    expect(fake.relationship?.counterpartyRceVersion).toBe(6)
    expect(await counterpartySpeaksChat(fake.agent, 'conn-1')).toBe(true)
  })

  it('raises to chat’s version only, never to this phone’s own or beyond', async () => {
    mockRceVersion = 7
    const fake = makeAgent({ rceVersion: 5 })
    await noteChatFromContact(fake.agent, fake.connections['conn-1'] as never)
    expect(fake.relationship?.counterpartyRceVersion).toBe(6)
  })

  it('never lowers a higher stored version', async () => {
    const fake = makeAgent({ rceVersion: 7 })
    await noteChatFromContact(fake.agent, fake.connections['conn-1'] as never)
    expect(fake.relationship?.counterpartyRceVersion).toBe(7)
    expect(fake.relationshipUpdates).toHaveLength(0)
  })

  it('clears a refusal', async () => {
    const fake = makeAgent({ rceVersion: 6 })
    fake.addEvent(sentEvent('conn-1', 'reaction'))
    await receiveChatProblemReport(
      fake.agent,
      { message: problemReport(EVENT_ID), connection: fake.connections['conn-1'] } as never,
      NOW
    )
    expect(await counterpartySpeaksChat(fake.agent, 'conn-1')).toBe(false)
    await noteChatFromContact(fake.agent, fake.connections['conn-1'] as never)
    expect(await counterpartySpeaksChat(fake.agent, 'conn-1')).toBe(true)
  })

  it('does nothing for a contact with no relationship record', async () => {
    const fake = makeAgent({ noRelationship: true })
    await expect(noteChatFromContact(fake.agent, fake.connections['conn-1'] as never)).resolves.toBeUndefined()
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
