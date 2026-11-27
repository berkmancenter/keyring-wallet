import type { Agent } from '@credo-ts/core'
import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'

import { memoryGenericRecords } from '../../../../../__tests__/modules/vrc/fixtures/memoryGenericRecords'
import {
  VtiMediatorSession,
  type VtiClientIdentity,
  type VtiMediatorEndpoints,
} from '../../../trust-tasks/module/VtiMediatorTransport'
import { mailboxAccountKey, MEDIATOR_ACCOUNT_UPDATE } from '../../../trust-tasks/module/walletMailbox'
import { AgentConnectionStore } from '../../store'
import { agentRecord, FIXTURE_NOW } from '../../testing/fixtures'
import type { AgentConnection } from '../../types'
import {
  AgentChatCarrier,
  type AgentChatCarrierDeps,
  type ChatMediatorSession,
  classifySendFailure,
  DEFAULT_RETRY_AFTER_SECONDS,
  MediatorRefusalError,
  mediatorRefusalOf,
  sendOfferedAgain,
} from '../carrier'
import type { ChatIdentityKms } from '../chatIdentity'

// The real session packs keys through Credo; here only the shape of what it packs is read.
jest.mock('@credo-ts/core', () => ({
  ...jest.requireActual('@credo-ts/core'),
  getPublicJwkFromVerificationMethod: (vm: { id: string }) => ({ fromVm: vm.id }),
}))

// fb-C1 (§3.5, §2.4, §2.5): the chat carrier. A fake session plays the mediator for the results; the real
// VtiMediatorSession, with its socket and Credo's envelope service stood in, shows what goes on the wire.

const MEDIATOR = 'did:peer:2.owners-mediator'
const FORWARD = 'https://didcomm.org/routing/2.0/forward'
const CHAT = 'https://didcomm.org/basicmessage/2.0/message'
const logger = { info: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined }

const mediatorEndpoints: VtiMediatorEndpoints = {
  did: MEDIATOR,
  authEndpoint: 'https://mediator.example/mediator/v1',
  wsEndpoint: 'wss://mediator.example/mediator/v1/ws',
  publicJwk: { kty: 'OKP', crv: 'X25519', x: 'mediator' } as never,
  kid: `${MEDIATOR}#key-2`,
}

const grantedAnswer = (): DidCommV2PlaintextMessage => ({
  id: 'answer-1',
  type: 'https://trusttasks.org/binding/didcomm/0.1/envelope',
  from: MEDIATOR,
  body: { type: `${MEDIATOR_ACCOUNT_UPDATE}#response`, payload: { account: { acl: { sendForwarded: true } } } },
})

/** A mediator session the test drives: every call is logged in order. */
function fakeSession() {
  const calls: string[] = []
  const sent: { peer: string; plaintext: DidCommV2PlaintextMessage }[] = []
  const asked: Record<string, unknown>[] = []
  const session = {
    start: jest.fn(async () => {
      calls.push('start')
    }),
    stop: jest.fn(async () => {
      calls.push('stop')
    }),
    ask: jest.fn(async (document: Record<string, unknown>) => {
      calls.push('ask')
      asked.push(document)
      return grantedAnswer()
    }),
    sendTo: jest.fn(async (peer: string, plaintext: DidCommV2PlaintextMessage) => {
      calls.push('sendTo')
      sent.push({ peer, plaintext })
    }),
  }
  return { session, calls, sent, asked }
}

function setup(overrides: Partial<AgentChatCarrierDeps> = {}) {
  const genericRecords = memoryGenericRecords()
  const agent = { genericRecords, config: { logger } } as unknown as Agent
  const store = new AgentConnectionStore(agent)
  let n = 0
  const kms: ChatIdentityKms = { createDidKey: jest.fn(async () => `did:key:z6MkChat${++n}`) }
  const fake = fakeSession()
  let inbound: ((plaintext: DidCommV2PlaintextMessage) => Promise<void>) | undefined
  let now = FIXTURE_NOW
  const makeSession = jest.fn(
    (
      _agent: Agent,
      _identity: VtiClientIdentity,
      _mediator: VtiMediatorEndpoints,
      onMessage: (plaintext: DidCommV2PlaintextMessage) => Promise<void>
    ) => {
      inbound = onMessage
      return fake.session as ChatMediatorSession
    }
  )
  const deps: AgentChatCarrierDeps = {
    agent,
    store,
    kms,
    mediatorFor: async () => MEDIATOR,
    resolveMediator: async () => mediatorEndpoints,
    identityOf: async (_agent, did) => ({ did, kid: `${did}#x25519`, senderKey: {} as never }),
    makeSession,
    signForMediator: async (document) => ({ ...document, proof: { type: 'DataIntegrityProof' } }),
    now: () => now,
    ...overrides,
  }
  const carrier = new AgentChatCarrier(deps)
  return {
    carrier,
    store,
    kms,
    fake,
    makeSession,
    deps,
    inbound: (plaintext: DidCommV2PlaintextMessage) => inbound!(plaintext),
    advance: (ms: number) => {
      now += ms
    },
  }
}

async function connected(store: AgentConnectionStore, overrides: Partial<AgentConnection> = {}) {
  const record = agentRecord(overrides)
  await store.put(record)
  return record
}

const text = (words: string, id?: string) => ({ ...(id ? { id } : {}), type: CHAT, body: { content: words } })

describe('sending (§3.5)', () => {
  it('sends from chatDid to the agent’s current key, at the owner’s mediator, and answers sent with the id', async () => {
    const { carrier, store, fake, makeSession } = setup()
    const record = await connected(store, { agentDid: 'did:key:z6MkAgentNow' })

    const result = await carrier.send(record, text('hello'))

    expect(result).toEqual({ result: 'sent', id: expect.stringMatching(/^urn:uuid:/) })
    const chatDid = (await store.get(record.id))?.chatDid
    expect(chatDid).toBe('did:key:z6MkChat1')
    expect(makeSession.mock.calls[0][1].did).toBe(chatDid)
    expect(makeSession.mock.calls[0][2].did).toBe(MEDIATOR)
    expect(fake.sent).toHaveLength(1)
    expect(fake.sent[0].peer).toBe('did:key:z6MkAgentNow')
    expect(fake.sent[0].plaintext).toMatchObject({
      id: (result as { id: string }).id,
      type: CHAT,
      from: chatDid,
      to: ['did:key:z6MkAgentNow'],
      body: { content: 'hello' },
    })
  })

  it('the self-grant precedes the first send, once per session, signed by chatDid for its own account', async () => {
    const { carrier, store, fake } = setup()
    const record = await connected(store)

    await carrier.send(record, text('one'))
    await carrier.send(record, text('two'))

    expect(fake.calls).toEqual(['start', 'ask', 'sendTo', 'sendTo'])
    const chatDid = (await store.get(record.id))!.chatDid!
    expect(fake.asked[0]).toMatchObject({
      type: MEDIATOR_ACCOUNT_UPDATE,
      issuer: chatDid,
      recipient: MEDIATOR,
      payload: { did: mailboxAccountKey(chatDid), acl: { sendForwarded: true } },
      proof: { type: 'DataIntegrityProof' },
    })
  })

  it('two first sends at once ask for the grant once', async () => {
    const { carrier, store, fake } = setup()
    const record = await connected(store)
    await Promise.all([carrier.send(record, text('a')), carrier.send(record, text('b'))])
    expect(fake.calls.filter((c) => c === 'ask')).toHaveLength(1)
    expect(fake.calls.filter((c) => c === 'start')).toHaveLength(1)
    expect(fake.calls.indexOf('ask')).toBeLessThan(fake.calls.indexOf('sendTo'))
    expect(fake.sent).toHaveLength(2)
  })

  it('a resend keeps its id', async () => {
    const { carrier, store, fake } = setup()
    const record = await connected(store)
    await carrier.send(record, text('again', 'urn:uuid:kept'))
    await carrier.send(record, text('again', 'urn:uuid:kept'))
    expect(fake.sent.map((s) => s.plaintext.id)).toEqual(['urn:uuid:kept', 'urn:uuid:kept'])
  })

  it('no mediator for the chat is unreachable, and nothing signs in', async () => {
    const { carrier, store, makeSession } = setup({ mediatorFor: async () => undefined })
    const record = await connected(store)
    expect(await carrier.send(record, text('x'))).toEqual({ result: 'unreachable', reason: 'noMediator' })
    expect(makeSession).not.toHaveBeenCalled()
  })

  it('a failed sign-in is unreachable (signIn), and the next send signs in afresh', async () => {
    const { carrier, store, fake } = setup()
    const record = await connected(store)
    fake.session.start.mockRejectedValueOnce(new Error('authenticate refused (401)'))

    expect(await carrier.send(record, text('x'))).toMatchObject({ result: 'unreachable', reason: 'signIn' })
    expect(fake.session.stop).toHaveBeenCalled()
    expect(await carrier.send(record, text('y'))).toMatchObject({ result: 'sent' })
  })
})

describe('the closed mediator (§2.4, §2.5)', () => {
  it('a self-grant the mediator refuses (not_self_manageable) is closedMediator, and nothing is sent', async () => {
    const { carrier, store, fake } = setup()
    const record = await connected(store)
    fake.session.ask.mockRejectedValueOnce(
      new Error('[TrustTasks:VtiMediator] mediator refused: authorization.acl.not_self_manageable (thread x)')
    )

    expect(await carrier.send(record, text('x'))).toEqual({
      result: 'closedMediator',
      refused: 'selfGrant',
      code: 'authorization.acl.not_self_manageable',
    })
    expect(fake.sent).toHaveLength(0)
  })

  it('a self-grant answered without the right on (a trust-task-error document) is closedMediator', async () => {
    const { carrier, store, fake } = setup()
    const record = await connected(store)
    fake.session.ask.mockResolvedValueOnce({
      id: 'e-1',
      type: 'https://trusttasks.org/binding/didcomm/0.1/envelope',
      body: { type: 'https://trusttasks.org/spec/trust-task-error/0.1', payload: { code: 'authorization.permission' } },
    })

    expect(await carrier.send(record, text('x'))).toMatchObject({ result: 'closedMediator', refused: 'selfGrant' })
    expect(fake.sent).toHaveLength(0)
  })

  it('a self-grant with no answer in time is unreachable (transport), not closed, and is asked again next send', async () => {
    const { carrier, store, fake } = setup()
    const record = await connected(store)
    fake.session.ask.mockRejectedValueOnce(new Error('the mediator did not answer within 15000 ms'))

    expect(await carrier.send(record, text('x'))).toMatchObject({ result: 'unreachable', reason: 'transport' })
    expect(await carrier.send(record, text('y'))).toMatchObject({ result: 'sent' })
    expect(fake.session.ask).toHaveBeenCalledTimes(2)
    expect(fake.session.sendTo).toHaveBeenCalledTimes(1)
  })

  it('HTTP 403 e.p.authorization.send is closedMediator', async () => {
    const { carrier, store, fake } = setup()
    const record = await connected(store)
    fake.session.sendTo.mockRejectedValueOnce(new MediatorRefusalError('refused', 403, 'e.p.authorization.send'))
    expect(await carrier.send(record, text('x'))).toEqual({
      result: 'closedMediator',
      refused: 'send',
      code: 'e.p.authorization.send',
    })
  })

  it('HTTP 403 e.p.authorization.send_forwarded is closedMediator, and the next send asks for the grant again', async () => {
    const { carrier, store, fake } = setup()
    const record = await connected(store)
    fake.session.sendTo.mockRejectedValueOnce(
      new MediatorRefusalError('refused', 403, 'e.p.authorization.send_forwarded')
    )

    expect(await carrier.send(record, text('x'))).toMatchObject({
      result: 'closedMediator',
      code: 'e.p.authorization.send_forwarded',
    })
    expect(await carrier.send(record, text('y'))).toMatchObject({ result: 'sent' })
    // The refused send is not in `calls`: its implementation was replaced for that one call.
    expect(fake.calls).toEqual(['start', 'ask', 'ask', 'sendTo'])
    expect(fake.session.sendTo).toHaveBeenCalledTimes(2)
  })

  it('the refusal read from a problem-report’s words maps the same way', async () => {
    const { carrier, store, fake } = setup()
    const record = await connected(store)
    fake.session.sendTo.mockRejectedValueOnce(
      new Error('mediator refused: e.p.authorization.send — not allowed (thread abc)')
    )
    expect(await carrier.send(record, text('x'))).toMatchObject({ result: 'closedMediator', refused: 'send' })
  })
})

describe('pacing (§3.5: 503 e.p.limits.queue.peer)', () => {
  it('a 503 waits its Retry-After: sends before then are paced without touching the network, never retried at once', async () => {
    const { carrier, store, fake, advance } = setup()
    const record = await connected(store)
    fake.session.sendTo.mockRejectedValueOnce(new MediatorRefusalError('queue full', 503, 'e.p.limits.queue.peer', 30))

    expect(await carrier.send(record, text('51st'))).toEqual({
      result: 'paced',
      retryAt: FIXTURE_NOW + 30_000,
      retryAfterMs: 30_000,
    })
    expect(fake.session.sendTo).toHaveBeenCalledTimes(1)

    advance(10_000)
    expect(await carrier.send(record, text('too soon'))).toEqual({
      result: 'paced',
      retryAt: FIXTURE_NOW + 30_000,
      retryAfterMs: 20_000,
    })
    expect(fake.session.sendTo).toHaveBeenCalledTimes(1)

    advance(20_000)
    expect(await carrier.send(record, text('now'))).toMatchObject({ result: 'sent' })
    expect(fake.session.sendTo).toHaveBeenCalledTimes(2)
  })

  it('a Retry-After in a response header is honoured', async () => {
    const { carrier, store, fake } = setup()
    const record = await connected(store)
    const error = Object.assign(new Error('503'), { status: 503, headers: { 'retry-after': '45' } })
    fake.session.sendTo.mockRejectedValueOnce(error)
    expect(await carrier.send(record, text('x'))).toMatchObject({ result: 'paced', retryAfterMs: 45_000 })
  })

  it(`a 503 with no Retry-After waits ${DEFAULT_RETRY_AFTER_SECONDS} s`, async () => {
    const { carrier, store, fake } = setup()
    const record = await connected(store)
    fake.session.sendTo.mockRejectedValueOnce(new MediatorRefusalError('queue full', 503, 'e.p.limits.queue.peer'))
    expect(await carrier.send(record, text('x'))).toMatchObject({
      result: 'paced',
      retryAfterMs: DEFAULT_RETRY_AFTER_SECONDS * 1000,
    })
  })

  it('pacing is per agent: another agent is not held back', async () => {
    const { carrier, store, fake } = setup()
    const one = await connected(store)
    const two = await connected(store, { id: 'did:key:z6MkOtherAgent' })
    fake.session.sendTo.mockRejectedValueOnce(new MediatorRefusalError('queue full', 503, 'e.p.limits.queue.peer', 30))
    expect(await carrier.send(one, text('x'))).toMatchObject({ result: 'paced' })
    expect(await carrier.send(two, text('y'))).toMatchObject({ result: 'sent' })
  })
})

describe('unreachable', () => {
  it('403 e.p.delivery.refused (the agent has no account there yet) is unreachable, recipientUnknown', async () => {
    const { carrier, store, fake } = setup()
    const record = await connected(store)
    fake.session.sendTo.mockRejectedValueOnce(new MediatorRefusalError('refused', 403, 'e.p.delivery.refused'))
    expect(await carrier.send(record, text('x'))).toMatchObject({ result: 'unreachable', reason: 'recipientUnknown' })
  })

  it('a closed socket is unreachable, transport', async () => {
    const { carrier, store, fake } = setup()
    const record = await connected(store)
    fake.session.sendTo.mockRejectedValueOnce(new Error('socket closed while the message was packed'))
    expect(await carrier.send(record, text('x'))).toMatchObject({ result: 'unreachable', reason: 'transport' })
  })
})

describe('a refusal spends the action', () => {
  it('only unreachable leaves the send offered again; a refusal (closed, paced) does not, and sent is done', () => {
    expect(sendOfferedAgain({ result: 'unreachable', reason: 'transport' })).toBe(true)
    expect(sendOfferedAgain({ result: 'unreachable', reason: 'recipientUnknown' })).toBe(true)
    expect(sendOfferedAgain({ result: 'closedMediator', refused: 'send' })).toBe(false)
    expect(sendOfferedAgain({ result: 'closedMediator', refused: 'selfGrant' })).toBe(false)
    expect(sendOfferedAgain({ result: 'paced', retryAt: 1, retryAfterMs: 1 })).toBe(false)
    expect(sendOfferedAgain({ result: 'sent', id: 'urn:uuid:x' })).toBe(false)
  })
})

describe('reading a refusal', () => {
  it('send is not mistaken for send_forwarded, nor the other way round', () => {
    expect(mediatorRefusalOf(new Error('refused: e.p.authorization.send_forwarded'))?.code).toBe(
      'e.p.authorization.send_forwarded'
    )
    expect(mediatorRefusalOf(new Error('refused: e.p.authorization.send (thread t)'))?.code).toBe(
      'e.p.authorization.send'
    )
  })

  it('an error with neither a status nor a code is no refusal, and is a transport failure', () => {
    expect(mediatorRefusalOf(new Error('boom'))).toBeUndefined()
    expect(classifySendFailure(new Error('boom'))).toEqual({ result: 'unreachable', reason: 'transport' })
  })
})

describe('receiving', () => {
  it('delivers what arrives for chatDid to every handler, with the record that holds that chatDid', async () => {
    const { carrier, store, inbound } = setup()
    const record = await connected(store)
    expect(await carrier.open(record)).toBe('open')
    const chatDid = (await store.get(record.id))!.chatDid!
    const handler = jest.fn()
    carrier.onMessage(handler)

    const plaintext = { id: 'm-1', type: CHAT, from: record.agentDid, to: [chatDid], body: { content: 'hi' } }
    await inbound(plaintext)

    expect(handler).toHaveBeenCalledWith({
      chatDid,
      record: expect.objectContaining({ id: record.id }),
      plaintext,
    })
  })

  it('a handler that throws rejects the delivery, so the session leaves the message queued', async () => {
    const { carrier, store, inbound } = setup()
    const record = await connected(store)
    await carrier.open(record)
    carrier.onMessage(() => {
      throw new Error('could not store it')
    })
    await expect(inbound({ id: 'm-1', type: CHAT, body: {} })).rejects.toThrow('could not store it')
  })

  it('with no handler listening, nothing takes the message: it stays queued', async () => {
    const { carrier, store, inbound } = setup()
    const record = await connected(store)
    await carrier.open(record)
    const off = carrier.onMessage(jest.fn())
    off()
    await expect(inbound({ id: 'm-1', type: CHAT, body: {} })).rejects.toThrow(/no handler/)
  })

  it('open signs in without the self-grant or any send', async () => {
    const { carrier, store, fake } = setup()
    const record = await connected(store)
    await carrier.open(record)
    expect(fake.calls).toEqual(['start'])
  })

  it('close signs out, and a closed carrier opens nothing again', async () => {
    const { carrier, store, fake } = setup()
    const record = await connected(store)
    await carrier.send(record, text('x'))
    await carrier.close()
    expect(fake.session.stop).toHaveBeenCalled()
    expect(await carrier.send(record, text('y'))).toMatchObject({ result: 'unreachable', reason: 'signIn' })
  })
})

describe('the identity', () => {
  it('the first send makes the chat identity, and sends announce nothing: only the chat message goes out', async () => {
    const { carrier, store, fake, kms } = setup()
    const record = await connected(store)
    await carrier.send(record, text('x'))
    expect(kms.createDidKey).toHaveBeenCalledTimes(1)
    // §11 Q7 is open: no message names chatDid or the mediator to the agent.
    expect(fake.sent).toHaveLength(1)
    expect(fake.sent[0].plaintext.type).toBe(CHAT)
  })

  // control: an existing chatDid is kept: the carrier sends from it, and makes no new key.
  it('control: an existing chatDid is kept', async () => {
    const { carrier, store, fake, kms } = setup()
    const record = await connected(store, {
      chatDid: 'did:key:z6MkExisting',
      chatConnectionId: 'agent-chat:did:key:z6MkNotesHelperFixture',
    })
    await carrier.send(record, text('x'))
    expect(kms.createDidKey).not.toHaveBeenCalled()
    expect(fake.sent[0].plaintext.from).toBe('did:key:z6MkExisting')
    expect((await store.get(record.id))?.chatDid).toBe('did:key:z6MkExisting')
  })
})

describe('on the wire, through the real VtiMediatorSession', () => {
  it('the forward is authcrypt to the mediator, with next = K_a, around an authcrypt inner message from chatDid', async () => {
    const packs: { plaintext: DidCommV2PlaintextMessage; options: Record<string, unknown> }[] = []
    const envelopeService = {
      pack: jest.fn(async (_ctx: unknown, plaintext: DidCommV2PlaintextMessage, options: Record<string, unknown>) => {
        packs.push({ plaintext, options })
        return { protected: 'e30', ciphertext: plaintext.type }
      }),
    }
    const agentDid = 'did:key:z6MkAgentKa'
    const genericRecords = memoryGenericRecords()
    const agent = {
      genericRecords,
      config: { logger },
      context: {},
      dependencyManager: { resolve: () => envelopeService },
      dids: {
        // A did:key: one keyAgreement method, no service.
        resolveDidDocument: async (did: string) => ({
          id: did,
          keyAgreement: [{ id: `${did}#x25519`, type: 'X25519KeyAgreementKey2020', controller: did }],
          service: [],
        }),
      },
    } as unknown as Agent
    const socket = { readyState: 1, send: jest.fn() }
    const { carrier, store } = setup({
      agent,
      makeSession: (a, identity, mediator, onMessage) => {
        const session = new VtiMediatorSession(a, identity, mediator, { onMessage })
        const s = session as unknown as Record<string, unknown>
        s.start = async () => {
          s.socket = socket
        }
        s.ensureOpen = async () => undefined
        s.ask = async () => grantedAnswer()
        return session
      },
    })
    const record = await connected(store, { agentDid })

    expect(await carrier.send(record, text('hello'))).toMatchObject({ result: 'sent' })

    const chatDid = (await store.get(record.id))!.chatDid!
    expect(packs).toHaveLength(2)
    const [inner, outer] = packs
    // Inner: from chatDid to K_a, authcrypt (a sender key and its skid).
    expect(inner.plaintext).toMatchObject({ from: chatDid, to: [agentDid], type: CHAT })
    expect(inner.options.recipientKey).toMatchObject({ keyId: `${agentDid}#x25519` })
    expect(inner.options.senderKey).toBeDefined()
    expect(inner.options.senderKeySkid).toBe(`${chatDid}#x25519`)
    // Outer: a routing/2.0 forward to the owner's mediator, next = K_a, authcrypt from chatDid: never anoncrypt.
    expect(outer.plaintext).toMatchObject({
      type: FORWARD,
      from: chatDid,
      to: [MEDIATOR],
      body: { next: agentDid },
    })
    expect(outer.options.senderKey).toBeDefined()
    expect(outer.options.senderKeySkid).toBe(`${chatDid}#x25519`)
    expect(outer.options.recipientKey).toMatchObject({ keyId: mediatorEndpoints.kid })
    expect(socket.send).toHaveBeenCalledTimes(1)
  })
})
