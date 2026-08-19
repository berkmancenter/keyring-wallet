/**
 * Ceremony tests — milestone 2, second slice: the `issue` leg in shadow mode.
 *
 * The issuing side delivers its signed VRC on the accepted exchange's thread
 * (proof attached — the spec declares the request proof REQUIRED and the
 * framework rejects a proofless document outright); the receiving side
 * verifies party bindings against the accepted proposal before receipting
 * with a recomputed digest, and refuses mismatches with `notAccepted`.
 * `signDocumentProof` is mocked (it needs a live KMS); the digest math is
 * real — see documentProof.test.ts for its own coverage.
 */
import { DidCommMessageSender, DidCommMessageHandlerRegistry } from '@credo-ts/didcomm'
import { InjectionSymbols, EventEmitter } from '@credo-ts/core'
import * as issue from '@openvtc/trust-tasks/vrc/relationships/issue/0.1/payload'
import * as propose from '@openvtc/trust-tasks/vrc/relationships/propose/0.1/payload'

import { maybeDeliverVrcViaTrustTask, maybeOpenRelationshipExchange, setupTrustTasksInbound } from '../ceremony'
import { digestMultibase } from '../documentProof'
import { TrustTaskMessage } from '../messages/TrustTaskMessage'
import { RelationshipDidRepository } from '../../vrc/repositories/RelationshipDidRepository'

jest.mock('../../vrc/vrc-manager', () => ({
  getOrCreateRelationshipDid: jest.fn(async () => 'did:peer:0zMyRel'),
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
}))

const SIGNED_VRC = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
  issuer: 'did:peer:0zMyRel',
  credentialSubject: { id: 'did:peer:0zPeerRel' },
  proof: { type: 'DataIntegrityProof', cryptosuite: 'eddsa-rdfc-2022', proofValue: 'zsig' },
}

// ---- a minimal fake agent (the slice-1 harness, extended for the issue leg) --

function makeFakeAgent(options: {
  myDid: string
  theirDid: string
  issuedCredential?: Record<string, unknown>
  relationshipRecord?: { myRelationshipDid?: string; counterpartyRelationshipDid?: string } | null
}) {
  const connectionId = 'conn-1'
  const stored: unknown[] = []
  const sentMessages: TrustTaskMessage[] = []
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
    modules: {
      didcomm: {
        connections: {
          getById: async () => ({ id: connectionId, did: options.myDid, theirDid: options.theirDid }),
        },
        credentials: {
          getFormatData: jest.fn(async () => ({ credential: { jsonld: options.issuedCredential ?? SIGNED_VRC } })),
        },
      },
    },
  }
  return {
    agent: agent as never,
    sentMessages,
    relationshipRepo,
    connectionId,
    logger: agent.config.logger,
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

/** Drive the proposer through propose → accepted #response so an exchange exists. */
async function establishAcceptedExchange(fake: ReturnType<typeof makeFakeAgent>) {
  setupTrustTasksInbound(fake.agent)
  await maybeOpenRelationshipExchange(fake.agent, fake.connectionId, 4, 4)
  const proposeDoc = fake.sentMessages[0].document as { id: string }
  await deliver(
    fake.capturedHandlerRef,
    {
      id: 'bbbb1111-0000-4000-8000-00000000000b',
      type: `${propose.TYPE_URI}#response`,
      threadId: proposeDoc.id,
      issuer: 'did:peer:4zzz',
      recipient: 'did:peer:4aaa',
      issuedAt: new Date().toISOString(),
      payload: { accept: true, relationshipDid: 'did:peer:0zPeerRel' },
    },
    { id: fake.connectionId, did: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' }
  )
  fake.sentMessages.length = 0
  return proposeDoc.id
}

describe('the outbound issue leg', () => {
  test('delivers the signed VRC on the exchange thread with a proof, exactly once', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    const exchangeId = await establishAcceptedExchange(fake)

    await maybeDeliverVrcViaTrustTask(fake.agent, fake.connectionId, 'cred-ex-1')
    await maybeDeliverVrcViaTrustTask(fake.agent, fake.connectionId, 'cred-ex-1')

    expect(fake.sentMessages).toHaveLength(1)
    const doc = fake.sentMessages[0].document as {
      type: string
      threadId: string
      issuer: string
      proof: unknown
      payload: { vrc: unknown; vrcDigestMultibase: string }
    }
    expect(doc.type).toBe(issue.TYPE_URI)
    expect(doc.threadId).toBe(exchangeId)
    expect(doc.issuer).toBe('did:peer:4aaa')
    expect(doc.proof).toEqual(STUB_PROOF)
    expect(doc.payload.vrc).toEqual(SIGNED_VRC)
    expect(doc.payload.vrcDigestMultibase).toBe(digestMultibase(SIGNED_VRC))
  })

  test('does not deliver outside an accepted exchange', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    setupTrustTasksInbound(fake.agent)
    await maybeOpenRelationshipExchange(fake.agent, fake.connectionId, 4, 4)
    fake.sentMessages.length = 0 // propose sent, but no acceptance yet

    await maybeDeliverVrcViaTrustTask(fake.agent, fake.connectionId, 'cred-ex-1')
    expect(fake.sentMessages).toHaveLength(0)
  })

  test('the RCard (a VDS, not a DTGCredential) never rides the task', async () => {
    const fake = makeFakeAgent({
      myDid: 'did:peer:4aaa',
      theirDid: 'did:peer:4zzz',
      issuedCredential: { ...SIGNED_VRC, type: ['VerifiableCredential', 'RelationshipCard'] },
    })
    await establishAcceptedExchange(fake)

    await maybeDeliverVrcViaTrustTask(fake.agent, fake.connectionId, 'cred-ex-rcard')
    expect(fake.sentMessages).toHaveLength(0)
  })
})

describe('the inbound issue leg', () => {
  const inboundIssue = (overrides?: { vrc?: Record<string, unknown>; omitProof?: boolean }) => {
    const vrc = overrides?.vrc ?? {
      ...SIGNED_VRC,
      issuer: 'did:peer:0zPeerRel',
      credentialSubject: { id: 'did:peer:0zMyRel' },
    }
    const doc: Record<string, unknown> = {
      id: 'cccc1111-0000-4000-8000-00000000000c',
      type: issue.TYPE_URI,
      threadId: 'aaaa1111-1111-4111-8111-111111111111',
      issuer: 'did:peer:4zzz',
      recipient: 'did:peer:4aaa',
      issuedAt: new Date().toISOString(),
      payload: { vrc, vrcDigestMultibase: digestMultibase(vrc) },
    }
    if (!overrides?.omitProof) doc.proof = STUB_PROOF
    return { doc, vrc }
  }

  test('a conforming delivery is receipted with the digest recomputed over the credential', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    setupTrustTasksInbound(fake.agent)
    const { doc, vrc } = inboundIssue()

    await deliver(fake.capturedHandlerRef, doc, { id: fake.connectionId, did: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })

    expect(fake.sentMessages).toHaveLength(1)
    const receipt = fake.sentMessages[0].document as { type: string; payload: { vrcDigestMultibase: string } }
    expect(receipt.type).toBe(`${issue.TYPE_URI}#response`)
    expect(receipt.payload.vrcDigestMultibase).toBe(digestMultibase(vrc))
  })

  test('a proofless delivery is rejected by the pipeline (spec: request proof REQUIRED)', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    setupTrustTasksInbound(fake.agent)
    const { doc } = inboundIssue({ omitProof: true })

    await deliver(fake.capturedHandlerRef, doc, { id: fake.connectionId, did: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })

    // no receipt — a trust-task-error (proofRequired) returns instead
    expect(fake.sentMessages).toHaveLength(1)
    const error = fake.sentMessages[0].document as { type: string; payload: { code: string } }
    expect(error.type).not.toBe(`${issue.TYPE_URI}#response`)
    expect(error.payload.code).toBe('proofRequired')
  })

  test('a credential whose subject is not this party is refused with notAccepted', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    setupTrustTasksInbound(fake.agent)
    const { doc } = inboundIssue({
      vrc: { ...SIGNED_VRC, issuer: 'did:peer:0zPeerRel', credentialSubject: { id: 'did:peer:0zSomebodyElse' } },
    })

    await deliver(fake.capturedHandlerRef, doc, { id: fake.connectionId, did: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })

    expect(fake.sentMessages).toHaveLength(1)
    const error = fake.sentMessages[0].document as { type: string; payload: { code: string } }
    expect(error.type).not.toBe(`${issue.TYPE_URI}#response`)
    expect(error.payload.code).toBe('vrc/relationships/issue:notAccepted')
  })

  test('a credential from an issuer that is not the proposal counterparty is refused', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    setupTrustTasksInbound(fake.agent)
    const { doc } = inboundIssue({
      vrc: { ...SIGNED_VRC, issuer: 'did:peer:0zMallory', credentialSubject: { id: 'did:peer:0zMyRel' } },
    })

    await deliver(fake.capturedHandlerRef, doc, { id: fake.connectionId, did: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })

    expect(fake.sentMessages).toHaveLength(1)
    const error = fake.sentMessages[0].document as { payload: { code: string } }
    expect(error.payload.code).toBe('vrc/relationships/issue:notAccepted')
  })
})

describe('the receipt round trip', () => {
  test('a receipt whose digest matches our delivery acknowledges it', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    const exchangeId = await establishAcceptedExchange(fake)
    await maybeDeliverVrcViaTrustTask(fake.agent, fake.connectionId, 'cred-ex-1')
    fake.sentMessages.length = 0

    await deliver(
      fake.capturedHandlerRef,
      {
        id: 'dddd1111-0000-4000-8000-00000000000d',
        type: `${issue.TYPE_URI}#response`,
        threadId: exchangeId,
        issuer: 'did:peer:4zzz',
        recipient: 'did:peer:4aaa',
        issuedAt: new Date().toISOString(),
        payload: { vrcDigestMultibase: digestMultibase(SIGNED_VRC) },
      },
      { id: fake.connectionId, did: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' }
    )

    expect(fake.logger.info).toHaveBeenCalledWith(expect.stringContaining('issue receipt matched'))
  })

  test('a receipt whose digest matches no delivery of ours acknowledges nothing', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    const exchangeId = await establishAcceptedExchange(fake)
    await maybeDeliverVrcViaTrustTask(fake.agent, fake.connectionId, 'cred-ex-1')
    fake.sentMessages.length = 0

    await deliver(
      fake.capturedHandlerRef,
      {
        id: 'eeee1111-0000-4000-8000-00000000000e',
        type: `${issue.TYPE_URI}#response`,
        threadId: exchangeId,
        issuer: 'did:peer:4zzz',
        recipient: 'did:peer:4aaa',
        issuedAt: new Date().toISOString(),
        payload: { vrcDigestMultibase: digestMultibase({ some: 'other credential' }) },
      },
      { id: fake.connectionId, did: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' }
    )

    expect(fake.logger.warn).toHaveBeenCalledWith(expect.stringContaining('matches no delivery of ours'))
  })
})
