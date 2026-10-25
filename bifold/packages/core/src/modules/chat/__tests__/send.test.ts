import { DidCommMessageSender } from '@credo-ts/didcomm'
import { EventEmitter, InjectionSymbols } from '@credo-ts/core'

import { isUlid } from '../chatEvent'
import { ChatEventMessage } from '../messages/ChatEventMessage'
import type { ChatEventRecord } from '../records/ChatEventRecord'
import { removeReaction, sendChatText, sendReaction } from '../send'
import { RelationshipDidRepository } from '../../vrc/repositories/RelationshipDidRepository'

const TARGET = '01JB3XKX6F8Q2W4E5R6T7Y8Z9V'

function makeAgent(options: { rceVersion?: number; sendFails?: boolean }) {
  const stored: ChatEventRecord[] = []
  const sent: ChatEventMessage[] = []
  const basic: { connectionId: string; text: string }[] = []
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
    findByQuery: async () => [],
  })
  singletons.set(EventEmitter, { emit: jest.fn() })
  singletons.set(DidCommMessageSender, {
    sendMessage: async (outbound: { message: ChatEventMessage }) => {
      if (options.sendFails) throw new Error('mediator unreachable')
      sent.push(outbound.message)
    },
  })
  singletons.set(RelationshipDidRepository, {
    findByConnectionDid: async () =>
      options.rceVersion === undefined ? null : { counterpartyRceVersion: options.rceVersion },
  })
  const agent = {
    context: {},
    config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
    dependencyManager: { container, resolve: container.resolve },
    modules: {
      didcomm: {
        connections: { getById: async (id: string) => ({ id, theirDid: 'did:peer:them', did: 'did:peer:me' }) },
        basicMessages: {
          sendMessage: async (connectionId: string, text: string) => {
            basic.push({ connectionId, text })
          },
        },
      },
    },
  }
  return { agent: agent as never, stored, sent, basic }
}

describe('sendChatText', () => {
  it('sends a chat event and stores it as sent, to a contact that speaks chat', async () => {
    const fake = makeAgent({ rceVersion: 6 })
    const outcome = await sendChatText(fake.agent, 'conn-1', 'hello', { inReplyTo: TARGET })
    expect(outcome.carriedAs).toBe('chat')
    expect(fake.sent).toHaveLength(1)
    const event = fake.sent[0].event as Record<string, unknown>
    expect(event).toMatchObject({
      type: 'message',
      content: { format: 'text/plain', text: 'hello' },
      inReplyTo: TARGET,
    })
    expect(isUlid(event.eventId)).toBe(true)
    expect(fake.stored).toHaveLength(1)
    expect(fake.stored[0]).toMatchObject({
      role: 'sent',
      eventType: 'message',
      eventId: event.eventId,
      inReplyTo: TARGET,
    })
    expect(fake.basic).toHaveLength(0)
  })

  it('falls back to a plain BasicMessage for a contact that does not speak chat, reply sent as its text', async () => {
    const fake = makeAgent({ rceVersion: 5 })
    const outcome = await sendChatText(fake.agent, 'conn-1', 'hello', { inReplyTo: TARGET })
    expect(outcome).toEqual({ carriedAs: 'basic' })
    expect(fake.basic).toEqual([{ connectionId: 'conn-1', text: 'hello' }])
    expect(fake.sent).toHaveLength(0)
    expect(fake.stored).toHaveLength(0)
  })

  it('stores nothing when the send fails', async () => {
    const fake = makeAgent({ rceVersion: 6, sendFails: true })
    await expect(sendChatText(fake.agent, 'conn-1', 'hello')).rejects.toThrow('mediator unreachable')
    expect(fake.stored).toHaveLength(0)
  })

  it('refuses empty text and a malformed reply target', async () => {
    const fake = makeAgent({ rceVersion: 6 })
    await expect(sendChatText(fake.agent, 'conn-1', '')).rejects.toThrow('empty')
    await expect(sendChatText(fake.agent, 'conn-1', 'hi', { inReplyTo: 'nope' })).rejects.toThrow('inReplyTo')
  })
})

describe('sendReaction and removeReaction', () => {
  it('send a reaction and a redaction to a contact that speaks chat', async () => {
    const fake = makeAgent({ rceVersion: 6 })
    const reacted = await sendReaction(fake.agent, 'conn-1', TARGET, '👍')
    expect(reacted.carriedAs).toBe('chat')
    const reactionId = (fake.sent[0].event as Record<string, unknown>).eventId as string
    expect(fake.sent[0].event).toMatchObject({ type: 'reaction', target: TARGET, emoji: '👍' })

    const removed = await removeReaction(fake.agent, 'conn-1', reactionId)
    expect(removed.carriedAs).toBe('chat')
    expect(fake.sent[1].event).toMatchObject({ type: 'redaction', target: reactionId })
    expect(fake.stored.map((r) => r.eventType)).toEqual(['reaction', 'redaction'])
  })

  it('send nothing to a contact without chat', async () => {
    const fake = makeAgent({ rceVersion: 5 })
    expect(await sendReaction(fake.agent, 'conn-1', TARGET, '👍')).toEqual({ carriedAs: 'not-sent' })
    expect(await removeReaction(fake.agent, 'conn-1', TARGET)).toEqual({ carriedAs: 'not-sent' })
    expect(fake.sent).toHaveLength(0)
    expect(fake.basic).toHaveLength(0)
  })
})
