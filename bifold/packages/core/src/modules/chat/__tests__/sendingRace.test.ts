import { DidCommMessageSender } from '@credo-ts/didcomm'
import { EventEmitter, InjectionSymbols } from '@credo-ts/core'

import { CHAT_PROFILE } from '../chatEvent'
import { receiveChatEventMessage } from '../inbound'
import type { ChatInboundVerdict } from '../inbound'
import { ChatEventMessage } from '../messages/ChatEventMessage'
import type { ChatEventRecord } from '../records/ChatEventRecord'
import { sendChatText } from '../send'
import { isBeingSent } from '../sending'
import { RelationshipDidRepository } from '../../vrc/repositories/RelationshipDidRepository'

// A sent event's record is stored only after its send succeeds. A peer that answers with the same eventId inside that
// window must still be refused: this agent delivers the peer's answer from inside the send itself.
function makeAgent(answer: (sentEventId: string) => Promise<void>) {
  const stored: ChatEventRecord[] = []
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
  singletons.set(DidCommMessageSender, {
    sendMessage: async (outbound: { message: ChatEventMessage }) => {
      await answer((outbound.message.event as { eventId: string }).eventId)
    },
  })
  singletons.set(RelationshipDidRepository, { findByConnectionDid: async () => ({ counterpartyRceVersion: 6 }) })
  const agent = {
    context: {},
    config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
    dependencyManager: { container, resolve: container.resolve },
    modules: {
      didcomm: {
        connections: { getById: async (id: string) => ({ id, theirDid: 'did:peer:them', did: 'did:peer:me' }) },
        basicMessages: { sendMessage: jest.fn() },
      },
    },
  }
  return { agent: agent as never, stored }
}

const connection = { id: 'conn-1', theirDid: 'did:peer:them', did: 'did:peer:me' }

describe('a peer answering with the eventId of a message still being sent', () => {
  it('is refused, though this phone’s record is not stored yet', async () => {
    let verdict: ChatInboundVerdict | undefined
    let storedWhenAnswered: number | undefined
    const fake = makeAgent(async (eventId) => {
      storedWhenAnswered = fake.stored.length
      const event = {
        profile: CHAT_PROFILE,
        type: 'message',
        eventId,
        content: { format: 'text/plain', text: 'x' },
        expiresIn: 3600,
      }
      verdict = await receiveChatEventMessage(fake.agent, {
        message: new ChatEventMessage({ event: event as never }),
        connection,
        senderKey: {},
      } as never)
    })
    await sendChatText(fake.agent, 'conn-1', 'hello')
    expect(storedWhenAnswered).toBe(0)
    expect(verdict).toBe('reused-event-id')
    expect(fake.stored.map((r) => r.role)).toEqual(['sent'])
  })

  it('stops counting as being sent once the send settles, whether it succeeded or failed', async () => {
    let sentId = ''
    const ok = makeAgent(async (eventId) => {
      sentId = eventId
    })
    await sendChatText(ok.agent, 'conn-1', 'hello')
    expect(isBeingSent('conn-1', sentId)).toBe(false)
    const failing = makeAgent(async (eventId) => {
      sentId = eventId
      throw new Error('mediator unreachable')
    })
    await expect(sendChatText(failing.agent, 'conn-1', 'hello')).rejects.toThrow('mediator unreachable')
    expect(isBeingSent('conn-1', sentId)).toBe(false)
  })
})
