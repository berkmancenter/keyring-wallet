/**
 * The continuity check's protocol, both phones, through the REAL Trust Task pipeline (TrustTasksService.consume:
 * schema, identity cross-check, recipient check). The cryptography is continuityCrypto.test.ts's (a real KMS); here it
 * is a stand-in whose box opens only for the DID it was sealed to, so the protocol's own decisions are what is tested:
 * who is prompted, what is sent back, what gets confirmed, and what is limited.
 *
 * The pipeline is real on purpose: a mocked consume that answered 'handled' hid that a request whose handler sends no
 * reply comes back 'accepted', and the answering phone dropped every genuine request (RC 270, step 3).
 */
import { CONTACT_LINK } from '../../../src/modules/vrc/contacts/contactLinks'
import {
  ASK_SHOWN_FOR,
  ATTEMPTS_PER_CONNECTION_PER_HOUR,
  CONTINUITY_ASK,
  PROMPTS_PER_HOUR,
  askToConfirm,
  askedRecently,
  continuityEvents,
  continuityPromptStore,
  handleContinuityRequest,
  handleContinuityResponse,
  isConfirmedByPeer,
  resetContinuityLimits,
  respondToContinuityPrompt,
} from '../../../src/modules/vrc/contacts/continuity'
import { SPEC, TYPE_URI } from '../../../src/modules/vrc/contacts/continuitySpec'
import { TrustTasksService, respondWith } from '../../../src/modules/trust-tasks/services/TrustTasksService'
import { memoryGenericRecords } from './fixtures/memoryGenericRecords'

const mockSend = jest.fn(
  async (_agent: unknown, _connectionId: string, _document: Record<string, unknown>) => undefined
)
const mockRetain = jest.fn(async () => undefined)
jest.mock('../../../src/modules/trust-tasks/ceremony', () => ({
  sendTrustTaskDocument: (...args: [unknown, string, Record<string, unknown>]) => mockSend(...args),
  getTrustTasksService: () => ({ retain: mockRetain }),
}))

const b64 = (text: string) => Buffer.from(text).toString('base64url')
/** The challenge the stand-in seals for a DID (base64url, as a real one is). */
const challengeFor = (did: string) => b64(`challenge-for-${did}`)
/** A sealed box, as the stand-in makes it: base64url of {did, challenge}; it opens only for that DID. */
const box = (did: string, challenge = challengeFor(did)) => b64(JSON.stringify({ did, challenge }))

jest.mock('../../../src/modules/vrc/contacts/continuityCrypto', () => {
  const encode = (text: string) => Buffer.from(text).toString('base64url')
  return {
    sealChallenge: jest.fn(async (_agent: unknown, did: string) => {
      const challenge = encode(`challenge-for-${did}`)
      return { challenge, sealed: encode(JSON.stringify({ did, challenge })) }
    }),
    openChallenge: jest.fn(async (_agent: unknown, sealed: string, dids: string[]) => {
      const { did, challenge } = JSON.parse(Buffer.from(sealed, 'base64url').toString())
      return dids.includes(did) ? { challenge, openedWith: did } : undefined
    }),
    sameChallenge: (a: string, b: string) => a === b,
  }
})
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const crypto = require('../../../src/modules/vrc/contacts/continuityCrypto')

/** This phone's relationships: connection → my DID with them, their DID with me. */
const RELATIONSHIPS = [
  { connectionId: 'conn-new', myRelationshipDid: 'did:peer:me-new', counterpartyRelationshipDid: 'did:peer:them-new' },
  { connectionId: 'conn-old', myRelationshipDid: 'did:peer:me-old', counterpartyRelationshipDid: 'did:peer:them-old' },
  { connectionId: 'conn-else', myRelationshipDid: 'did:peer:me-else', counterpartyRelationshipDid: 'did:peer:else' },
]

/** The connection DIDs on both ends of a connection, as each phone's connection record names them. */
const mine = (connectionId: string) => `did:conn:mine-${connectionId}`
const theirs = (connectionId: string) => `did:conn:theirs-${connectionId}`

function agentWith(store = memoryGenericRecords(), relationships: typeof RELATIONSHIPS = RELATIONSHIPS) {
  return {
    store,
    agent: {
      context: {},
      genericRecords: store,
      w3cCredentials: { getAll: async () => [] },
      dependencyManager: {
        resolve: () => ({
          getAll: async () => relationships,
          findByCounterpartyRelationshipDid: async (_c: unknown, did: string) =>
            relationships.find((r) => r.counterpartyRelationshipDid === did) ?? null,
        }),
      },
      modules: {
        didcomm: {
          connections: {
            getById: async (id: string) => ({ id, did: mine(id), theirDid: theirs(id) }),
          },
        },
      },
    } as any,
  }
}

/** The real pipeline, with a repository that keeps nothing. */
let pipeline: TrustTasksService
/** An inbound document on `connectionId`, from the peer to this phone. */
const inbound = (connectionId: string) => ({
  connectionId,
  senderDid: theirs(connectionId),
  recipientDid: mine(connectionId),
})
/** A continuity request as the asking phone sends it, arriving on `connectionId`. */
const request = (connectionId: string, sealed: string, id = 'request-1') => ({
  id,
  type: TYPE_URI,
  issuer: theirs(connectionId),
  recipient: mine(connectionId),
  issuedAt: new Date().toISOString(),
  payload: { sealed },
})

beforeEach(() => {
  resetContinuityLimits()
  jest.clearAllMocks()
  pipeline = new TrustTasksService({ save: async () => undefined } as never)
  jest.spyOn(pipeline, 'consume')
})

describe('answering a continuity check', () => {
  test('a genuine request passes the real pipeline (which answers "accepted", not "handled") and prompts', async () => {
    const { agent } = agentWith()
    await handleContinuityRequest(agent, pipeline, request('conn-new', box('did:peer:me-old')), inbound('conn-new'))
    expect(continuityPromptStore.has('conn-new')).toBe(true)
    expect(mockSend).not.toHaveBeenCalled()
  })

  test("only my OTHER relationships' keys are tried: one sealed to this connection's own relationship never prompts", async () => {
    const { agent } = agentWith()
    await handleContinuityRequest(agent, pipeline, request('conn-new', box('did:peer:me-new')), inbound('conn-new'))
    expect(crypto.openChallenge).toHaveBeenCalledWith(agent, expect.any(String), [
      'did:peer:me-old',
      'did:peer:me-else',
    ])
    expect(continuityPromptStore.has('conn-new')).toBe(false)
    expect(mockSend).not.toHaveBeenCalled()
  })

  test("the asker's own relationship DID is excluded by DID, even on a record without that connection", async () => {
    const { agent } = agentWith(memoryGenericRecords(), [
      ...RELATIONSHIPS,
      { myRelationshipDid: 'did:peer:me-new', counterpartyRelationshipDid: 'did:peer:them-new' } as never,
    ])
    await handleContinuityRequest(agent, pipeline, request('conn-new', box('did:peer:me-new')), inbound('conn-new'))
    expect(continuityPromptStore.has('conn-new')).toBe(false)
    expect(mockSend).not.toHaveBeenCalled()
  })

  test('a challenge that opens with none of my keys: no prompt, and nothing sent back at all', async () => {
    const { agent } = agentWith()
    await handleContinuityRequest(agent, pipeline, request('conn-new', box('did:peer:stranger')), inbound('conn-new'))
    expect(continuityPromptStore.has('conn-new')).toBe(false)
    expect(mockSend).not.toHaveBeenCalled()
    expect(mockRetain).not.toHaveBeenCalled()
  })

  test('a request the pipeline refuses (bad payload, wrong recipient) is dropped without trying a key or answering', async () => {
    const { agent } = agentWith()
    await handleContinuityRequest(agent, pipeline, request('conn-new', 'too-short'), inbound('conn-new'))
    const misaddressed = { ...request('conn-new', box('did:peer:me-old')), recipient: 'did:conn:someone-else' }
    await handleContinuityRequest(agent, pipeline, misaddressed, inbound('conn-new'))
    expect(crypto.openChallenge).not.toHaveBeenCalled()
    expect(continuityPromptStore.has('conn-new')).toBe(false)
    expect(mockSend).not.toHaveBeenCalled()
  })

  test('a connection with no relationship on it is not answered', async () => {
    const { agent } = agentWith()
    await handleContinuityRequest(
      agent,
      pipeline,
      request('conn-unknown', box('did:peer:me-old')),
      inbound('conn-unknown')
    )
    expect(continuityPromptStore.has('conn-unknown')).toBe(false)
  })

  test('on Confirm the reply carries the challenge back and nothing else — not which relationship opened it', async () => {
    const { agent } = agentWith()
    await handleContinuityRequest(agent, pipeline, request('conn-new', box('did:peer:me-old')), inbound('conn-new'))
    await respondToContinuityPrompt(agent, 'conn-new', true)
    expect(mockSend).toHaveBeenCalledTimes(1)
    const [, connectionId, reply] = mockSend.mock.calls[0]
    expect(connectionId).toBe('conn-new')
    expect(reply.payload).toEqual({ challenge: challengeFor('did:peer:me-old') })
    expect(reply.threadId).toBe('request-1')
    expect(JSON.stringify(reply)).not.toContain('me-old')
    expect(JSON.stringify(reply)).not.toContain('them-old')
    expect(continuityPromptStore.has('conn-new')).toBe(false)
  })

  test('on Not now nothing is sent, and the prompt is gone', async () => {
    const { agent } = agentWith()
    await handleContinuityRequest(agent, pipeline, request('conn-new', box('did:peer:me-old')), inbound('conn-new'))
    await respondToContinuityPrompt(agent, 'conn-new', false)
    expect(mockSend).not.toHaveBeenCalled()
    expect(continuityPromptStore.has('conn-new')).toBe(false)
  })

  test('one pending prompt per connection: a second request while one waits is not even opened', async () => {
    const { agent } = agentWith()
    await handleContinuityRequest(agent, pipeline, request('conn-new', box('did:peer:me-old')), inbound('conn-new'))
    const second = box('did:peer:me-old', b64('a-second-challenge'))
    await handleContinuityRequest(agent, pipeline, request('conn-new', second, 'request-2'), inbound('conn-new'))
    expect(crypto.openChallenge).toHaveBeenCalledTimes(1)
    expect(continuityPromptStore.getAny()?.challenge).toBe(challengeFor('did:peer:me-old'))
  })

  test(`at most ${ATTEMPTS_PER_CONNECTION_PER_HOUR} attempts per connection per hour reach the pipeline`, async () => {
    const { agent } = agentWith()
    for (let i = 0; i < ATTEMPTS_PER_CONNECTION_PER_HOUR + 3; i++) {
      const sealed = box('did:peer:stranger', b64(`challenge-number-${i}`))
      await handleContinuityRequest(agent, pipeline, request('conn-new', sealed, `r-${i}`), inbound('conn-new'))
    }
    expect(pipeline.consume).toHaveBeenCalledTimes(ATTEMPTS_PER_CONNECTION_PER_HOUR)
  })

  test(`at most ${PROMPTS_PER_HOUR} prompts an hour in all, across connections`, async () => {
    const { agent } = agentWith()
    const shown: string[] = []
    continuityPromptStore.on('prompt', (p: { connectionId: string }) => shown.push(p.connectionId))
    for (const [index, connectionId] of ['conn-new', 'conn-else', 'conn-old', 'conn-new'].entries()) {
      // Each answered at once, so "one pending per connection" is not what limits here.
      const target = connectionId === 'conn-old' ? 'did:peer:me-new' : 'did:peer:me-old'
      await handleContinuityRequest(
        agent,
        pipeline,
        request(connectionId, box(target), `r-${index}`),
        inbound(connectionId)
      )
      await respondToContinuityPrompt(agent, connectionId, false)
    }
    continuityPromptStore.removeAllListeners('prompt')
    expect(shown).toHaveLength(PROMPTS_PER_HOUR)
  })
})

describe('asking for a continuity check', () => {
  const merged = new Map([['did:peer:them-old', 'did:peer:them-new']])

  test('one sealed challenge per other relationship, sent over the opened relationship’s connection', async () => {
    const { agent, store } = agentWith()
    expect(await askToConfirm(agent, merged, 'did:peer:them-new')).toBe('sent')
    expect(crypto.sealChallenge).toHaveBeenCalledWith(agent, 'did:peer:them-old')
    expect(mockSend).toHaveBeenCalledTimes(1)
    const [, connectionId, document] = mockSend.mock.calls[0]
    expect(connectionId).toBe('conn-new')
    expect(document).toEqual(expect.objectContaining({ type: TYPE_URI, payload: { sealed: box('did:peer:them-old') } }))
    expect(store.records).toEqual([
      expect.objectContaining({
        tags: { recordType: CONTINUITY_ASK, connectionId: 'conn-new', threadId: document.id },
        content: expect.objectContaining({ askedFrom: 'did:peer:them-new', about: 'did:peer:them-old' }),
      }),
    ])
  })

  test('the request it sends is one the answering phone’s real pipeline accepts', async () => {
    const asker = agentWith()
    await askToConfirm(asker.agent, merged, 'did:peer:them-new')
    const [, , sent] = mockSend.mock.calls[0]
    // As the other phone sees it: from them, to it, on the same connection.
    const outcome = await pipeline.consume({} as never, {
      spec: SPEC as never,
      document: sent,
      myDid: theirs('conn-new'),
      senderDid: mine('conn-new'),
      connectionId: 'conn-new',
      handler: async () => undefined,
    })
    expect(outcome.kind).toBe('accepted')
  })

  test('a new ask replaces the earlier ones on that connection', async () => {
    const { agent, store } = agentWith()
    await askToConfirm(agent, merged, 'did:peer:them-new')
    await askToConfirm(agent, merged, 'did:peer:them-new')
    const asks = store.records.filter((r) => r.tags.recordType === CONTINUITY_ASK)
    expect(asks).toHaveLength(1)
    expect(asks[0].tags.threadId).toBe(String(mockSend.mock.calls[1][2].id))
  })

  test('an ask shows as asked for a day, then not', async () => {
    const { agent, store } = agentWith()
    store.records.push({
      id: 'ask-old',
      content: { askedAt: Date.now() - ASK_SHOWN_FOR - 1000 },
      tags: { recordType: CONTINUITY_ASK, connectionId: 'conn-new', threadId: 't-old' },
    })
    expect(await askedRecently(agent, 'conn-new')).toBe(false)
    store.records.push({
      id: 'ask-new',
      content: { askedAt: Date.now() },
      tags: { recordType: CONTINUITY_ASK, connectionId: 'conn-new', threadId: 't-new' },
    })
    expect(await askedRecently(agent, 'conn-new')).toBe(true)
  })

  test('nothing to confirm for a contact of one relationship; no connection, nothing sent', async () => {
    const { agent } = agentWith()
    expect(await askToConfirm(agent, new Map(), 'did:peer:them-new')).toBe('nothingToConfirm')
    expect(await askToConfirm(agent, new Map([['did:peer:x', 'did:peer:y']]), 'did:peer:y')).toBe('noConnection')
    expect(mockSend).not.toHaveBeenCalled()
  })
})

describe('receiving the answer', () => {
  async function asked() {
    const harness = agentWith()
    harness.store.records.push({
      id: 'link-old',
      content: { issuerDid: 'did:peer:them-old', contactId: 'did:peer:them-new', confirmation: 'user' },
      tags: { recordType: CONTACT_LINK, issuerDid: 'did:peer:them-old', contactId: 'did:peer:them-new' },
    })
    await askToConfirm(harness.agent, new Map([['did:peer:them-old', 'did:peer:them-new']]), 'did:peer:them-new')
    const sent = mockSend.mock.calls[0][2]
    return { ...harness, sent }
  }
  const links = new Map([['did:peer:them-old', 'did:peer:them-new']])
  /** The other phone's reply to `sent`, as respondWith builds it, carrying `challenge`. */
  const replyTo = (sent: Record<string, unknown>, challenge: string) =>
    respondWith(sent as never, 'reply-1', { challenge }, () => new Date().toISOString()) as unknown as Record<
      string,
      unknown
    >
  /** The reply arriving on this phone over `connectionId`: from them, to it. */
  const answerOn = (connectionId: string) => ({
    connectionId,
    senderDid: theirs('conn-new'),
    recipientDid: mine('conn-new'),
  })

  test('our challenge back, on its thread and connection: the merge is confirmed by the other phone', async () => {
    const { agent, store, sent } = await asked()
    const confirmed = jest.fn()
    continuityEvents.once('confirmed', confirmed)
    expect(await isConfirmedByPeer(agent, links, 'did:peer:them-new')).toBe(false)
    await handleContinuityResponse(
      agent,
      pipeline,
      replyTo(sent, challengeFor('did:peer:them-old')),
      answerOn('conn-new')
    )
    expect(await isConfirmedByPeer(agent, links, 'did:peer:them-new')).toBe(true)
    // In place: the same link, updated, never deleted and saved again.
    expect(store.update).toHaveBeenCalled()
    expect(store.records.find((r) => r.id === 'link-old')?.content).toEqual(
      expect.objectContaining({ confirmation: 'peer' })
    )
    expect(store.records.filter((r) => r.tags.recordType === CONTINUITY_ASK)).toHaveLength(0)
    expect(confirmed).toHaveBeenCalledWith({ connectionId: 'conn-new' })
  })

  test('a reply without our challenge confirms nothing, and the question stays open for the real answer', async () => {
    const { agent, store, sent } = await asked()
    await handleContinuityResponse(
      agent,
      pipeline,
      replyTo(sent, b64('a-guess-at-the-challenge')),
      answerOn('conn-new')
    )
    expect(await isConfirmedByPeer(agent, links, 'did:peer:them-new')).toBe(false)
    expect(store.records.filter((r) => r.tags.recordType === CONTINUITY_ASK)).toHaveLength(1)
  })

  test('the right challenge on another connection confirms nothing', async () => {
    const { agent, sent } = await asked()
    await handleContinuityResponse(
      agent,
      pipeline,
      replyTo(sent, challengeFor('did:peer:them-old')),
      answerOn('conn-else')
    )
    expect(await isConfirmedByPeer(agent, links, 'did:peer:them-new')).toBe(false)
  })

  test('a failed write while confirming leaves the merge as it was', async () => {
    const { agent, store, sent } = await asked()
    store.update.mockRejectedValueOnce(new Error('store unavailable'))
    await expect(
      handleContinuityResponse(agent, pipeline, replyTo(sent, challengeFor('did:peer:them-old')), answerOn('conn-new'))
    ).rejects.toThrow('store unavailable')
    expect(store.records.find((r) => r.id === 'link-old')).toBeTruthy()
    expect(await isConfirmedByPeer(agent, links, 'did:peer:them-new')).toBe(false)
  })
})
