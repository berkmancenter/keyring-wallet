/**
 * Ceremony tests — milestone 2, first slice: the capability-gated recast of
 * the relationship handshake onto vrc/relationships/propose. Old peers (< v4)
 * must never see a Trust Task message; v4 pairs must converge on the same
 * repository state the legacy dance writes.
 */
import { DidCommMessageSender, DidCommMessageHandlerRegistry } from '@credo-ts/didcomm'
import { InjectionSymbols, EventEmitter } from '@credo-ts/core'
import * as propose from '@openvtc/trust-tasks/vrc/relationships/propose/0.1/payload'

import {
  maybeOpenRelationshipExchange,
  setupTrustTasksInbound,
  isDeterministicProposer,
  TRUST_TASKS_MIN_RCE_VERSION,
} from '../ceremony'
import { TrustTaskMessage } from '../messages/TrustTaskMessage'
import { RelationshipDidRepository } from '../../vrc/repositories/RelationshipDidRepository'

jest.mock('../../vrc/vrc-manager', () => ({
  getOrCreateRelationshipDid: jest.fn(async () => 'did:peer:my-rel'),
}))

// ---- a minimal fake agent ---------------------------------------------------

function makeFakeAgent(options: { myDid: string; theirDid: string; connectionId?: string }) {
  const connectionId = options.connectionId ?? 'conn-1'
  const stored: unknown[] = []
  const sentMessages: TrustTaskMessage[] = []
  const relationshipRepo = { updateCounterpartyRelationshipDid: jest.fn(async () => null) }
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

  // Pre-register the primitives the module's factories resolve.
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
  singletons.set(RelationshipDidRepository, relationshipRepo)
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
      // TrustTasksModule.register receives the dependencyManager itself
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
  // Module.register(dependencyManager) accesses dependencyManager.container
  return { agent: agent as never, sentMessages, relationshipRepo, connectionId, capturedHandlerRef: () => capturedHandler }
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

describe('the capability gate', () => {
  test('a v3 peer never receives a Trust Task message', async () => {
    const { agent, sentMessages } = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    await maybeOpenRelationshipExchange(agent, 'conn-1', 3, TRUST_TASKS_MIN_RCE_VERSION)
    expect(sentMessages).toHaveLength(0)
  })

  test('only the deterministic proposer opens the exchange', async () => {
    // myDid sorts HIGHER → not the proposer.
    const { agent, sentMessages } = makeFakeAgent({ myDid: 'did:peer:4zzz', theirDid: 'did:peer:4aaa' })
    await maybeOpenRelationshipExchange(agent, 'conn-1', 4, 4)
    expect(sentMessages).toHaveLength(0)
    expect(isDeterministicProposer('did:peer:4aaa', 'did:peer:4zzz')).toBe(true)
    expect(isDeterministicProposer('did:peer:4zzz', 'did:peer:4aaa')).toBe(false)
  })

  test('the proposer sends propose exactly once (idempotent per connection)', async () => {
    const { agent, sentMessages } = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    await maybeOpenRelationshipExchange(agent, 'conn-1', 4, 4)
    await maybeOpenRelationshipExchange(agent, 'conn-1', 4, 4)
    expect(sentMessages).toHaveLength(1)
    const doc = sentMessages[0].document as { type: string; payload: { relationshipDid: string } }
    expect(doc.type).toBe(propose.TYPE_URI)
    expect(doc.payload.relationshipDid).toBe('did:peer:my-rel')
  })
})

describe('inbound routing', () => {
  test('an inbound propose stores the counterparty relationship DID and replies with acceptance', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4me', theirDid: 'did:peer:4peer' })
    setupTrustTasksInbound(fake.agent)

    await deliver(fake.capturedHandlerRef, {
      id: 'aaaa1111-1111-4111-8111-111111111111',
      type: propose.TYPE_URI,
      threadId: 'aaaa1111-1111-4111-8111-111111111111',
      issuer: 'did:peer:4peer',
      recipient: 'did:peer:4me',
      issuedAt: new Date().toISOString(),
      payload: { relationshipDid: 'did:peer:peer-rel', witnessed: false },
    }, { id: fake.connectionId, did: 'did:peer:4me', theirDid: 'did:peer:4peer' })

    expect(fake.relationshipRepo.updateCounterpartyRelationshipDid).toHaveBeenCalledWith(
      expect.anything(),
      'did:peer:4peer',
      'did:peer:peer-rel',
      TRUST_TASKS_MIN_RCE_VERSION
    )
    expect(fake.sentMessages).toHaveLength(1)
    const response = fake.sentMessages[0].document as { type: string; payload: { accept: boolean; relationshipDid: string } }
    expect(response.type).toBe(`${propose.TYPE_URI}#response`)
    expect(response.payload.accept).toBe(true)
    expect(response.payload.relationshipDid).toBe('did:peer:my-rel')
  })

  test('an inbound propose#response stores the counterparty relationship DID (proposer side closes)', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4me', theirDid: 'did:peer:4peer' })
    setupTrustTasksInbound(fake.agent)

    await deliver(fake.capturedHandlerRef, {
      id: 'aaaa1111-0000-4000-8000-00000000000a',
      type: `${propose.TYPE_URI}#response`,
      threadId: 'aaaa1111-1111-4111-8111-111111111111',
      issuer: 'did:peer:4peer',
      recipient: 'did:peer:4me',
      issuedAt: new Date().toISOString(),
      payload: { accept: true, relationshipDid: 'did:peer:peer-rel' },
    }, { id: fake.connectionId, did: 'did:peer:4me', theirDid: 'did:peer:4peer' })

    expect(fake.relationshipRepo.updateCounterpartyRelationshipDid).toHaveBeenCalledWith(
      expect.anything(),
      'did:peer:4peer',
      'did:peer:peer-rel',
      TRUST_TASKS_MIN_RCE_VERSION
    )
    expect(fake.sentMessages).toHaveLength(0)
  })

  test('a connection-less arrival (case 2) is retained but never acted on', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4me', theirDid: 'did:peer:4peer' })
    setupTrustTasksInbound(fake.agent)

    await deliver(fake.capturedHandlerRef, {
      id: 'aaaa1111-1111-4111-8111-111111111111',
      type: propose.TYPE_URI,
      threadId: 'aaaa1111-1111-4111-8111-111111111111',
      issuer: 'did:peer:4peer',
      recipient: 'did:peer:4me',
      issuedAt: new Date().toISOString(),
      payload: { relationshipDid: 'did:peer:mallory-rel', witnessed: false },
    }, undefined)

    expect(fake.relationshipRepo.updateCounterpartyRelationshipDid).not.toHaveBeenCalled()
    expect(fake.sentMessages).toHaveLength(0)
  })
})
