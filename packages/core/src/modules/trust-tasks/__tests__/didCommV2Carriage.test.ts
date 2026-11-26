/**
 * DidCommV2Carriage — the consumer half of the framework's binding/didcomm
 * 0.2 as this module implements it: authcrypt only, the §3.1 thread rule,
 * the connection's DIDs as the transport-authenticated identities, and the
 * inviter-side first contact (Credo never creates the inviter's v2 record).
 *
 * The Credo agent is faked at the container boundary, as tspCarriage.test.ts
 * does; the message class itself is the real one, so `toV2Plaintext` and the
 * inbound reassembly (Credo spreads the v2 body next to @id/@type) are what
 * is exercised, not a stand-in.
 */
import { getX25519KeyAgreementKey2019, JsonTransformer, Kms, TypedArrayEncoder } from '@credo-ts/core'
import {
  DidCommConnectionService,
  DidCommMessageHandlerRegistry,
  DidCommMessageSender,
  DidCommOutOfBandRepository,
} from '@credo-ts/didcomm'

import { TrustTaskEnvelopeV2Message, TRUST_TASK_V2_ENVELOPE_TYPE } from '../messages/TrustTaskEnvelopeV2Message'
import { checkV2ThreadCorrelation, createDidCommV2Carriage } from '../module/DidCommV2Carriage'
import type { V2InboundVerdict } from '../module/DidCommV2Carriage'

const ALICE =
  'did:peer:2.Vz6MkaliceAliceAliceAliceAliceAliceAliceAliceAli.Ez6LSaliceAliceAliceAliceAliceAliceAliceAliceAlic'
const BOB =
  'did:peer:2.Vz6MkbobBobBobBobBobBobBobBobBobBobBobBobBobBobBob.Ez6LSbobBobBobBobBobBobBobBobBobBobBobBobBobBobBobB'

const DOC = {
  id: '11e6c7a2-53d4-4a10-9b6e-2f01c3a9d201',
  type: 'https://trusttasks.org/spec/vtc/relationships/request/0.1',
  threadId: '11e6c7a2-53d4-4a10-9b6e-2f01c3a9d201',
  issuer: BOB,
  recipient: ALICE,
  issuedAt: '2026-09-14T12:00:00Z',
  payload: { reason: 'We met at the Berkman workshop; requesting a relationship credential.' },
}

/** What Credo's v2 envelope hands the message handler after normalising body → top level. */
function inboundInstance(
  document: Record<string, unknown>,
  headers: { thid?: string; pthid?: string; from?: string; to?: string[] } = {}
) {
  const normalised: Record<string, unknown> = {
    '@type': TRUST_TASK_V2_ENVELOPE_TYPE,
    '@id': '7c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f',
    ...document,
  }
  if (headers.from) normalised.from = headers.from
  if (headers.to) normalised.to = headers.to
  if (headers.thid !== undefined || headers.pthid !== undefined) {
    const thread: Record<string, string> = {}
    if (headers.thid !== undefined) thread.thid = headers.thid
    if (headers.pthid !== undefined) thread.pthid = headers.pthid
    normalised['~thread'] = thread
  }
  return JsonTransformer.fromJSON(normalised, TrustTaskEnvelopeV2Message)
}

type Handler = (ctx: Record<string, unknown>) => Promise<unknown>

/** A real (Askar-free) X25519 keyAgreement key: pure JWK/VerificationMethod
 *  construction is enough for getPublicJwkFromVerificationMethod to parse —
 *  no agent, no Askar backend needed for public-key-only comparisons. */
function fakeX25519KeyAgreementKey(seed: number) {
  const publicKeyBytes = new Uint8Array(32).fill(seed)
  const publicJwk = Kms.PublicJwk.fromPublicJwk({ kty: 'OKP', crv: 'X25519', x: TypedArrayEncoder.toBase64Url(publicKeyBytes) })
  const verificationMethod = getX25519KeyAgreementKey2019({
    id: '#key-2',
    publicJwk: publicJwk as never,
    controller: '#id',
  })
  return { publicJwk, verificationMethod }
}

function makeFakeAgent(options: {
  connections?: Array<{ id: string; did: string; theirDid: string; didcommVersion?: 'v1' | 'v2' }>
  ownInvitationDids?: string[]
  /** DID → its resolved keyAgreement verification methods, for senderKeyBelongsToClaimedDid. */
  didDocuments?: Record<string, { keyAgreement: unknown[] }>
}) {
  const sent: unknown[] = []
  const created: Array<Record<string, unknown>> = []
  let registered: Handler | undefined
  const connections = [...(options.connections ?? [])]
  // Tokens are matched by class NAME, not identity: in this package's test tree
  // @bifold/trust-tasks (mapped to source) resolves @credo-ts/didcomm from the
  // hoisted copy while this file gets the nested one, so the same class arrives
  // as two objects. Production trees are single-copy (Metro singleton list, Node).
  const is = (token: unknown, cls: { name: string }) => (token as { name?: string })?.name === cls.name
  const container = {
    resolve: (token: unknown) => {
      if (is(token, DidCommMessageSender))
        return { sendMessage: async (ctx: { message: unknown }) => sent.push(ctx.message) }
      if (is(token, DidCommMessageHandlerRegistry))
        return { registerMessageHandler: (def: { handle: Handler }) => (registered = def.handle) }
      if (is(token, DidCommConnectionService))
        return {
          findByDids: async (_ctx: unknown, q: { ourDid: string; theirDid: string }) =>
            connections.find((c) => c.did === q.ourDid && c.theirDid === q.theirDid) ?? null,
          createConnection: async (_ctx: unknown, props: Record<string, unknown>) => {
            created.push(props)
            const record = {
              id: `conn-${created.length}`,
              did: props.did as string,
              theirDid: props.theirDid as string,
              didcommVersion: 'v2' as const,
            }
            connections.push(record)
            return record
          },
        }
      if (is(token, DidCommOutOfBandRepository))
        return {
          findByQuery: async () =>
            (options.ownInvitationDids ?? []).map((did, i) => ({
              id: `oob-${i}`,
              outOfBandInvitation: { v2Invitation: { from: did, body: { goal: 'relationship' } } },
            })),
        }
      throw new Error(`unexpected token ${String(token)}`)
    },
  }
  const agent = {
    context: {},
    config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
    dependencyManager: { container },
    dids: {
      resolveDidDocument: async (did: string) => {
        const doc = options.didDocuments?.[did]
        if (!doc) throw new Error(`no such did: ${did}`)
        return doc
      },
    },
    modules: {
      didcomm: {
        connections: {
          getById: async (id: string) =>
            connections.find((c) => c.id === id) ?? Promise.reject(new Error(`no connection ${id}`)),
        },
      },
    },
  }
  return { agent: agent as never, sent, created, connections, handler: () => registered as Handler }
}

describe('TrustTaskEnvelopeV2Message', () => {
  test('packs the binding shape: body = the document, thid from threadId, pthid from parentThreadId', () => {
    const message = new TrustTaskEnvelopeV2Message({ document: { ...DOC, parentThreadId: 'parent-1' } })
    const plaintext = message.toV2Plaintext()
    expect(plaintext.type).toBe(TRUST_TASK_V2_ENVELOPE_TYPE)
    expect(plaintext.body).toEqual({ ...DOC, parentThreadId: 'parent-1' })
    expect(plaintext.thid).toBe(DOC.threadId)
    expect(plaintext.pthid).toBe('parent-1')
    expect(plaintext.id).not.toBe(DOC.id) // the DIDComm id is its own identifier space
  })

  test('falls back to the document id for thid when there is no threadId', () => {
    const { threadId: _t, ...noThread } = DOC
    expect(new TrustTaskEnvelopeV2Message({ document: noThread }).toV2Plaintext().thid).toBe(DOC.id)
  })

  test('reassembles the document from the spread body, keeping the envelope its own @id/@type', () => {
    const message = inboundInstance(DOC, { thid: DOC.threadId, from: BOB, to: [ALICE] })
    expect(message.type).toBe(TRUST_TASK_V2_ENVELOPE_TYPE)
    expect(message.id).toBe('7c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f')
    expect(message.threadId).toBe(DOC.threadId)
    expect(message.document).toEqual(DOC)
    expect(message.plaintextFrom).toBe(BOB)
    expect(message.plaintextTo).toEqual([ALICE])
  })
})

describe('checkV2ThreadCorrelation (binding §3.1)', () => {
  // Real inbound message instances (via inboundInstance, a real
  // TrustTaskEnvelopeV2Message with a real `~thread` decorator) rather than
  // plain object literals: Credo's `message.threadId` is a GETTER that
  // defaults to the message `@id` whenever `~thread.thid` is absent on the
  // wire, so a plain `{ threadId: … }` fixture can't distinguish "thid was
  // set" from "thid was never on the wire at all" — exactly the distinction
  // this check depends on. A prior version of these tests used such a
  // literal and passed while the implementation read the getter, silently
  // masking the false-rejection bug fixed below.
  test('agreeing headers pass', () => {
    const message = inboundInstance(DOC, { thid: DOC.threadId })
    expect(checkV2ThreadCorrelation(message, DOC)).toBe('ok')
  })
  test('disagreeing thid is malformedRequest', () => {
    // ~thread.thid is format-validated (RFC 0008 shape); a same-shaped but
    // different id is enough to exercise a genuine mismatch.
    const message = inboundInstance(DOC, { thid: '22222222-2222-2222-2222-222222222222' })
    expect(checkV2ThreadCorrelation(message, DOC)).toBe('malformedRequest:thid')
  })
  test('disagreeing pthid is malformedRequest', () => {
    const message = inboundInstance(DOC, {
      thid: DOC.threadId,
      pthid: '33333333-3333-3333-3333-333333333333',
    })
    expect(
      checkV2ThreadCorrelation(message, { ...DOC, parentThreadId: '44444444-4444-4444-4444-444444444444' })
    ).toBe('malformedRequest:pthid')
  })
  test('a missing member on either side is never compared (and never filled)', () => {
    const { threadId: _t, ...noThread } = DOC
    expect(checkV2ThreadCorrelation(inboundInstance(noThread, { thid: noThread.id }), noThread)).toBe('ok')
    expect(checkV2ThreadCorrelation(inboundInstance(DOC, {}), DOC)).toBe('ok')
  })
  test('a conforming producer that omits thid entirely (relying on the document id) is never falsely rejected', () => {
    // The regression this binding's own comment anticipates: the message's
    // own @id differs from the document's threadId, so `message.threadId`
    // (the getter) would read as a MISMATCH. Reading the raw `~thread.thid`
    // header (absent here) must see no thid at all and pass.
    const message = inboundInstance(DOC, {}) // no ~thread on the wire
    expect((message as { threadId: string }).threadId).not.toBe(DOC.threadId) // getter defaults to @id
    expect(checkV2ThreadCorrelation(message, DOC)).toBe('ok')
  })
})

describe('DidCommV2Carriage', () => {
  test('send: refuses a v1 connection and packs the envelope on a v2 one', async () => {
    const fake = makeFakeAgent({
      connections: [
        { id: 'v1', did: 'did:peer:4zQm', theirDid: 'did:peer:4zQn', didcommVersion: 'v1' },
        { id: 'v2', did: ALICE, theirDid: BOB, didcommVersion: 'v2' },
      ],
    })
    const carriage = createDidCommV2Carriage(fake.agent)
    await expect(carriage.send(DOC, { connectionId: 'v1' })).rejects.toThrow(/not a DIDComm v2 connection/)
    await carriage.send(DOC, { connectionId: 'v2' })
    expect(fake.sent).toHaveLength(1)
    const message = fake.sent[0] as TrustTaskEnvelopeV2Message
    expect(message).toBeInstanceOf(TrustTaskEnvelopeV2Message)
    expect(message.toV2Plaintext().body).toEqual(DOC)
  })

  test('inbound on an existing v2 connection reaches the handler with the connection DIDs as the identities', async () => {
    const fake = makeFakeAgent({ connections: [{ id: 'v2', did: ALICE, theirDid: BOB, didcommVersion: 'v2' }] })
    const verdicts: V2InboundVerdict[] = []
    const received: Array<[Record<string, unknown>, Record<string, unknown>]> = []
    createDidCommV2Carriage(fake.agent, (v) => verdicts.push(v)).onDocument(async (document, peer) => {
      received.push([document, peer as Record<string, unknown>])
    })
    await fake.handler()({
      message: inboundInstance(DOC, { thid: DOC.threadId, from: BOB, to: [ALICE] }),
      connection: fake.connections[0],
      senderKey: {},
      senderDid: BOB,
    })
    expect(verdicts).toEqual(['ok'])
    expect(received).toHaveLength(1)
    expect(received[0][0]).toEqual(DOC)
    expect(received[0][1]).toEqual({ connectionId: 'v2', senderDid: BOB, recipientDid: ALICE })
  })

  test('inbound without an authenticated sender never reaches the handler', async () => {
    const fake = makeFakeAgent({ connections: [{ id: 'v2', did: ALICE, theirDid: BOB, didcommVersion: 'v2' }] })
    const verdicts: V2InboundVerdict[] = []
    const handler = jest.fn()
    createDidCommV2Carriage(fake.agent, (v) => verdicts.push(v)).onDocument(handler)
    await fake.handler()({ message: inboundInstance(DOC, { thid: DOC.threadId }), connection: fake.connections[0] })
    expect(verdicts).toEqual(['no-authenticated-sender'])
    expect(handler).not.toHaveBeenCalled()
  })

  test('inbound with thid ≠ threadId is refused as malformedRequest before the handler', async () => {
    const fake = makeFakeAgent({ connections: [{ id: 'v2', did: ALICE, theirDid: BOB, didcommVersion: 'v2' }] })
    const verdicts: V2InboundVerdict[] = []
    const handler = jest.fn()
    createDidCommV2Carriage(fake.agent, (v) => verdicts.push(v)).onDocument(handler)
    await fake.handler()({
      message: inboundInstance(DOC, { thid: '9f9f9f9f-0000-4000-8000-000000000000' }),
      connection: fake.connections[0],
      senderKey: {},
    })
    expect(verdicts).toEqual(['malformedRequest:thid'])
    expect(handler).not.toHaveBeenCalled()
  })

  test('first contact: a message on one of our own v2 invitations, from a key BOB\'s own DID document lists, mints the inviter-side connection', async () => {
    const bobsKey = fakeX25519KeyAgreementKey(1)
    const fake = makeFakeAgent({
      ownInvitationDids: [ALICE],
      didDocuments: { [BOB]: { keyAgreement: [bobsKey.verificationMethod] } },
    })
    const verdicts: V2InboundVerdict[] = []
    const received: Record<string, unknown>[] = []
    createDidCommV2Carriage(fake.agent, (v) => verdicts.push(v)).onDocument(async (_document, peer) => {
      received.push(peer as Record<string, unknown>)
    })
    await fake.handler()({
      message: inboundInstance(DOC, { thid: DOC.threadId, from: BOB, to: [ALICE] }),
      senderKey: bobsKey.publicJwk,
      senderDid: BOB,
    })
    expect(verdicts).toEqual(['ok'])
    expect(fake.created).toHaveLength(1)
    expect(fake.created[0]).toMatchObject({
      did: ALICE,
      theirDid: BOB,
      didcommVersion: 'v2',
      invitationDid: ALICE,
      outOfBandId: 'oob-0',
    })
    expect(received[0]).toEqual({ connectionId: 'conn-1', senderDid: BOB, recipientDid: ALICE })
  })

  test('first contact on a DID that is not one of our invitations is refused, and nothing is created', async () => {
    const bobsKey = fakeX25519KeyAgreementKey(1)
    const fake = makeFakeAgent({ ownInvitationDids: [], didDocuments: { [BOB]: { keyAgreement: [bobsKey.verificationMethod] } } })
    const verdicts: V2InboundVerdict[] = []
    const handler = jest.fn()
    createDidCommV2Carriage(fake.agent, (v) => verdicts.push(v)).onDocument(handler)
    await fake.handler()({
      message: inboundInstance(DOC, { thid: DOC.threadId, from: BOB, to: [ALICE] }),
      senderKey: bobsKey.publicJwk,
      senderDid: BOB,
    })
    expect(verdicts).toEqual(['no-connection'])
    expect(fake.created).toHaveLength(0)
    expect(handler).not.toHaveBeenCalled()
  })

  test('security — first contact plaintext-claiming to be BOB, authenticated by a key BOB\'s DID document does NOT list, is refused (no connection minted, no document processed)', async () => {
    // The vulnerability this closes: DIDComm v2 first contact has no
    // handshake, and ensureV2ConnectionForFirstContact used to bind
    // theirDid straight from the plaintext `from` header — an attacker
    // authenticated with ANY key could claim to be BOB. Now it must be
    // refused because the actual authenticating key (mallory's) is absent
    // from BOB's own resolved keyAgreement set.
    const bobsRealKey = fakeX25519KeyAgreementKey(1)
    const malloryKey = fakeX25519KeyAgreementKey(2)
    const fake = makeFakeAgent({
      ownInvitationDids: [ALICE],
      didDocuments: { [BOB]: { keyAgreement: [bobsRealKey.verificationMethod] } },
    })
    const verdicts: V2InboundVerdict[] = []
    const handler = jest.fn()
    createDidCommV2Carriage(fake.agent, (v) => verdicts.push(v)).onDocument(handler)
    await fake.handler()({
      message: inboundInstance(DOC, { thid: DOC.threadId, from: BOB, to: [ALICE] }),
      senderKey: malloryKey.publicJwk, // authenticated, but NOT a key BOB's document lists
      senderDid: BOB,
    })
    expect(verdicts).toEqual(['no-connection'])
    expect(fake.created).toHaveLength(0)
    expect(handler).not.toHaveBeenCalled()
  })
})
