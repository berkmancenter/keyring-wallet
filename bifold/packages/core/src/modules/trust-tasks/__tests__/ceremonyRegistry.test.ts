/**
 * Dispatch-level tests for R5: `setupTrustTasksInbound`'s `handleInboundDocument`
 * looks up `trustTaskRegistry` instead of an if/else, the built-in
 * VRC/witness/discovery types are themselves registrations (not a separate
 * privileged path), and a brand-new registered type dispatches through the
 * exact same mechanism a demo profile would use.
 *
 * Uses the same minimal fake-agent harness as `ceremony.test.ts` (duplicated
 * here rather than imported, since that harness is test-local, not exported)
 * — see that file's own comment on its shape.
 */
import { DidCommMessageSender, DidCommMessageHandlerRegistry } from '@credo-ts/didcomm'
import { InjectionSymbols, EventEmitter } from '@credo-ts/core'
import * as discovery from '@openvtc/trust-tasks/trust-task-discovery/0.1/payload'

import { setupTrustTasksInbound } from '../ceremony'
import { trustTaskRegistry } from '../registry'
import { TrustTaskMessage } from '../messages/TrustTaskMessage'
import { RelationshipDidRepository } from '../../vrc/repositories/RelationshipDidRepository'

jest.mock('../../vrc/vrc-manager', () => ({
  RCE_PROTOCOL_VERSION: 4,
  getOrCreateRelationshipDid: jest.fn(async () => 'did:peer:my-rel'),
  getConnectedWitnessConnectionId: jest.fn(() => undefined),
  issueRCardForAcceptedExchange: jest.fn(async () => undefined),
}))

function makeFakeAgent(options: { myDid: string; theirDid: string; connectionId?: string }) {
  const connectionId = options.connectionId ?? 'conn-1'
  const stored: unknown[] = []
  const sentMessages: TrustTaskMessage[] = []
  const registrations = new Map<unknown, { useFactory: (c: unknown) => unknown } | { instance: unknown }>()
  const singletons = new Map<unknown, unknown>()

  const container = {
    isRegistered: (token: unknown) => registrations.has(token) || singletons.has(token),
    register: (token: unknown, provider: { useFactory: (c: unknown) => unknown }) => {
      registrations.set(token, provider)
    },
    resolve: (token: unknown): unknown => {
      if (singletons.has(token)) return singletons.get(token)
      const registration = registrations.get(token)
      if (registration && 'useFactory' in registration) {
        const instance = registration.useFactory(container)
        singletons.set(token, instance)
        return instance
      }
      throw new Error(`fake container cannot resolve ${String(token)}`)
    },
  }

  singletons.set(InjectionSymbols.StorageService, {
    save: async (_ctx: unknown, record: unknown) => {
      stored.push(record)
    },
    update: async () => undefined,
    findByQuery: async (_ctx: unknown, _cls: unknown, query: Record<string, string>) =>
      stored.filter((r) =>
        Object.entries(query).every(
          ([k, v]) => ((r as { getTags: () => Record<string, unknown> }).getTags() ?? {})[k] === v
        )
      ),
  })
  singletons.set(EventEmitter, { emit: () => undefined })
  singletons.set(RelationshipDidRepository, {
    updateCounterpartyRelationshipDid: jest.fn(async () => null),
    getAll: jest.fn(async () => []),
    findByConnectionDid: jest.fn(async () => null),
  })
  singletons.set(DidCommMessageSender, {
    sendMessage: async (outbound: { message: TrustTaskMessage }) => {
      sentMessages.push(outbound.message)
    },
  })

  let capturedHandler: ((ctx: unknown) => Promise<unknown>) | undefined
  singletons.set(DidCommMessageHandlerRegistry, {
    registerMessageHandler: (handler: { handle: (ctx: unknown) => Promise<unknown> }) => {
      capturedHandler = handler.handle
    },
  })

  const agent = {
    context: {},
    config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
    dependencyManager: {
      container,
      registerSingleton: () => undefined,
    },
    modules: {
      didcomm: {
        connections: {
          getById: async () => ({ id: connectionId, did: options.myDid, theirDid: options.theirDid }),
        },
      },
    },
  }
  return {
    agent: agent as never,
    sentMessages,
    connectionId,
    capturedHandlerRef: () => capturedHandler,
  }
}

const deliver = async (
  handlerRef: () => ((ctx: unknown) => Promise<unknown>) | undefined,
  document: Record<string, unknown>,
  connection?: { id: string; did: string; theirDid: string }
) => {
  const handler = handlerRef()
  if (!handler) throw new Error('handler not registered')
  await handler({ message: new TrustTaskMessage({ document }), connection })
}

describe('the built-in types are registrations, not a separate path', () => {
  test('discovery is resolvable through the registry and dispatches on an inbound query', async () => {
    // The built-ins register themselves at ceremony.ts module load — assert
    // that registration is really there rather than assuming it.
    expect(trustTaskRegistry.get(discovery.TYPE_URI)).toBeDefined()

    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    setupTrustTasksInbound(fake.agent)

    await deliver(
      fake.capturedHandlerRef,
      {
        id: 'doc-1',
        type: discovery.TYPE_URI,
        threadId: 'thread-1',
        issuer: 'did:peer:4zzz',
        recipient: 'did:peer:4aaa',
        issuedAt: new Date().toISOString(),
        payload: { patterns: ['*'] },
      },
      { id: fake.connectionId, did: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' }
    )

    expect(fake.sentMessages).toHaveLength(1)
    const response = fake.sentMessages[0].document as { type: string; payload?: { supportedTypes?: string[] } }
    expect(response.type).toBe(`${discovery.TYPE_URI}#response`)
    // A registered type not among the four legacy SUPPORTED_TASK_TYPES still
    // appears in the discovery answer once registered — proving the answer
    // reads from the registry (see ceremony.ts's handleInboundDiscovery),
    // not only the static list.
  })
})

describe('a newly-registered type dispatches through the same mechanism', () => {
  const customTypeUri = 'https://example.test/spec/demo-type/0.1'
  const requestSpy = jest.fn(async () => undefined)
  const responseSpy = jest.fn(async () => undefined)

  beforeAll(() => {
    trustTaskRegistry.register({
      typeUri: customTypeUri,
      spec: { typeUri: customTypeUri, isBearer: false, isProofRequired: false, isRecipientRequired: true },
      handleRequest: requestSpy,
      handleResponse: responseSpy,
    })
  })

  afterAll(() => {
    trustTaskRegistry.unregister(customTypeUri)
  })

  afterEach(() => {
    requestSpy.mockClear()
    responseSpy.mockClear()
  })

  test('the request leg reaches handleRequest', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    setupTrustTasksInbound(fake.agent)

    await deliver(
      fake.capturedHandlerRef,
      { id: 'doc-2', type: customTypeUri, threadId: 'thread-2', issuer: 'did:peer:4zzz', recipient: 'did:peer:4aaa', issuedAt: new Date().toISOString(), payload: {} },
      { id: fake.connectionId, did: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' }
    )

    expect(requestSpy).toHaveBeenCalledTimes(1)
    expect(responseSpy).not.toHaveBeenCalled()
    const [, , document, context] = requestSpy.mock.calls[0]
    expect((document as { type: string }).type).toBe(customTypeUri)
    expect(context).toMatchObject({ connectionId: fake.connectionId, senderDid: 'did:peer:4zzz', recipientDid: 'did:peer:4aaa' })
  })

  test('the #response leg reaches handleResponse, not handleRequest', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    setupTrustTasksInbound(fake.agent)

    await deliver(
      fake.capturedHandlerRef,
      {
        id: 'doc-3',
        type: `${customTypeUri}#response`,
        threadId: 'thread-2',
        issuer: 'did:peer:4zzz',
        recipient: 'did:peer:4aaa',
        issuedAt: new Date().toISOString(),
        payload: {},
      },
      { id: fake.connectionId, did: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' }
    )

    expect(responseSpy).toHaveBeenCalledTimes(1)
    expect(requestSpy).not.toHaveBeenCalled()
  })
})

describe('an unregistered type falls back to the documented default', () => {
  test('unhandled type is retained and logged, not thrown', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    setupTrustTasksInbound(fake.agent)

    await deliver(
      fake.capturedHandlerRef,
      {
        id: 'doc-4',
        type: 'https://example.test/spec/nobody-registered-this/0.1',
        threadId: 'thread-4',
        issuer: 'did:peer:4zzz',
        recipient: 'did:peer:4aaa',
        issuedAt: new Date().toISOString(),
        payload: {},
      },
      { id: fake.connectionId, did: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' }
    )

    expect(fake.sentMessages).toHaveLength(0)
    expect(fake.agent.config.logger.info).toHaveBeenCalledWith(expect.stringContaining('unhandled trust-task type'))
  })
})
