/**
 * The continuity check's protocol, both phones. The cryptography is continuityCrypto.test.ts's (a real KMS); here it
 * is a stand-in whose box "opens" only for the DID it was sealed to, so the protocol's own decisions are what is
 * tested: who is prompted, what is sent back, what gets confirmed, and what is limited.
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
import { TYPE_URI } from '../../../src/modules/vrc/contacts/continuitySpec'
import { memoryGenericRecords } from './fixtures/memoryGenericRecords'

const mockSend = jest.fn(
  async (_agent: unknown, _connectionId: string, _document: Record<string, unknown>) => undefined
)
const mockRetain = jest.fn(async () => undefined)
jest.mock('../../../src/modules/trust-tasks/ceremony', () => ({
  sendTrustTaskDocument: (...args: [unknown, string, Record<string, unknown>]) => mockSend(...args),
  getTrustTasksService: () => ({ retain: mockRetain }),
}))

// A sealed box is "sealed|<did>|<challenge>"; it opens only when that DID is among the keys offered.
jest.mock('../../../src/modules/vrc/contacts/continuityCrypto', () => ({
  sealChallenge: jest.fn(async (_agent: unknown, did: string) => ({
    challenge: `challenge-for-${did}`,
    sealed: `sealed|${did}|challenge-for-${did}`,
  })),
  openChallenge: jest.fn(async (_agent: unknown, sealed: string, dids: string[]) => {
    const [, did, challenge] = sealed.split('|')
    return dids.includes(did) ? { challenge, openedWith: did } : undefined
  }),
  sameChallenge: (a: string, b: string) => a === b,
}))
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const crypto = require('../../../src/modules/vrc/contacts/continuityCrypto')

/** This phone's relationships: connection → my DID with them, their DID with me. */
const RELATIONSHIPS = [
  { connectionId: 'conn-new', myRelationshipDid: 'did:peer:me-new', counterpartyRelationshipDid: 'did:peer:them-new' },
  { connectionId: 'conn-old', myRelationshipDid: 'did:peer:me-old', counterpartyRelationshipDid: 'did:peer:them-old' },
  { connectionId: 'conn-else', myRelationshipDid: 'did:peer:me-else', counterpartyRelationshipDid: 'did:peer:else' },
]

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
            getById: async (id: string) => ({ id, did: `did:conn:mine-${id}`, theirDid: `did:conn:theirs-${id}` }),
          },
        },
      },
    } as any,
  }
}

const accepting = { consume: jest.fn(async () => ({ kind: 'handled' })) } as any
const inbound = (connectionId: string) => ({ connectionId, senderDid: 'did:conn:sender', recipientDid: 'did:conn:me' })
const request = (sealed: string, id = 'request-1') => ({
  id,
  type: TYPE_URI,
  issuer: 'did:conn:sender',
  recipient: 'did:conn:me',
  issuedAt: '2026-10-23T00:00:00Z',
  payload: { sealed },
})

beforeEach(() => {
  resetContinuityLimits()
  jest.clearAllMocks()
})

describe('answering a continuity check', () => {
  test('a challenge sealed to an earlier relationship of mine prompts my person, naming nothing yet sent', async () => {
    const { agent } = agentWith()
    await handleContinuityRequest(agent, accepting, request('sealed|did:peer:me-old|abc'), inbound('conn-new'))
    expect(continuityPromptStore.has('conn-new')).toBe(true)
    expect(mockSend).not.toHaveBeenCalled()
  })

  test("only my OTHER relationships' keys are tried: one sealed to this connection's own relationship never prompts", async () => {
    const { agent } = agentWith()
    await handleContinuityRequest(agent, accepting, request('sealed|did:peer:me-new|abc'), inbound('conn-new'))
    expect(crypto.openChallenge).toHaveBeenCalledWith(agent, expect.any(String), [
      'did:peer:me-old',
      'did:peer:me-else',
    ])
    expect(continuityPromptStore.has('conn-new')).toBe(false)
    expect(mockSend).not.toHaveBeenCalled()
  })

  test("the asker's own relationship DID is excluded by DID, even on a record without that connection", async () => {
    // A second record holding this connection's own DID, with no connection of its own.
    const { agent } = agentWith(memoryGenericRecords(), [
      ...RELATIONSHIPS,
      { myRelationshipDid: 'did:peer:me-new', counterpartyRelationshipDid: 'did:peer:them-new' } as never,
    ])
    await handleContinuityRequest(agent, accepting, request('sealed|did:peer:me-new|abc'), inbound('conn-new'))
    expect(continuityPromptStore.has('conn-new')).toBe(false)
    expect(mockSend).not.toHaveBeenCalled()
  })

  test('a challenge that opens with none of my keys: no prompt, and nothing sent back at all', async () => {
    const { agent } = agentWith()
    await handleContinuityRequest(agent, accepting, request('sealed|did:peer:stranger|abc'), inbound('conn-new'))
    expect(continuityPromptStore.has('conn-new')).toBe(false)
    expect(mockSend).not.toHaveBeenCalled()
    expect(mockRetain).not.toHaveBeenCalled()
  })

  test('a request the pipeline refuses is dropped without trying a key or answering', async () => {
    const { agent } = agentWith()
    const refusing = { consume: jest.fn(async () => ({ kind: 'rejected', error: { type: 'error' } })) } as any
    await handleContinuityRequest(agent, refusing, request('sealed|did:peer:me-old|abc'), inbound('conn-new'))
    expect(crypto.openChallenge).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  test('a connection with no relationship on it is not answered', async () => {
    const { agent } = agentWith()
    await handleContinuityRequest(agent, accepting, request('sealed|did:peer:me-old|abc'), inbound('conn-unknown'))
    expect(continuityPromptStore.has('conn-unknown')).toBe(false)
  })

  test('on Confirm the reply carries the challenge back and nothing else — not which relationship opened it', async () => {
    const { agent } = agentWith()
    await handleContinuityRequest(agent, accepting, request('sealed|did:peer:me-old|abc'), inbound('conn-new'))
    await respondToContinuityPrompt(agent, 'conn-new', true)
    expect(mockSend).toHaveBeenCalledTimes(1)
    const [, connectionId, reply] = mockSend.mock.calls[0]
    expect(connectionId).toBe('conn-new')
    expect(reply.payload).toEqual({ challenge: 'abc' })
    expect(reply.threadId).toBe('request-1')
    expect(JSON.stringify(reply)).not.toContain('me-old')
    expect(JSON.stringify(reply)).not.toContain('them-old')
    expect(continuityPromptStore.has('conn-new')).toBe(false)
  })

  test('on Not now nothing is sent, and the prompt is gone', async () => {
    const { agent } = agentWith()
    await handleContinuityRequest(agent, accepting, request('sealed|did:peer:me-old|abc'), inbound('conn-new'))
    await respondToContinuityPrompt(agent, 'conn-new', false)
    expect(mockSend).not.toHaveBeenCalled()
    expect(continuityPromptStore.has('conn-new')).toBe(false)
  })

  test('one pending prompt per connection: a second request while one waits is not even opened', async () => {
    const { agent } = agentWith()
    await handleContinuityRequest(agent, accepting, request('sealed|did:peer:me-old|abc'), inbound('conn-new'))
    await handleContinuityRequest(
      agent,
      accepting,
      request('sealed|did:peer:me-old|def', 'request-2'),
      inbound('conn-new')
    )
    expect(crypto.openChallenge).toHaveBeenCalledTimes(1)
    expect(continuityPromptStore.getAny()?.challenge).toBe('abc')
  })

  test(`at most ${ATTEMPTS_PER_CONNECTION_PER_HOUR} attempts per connection per hour reach the pipeline`, async () => {
    const { agent } = agentWith()
    for (let i = 0; i < ATTEMPTS_PER_CONNECTION_PER_HOUR + 3; i++) {
      await handleContinuityRequest(
        agent,
        accepting,
        request(`sealed|did:peer:stranger|${i}`, `r-${i}`),
        inbound('conn-new')
      )
    }
    expect(accepting.consume).toHaveBeenCalledTimes(ATTEMPTS_PER_CONNECTION_PER_HOUR)
  })

  test(`at most ${PROMPTS_PER_HOUR} prompts an hour in all, across connections`, async () => {
    const { agent } = agentWith()
    const shown: string[] = []
    continuityPromptStore.on('prompt', (p: { connectionId: string }) => shown.push(p.connectionId))
    for (const connectionId of ['conn-new', 'conn-else', 'conn-old', 'conn-new']) {
      // Each answered at once, so "one pending per connection" is not what limits here.
      const target = connectionId === 'conn-old' ? 'did:peer:me-new' : 'did:peer:me-old'
      await handleContinuityRequest(agent, accepting, request(`sealed|${target}|x`), inbound(connectionId))
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
    expect(document).toEqual(
      expect.objectContaining({
        type: TYPE_URI,
        payload: { sealed: 'sealed|did:peer:them-old|challenge-for-did:peer:them-old' },
      })
    )
    expect(store.records).toEqual([
      expect.objectContaining({
        tags: { recordType: CONTINUITY_ASK, connectionId: 'conn-new', threadId: document.id },
        content: expect.objectContaining({ askedFrom: 'did:peer:them-new', about: 'did:peer:them-old' }),
      }),
    ])
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
      tags: {
        recordType: CONTACT_LINK,
        issuerDid: 'did:peer:them-old',
        contactId: 'did:peer:them-new',
        confirmation: 'user',
      },
    })
    await askToConfirm(harness.agent, new Map([['did:peer:them-old', 'did:peer:them-new']]), 'did:peer:them-new')
    const document = mockSend.mock.calls[0][2]
    return { ...harness, threadId: String(document.id) }
  }
  const links = new Map([['did:peer:them-old', 'did:peer:them-new']])
  const reply = (threadId: string, challenge: string) => ({
    id: 'reply-1',
    type: `${TYPE_URI}#response`,
    threadId,
    payload: { challenge },
  })

  test('our challenge back, on its thread and connection: the merge is confirmed by the other phone', async () => {
    const { agent, store, threadId } = await asked()
    const confirmed = jest.fn()
    continuityEvents.once('confirmed', confirmed)
    expect(await isConfirmedByPeer(agent, links, 'did:peer:them-new')).toBe(false)
    await handleContinuityResponse(
      agent,
      accepting,
      reply(threadId, 'challenge-for-did:peer:them-old'),
      inbound('conn-new')
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
    const { agent, store, threadId } = await asked()
    await handleContinuityResponse(agent, accepting, reply(threadId, 'a-guess'), inbound('conn-new'))
    expect(await isConfirmedByPeer(agent, links, 'did:peer:them-new')).toBe(false)
    expect(store.records.filter((r) => r.tags.recordType === CONTINUITY_ASK)).toHaveLength(1)
  })

  test('the right challenge on another connection confirms nothing', async () => {
    const { agent, threadId } = await asked()
    await handleContinuityResponse(
      agent,
      accepting,
      reply(threadId, 'challenge-for-did:peer:them-old'),
      inbound('conn-else')
    )
    expect(await isConfirmedByPeer(agent, links, 'did:peer:them-new')).toBe(false)
  })

  test('a failed write while confirming leaves the merge as it was', async () => {
    const { agent, store, threadId } = await asked()
    store.update.mockRejectedValueOnce(new Error('store unavailable'))
    await expect(
      handleContinuityResponse(
        agent,
        accepting,
        reply(threadId, 'challenge-for-did:peer:them-old'),
        inbound('conn-new')
      )
    ).rejects.toThrow('store unavailable')
    expect(store.records.find((r) => r.id === 'link-old')).toBeTruthy()
    expect(await isConfirmedByPeer(agent, links, 'did:peer:them-new')).toBe(false)
  })
})
