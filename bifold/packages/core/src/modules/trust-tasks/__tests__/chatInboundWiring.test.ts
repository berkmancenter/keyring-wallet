/**
 * setupTrustTasksInbound must register the keyring/chat/1.0 handler.
 *
 * The other ceremony fakes keep only the last registered handler, so they
 * cannot see the chat registration at all. This one collects every
 * registration, so deleting the setupChatInbound call fails here.
 */
import { DidCommMessageHandlerRegistry, DidCommProblemReportMessage } from '@credo-ts/didcomm'
import { EventEmitter, InjectionSymbols } from '@credo-ts/core'

import { setupTrustTasksInbound } from '../ceremony'
import { ChatCapabilityMessage } from '../../chat/messages/ChatCapabilityMessage'
import { ChatEventMessage } from '../../chat/messages/ChatEventMessage'
import { TrustTaskMessage } from '../messages/TrustTaskMessage'

jest.mock('../../vrc/vrc-manager', () => ({
  RCE_PROTOCOL_VERSION: 4,
  getOrCreateRelationshipDid: jest.fn(async () => 'did:peer:my-rel'),
  getConnectedWitnessConnectionId: jest.fn(() => undefined),
  issueRCardForAcceptedExchange: jest.fn(async () => undefined),
}))

function makeCollectingAgent() {
  const registered: { supportedMessages: unknown[] }[] = []
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
  singletons.set(InjectionSymbols.StorageService, { save: jest.fn(), findByQuery: jest.fn(async () => []) })
  singletons.set(EventEmitter, { emit: jest.fn() })
  singletons.set(DidCommMessageHandlerRegistry, {
    registerMessageHandler: (handler: { supportedMessages: unknown[] }) => {
      registered.push(handler)
    },
  })
  const agent = {
    context: {},
    config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
    dependencyManager: { container, resolve: container.resolve },
  }
  return { agent: agent as never, registered }
}

describe('setupTrustTasksInbound wiring', () => {
  it('registers the chat event handler alongside the Trust Task carriages', () => {
    const { agent, registered } = makeCollectingAgent()
    setupTrustTasksInbound(agent)

    const supported = registered.flatMap((handler) => handler.supportedMessages)
    expect(supported).toContain(ChatEventMessage)
    expect(supported).toContain(TrustTaskMessage)
  })

  it('registers the capability notice and the generic problem report handlers with chat', () => {
    const { agent, registered } = makeCollectingAgent()
    setupTrustTasksInbound(agent)

    const supported = registered.flatMap((handler) => handler.supportedMessages)
    expect(supported).toContain(ChatCapabilityMessage)
    expect(supported).toContain(DidCommProblemReportMessage)
    const v1Index = registered.findIndex((handler) => handler.supportedMessages.includes(TrustTaskMessage))
    const noticeIndex = registered.findIndex((handler) => handler.supportedMessages.includes(ChatCapabilityMessage))
    expect(noticeIndex).toBeLessThan(v1Index)
  })

  it('registers chat before the v1 carriage, so last-handler fakes keep exercising v1', () => {
    const { agent, registered } = makeCollectingAgent()
    setupTrustTasksInbound(agent)

    const chatIndex = registered.findIndex((handler) => handler.supportedMessages.includes(ChatEventMessage))
    const v1Index = registered.findIndex((handler) => handler.supportedMessages.includes(TrustTaskMessage))
    expect(chatIndex).toBeGreaterThanOrEqual(0)
    expect(chatIndex).toBeLessThan(v1Index)
    expect(registered[registered.length - 1].supportedMessages).toContain(TrustTaskMessage)
  })
})
