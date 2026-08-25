/**
 * Ceremony tests — the authority flip: consent is the accepted proposal, and
 * the VRC travels ONLY as the trust-task issue leg for v4 pairs.
 *
 *  - the responder's consent (respondToRelationshipProposal) answers the
 *    propose and triggers this side's signed delivery;
 *  - the proposer delivers on consuming the acceptance;
 *  - the receiver verifies party bindings AND the credential's own proof,
 *    STORES the credential (digest-deduplicated), and receipts with the
 *    digest recomputed over what it stored;
 *  - a decline is a trust-task-error (`propose:declined`), never
 *    `accept: false`.
 *
 * `signDocumentProof`/`verifyDocumentProof` are mocked (real crypto is
 * covered in documentProof.test.ts); the digest math is real.
 */
import { DidCommMessageSender, DidCommMessageHandlerRegistry } from '@credo-ts/didcomm'
import { InjectionSymbols, EventEmitter } from '@credo-ts/core'
import * as issue from '@openvtc/trust-tasks/vrc/relationships/issue/0.1/payload'
import * as discovery from '@openvtc/trust-tasks/trust-task-discovery/0.1/payload'
import * as propose from '@openvtc/trust-tasks/vrc/relationships/propose/0.1/payload'

import {
  deliverVrcViaTrustTaskForExchange,
  maybeOpenRelationshipExchange,
  respondToRelationshipProposal,
  setupTrustTasksInbound,
} from '../ceremony'
import { digestMultibase } from '../documentProof'
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
  getOrCreateRelationshipDid: jest.fn(async () => 'did:peer:0zMyRel'),
  getConnectedWitnessConnectionId: jest.fn(() => undefined),
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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { verifyDocumentProof: mockedVerify } = require('../documentProof') as { verifyDocumentProof: jest.Mock }

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

describe('the proposer side (auto-delivery on acceptance)', () => {
  test('consuming the acceptance delivers the signed VRC on the exchange thread, exactly once', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    setupTrustTasksInbound(fake.agent)
    await maybeOpenRelationshipExchange(fake.agent, fake.connectionId, 4, 4)
    // discovery hop: confirm propose support so the exchange opens
    await deliver(
      fake.capturedHandlerRef,
      {
        id: 'dddd1111-0000-4000-8000-00000000000d',
        type: `${discovery.TYPE_URI}#response`,
        threadId: 'dddd1111-0000-4000-8000-00000000000d',
        issuer: 'did:peer:4zzz',
        recipient: 'did:peer:4aaa',
        issuedAt: new Date().toISOString(),
        payload: { supportedTypes: [propose.TYPE_URI] },
      },
      { id: fake.connectionId, did: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' }
    )
    const proposeDoc = fake.sentMessages[1].document as { id: string }

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
    await flushDelivery() // delivery is fire-and-forget off the inbound handler

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { issueRCardForAcceptedExchange } = require('../../vrc/vrc-manager') as { issueRCardForAcceptedExchange: jest.Mock }
    expect(issueRCardForAcceptedExchange).toHaveBeenCalledWith(fake.agent, fake.connectionId)
    expect(fake.sentMessages).toHaveLength(3) // discovery, propose, then our issue
    const doc = fake.sentMessages[2].document as {
      type: string
      threadId: string
      proof: unknown
      payload: { vrc: unknown; vrcDigestMultibase: string }
    }
    expect(doc.type).toBe(issue.TYPE_URI)
    expect(doc.threadId).toBe(proposeDoc.id)
    expect(doc.proof).toEqual(STUB_PROOF)
    expect(doc.payload.vrc).toEqual(SIGNED_VRC)
    expect(doc.payload.vrcDigestMultibase).toBe(digestMultibase(SIGNED_VRC))

    // idempotent: a second delivery attempt for the same exchange is a no-op
    await deliverVrcViaTrustTaskForExchange(fake.agent, fake.connectionId, proposeDoc.id)
    expect(fake.sentMessages).toHaveLength(3)
  })

  test('concurrent duplicate triggers deliver exactly once (in-flight guard)', async () => {
    // The persisted prior-issue check only protects AFTER an issue document is
    // retained; a redelivered trigger while the first delivery is still in
    // flight must be swallowed by the in-flight guard (observed live as a
    // second biometric prompt + a duplicate witness session, 2026-08-25).
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    const exchangeId = 'cccc1111-0000-4000-8000-00000000000c'
    await Promise.all([
      deliverVrcViaTrustTaskForExchange(fake.agent, fake.connectionId, exchangeId),
      deliverVrcViaTrustTaskForExchange(fake.agent, fake.connectionId, exchangeId),
    ])
    const issues = fake.sentMessages.filter((m) => (m.document as { type?: string }).type === issue.TYPE_URI)
    expect(issues).toHaveLength(1)
  })
})

describe('the responder side (consent gates everything)', () => {
  const inboundPropose = () => ({
    id: 'aaaa1111-1111-4111-8111-111111111111',
    type: propose.TYPE_URI,
    threadId: 'aaaa1111-1111-4111-8111-111111111111',
    issuer: 'did:peer:4zzz',
    recipient: 'did:peer:4aaa',
    issuedAt: new Date().toISOString(),
    payload: { relationshipDid: 'did:peer:0zPeerRel', witnessed: false },
  })

  test('an inbound propose surfaces a consent prompt and sends NOTHING', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    setupTrustTasksInbound(fake.agent)

    await deliver(fake.capturedHandlerRef, inboundPropose(), {
      id: fake.connectionId,
      did: 'did:peer:4aaa',
      theirDid: 'did:peer:4zzz',
    })

    expect(fake.sentMessages).toHaveLength(0)
    expect(vrcFlowStore.getProposalPrompt(fake.connectionId)).toMatchObject({
      counterpartyLabel: 'Peer Wallet',
      exchangeId: 'aaaa1111-1111-4111-8111-111111111111',
    })
  })

  test('user acceptance answers the propose and delivers our signed VRC', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    setupTrustTasksInbound(fake.agent)
    await deliver(fake.capturedHandlerRef, inboundPropose(), {
      id: fake.connectionId,
      did: 'did:peer:4aaa',
      theirDid: 'did:peer:4zzz',
    })

    await respondToRelationshipProposal(fake.agent, fake.connectionId, true)
    await flushDelivery() // delivery is fire-and-forget off the consent path

    expect(fake.relationshipRepo.updateCounterpartyRelationshipDid).toHaveBeenCalledWith(
      expect.anything(),
      'did:peer:4zzz',
      'did:peer:0zPeerRel',
      4
    )
    // Three sends: the acceptance, the responder's own SYMMETRIC discovery
    // query (step 7 — it must learn the proposer's supportedTypes for the
    // witness-share gate), and the issue delivery.
    const types = fake.sentMessages.map((m) => (m.document as { type: string }).type)
    expect(types).toHaveLength(3)
    expect(types).toContain('https://trusttasks.org/spec/trust-task-discovery/0.1')
    const response = fake.sentMessages[0].document as { type: string; payload: { accept: boolean } }
    expect(response.type).toBe(`${propose.TYPE_URI}#response`)
    expect(response.payload.accept).toBe(true)
    const issueDoc = fake.sentMessages
      .map((m) => m.document as { type: string; threadId: string })
      .find((d) => d.type === issue.TYPE_URI)
    expect(issueDoc?.threadId).toBe('aaaa1111-1111-4111-8111-111111111111')
    expect(vrcFlowStore.getProposalPrompt(fake.connectionId)).toBeUndefined()
    // The acceptance also triggers the R-Card (legacy leg) — the basic-message
    // announcement it used to depend on can be lost.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { issueRCardForAcceptedExchange } = require('../../vrc/vrc-manager') as { issueRCardForAcceptedExchange: jest.Mock }
    expect(issueRCardForAcceptedExchange).toHaveBeenCalledWith(fake.agent, fake.connectionId)
  })

  test('user decline sends a trust-task-error (propose:declined), never accept:false', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    setupTrustTasksInbound(fake.agent)
    await deliver(fake.capturedHandlerRef, inboundPropose(), {
      id: fake.connectionId,
      did: 'did:peer:4aaa',
      theirDid: 'did:peer:4zzz',
    })

    await respondToRelationshipProposal(fake.agent, fake.connectionId, false)

    expect(fake.sentMessages).toHaveLength(1)
    const error = fake.sentMessages[0].document as { type: string; payload: { code: string } }
    expect(error.type).not.toBe(`${propose.TYPE_URI}#response`)
    expect(error.payload.code).toBe('vrc/relationships/propose:declined')
  })
})

describe('the inbound issue leg (verify, store, receipt)', () => {
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

  test('a conforming delivery is verified, STORED, and receipted with the recomputed digest', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    setupTrustTasksInbound(fake.agent)
    const { doc, vrc } = inboundIssue()

    await deliver(fake.capturedHandlerRef, doc, { id: fake.connectionId, did: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })

    expect(fake.w3c.verifyCredential).toHaveBeenCalled()
    expect(fake.storedCredentials).toHaveLength(1)
    expect(fake.sentMessages).toHaveLength(1)
    const receipt = fake.sentMessages[0].document as { type: string; payload: { vrcDigestMultibase: string } }
    expect(receipt.type).toBe(`${issue.TYPE_URI}#response`)
    expect(receipt.payload.vrcDigestMultibase).toBe(digestMultibase(vrc))
  })

  test('a credential whose own proof fails verification is refused, not stored', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz', credentialProofValid: false })
    setupTrustTasksInbound(fake.agent)
    const { doc } = inboundIssue()

    await deliver(fake.capturedHandlerRef, doc, { id: fake.connectionId, did: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })

    expect(fake.storedCredentials).toHaveLength(0)
    const error = fake.sentMessages[0].document as { payload: { code: string } }
    expect(error.payload.code).toBe('vrc/relationships/issue:notAccepted')
  })

  test('a proofless delivery is rejected by the pipeline (spec: request proof REQUIRED)', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    setupTrustTasksInbound(fake.agent)
    const { doc } = inboundIssue({ omitProof: true })

    await deliver(fake.capturedHandlerRef, doc, { id: fake.connectionId, did: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })

    expect(fake.storedCredentials).toHaveLength(0)
    const error = fake.sentMessages[0].document as { payload: { code: string } }
    expect(error.payload.code).toBe('proofRequired')
  })

  test('a delivery whose document proof fails verification is rejected as proofInvalid', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    setupTrustTasksInbound(fake.agent)
    const { doc } = inboundIssue()
    mockedVerify.mockResolvedValueOnce(false)

    await deliver(fake.capturedHandlerRef, doc, { id: fake.connectionId, did: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })

    expect(fake.storedCredentials).toHaveLength(0)
    const error = fake.sentMessages[0].document as { payload: { code: string } }
    expect(error.payload.code).toBe('proofInvalid')
  })

  test('a credential whose subject is not this party is refused with notAccepted', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })
    setupTrustTasksInbound(fake.agent)
    const { doc } = inboundIssue({
      vrc: { ...SIGNED_VRC, issuer: 'did:peer:0zPeerRel', credentialSubject: { id: 'did:peer:0zSomebodyElse' } },
    })

    await deliver(fake.capturedHandlerRef, doc, { id: fake.connectionId, did: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' })

    expect(fake.storedCredentials).toHaveLength(0)
    const error = fake.sentMessages[0].document as { payload: { code: string } }
    expect(error.payload.code).toBe('vrc/relationships/issue:notAccepted')
  })
})
