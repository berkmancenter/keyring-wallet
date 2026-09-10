/**
 * Ceremony tests — `credential-exchange/{query,present}` (subtask §9 step 4,
 * happy path only; `pending/*` defer-for-consent is out of scope here).
 *
 * A verifier's `credential-exchange/query` carries a bare DCQL query, no
 * `#response` variant exists, and the wallet's answer is a SEPARATE
 * `credential-exchange/present` document on the query's own thread — mirrors
 * `handleInboundPropose`/`respondToRelationshipProposal`'s consent-gate shape,
 * but keyed by the query document's own id (a wallet can hold prompts from
 * more than one verifier connection at once, unlike a relationship proposal).
 *
 * `signDocumentProof` is mocked (real crypto is covered in
 * documentProof.test.ts); DCQL matching and the challenge-bound VP
 * construction are exercised for real against a fake `DcqlService`/
 * `w3cCredentials`.
 */
import { DidCommMessageSender, DidCommMessageHandlerRegistry } from '@credo-ts/didcomm'
import { InjectionSymbols, EventEmitter, DcqlService, ClaimFormat } from '@credo-ts/core'
import * as credentialExchangePresent from '@openvtc/trust-tasks/credential-exchange/present/0.1/payload'
import * as credentialExchangeQuery from '@openvtc/trust-tasks/credential-exchange/query/0.1/payload'

import { respondToCredentialExchangeQuery, setupTrustTasksInbound } from '../ceremony'
import { credentialExchangeStore } from '../credentialExchangeStore'
import { TrustTaskMessage } from '../messages/TrustTaskMessage'
import { RelationshipDidRepository } from '../../vrc/repositories/RelationshipDidRepository'

// DCQL `type_values` matches against a stored credential's JSON-LD EXPANDED
// type IRIs (Credo's `expandedTypes` tag), not its raw compact `type` array —
// see ceremony.ts's `matchDcqlQuery` doc comment.
const EXPANDED_TYPES = [
  'https://www.w3.org/2018/credentials#VerifiableCredential',
  'https://example.org/dtg#DTGCredential',
  'https://example.org/dtg#RelationshipCredential',
]

const STORED_CREDENTIAL_JSON = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
  issuer: 'did:peer:0zMyRel',
  credentialSubject: { id: 'did:peer:0zPeerRel' },
  proof: {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-rdfc-2022',
    created: '2026-08-18T00:00:00Z',
    verificationMethod: 'did:peer:0zMyRel#key-1',
    proofPurpose: 'assertionMethod',
    proofValue: 'zStoredCredentialSig',
  },
}

const SIGNED_VP = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: ['VerifiablePresentation'],
  holder: 'did:peer:4aaa',
  verifiableCredential: [STORED_CREDENTIAL_JSON],
  proof: { type: 'Ed25519Signature2018', challenge: 'stub', domain: 'stub' },
}

const STUB_PROOF = {
  type: 'DataIntegrityProof',
  cryptosuite: 'eddsa-jcs-2022',
  created: '2026-09-04T00:00:00Z',
  verificationMethod: 'did:peer:4aaa#key-1',
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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { signDocumentProof: mockedSign } = require('../documentProof') as { signDocumentProof: jest.Mock }

jest.mock('../../vrc/vrc-manager', () => ({
  RCE_PROTOCOL_VERSION: 4,
  getOrCreateRelationshipDid: jest.fn(async () => 'did:peer:0zMyRel'),
  getConnectedWitnessConnectionId: jest.fn(() => undefined),
  issueRCardForAcceptedExchange: jest.fn(async () => undefined),
}))

// ---- a minimal fake agent (DCQL-aware) --------------------------------------

function makeFakeAgent(options: { myDid: string; theirDid: string; canBeSatisfied: boolean }) {
  const connectionId = 'conn-1'
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
  const queryResult = { can_be_satisfied: options.canBeSatisfied, credential_matches: {} }
  const getCredentialsForRequest = jest.fn(async () => queryResult)
  singletons.set(DcqlService, { getCredentialsForRequest })

  let capturedHandler: ((ctx: unknown) => Promise<unknown>) | undefined
  singletons.set(DidCommMessageHandlerRegistry, {
    registerMessageHandler: (handler: { handle: (ctx: unknown) => Promise<unknown> }) => {
      capturedHandler = handler.handle
    },
  })

  const signPresentation = jest.fn(async () => SIGNED_VP)
  // matchDcqlQuery selects the concrete record directly against
  // w3cCredentials.getAll() (not Credo's openid4vc holder API — see that
  // function's doc comment for why) — only returned when the query is
  // satisfiable, matching how the real DcqlService/stored-record pairing
  // behaves.
  const getAll = jest.fn(async () =>
    options.canBeSatisfied
      ? [
          {
            firstCredential: { ...STORED_CREDENTIAL_JSON, claimFormat: ClaimFormat.LdpVc },
            getTags: () => ({ expandedTypes: EXPANDED_TYPES }),
          },
        ]
      : []
  )

  const agent = {
    context: {},
    config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
    dependencyManager: { container, registerSingleton: () => undefined },
    dids: {
      resolveDidDocument: async () => ({
        verificationMethod: [{ id: 'did:peer:4aaa#key-1', type: 'Multikey', controller: 'did:peer:4aaa' }],
      }),
    },
    w3cCredentials: {
      signPresentation,
      getAll,
    },
    modules: {
      didcomm: {
        connections: {
          getById: async () => ({
            id: connectionId,
            did: options.myDid,
            theirDid: options.theirDid,
            theirLabel: 'Real Verifier Inc.',
          }),
        },
      },
    },
  }
  return {
    agent: agent as never,
    sentMessages,
    connectionId,
    getCredentialsForRequest,
    getAll,
    signPresentation,
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

const inboundQuery = (id = 'qqqq1111-1111-4111-8111-111111111111') => ({
  id,
  type: credentialExchangeQuery.TYPE_URI,
  threadId: id,
  issuer: 'did:peer:4zzz',
  recipient: 'did:peer:4aaa',
  issuedAt: new Date().toISOString(),
  payload: {
    dcql_query: { credentials: [{ id: 'cred1', format: 'ldp_vc', meta: { type_values: [EXPANDED_TYPES] } }] },
    nonce: 'server-nonce',
    purpose: 'Prove membership',
  },
})

afterEach(() => {
  jest.clearAllMocks()
})

describe('an inbound credential-exchange query', () => {
  test('a satisfiable query surfaces a consent prompt and sends nothing', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz', canBeSatisfied: true })
    setupTrustTasksInbound(fake.agent)

    await deliver(fake.capturedHandlerRef, inboundQuery(), {
      id: fake.connectionId,
      did: 'did:peer:4aaa',
      theirDid: 'did:peer:4zzz',
    })

    expect(fake.sentMessages).toHaveLength(0)
    expect(fake.getCredentialsForRequest).toHaveBeenCalled()
    expect(credentialExchangeStore.getQueryPrompt('qqqq1111-1111-4111-8111-111111111111')).toMatchObject({
      verifierLabel: 'Real Verifier Inc.',
      purpose: 'Prove membership',
    })
    credentialExchangeStore.clearQueryPrompt('qqqq1111-1111-4111-8111-111111111111')
  })

  test('an unsatisfiable query surfaces NO prompt and sends nothing', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz', canBeSatisfied: false })
    setupTrustTasksInbound(fake.agent)

    await deliver(fake.capturedHandlerRef, inboundQuery('qqqq2222-1111-4111-8111-111111111111'), {
      id: fake.connectionId,
      did: 'did:peer:4aaa',
      theirDid: 'did:peer:4zzz',
    })

    expect(fake.sentMessages).toHaveLength(0)
    expect(credentialExchangeStore.getQueryPrompt('qqqq2222-1111-4111-8111-111111111111')).toBeUndefined()
  })
})

describe("the user's answer", () => {
  test('Share sends credential-exchange/present on the query thread, signed', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz', canBeSatisfied: true })
    setupTrustTasksInbound(fake.agent)
    const queryId = 'qqqq3333-1111-4111-8111-111111111111'
    await deliver(fake.capturedHandlerRef, inboundQuery(queryId), {
      id: fake.connectionId,
      did: 'did:peer:4aaa',
      theirDid: 'did:peer:4zzz',
    })

    await respondToCredentialExchangeQuery(fake.agent, queryId, true)

    expect(fake.sentMessages).toHaveLength(1)
    const doc = fake.sentMessages[0].document as {
      type: string
      threadId: string
      proof: unknown
      payload: { vp_token: unknown }
    }
    expect(doc.type).toBe(credentialExchangePresent.TYPE_URI)
    expect(doc.threadId).toBe(queryId)
    expect(doc.proof).toEqual(STUB_PROOF)
    expect(doc.payload.vp_token).toEqual(SIGNED_VP)
    expect(fake.signPresentation).toHaveBeenCalledWith(
      expect.objectContaining({ challenge: 'server-nonce', domain: 'did:peer:4zzz' })
    )
    expect(mockedSign).toHaveBeenCalledWith(fake.agent, expect.anything(), 'did:peer:4aaa')
    expect(credentialExchangeStore.getQueryPrompt(queryId)).toBeUndefined()
  })

  test('Decline sends nothing and clears the prompt', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz', canBeSatisfied: true })
    setupTrustTasksInbound(fake.agent)
    const queryId = 'qqqq4444-1111-4111-8111-111111111111'
    await deliver(fake.capturedHandlerRef, inboundQuery(queryId), {
      id: fake.connectionId,
      did: 'did:peer:4aaa',
      theirDid: 'did:peer:4zzz',
    })

    await respondToCredentialExchangeQuery(fake.agent, queryId, false)

    expect(fake.sentMessages).toHaveLength(0)
    expect(credentialExchangeStore.getQueryPrompt(queryId)).toBeUndefined()
  })

  test('answering a query id with no pending prompt is a safe no-op', async () => {
    const fake = makeFakeAgent({ myDid: 'did:peer:4aaa', theirDid: 'did:peer:4zzz', canBeSatisfied: true })
    await respondToCredentialExchangeQuery(fake.agent, 'no-such-query', true)
    expect(fake.sentMessages).toHaveLength(0)
  })
})
