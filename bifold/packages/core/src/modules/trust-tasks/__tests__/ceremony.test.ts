/**
 * Ceremony tests — milestone 2, first slice: the capability-gated recast of
 * the relationship handshake onto vrc/relationships/propose. Old peers (< v4)
 * must never see a Trust Task message; v4 pairs must converge on the same
 * repository state the legacy dance writes.
 */
import { DidCommMessageSender, DidCommMessageHandlerRegistry } from '@credo-ts/didcomm'
import { InjectionSymbols, EventEmitter } from '@credo-ts/core'
import * as discovery from '@openvtc/trust-tasks/trust-task-discovery/0.1/payload'
import * as propose from '@openvtc/trust-tasks/vrc/relationships/propose/0.1/payload'
import * as witnessSession from '@openvtc/trust-tasks/witness/session/0.1/payload'

import {
  getTrustTasksService,
  maybeOpenRelationshipExchange,
  respondToRelationshipProposal,
  resumeInterruptedExchanges,
  setupTrustTasksInbound,
  isDeterministicProposer,
  queryWitnessDiscovery,
  getWitnessLocalityRequirement,
  TRUST_TASKS_MIN_RCE_VERSION,
} from '../ceremony'
import { LOCALITY_EXT_NAMESPACE } from '../deviceLocality'
import { vrcFlowStore } from '../../vrc/witnessStatusStore'
import { TrustTaskMessage } from '../messages/TrustTaskMessage'
import { RelationshipDidRepository } from '../../vrc/repositories/RelationshipDidRepository'

jest.mock('../../vrc/vrc-manager', () => ({
  RCE_PROTOCOL_VERSION: 4,
  getOrCreateRelationshipDid: jest.fn(async () => 'did:peer:my-rel'),
  getConnectedWitnessConnectionId: jest.fn(() => undefined),
  issueRCardForAcceptedExchange: jest.fn(async () => undefined),
}))

// ---- a minimal fake agent ---------------------------------------------------

function makeFakeAgent(options: { myDid: string; theirDid: string; connectionId?: string }) {
  const connectionId = options.connectionId ?? 'conn-1'
  const stored: unknown[] = []
  const sentMessages: TrustTaskMessage[] = []
  const relationshipDidRecords: { connectionId?: string; counterpartyRceVersion?: number }[] = []
  const relationshipRepo = {
    updateCounterpartyRelationshipDid: jest.fn(async () => null),
    getAll: jest.fn(async () => relationshipDidRecords),
  }
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
  return {
    agent: agent as never,
    sentMessages,
    relationshipRepo,
    relationshipDidRecords,
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

  test('the proposer negotiates via discovery, then proposes exactly once', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    setupTrustTasksInbound(fake.agent)
    await maybeOpenRelationshipExchange(fake.agent, 'conn-1', 4, 4)
    await maybeOpenRelationshipExchange(fake.agent, 'conn-1', 4, 4)

    // capability negotiation first — no propose until the peer confirms support
    expect(fake.sentMessages).toHaveLength(1)
    const query = fake.sentMessages[0].document as { type: string; payload: { patterns: string[] } }
    expect(query.type).toBe(discovery.TYPE_URI)
    expect(query.payload.patterns).toContain('vrc/relationships/*')

    await deliver(fake.capturedHandlerRef, {
      id: 'dddd1111-0000-4000-8000-00000000000d',
      type: `${discovery.TYPE_URI}#response`,
      threadId: String((query as unknown as { threadId: string }).threadId ?? 'dddd'),
      issuer: 'did:peer:4zzz',
      recipient: 'did:peer:4aaa',
      issuedAt: new Date().toISOString(),
      payload: { supportedTypes: [propose.TYPE_URI] },
    }, { id: 'conn-1', did: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })

    expect(fake.sentMessages).toHaveLength(2)
    const doc = fake.sentMessages[1].document as { type: string; payload: { relationshipDid: string } }
    expect(doc.type).toBe(propose.TYPE_URI)
    expect(doc.payload.relationshipDid).toBe('did:peer:my-rel')
  })

  test('a peer whose supportedTypes omit the propose never receives one', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    setupTrustTasksInbound(fake.agent)
    await maybeOpenRelationshipExchange(fake.agent, 'conn-1', 4, 4)
    await deliver(fake.capturedHandlerRef, {
      id: 'dddd2222-0000-4000-8000-00000000000d',
      type: `${discovery.TYPE_URI}#response`,
      threadId: 'dddd2222-0000-4000-8000-00000000000d',
      issuer: 'did:peer:4zzz',
      recipient: 'did:peer:4aaa',
      issuedAt: new Date().toISOString(),
      payload: { supportedTypes: ['https://trusttasks.org/spec/chat/message/0.1'] },
    }, { id: 'conn-1', did: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })

    expect(fake.sentMessages).toHaveLength(1) // the discovery query only
  })

  test('an inbound discovery is answered with our supported types, pattern-filtered', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4me', theirDid: 'did:peer:4peer' })
    setupTrustTasksInbound(fake.agent)
    await deliver(fake.capturedHandlerRef, {
      id: 'dddd3333-0000-4000-8000-00000000000d',
      type: discovery.TYPE_URI,
      threadId: 'dddd3333-0000-4000-8000-00000000000d',
      issuer: 'did:peer:4peer',
      recipient: 'did:peer:4me',
      issuedAt: new Date().toISOString(),
      payload: { patterns: ['vrc/relationships/propose'] },
    }, { id: fake.connectionId, did: 'did:peer:4me', theirDid: 'did:peer:4peer' })

    expect(fake.sentMessages).toHaveLength(1)
    const response = fake.sentMessages[0].document as { type: string; payload: { supportedTypes: string[] } }
    expect(response.type).toBe(`${discovery.TYPE_URI}#response`)
    expect(response.payload.supportedTypes).toEqual([propose.TYPE_URI])
  })
})

describe('witness discovery (locality-plan.md §10.3 item 8)', () => {
  test('queryWitnessDiscovery sends a discovery query on the witness connection, patterns including witness/*', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4me', theirDid: 'did:peer:4witness' })
    setupTrustTasksInbound(fake.agent)

    await queryWitnessDiscovery(fake.agent, fake.connectionId)

    expect(fake.sentMessages).toHaveLength(1)
    const query = fake.sentMessages[0].document as { type: string; payload: { patterns: string[] } }
    expect(query.type).toBe(discovery.TYPE_URI)
    expect(query.payload.patterns).toContain('witness/*')
  })

  test('getWitnessLocalityRequirement is null before any discovery answer has arrived', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4me', theirDid: 'did:peer:4witness' })
    setupTrustTasksInbound(fake.agent)

    await expect(getWitnessLocalityRequirement(fake.agent, fake.connectionId)).resolves.toBeNull()
  })

  test('getWitnessLocalityRequirement is true when the witness/session row lists requiredExt for the locality namespace', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4me', theirDid: 'did:peer:4witness' })
    setupTrustTasksInbound(fake.agent)
    await queryWitnessDiscovery(fake.agent, fake.connectionId)

    await deliver(
      fake.capturedHandlerRef,
      {
        id: 'eeee1111-0000-4000-8000-00000000000e',
        type: `${discovery.TYPE_URI}#response`,
        threadId: 'eeee1111-0000-4000-8000-00000000000e',
        issuer: 'did:peer:4witness',
        recipient: 'did:peer:4me',
        issuedAt: new Date().toISOString(),
        payload: {
          supportedTypes: [{ type: witnessSession.TYPE_URI, requiredExt: [LOCALITY_EXT_NAMESPACE] }],
        },
      },
      { id: fake.connectionId, did: 'did:peer:4me', theirDid: 'did:peer:4witness' }
    )

    await expect(getWitnessLocalityRequirement(fake.agent, fake.connectionId)).resolves.toBe(true)
  })

  test('getWitnessLocalityRequirement is false when witness/session is supported but not marked as requiring locality', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4me', theirDid: 'did:peer:4witness' })
    setupTrustTasksInbound(fake.agent)
    await queryWitnessDiscovery(fake.agent, fake.connectionId)

    await deliver(
      fake.capturedHandlerRef,
      {
        id: 'eeee2222-0000-4000-8000-00000000000e',
        type: `${discovery.TYPE_URI}#response`,
        threadId: 'eeee2222-0000-4000-8000-00000000000e',
        issuer: 'did:peer:4witness',
        recipient: 'did:peer:4me',
        issuedAt: new Date().toISOString(),
        payload: { supportedTypes: [witnessSession.TYPE_URI] },
      },
      { id: fake.connectionId, did: 'did:peer:4me', theirDid: 'did:peer:4witness' }
    )

    await expect(getWitnessLocalityRequirement(fake.agent, fake.connectionId)).resolves.toBe(false)
  })
})

describe('inbound routing', () => {
  test('an inbound propose awaits user consent; acceptance stores the DID and replies', async () => {
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

    // Consent gate: nothing on the wire until the user answers.
    expect(fake.sentMessages).toHaveLength(0)
    expect(fake.relationshipRepo.updateCounterpartyRelationshipDid).not.toHaveBeenCalled()

    await respondToRelationshipProposal(fake.agent, fake.connectionId, true)

    expect(fake.relationshipRepo.updateCounterpartyRelationshipDid).toHaveBeenCalledWith(
      expect.anything(),
      'did:peer:4peer',
      'did:peer:peer-rel',
      TRUST_TASKS_MIN_RCE_VERSION
    )
    const response = fake.sentMessages[0].document as { type: string; payload: { accept: boolean; relationshipDid: string } }
    expect(response.type).toBe(`${propose.TYPE_URI}#response`)
    expect(response.payload.accept).toBe(true)
    expect(response.payload.relationshipDid).toBe('did:peer:my-rel')
    vrcFlowStore.clearFlow(fake.connectionId)
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

describe('resuming an exchange interrupted by a restart', () => {
  /** A fake agent with the module registered, as real agent setup leaves it. */
  const makeRestartedAgent = () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    setupTrustTasksInbound(fake.agent)
    return fake
  }

  /**
   * Retain the peer's discovery answer directly, bypassing the inbound handler
   * — exactly the state a kill leaves behind when the answer was already
   * processed but the propose never made it out. These tests never deliver()
   * anything, so the registered handler stays dormant.
   */
  const retainPeerAnswer = async (fake: ReturnType<typeof makeFakeAgent>, theirDid: string, myDid: string) => {
    const service = getTrustTasksService(fake.agent)
    await service.retain(
      (fake.agent as unknown as { context: unknown }).context as never,
      {
        id: 'eeee1111-0000-4000-8000-00000000000e',
        type: `${discovery.TYPE_URI}#response`,
        threadId: 'eeee1111-0000-4000-8000-00000000000e',
        issuer: theirDid,
        recipient: myDid,
        issuedAt: new Date().toISOString(),
        payload: { supportedTypes: [propose.TYPE_URI] },
      } as never,
      'response',
      fake.connectionId
    )
  }

  test('the propose is sent from the retained answer, not lost forever', async () => {
    const fake = makeRestartedAgent()

    // Pre-kill: our discovery query went out.
    await maybeOpenRelationshipExchange(fake.agent, 'conn-1', 4, 4)
    expect(fake.sentMessages).toHaveLength(1)
    expect((fake.sentMessages[0].document as { type: string }).type).toBe(discovery.TYPE_URI)

    // ...and the peer's answer was processed, but no propose was sent.
    await retainPeerAnswer(fake, 'did:peer:4zzz', 'did:peer:4aaa')

    // Post-restart sweep. Without the resume branch this sends nothing:
    // sendDiscoveryQuery no-ops on our retained query and openRelationshipExchange
    // is unreachable, so the connection stays wedged at 'connecting'.
    fake.relationshipDidRecords.push({ connectionId: 'conn-1', counterpartyRceVersion: 4 })
    await resumeInterruptedExchanges(fake.agent)

    expect(fake.sentMessages).toHaveLength(2)
    const doc = fake.sentMessages[1].document as { type: string; payload: { relationshipDid: string } }
    expect(doc.type).toBe(propose.TYPE_URI)
    expect(doc.payload.relationshipDid).toBe('did:peer:my-rel')
  })

  test('the sweep is idempotent — a second pass proposes nothing more', async () => {
    const fake = makeRestartedAgent()
    await maybeOpenRelationshipExchange(fake.agent, 'conn-1', 4, 4)
    await retainPeerAnswer(fake, 'did:peer:4zzz', 'did:peer:4aaa')
    fake.relationshipDidRecords.push({ connectionId: 'conn-1', counterpartyRceVersion: 4 })

    await resumeInterruptedExchanges(fake.agent)
    await resumeInterruptedExchanges(fake.agent)

    // discovery + exactly one propose
    expect(fake.sentMessages).toHaveLength(2)
    expect(fake.sentMessages.filter((m) => (m.document as { type: string }).type === propose.TYPE_URI)).toHaveLength(1)
  })

  test('a sub-v4 peer is never swept', async () => {
    const fake = makeRestartedAgent()
    fake.relationshipDidRecords.push({ connectionId: 'conn-1', counterpartyRceVersion: 3 })
    await resumeInterruptedExchanges(fake.agent)
    expect(fake.sentMessages).toHaveLength(0)
  })

  test('a record with no announced version is never swept', async () => {
    const fake = makeRestartedAgent()
    fake.relationshipDidRecords.push({ connectionId: 'conn-1' })
    await resumeInterruptedExchanges(fake.agent)
    expect(fake.sentMessages).toHaveLength(0)
  })

  test('with no answer retained the sweep re-queries rather than proposing blind', async () => {
    const fake = makeRestartedAgent()
    // Nothing sent pre-kill at all: the sweep should open with discovery.
    fake.relationshipDidRecords.push({ connectionId: 'conn-1', counterpartyRceVersion: 4 })
    await resumeInterruptedExchanges(fake.agent)

    expect(fake.sentMessages).toHaveLength(1)
    expect((fake.sentMessages[0].document as { type: string }).type).toBe(discovery.TYPE_URI)
  })
})
