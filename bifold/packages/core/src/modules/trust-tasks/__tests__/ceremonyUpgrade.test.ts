/**
 * Upgrading an existing relationship in place: on the connection the two
 * phones already exchanged on, either person may ask to sign the cards again
 * (with secure hardware now, or with a witness), and the other must consent.
 * The relationship DIDs are the stored ones — an upgrade never introduces a
 * new identifier, and a propose or response naming another is refused. The
 * automatic first exchange stays exactly once per connection (restart
 * recovery depends on it); the issue and witness-share guards are once per
 * EXCHANGE. No profile (R-Card) is re-sent on an upgrade, and the initiator
 * may cancel a pending one locally.
 */
import { DidCommMessageSender, DidCommMessageHandlerRegistry } from '@credo-ts/didcomm'
import { InjectionSymbols, EventEmitter } from '@credo-ts/core'
import * as issue from '@openvtc/trust-tasks/vrc/relationships/issue/0.1/payload'
import * as discovery from '@openvtc/trust-tasks/trust-task-discovery/0.1/payload'
import * as propose from '@openvtc/trust-tasks/vrc/relationships/propose/0.1/payload'

import {
  cancelRelationshipUpgrade,
  deliverVrcViaTrustTaskForExchange,
  maybeOpenRelationshipExchange,
  pendingUpgradeOf,
  priorForExchange,
  respondToRelationshipProposal,
  setupTrustTasksInbound,
  upgradeRelationship,
} from '../ceremony'
import { extendedCode } from '../services/TrustTasksService'
import { TrustTaskMessage } from '../messages/TrustTaskMessage'
import { RelationshipDidRepository } from '../../vrc/repositories/RelationshipDidRepository'
import { vrcFlowStore } from '../../vrc/witnessStatusStore'

const UNSIGNED_VRC = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
  issuer: 'did:peer:0zMyRel',
  credentialSubject: { id: 'did:peer:0zPeerRel' },
}
const SIGNED_VRC = {
  ...UNSIGNED_VRC,
  proof: {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-rdfc-2022',
    created: '2026-08-18T00:00:00Z',
    verificationMethod: 'did:peer:0zPeerRel#key-1',
    proofPurpose: 'assertionMethod',
    proofValue: 'zsig',
  },
}

jest.mock('../../vrc/vrc-manager', () => ({
  RCE_PROTOCOL_VERSION: 4,
  getOrCreateRelationshipDid: jest.fn(async () => 'did:peer:0zMyRel'),
  getConnectedWitnessConnectionId: jest.fn(() => undefined),
  isWitnessingPreferred: jest.fn(async () => true),
  issueRCardForAcceptedExchange: jest.fn(async () => undefined),
  prepareVrcCredentialWithEvidence: jest.fn(async () => ({ credential: UNSIGNED_VRC, biometricSkipped: false })),
  getVrcJsonLdProofOptions: jest.fn(async () => ({ proofType: 'DataIntegrityProof', cryptosuite: 'eddsa-rdfc-2022' })),
}))

const STUB_PROOF = {
  type: 'DataIntegrityProof',
  cryptosuite: 'eddsa-jcs-2022',
  created: '2026-08-18T00:00:00Z',
  verificationMethod: 'did:peer:0zMyRel#key-1',
  proofPurpose: 'assertionMethod',
  proofValue: 'zStubForPipelineShapeOnly',
}

jest.mock('../documentProof', () => ({
  ...jest.requireActual('../documentProof'),
  signDocumentProof: jest.fn(async (_agent: unknown, document: Record<string, unknown>) => ({
    ...document,
    proof: STUB_PROOF,
  })),
  verifyDocumentProof: jest.fn(async () => true),
}))

// ---- a minimal fake agent (extended for the authority flip) -----------------

function makeFakeAgent(options: {
  myDid: string
  theirDid: string
  relationshipRecord?: { myRelationshipDid?: string; counterpartyRelationshipDid?: string } | null
  credentialProofValid?: boolean
}) {
  const connectionId = 'conn-1'
  const stored: unknown[] = []
  const sentMessages: TrustTaskMessage[] = []
  const storedCredentials: unknown[] = []
  const genericRecords: { content: unknown; tags: Record<string, string> }[] = []
  const relationshipRepo = {
    updateCounterpartyRelationshipDid: jest.fn(async () => null),
    findByConnectionDid: jest.fn(async () =>
      options.relationshipRecord === undefined
        ? { myRelationshipDid: 'did:peer:0zMyRel', counterpartyRelationshipDid: 'did:peer:0zPeerRel' }
        : options.relationshipRecord
    ),
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
    dependencyManager: { container, registerSingleton: () => undefined },
    dids: {
      resolveDidDocument: async () => ({
        verificationMethod: [{ id: 'did:peer:0zMyRel#key-1', type: 'Multikey', controller: 'did:peer:0zMyRel' }],
      }),
    },
    genericRecords: {
      save: jest.fn(async ({ content, tags }: { content: unknown; tags: Record<string, string> }) => {
        genericRecords.push({ content, tags })
      }),
      findAllByQuery: jest.fn(async (query: Record<string, string>) =>
        genericRecords.filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v))
      ),
    },
    w3cCredentials: {
      signCredential: jest.fn(async () => SIGNED_VRC),
      verifyCredential: jest.fn(async () => ({ isValid: options.credentialProofValid ?? true })),
      getAll: jest.fn(async () => []),
      store: jest.fn(async (opts: unknown) => {
        storedCredentials.push(opts)
      }),
    },
    modules: {
      didcomm: {
        connections: {
          getById: async () => ({
            id: connectionId,
            did: options.myDid,
            theirDid: options.theirDid,
            theirLabel: 'Peer Wallet',
          }),
        },
      },
    },
  }
  return {
    agent: agent as never,
    sentMessages,
    storedCredentials,
    relationshipRepo,
    connectionId,
    logger: agent.config.logger,
    w3c: agent.w3cCredentials,
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

afterEach(() => {
  vrcFlowStore.clearFlow('conn-1')
  vrcFlowStore.clearProposalPrompt('conn-1')
})

const flushDelivery = () => new Promise((resolve) => setTimeout(resolve, 50))

const ME = 'did:peer:4aaa' // the deterministic proposer of the first exchange
const PEER = 'did:peer:4zzz'
const conn = (fake: { connectionId: string }, mine: string, theirs: string) => ({
  id: fake.connectionId,
  did: mine,
  theirDid: theirs,
})
// eslint-disable-next-line @typescript-eslint/no-var-requires
const rcard = () =>
  (require('../../vrc/vrc-manager') as { issueRCardForAcceptedExchange: jest.Mock }).issueRCardForAcceptedExchange

const docsOfType = (fake: { sentMessages: TrustTaskMessage[] }, type: string) =>
  fake.sentMessages
    .map((m) => m.document as Record<string, unknown> & { payload: Record<string, unknown> })
    .filter((d) => d.type === type)

/** The first exchange as its proposer: discovery, propose, acceptance, our card. */
async function firstExchangeAsProposer(fake: ReturnType<typeof makeFakeAgent>) {
  setupTrustTasksInbound(fake.agent)
  await maybeOpenRelationshipExchange(fake.agent, fake.connectionId, 4, 4)
  const query = docsOfType(fake, discovery.TYPE_URI)[0]
  await deliver(
    fake.capturedHandlerRef,
    {
      id: 'dddd1111-0000-4000-8000-00000000000d',
      type: `${discovery.TYPE_URI}#response`,
      threadId: query.id,
      issuer: PEER,
      recipient: ME,
      issuedAt: new Date().toISOString(),
      payload: { supportedTypes: [propose.TYPE_URI] },
    },
    conn(fake, ME, PEER)
  )
  const first = docsOfType(fake, propose.TYPE_URI)[0]
  await deliver(
    fake.capturedHandlerRef,
    {
      id: 'bbbb1111-0000-4000-8000-00000000000b',
      type: `${propose.TYPE_URI}#response`,
      threadId: first.id,
      issuer: PEER,
      recipient: ME,
      issuedAt: new Date().toISOString(),
      payload: { accept: true, relationshipDid: 'did:peer:0zPeerRel' },
    },
    conn(fake, ME, PEER)
  )
  await flushDelivery()
  return first
}

/** The first exchange as its responder: their propose, our consent, our discovery answered. */
async function firstExchangeAsResponder(fake: ReturnType<typeof makeFakeAgent>) {
  setupTrustTasksInbound(fake.agent)
  await deliver(
    fake.capturedHandlerRef,
    {
      id: 'aaaa1111-1111-4111-8111-111111111111',
      type: propose.TYPE_URI,
      threadId: 'aaaa1111-1111-4111-8111-111111111111',
      issuer: ME,
      recipient: PEER,
      issuedAt: new Date().toISOString(),
      payload: { relationshipDid: 'did:peer:0zPeerRel', witnessed: false },
    },
    conn(fake, PEER, ME)
  )
  await respondToRelationshipProposal(fake.agent, fake.connectionId, true)
  await flushDelivery()
  const query = docsOfType(fake, discovery.TYPE_URI)[0]
  await deliver(
    fake.capturedHandlerRef,
    {
      id: 'dddd2222-0000-4000-8000-00000000000d',
      type: `${discovery.TYPE_URI}#response`,
      threadId: query.id,
      issuer: ME,
      recipient: PEER,
      issuedAt: new Date().toISOString(),
      payload: { supportedTypes: [propose.TYPE_URI] },
    },
    conn(fake, PEER, ME)
  )
}

describe('upgrading a relationship on its existing connection', () => {
  beforeEach(() => rcard().mockClear())

  test('either side may ask: a fresh propose with the STORED relationship DID', async () => {
    const fake = makeFakeAgent({ myDid: PEER, theirDid: ME }) // not the deterministic proposer
    await firstExchangeAsResponder(fake)
    const before = fake.sentMessages.length
    const result = await upgradeRelationship(fake.agent, fake.connectionId, { witnessed: false })
    expect(result.kind).toBe('sent')
    expect(fake.sentMessages).toHaveLength(before + 1)
    const sent = fake.sentMessages[before].document as {
      type: string
      id: string
      threadId: string
      payload: { relationshipDid: string; witnessed: boolean }
    }
    expect(sent.type).toBe(propose.TYPE_URI)
    expect(sent.threadId).toBe(sent.id)
    expect(sent.id).not.toBe('aaaa1111-1111-4111-8111-111111111111')
    expect(sent.payload).toEqual({ relationshipDid: 'did:peer:0zMyRel', witnessed: false })
  })

  test('with no exchange before, there is nothing to upgrade, and nothing is sent', async () => {
    const fake = makeFakeAgent({ myDid: ME, theirDid: PEER })
    setupTrustTasksInbound(fake.agent)
    const result = await upgradeRelationship(fake.agent, fake.connectionId, { witnessed: false })
    expect(result.kind).toBe('noRelationship')
    expect(fake.sentMessages).toHaveLength(0)
  })

  test('adding a witness needs one connected on this phone', async () => {
    const fake = makeFakeAgent({ myDid: ME, theirDid: PEER })
    await firstExchangeAsProposer(fake)
    const before = fake.sentMessages.length
    expect((await upgradeRelationship(fake.agent, fake.connectionId, { witnessed: true })).kind).toBe('noWitness')
    expect(fake.sentMessages).toHaveLength(before)
  })

  test('the automatic first exchange stays once per connection, an upgrade included', async () => {
    const fake = makeFakeAgent({ myDid: ME, theirDid: PEER })
    await firstExchangeAsProposer(fake)
    await upgradeRelationship(fake.agent, fake.connectionId, { witnessed: false })
    const before = fake.sentMessages.length
    await maybeOpenRelationshipExchange(fake.agent, fake.connectionId, 4, 4)
    expect(fake.sentMessages).toHaveLength(before)
  })

  test("the upgrade's acceptance delivers a fresh card on its own thread, once, and no profile again", async () => {
    const fake = makeFakeAgent({ myDid: ME, theirDid: PEER })
    const first = await firstExchangeAsProposer(fake)
    expect(docsOfType(fake, issue.TYPE_URI)).toHaveLength(1)
    expect(rcard()).toHaveBeenCalledTimes(1)
    const up = await upgradeRelationship(fake.agent, fake.connectionId, { witnessed: false })
    if (up.kind !== 'sent') throw new Error('not sent')
    expect(await pendingUpgradeOf(fake.agent, fake.connectionId)).toEqual({
      exchangeId: up.exchangeId,
      witnessed: false,
    })
    await deliver(
      fake.capturedHandlerRef,
      {
        id: 'bbbb2222-0000-4000-8000-00000000000b',
        type: `${propose.TYPE_URI}#response`,
        threadId: up.exchangeId,
        issuer: PEER,
        recipient: ME,
        issuedAt: new Date().toISOString(),
        payload: { accept: true, relationshipDid: 'did:peer:0zPeerRel' },
      },
      conn(fake, ME, PEER)
    )
    await flushDelivery()
    const issues = docsOfType(fake, issue.TYPE_URI)
    expect(issues.map((d) => d.threadId)).toEqual([first.id, up.exchangeId])
    expect(rcard()).toHaveBeenCalledTimes(1)
    expect(await pendingUpgradeOf(fake.agent, fake.connectionId)).toBeUndefined()
    // once per exchange, still
    await deliverVrcViaTrustTaskForExchange(fake.agent, fake.connectionId, up.exchangeId)
    expect(docsOfType(fake, issue.TYPE_URI)).toHaveLength(2)
  })

  test('an acceptance naming another relationship DID is refused: nothing recorded, no card', async () => {
    const fake = makeFakeAgent({ myDid: ME, theirDid: PEER })
    await firstExchangeAsProposer(fake)
    const up = await upgradeRelationship(fake.agent, fake.connectionId, { witnessed: false })
    if (up.kind !== 'sent') throw new Error('not sent')
    fake.relationshipRepo.updateCounterpartyRelationshipDid.mockClear()
    // Waiting, while the request is out (the control the next line needs).
    expect(vrcFlowStore.getStatus(fake.connectionId)).toBe('proposed')
    await deliver(
      fake.capturedHandlerRef,
      {
        id: 'bbbb3333-0000-4000-8000-00000000000b',
        type: `${propose.TYPE_URI}#response`,
        threadId: up.exchangeId,
        issuer: PEER,
        recipient: ME,
        issuedAt: new Date().toISOString(),
        payload: { accept: true, relationshipDid: 'did:peer:0zSomeoneElse' },
      },
      conn(fake, ME, PEER)
    )
    await flushDelivery()
    expect(fake.relationshipRepo.updateCounterpartyRelationshipDid).not.toHaveBeenCalled()
    expect(docsOfType(fake, issue.TYPE_URI)).toHaveLength(1)
    // …and no longer, once its acceptance is refused: nothing is left waiting.
    expect(vrcFlowStore.getStatus(fake.connectionId)).toBe('idle')
    // Stood down as an error, so the overlay never reads it as a confirmation (Phase 0).
    expect(vrcFlowStore.flowEndedWith(fake.connectionId)).toBe('error')
  })

  test('the receiver is asked as an upgrade, and accepting sends a fresh card but no profile', async () => {
    const fake = makeFakeAgent({ myDid: PEER, theirDid: ME })
    await firstExchangeAsResponder(fake)
    expect(rcard()).toHaveBeenCalledTimes(1)
    await deliver(
      fake.capturedHandlerRef,
      {
        id: 'aaaa2222-2222-4222-8222-222222222222',
        type: propose.TYPE_URI,
        threadId: 'aaaa2222-2222-4222-8222-222222222222',
        issuer: ME,
        recipient: PEER,
        issuedAt: new Date().toISOString(),
        payload: { relationshipDid: 'did:peer:0zPeerRel', witnessed: true },
      },
      conn(fake, PEER, ME)
    )
    expect(vrcFlowStore.getAnyProposalPrompt()).toEqual(
      expect.objectContaining({ connectionId: fake.connectionId, upgrade: 'witness' })
    )
    await respondToRelationshipProposal(fake.agent, fake.connectionId, true)
    await flushDelivery()
    const response = docsOfType(fake, `${propose.TYPE_URI}#response`).pop()!
    expect(response.payload).toEqual(expect.objectContaining({ accept: true, relationshipDid: 'did:peer:0zMyRel' }))
    expect(docsOfType(fake, issue.TYPE_URI).map((d) => d.threadId)).toContain('aaaa2222-2222-4222-8222-222222222222')
    expect(rcard()).toHaveBeenCalledTimes(1)
  })

  // Phase 0: a decline, by either person, ends the flow as declined — never as a confirmation.
  test('declining the upgrade here: the flow ends as declined', async () => {
    const fake = makeFakeAgent({ myDid: PEER, theirDid: ME })
    await firstExchangeAsResponder(fake)
    await deliver(
      fake.capturedHandlerRef,
      {
        id: 'aaaa5555-5555-4555-8555-555555555555',
        type: propose.TYPE_URI,
        threadId: 'aaaa5555-5555-4555-8555-555555555555',
        issuer: ME,
        recipient: PEER,
        issuedAt: new Date().toISOString(),
        payload: { relationshipDid: 'did:peer:0zPeerRel', witnessed: false },
      },
      conn(fake, PEER, ME)
    )
    expect(vrcFlowStore.getAnyProposalPrompt()).toEqual(expect.objectContaining({ connectionId: fake.connectionId }))
    await respondToRelationshipProposal(fake.agent, fake.connectionId, false)
    expect(vrcFlowStore.getStatus(fake.connectionId)).toBe('idle')
    expect(vrcFlowStore.flowEndedWith(fake.connectionId)).toBe('declined')
  })

  test('the other person declines the upgrade: the flow ends as declined; another refusal ends as an error', async () => {
    const declinedWith = async (code: string) => {
      const fake = makeFakeAgent({ myDid: ME, theirDid: PEER })
      await firstExchangeAsProposer(fake)
      const up = await upgradeRelationship(fake.agent, fake.connectionId, { witnessed: false })
      if (up.kind !== 'sent') throw new Error('not sent')
      // Waiting first: the control for the outcome below.
      expect(vrcFlowStore.getStatus(fake.connectionId)).toBe('proposed')
      await deliver(
        fake.capturedHandlerRef,
        {
          id: `bbbb6666-0000-4000-8000-${code.length.toString().padStart(12, '0')}`,
          type: 'https://trusttasks.org/spec/trust-task-error/0.5',
          threadId: up.exchangeId,
          issuer: PEER,
          recipient: ME,
          issuedAt: new Date().toISOString(),
          payload: { code, message: 'no', retryable: false },
        },
        conn(fake, ME, PEER)
      )
      await flushDelivery()
      return vrcFlowStore.flowEndedWith(fake.connectionId)
    }
    // The code exactly as a declining phone sends it (respondToRelationshipProposal's rejectWith).
    expect(await declinedWith(extendedCode(propose.TYPE_URI, 'declined'))).toBe('declined')
    expect(await declinedWith(extendedCode(propose.TYPE_URI, 'relationshipMismatch'))).toBe('error')
  })

  test('a first exchange is still asked as one, not as an upgrade', async () => {
    const fake = makeFakeAgent({ myDid: PEER, theirDid: ME })
    setupTrustTasksInbound(fake.agent)
    await deliver(
      fake.capturedHandlerRef,
      {
        id: 'aaaa3333-3333-4333-8333-333333333333',
        type: propose.TYPE_URI,
        threadId: 'aaaa3333-3333-4333-8333-333333333333',
        issuer: ME,
        recipient: PEER,
        issuedAt: new Date().toISOString(),
        payload: { relationshipDid: 'did:peer:0zPeerRel', witnessed: false },
      },
      conn(fake, PEER, ME)
    )
    const prompt = vrcFlowStore.getAnyProposalPrompt()
    expect(prompt?.connectionId).toBe(fake.connectionId)
    expect(prompt?.upgrade).toBeUndefined()
  })

  test('an upgrade propose naming another relationship DID is refused and never asked', async () => {
    const fake = makeFakeAgent({ myDid: PEER, theirDid: ME })
    await firstExchangeAsResponder(fake)
    const before = fake.sentMessages.length
    await deliver(
      fake.capturedHandlerRef,
      {
        id: 'aaaa4444-4444-4444-8444-444444444444',
        type: propose.TYPE_URI,
        threadId: 'aaaa4444-4444-4444-8444-444444444444',
        issuer: ME,
        recipient: PEER,
        issuedAt: new Date().toISOString(),
        payload: { relationshipDid: 'did:peer:0zSomeoneElse', witnessed: false },
      },
      conn(fake, PEER, ME)
    )
    expect(vrcFlowStore.getAnyProposalPrompt()).toBeUndefined()
    const sent = fake.sentMessages.slice(before).map((m) => m.document as { type: string; payload?: { code?: string } })
    expect(sent).toHaveLength(1)
    expect(sent[0].type).toMatch(/trust-task-error/)
    expect(sent[0].payload?.code).toBe('vrc/relationships/propose:relationshipMismatch')
  })

  test('a cancelled upgrade is no longer pending, and its late acceptance sends no card', async () => {
    const fake = makeFakeAgent({ myDid: ME, theirDid: PEER })
    await firstExchangeAsProposer(fake)
    const up = await upgradeRelationship(fake.agent, fake.connectionId, { witnessed: false })
    if (up.kind !== 'sent') throw new Error('not sent')
    await cancelRelationshipUpgrade(fake.agent, fake.connectionId, up.exchangeId)
    expect(await pendingUpgradeOf(fake.agent, fake.connectionId)).toBeUndefined()
    expect(vrcFlowStore.flowEndedWith(fake.connectionId)).toBe('cancelled')
    const before = fake.sentMessages.length
    await deliver(
      fake.capturedHandlerRef,
      {
        id: 'bbbb4444-0000-4000-8000-00000000000b',
        type: `${propose.TYPE_URI}#response`,
        threadId: up.exchangeId,
        issuer: PEER,
        recipient: ME,
        issuedAt: new Date().toISOString(),
        payload: { accept: true, relationshipDid: 'did:peer:0zPeerRel' },
      },
      conn(fake, ME, PEER)
    )
    await flushDelivery()
    expect(docsOfType(fake, issue.TYPE_URI)).toHaveLength(1)
    expect(fake.sentMessages).toHaveLength(before)
  })
})

describe('the issue and witness-share guards are once per exchange', () => {
  const doc = (issuer: string, threadId: string) => ({ document: { issuer, threadId } })
  test("a prior of ours for THIS exchange blocks; one for another exchange, or the peer's, does not", () => {
    const priors = [doc('did:peer:4aaa', 'x1'), doc('did:peer:4zzz', 'x2')]
    expect(priorForExchange(priors, 'did:peer:4aaa', 'x1')).toBe(true)
    expect(priorForExchange(priors, 'did:peer:4aaa', 'x2')).toBe(false)
    expect(priorForExchange(priors, 'did:peer:4aaa', 'x3')).toBe(false)
  })
})
