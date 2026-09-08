/**
 * Witness-share tests (subtask §9 step 7) — the Witnessed indicator is
 * earned by verification, never granted on receipt:
 *
 *  - a conforming bundle (VP over the sender's VWC + its outcome pair,
 *    challenge-bound to the exchange) is verified, STORED, and receipted;
 *  - a VWC whose subject is not the sender's relationship DID is refused
 *    (the "shared someone else's witnessing" counterfeit — including your
 *    own VWC bounced back);
 *  - an error-typed terminal is failure evidence: refused, nothing stored;
 *  - a bundle whose digest does not reproduce over the initiating document
 *    is refused.
 *
 * Document-proof crypto is mocked (covered in documentProof.test.ts); the
 * digest math is real; presentation/credential proofs are mocked valid so
 * the pairing checks are what each tamper isolates.
 */
import { DidCommMessageSender, DidCommMessageHandlerRegistry } from '@credo-ts/didcomm'
import { InjectionSymbols, EventEmitter } from '@credo-ts/core'

import { setupTrustTasksInbound } from '../ceremony'
import { digestMultibase, taskDigestMultibase } from '../documentProof'
import { TrustTaskMessage } from '../messages/TrustTaskMessage'
import { RelationshipDidRepository } from '../../vrc/repositories/RelationshipDidRepository'
import * as witnessShare from '../witnessShareSpec'

jest.mock('../../vrc/vrc-manager', () => ({
  RCE_PROTOCOL_VERSION: 4,
  getOrCreateRelationshipDid: jest.fn(async () => 'did:peer:0zMyRel'),
  getConnectedWitnessConnectionId: jest.fn(() => undefined),
  issueRCardForAcceptedExchange: jest.fn(async () => undefined),
  isWitnessingPreferred: jest.fn(async () => false),
  prepareVrcCredentialWithEvidence: jest.fn(async () => ({ credential: {}, biometricSkipped: false })),
  getVrcJsonLdProofOptions: jest.fn(async () => ({ proofType: 'DataIntegrityProof', cryptosuite: 'eddsa-rdfc-2022' })),
}))

jest.mock('../documentProof', () => ({
  ...jest.requireActual('../documentProof'),
  signDocumentProof: jest.fn(async (_agent: unknown, document: Record<string, unknown>) => document),
  verifyDocumentProof: jest.fn(async () => true),
}))

const EXCHANGE_ID = 'eeee1111-0000-4000-8000-00000000000e'
const SESSION_ID = 'aaaa2222-0000-4000-8000-000000000002'
const MY_REL_DID = 'did:peer:0zMyRel'
const PEER_REL_DID = 'did:peer:0zPeerRel'

const STUB_DOC_PROOF = {
  type: 'DataIntegrityProof',
  cryptosuite: 'eddsa-jcs-2022',
  created: '2026-08-19T00:00:00Z',
  verificationMethod: `${PEER_REL_DID}#key-1`,
  proofPurpose: 'assertionMethod',
  proofValue: 'zStubForPipelineShapeOnly',
}

/** The peer's genuine bundle, mutable per test. */
function genuineShare(mutate?: (payload: Record<string, unknown>) => void): Record<string, unknown> {
  const initiating: Record<string, unknown> = {
    id: SESSION_ID,
    type: 'https://trusttasks.org/spec/witness/session/0.1',
    threadId: SESSION_ID,
    parentThreadId: EXCHANGE_ID,
    issuer: 'did:peer:4peerwitnessside',
    recipient: 'did:peer:4witness',
    issuedAt: '2026-08-19T00:00:00Z',
    payload: { parties: [PEER_REL_DID, MY_REL_DID] },
  }
  const vwc: Record<string, unknown> = {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential', 'DTGCredential', 'WitnessCredential'],
    issuer: 'did:example:witness',
    credentialSubject: {
      id: PEER_REL_DID,
      parties: [PEER_REL_DID, MY_REL_DID],
      taskContext: SESSION_ID,
      taskDigestMultibase: taskDigestMultibase(initiating),
    },
    proof: {
      type: 'DataIntegrityProof',
      cryptosuite: 'eddsa-jcs-2022',
      created: '2026-08-19T00:00:04Z',
      verificationMethod: 'did:example:witness#key-1',
      proofPurpose: 'assertionMethod',
      proofValue: 'zvwc',
    },
  }
  const terminal: Record<string, unknown> = {
    id: 'bbbb3333-0000-4000-8000-000000000003',
    type: 'https://trusttasks.org/spec/witness/session/submit/0.1#response',
    threadId: SESSION_ID,
    issuer: 'did:peer:4witness',
    recipient: 'did:peer:4peerwitnessside',
    issuedAt: '2026-08-19T00:00:05Z',
    payload: { vwc, vwcDigestMultibase: digestMultibase(vwc) },
    proof: { ...STUB_DOC_PROOF, verificationMethod: 'did:peer:4witness#key-1' },
  }
  const payload: Record<string, unknown> = {
    presentation: {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiablePresentation'],
      holder: PEER_REL_DID,
      verifiableCredential: [vwc],
      proof: {
        type: 'Ed25519Signature2018',
        created: '2026-08-19T00:00:06Z',
        verificationMethod: `${PEER_REL_DID}#key-1`,
        proofPurpose: 'authentication',
        challenge: EXCHANGE_ID,
        domain: witnessShare.WITNESS_SHARE_DOMAIN,
        jws: 'eyJhbGciOiJFZERTQSJ9..zvp',
      },
    },
    outcomeEvidence: { initiating, terminal },
  }
  if (mutate) mutate(payload)
  return {
    id: 'cccc4444-0000-4000-8000-000000000004',
    type: witnessShare.TYPE_URI,
    threadId: EXCHANGE_ID,
    issuer: 'did:peer:4zzz',
    recipient: 'did:peer:4aaa',
    issuedAt: '2026-08-19T00:00:07Z',
    payload,
    proof: STUB_DOC_PROOF,
  }
}

// ---- minimal fake agent (the ceremonyIssue harness, trimmed) ---------------

function makeFakeAgent() {
  const connectionId = 'conn-1'
  const stored: unknown[] = []
  const sentMessages: TrustTaskMessage[] = []
  const storedCredentials: unknown[] = []
  const relationshipRepo = {
    updateCounterpartyRelationshipDid: jest.fn(async () => null),
    findByConnectionDid: jest.fn(async () => ({
      myRelationshipDid: MY_REL_DID,
      counterpartyRelationshipDid: PEER_REL_DID,
    })),
  }
  const registrations = new Map<unknown, { useFactory: (c: unknown) => unknown }>()
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
    w3cCredentials: {
      verifyPresentation: jest.fn(async () => ({ isValid: true })),
      verifyCredential: jest.fn(async () => ({ isValid: true })),
      getAll: jest.fn(async () => []),
      store: jest.fn(async (opts: unknown) => {
        storedCredentials.push(opts)
      }),
    },
    modules: {
      didcomm: {
        connections: {
          getById: async () => ({ id: connectionId, did: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' }),
        },
      },
    },
  }
  return {
    agent: agent as never,
    sentMessages,
    storedCredentials,
    connectionId,
    logger: agent.config.logger,
    capturedHandlerRef: () => capturedHandler,
  }
}

const deliver = async (fake: ReturnType<typeof makeFakeAgent>, document: Record<string, unknown>) => {
  const handler = fake.capturedHandlerRef()
  if (!handler) throw new Error('handler not registered')
  await handler({
    message: new TrustTaskMessage({ document }),
    connection: { id: fake.connectionId, did: 'did:peer:4aaa', theirDid: 'did:peer:4zzz' },
  })
}

describe('the inbound witness-share (verify the bundle, store, receipt)', () => {
  test('a conforming bundle is verified, STORED, and receipted with the VWC digest', async () => {
    const fake = makeFakeAgent()
    setupTrustTasksInbound(fake.agent)
    const share = genuineShare()
    await deliver(fake, share)

    expect(fake.storedCredentials).toHaveLength(1)
    expect(fake.sentMessages).toHaveLength(1)
    const receipt = fake.sentMessages[0].document as { type: string; payload: { vwcDigestMultibase: string } }
    expect(receipt.type).toBe(witnessShare.RESPONSE_TYPE_URI)
    const vwc = ((share.payload as { presentation: { verifiableCredential: Record<string, unknown>[] } })
      .presentation.verifiableCredential)[0]
    expect(receipt.payload.vwcDigestMultibase).toBe(digestMultibase(vwc))
    expect(
      (fake.logger.info as jest.Mock).mock.calls.some((c) => String(c[0]).includes('witness-share verified and stored'))
    ).toBe(true)
  })

  test('a VWC whose subject is not the sender relationship DID is refused, nothing stored', async () => {
    const fake = makeFakeAgent()
    setupTrustTasksInbound(fake.agent)
    await deliver(
      fake,
      genuineShare((payload) => {
        const vwc = (payload.presentation as { verifiableCredential: Record<string, unknown>[] }).verifiableCredential[0]
        // the counterfeit: my own VWC bounced back at me
        ;(vwc.credentialSubject as Record<string, unknown>).id = MY_REL_DID
      })
    )
    expect(fake.storedCredentials).toHaveLength(0)
    const error = fake.sentMessages[0].document as { type: string; payload: { code: string } }
    expect(error.type).toContain('trust-task-error')
    expect(error.payload.code).toContain('notAccepted')
  })

  test('an error-typed terminal is failure evidence: refused, nothing stored', async () => {
    const fake = makeFakeAgent()
    setupTrustTasksInbound(fake.agent)
    await deliver(
      fake,
      genuineShare((payload) => {
        const evidence = payload.outcomeEvidence as { terminal: Record<string, unknown> }
        evidence.terminal = {
          ...evidence.terminal,
          type: 'https://trusttasks.org/spec/trust-task-error/0.3',
          payload: { code: 'taskFailed', message: 'x', retryable: false },
        }
      })
    )
    expect(fake.storedCredentials).toHaveLength(0)
    const error = fake.sentMessages[0].document as { type: string }
    expect(error.type).toContain('trust-task-error')
  })

  test('a digest that does not reproduce over the initiating document is refused', async () => {
    const fake = makeFakeAgent()
    setupTrustTasksInbound(fake.agent)
    await deliver(
      fake,
      genuineShare((payload) => {
        const evidence = payload.outcomeEvidence as { initiating: Record<string, unknown> }
        evidence.initiating = {
          ...evidence.initiating,
          payload: { parties: ['did:peer:0zForged', MY_REL_DID] },
        }
      })
    )
    expect(fake.storedCredentials).toHaveLength(0)
    const error = fake.sentMessages[0].document as { type: string }
    expect(error.type).toContain('trust-task-error')
  })

  test('redelivery of an already-stored VWC is receipted without a second store', async () => {
    const fake = makeFakeAgent()
    setupTrustTasksInbound(fake.agent)
    const share = genuineShare()
    const vwc = ((share.payload as { presentation: { verifiableCredential: Record<string, unknown>[] } })
      .presentation.verifiableCredential)[0]
    ;(fake.agent as { w3cCredentials: { getAll: jest.Mock } }).w3cCredentials.getAll.mockResolvedValue([
      { firstCredential: vwc },
    ] as never)
    await deliver(fake, share)
    expect(fake.storedCredentials).toHaveLength(0)
    expect((fake.sentMessages[0].document as { type: string }).type).toBe(witnessShare.RESPONSE_TYPE_URI)
  })
})

describe('the witness-share receipt (correlate against our sent share)', () => {
  test('a receipt naming our shared VWC is consumed and matched', async () => {
    const fake = makeFakeAgent()
    setupTrustTasksInbound(fake.agent)
    // Receive a genuine share first so a receipt-shaped reply exists to mirror;
    // then simulate OUR share retained as a request by delivering the peer's
    // receipt whose digest names the same VWC. Retention of our own share is
    // exercised through the send path in e2e; here we retain it directly.
    const share = genuineShare()
    const vwc = ((share.payload as { presentation: { verifiableCredential: Record<string, unknown>[] } })
      .presentation.verifiableCredential)[0]
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getTrustTasksService } = require('../ceremony') as typeof import('../ceremony')
    const service = getTrustTasksService(fake.agent)
    await service.retain(
      (fake.agent as { context: never }).context,
      {
        id: 'dddd5555-0000-4000-8000-000000000005',
        type: witnessShare.TYPE_URI,
        threadId: EXCHANGE_ID,
        issuer: 'did:peer:4aaa',
        recipient: 'did:peer:4zzz',
        issuedAt: '2026-08-19T00:00:08Z',
        payload: share.payload,
      },
      'request',
      fake.connectionId
    )

    await deliver(fake, {
      id: 'ffff6666-0000-4000-8000-000000000006',
      type: witnessShare.RESPONSE_TYPE_URI,
      threadId: EXCHANGE_ID,
      issuer: 'did:peer:4zzz',
      recipient: 'did:peer:4aaa',
      issuedAt: '2026-08-19T00:00:09Z',
      payload: { vwcDigestMultibase: digestMultibase(vwc) },
    })

    expect(
      (fake.logger.warn as jest.Mock).mock.calls.some((c) => String(c[0]).includes('receipt not consumed'))
    ).toBe(false)
    expect(
      (fake.logger.info as jest.Mock).mock.calls.some((c) => String(c[0]).includes('witness-share receipt matched'))
    ).toBe(true)
  })
})
