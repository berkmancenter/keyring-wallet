/**
 * TspCarriage — the glue code this module adds beyond what
 * @bifold/trust-tasks's tsp.pack/unpack and @bifold/credo-tsp-adapter's
 * identity/resolver already prove: JSON document <-> TSP envelope bytes
 * marshaling, the DIDComm-v1 delivery wrapper (TspEnvelopeMessage), and the
 * "reject an envelope whose claimed sender disagrees with the connection's
 * counterparty" policy check.
 *
 * @bifold/credo-tsp-adapter is mocked here with raw-key ports (real
 * @noble/curves crypto, no Askar) — this suite runs under @bifold/core's
 * react-native jest preset, which cannot load real Askar native bindings
 * (matching documentProof.test.ts's own note that live-KMS code is proven by
 * the e2e run instead). credo-tsp-adapter's OWN test suite (Node, real
 * Askar) already proves the ports it exports are correct; this suite only
 * needs to prove TspCarriage's own new orchestration around them.
 */
import { DidCommMessageHandlerRegistry, DidCommMessageSender } from '@credo-ts/didcomm'

import { createTspCarriage } from '../module/TspCarriage'
import { TspEnvelopeMessage } from '../messages/TspEnvelopeMessage'

// jest.mock's factory can't close over module-scope variables (hoisting), so
// the identity registry lives entirely inside the factory and is exposed as
// an extra, test-only export (`__registerIdentity`) on the mocked module.
jest.mock('@bifold/credo-tsp-adapter', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ed25519, x25519 } = require('@noble/curves/ed25519.js')
  const identities = new Map()

  function identityFor(did: string) {
    const keys = identities.get(did)
    if (!keys) throw new Error(`test fixture: no identity registered for ${did}`)
    return {
      signingKey: {
        publicKey: ed25519.getPublicKey(keys.signingSk),
        async sign(message: Uint8Array) {
          return ed25519.sign(message, keys.signingSk)
        },
      },
      keyAgreement: {
        publicKey: x25519.getPublicKey(keys.encSk),
        async agree(peerPublicKey: Uint8Array) {
          return x25519.getSharedSecret(keys.encSk, peerPublicKey)
        },
      },
    }
  }

  return {
    __registerIdentity: (did: string) => {
      identities.set(did, { signingSk: ed25519.utils.randomSecretKey(), encSk: x25519.utils.randomSecretKey() })
    },
    identityFromDid: async (_agent: unknown, did: string) => identityFor(did),
    createCredoVidResolver: () => ({
      resolve: async (vid: string) => {
        const identity = identityFor(vid)
        return { encryptionPublicKey: identity.keyAgreement.publicKey, signingPublicKey: identity.signingKey.publicKey }
      },
    }),
    // Same rule as the real adapter's unpackForConnection (credo-tsp-adapter/src/connection.ts):
    // our current-or-previous DIDs, the counterparty's current-or-previous DIDs.
    unpackForConnection: async (
      _agent: unknown,
      envelope: Uint8Array,
      connection: {
        id: string
        did?: string
        theirDid?: string
        previousDids?: string[]
        previousTheirDids?: string[]
      },
      resolver: unknown
    ) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { tsp } = require('@bifold/trust-tasks')
      const ours = [connection.did, ...(connection.previousDids ?? [])].filter(Boolean) as string[]
      let lastError: unknown
      for (const did of ours) {
        try {
          const unpacked = await tsp.unpack(envelope, identityFor(did), resolver)
          const theirs = [connection.theirDid, ...(connection.previousTheirDids ?? [])]
          if (!theirs.includes(unpacked.sender)) {
            throw new Error(`envelope's claimed sender (${unpacked.sender}) is not a DID of the counterparty`)
          }
          return { unpacked, receivedAs: did }
        } catch (error) {
          lastError = error
        }
      }
      throw lastError
    },
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { __registerIdentity: registerIdentity } = require('@bifold/credo-tsp-adapter')

type FakeConnection = {
  did: string
  theirDid: string
  didcommVersion?: 'v1' | 'v2'
  previousDids?: string[]
  previousTheirDids?: string[]
  /** What the contact said about reading TSP (contactTspCapability.ts), kept on the record. */
  tspCapability?: { reads: boolean; at: number; from: 'discovery' | 'envelope' }
}

function makeFakeAgent(
  connections: Record<string, FakeConnection>,
  discovery: { queryFeatures: jest.Mock } = { queryFeatures: jest.fn(async () => ({ features: [] })) }
) {
  const sent: unknown[] = []
  const record = (id: string) => {
    const conn = connections[id]
    if (!conn) return undefined
    return {
      id,
      ...conn,
      metadata: {
        get: (key: string) => (key === 'keyring:tspCarriage' ? (conn.tspCapability ?? null) : null),
        set: (key: string, value: FakeConnection['tspCapability']) => {
          if (key === 'keyring:tspCarriage') conn.tspCapability = value
        },
      },
    }
  }
  let registeredHandler:
    | ((messageContext: {
        message: TspEnvelopeMessage
        connection: { id: string } & FakeConnection
      }) => Promise<unknown>)
    | undefined

  const container = {
    resolve: (token: unknown) => {
      if (token === DidCommMessageSender) {
        return { sendMessage: async (context: { message: unknown }) => sent.push(context.message) }
      }
      if (token === DidCommMessageHandlerRegistry) {
        return {
          registerMessageHandler: (handlerDef: { handle: typeof registeredHandler }) => {
            registeredHandler = handlerDef.handle
          },
        }
      }
      throw new Error(`fake container cannot resolve ${String(token)}`)
    },
  }

  const agent = {
    config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
    dependencyManager: { container },
    modules: {
      didcomm: {
        connections: {
          getById: async (id: string) => {
            const conn = record(id)
            if (!conn) throw new Error(`fake connections: no connection ${id}`)
            return conn
          },
          findById: async (id: string) => record(id) ?? null,
          update: async () => undefined,
        },
        discovery,
      },
    },
  }

  return {
    agent: agent as never,
    sent,
    deliver: async (connectionId: string) => {
      if (!registeredHandler) throw new Error('test setup: onDocument was never called')
      const message = sent.pop()
      if (!message) throw new Error('test setup: nothing was sent')
      const conn = connections[connectionId]
      return registeredHandler({ message: message as TspEnvelopeMessage, connection: { id: connectionId, ...conn } })
    },
  }
}

describe('TspCarriage', () => {
  test('send/onDocument round-trips a JSON document as a real TSP envelope', async () => {
    const aliceDid = 'did:example:alice'
    const bobDid = 'did:example:bob'
    registerIdentity(aliceDid)
    registerIdentity(bobDid)

    const alice = makeFakeAgent({ 'conn-1': { did: aliceDid, theirDid: bobDid } })
    const bob = makeFakeAgent({ 'conn-1': { did: bobDid, theirDid: aliceDid } })

    const document = { type: 'https://example.org/hello/0.1', id: 'doc-1', greeting: 'hello from alice' }
    await createTspCarriage(alice.agent).send(document, { connectionId: 'conn-1' })

    expect(alice.sent).toHaveLength(1)
    expect(alice.sent[0]).toBeInstanceOf(TspEnvelopeMessage)

    let received: Record<string, unknown> | undefined
    createTspCarriage(bob.agent).onDocument(async (doc) => {
      received = doc
    })

    bob.sent.push(alice.sent[0])
    await bob.deliver('conn-1')

    expect(received).toEqual(document)
  })

  test('rejects an envelope whose claimed sender disagrees with the connection counterparty', async () => {
    const aliceDid = 'did:example:alice2'
    const bobDid = 'did:example:bob2'
    const malloryDid = 'did:example:mallory2'
    registerIdentity(aliceDid)
    registerIdentity(bobDid)
    registerIdentity(malloryDid)

    // mallory packs a genuinely valid envelope to bob — correctly encrypted
    // to bob's real key, correctly signed as herself — so decryption and
    // signature verification both succeed. The mismatch is purely that
    // bob's OWN connection record says his counterparty is alice.
    const mallory = makeFakeAgent({ 'conn-x': { did: malloryDid, theirDid: bobDid } })
    await createTspCarriage(mallory.agent).send({ type: 'x', id: '1' }, { connectionId: 'conn-x' })

    const bob = makeFakeAgent({ 'conn-1': { did: bobDid, theirDid: aliceDid } })
    let handlerRan = false
    createTspCarriage(bob.agent).onDocument(async () => {
      handlerRan = true
    })

    bob.sent.push(mallory.sent[0])
    await expect(bob.deliver('conn-1')).rejects.toThrow(/not a DID of/)
    expect(handlerRan).toBe(false)
  })
})

describe('carriage selection (ceremony.ts)', () => {
  // ceremony.ts pulls in the vrc-manager module at import time; ceremony.test.ts
  // mocks it for the same reason (it isn't exercised by sendTrustTaskDocument).
  jest.mock('../../vrc/vrc-manager', () => ({
    RCE_PROTOCOL_VERSION: 4,
    getOrCreateRelationshipDid: jest.fn(),
    getConnectedWitnessConnectionId: jest.fn(),
    issueRCardForAcceptedExchange: jest.fn(),
  }))

  const ceremony = () => require('../ceremony') as typeof import('../ceremony')
  const capability = () => require('../module/contactTspCapability') as typeof import('../module/contactTspCapability')
  const yes = { reads: true, at: Date.now(), from: 'discovery' as const }
  const freshNo = { reads: false, at: Date.now(), from: 'discovery' as const }

  afterEach(() => {
    ceremony().setTspCarriageEnabled(true)
    ceremony().TSP_SEND_REMOTE_OFF.off = false
    capability().resetTspCapabilityQuestions()
  })

  test('TSP carriage is on as shipped', () => {
    jest.isolateModules(() => {
      const fresh = require('../ceremony') as typeof import('../ceremony')
      expect(fresh.TSP_CARRIAGE_ON_BY_DEFAULT).toBe(true)
      expect(fresh.isTspCarriageEnabled()).toBe(true)
    })
  })

  test('CONTROL: TSP on, and the contact has said it reads TSP: the document goes as a TSP envelope', async () => {
    const aliceDid = 'did:example:selected-alice'
    const bobDid = 'did:example:selected-bob'
    registerIdentity(aliceDid)
    registerIdentity(bobDid)
    const { agent, sent } = makeFakeAgent({ 'conn-1': { did: aliceDid, theirDid: bobDid, tspCapability: yes } })

    await ceremony().sendTrustTaskDocument(agent, 'conn-1', { type: 'x', id: '1' })
    expect(sent[0]).toBeInstanceOf(TspEnvelopeMessage)
  })

  test('TSP on, but nothing is known about the contact: the binding, and the contact is asked once, in the background', async () => {
    const did = 'did:example:unknown-peer'
    registerIdentity(did)
    const queryFeatures = jest.fn(async () => ({ features: [] }))
    const { agent, sent } = makeFakeAgent({ 'conn-1': { did, theirDid: did } }, { queryFeatures })

    await ceremony().sendTrustTaskDocument(agent, 'conn-1', { type: 'x', id: '1' })
    expect(sent[0]).not.toBeInstanceOf(TspEnvelopeMessage)
    expect(queryFeatures).toHaveBeenCalledTimes(1)
    expect(queryFeatures).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn-1',
        protocolVersion: 'v2',
        queries: [{ featureType: 'protocol', match: capability().TSP_ENVELOPE_PROTOCOL_URI }],
      })
    )
  })

  test('TSP on, and the contact said it does not read TSP: the binding, and it is not asked again the same day', async () => {
    const did = 'did:example:old-build'
    registerIdentity(did)
    const queryFeatures = jest.fn(async () => ({ features: [] }))
    const { agent, sent } = makeFakeAgent(
      { 'conn-1': { did, theirDid: did, tspCapability: freshNo } },
      { queryFeatures }
    )

    await ceremony().sendTrustTaskDocument(agent, 'conn-1', { type: 'x', id: '1' })
    expect(sent[0]).not.toBeInstanceOf(TspEnvelopeMessage)
    expect(queryFeatures).not.toHaveBeenCalled()
  })

  test("a contact's no older than a day is asked again (it may have updated); this send still takes the binding", async () => {
    const did = 'did:example:stale-no'
    const queryFeatures = jest.fn(async () => ({ features: [] }))
    const stale = { reads: false, at: Date.now() - capability().TSP_NO_RECHECK_MS - 1, from: 'discovery' as const }
    const { agent } = makeFakeAgent({ 'conn-1': { did, theirDid: did, tspCapability: stale } }, { queryFeatures })

    expect(await ceremony().selectCarriage(agent, 'conn-1')).toBe('didcomm-v1')
    expect(queryFeatures).toHaveBeenCalledTimes(1)
  })

  test('the release kill beats a contact that reads TSP: the binding', async () => {
    ceremony().TSP_SEND_REMOTE_OFF.off = true
    const { agent } = makeFakeAgent({
      'conn-1': { did: 'did:example:a', theirDid: 'did:example:b', tspCapability: yes },
    })
    expect(ceremony().isTspCarriageEnabled()).toBe(false)
    expect(await ceremony().selectCarriage(agent, 'conn-1')).toBe('didcomm-v1')
  })

  test.each([
    [false, 'v1', true, 'didcomm-v1'],
    [false, 'v2', true, 'didcomm-v2'],
    [true, 'v1', true, 'tsp'],
    [true, 'v2', true, 'tsp'],
    [true, 'v1', false, 'didcomm-v1'],
    [true, 'v2', false, 'didcomm-v2'],
  ])(
    'selectCarriage: TSP setting %s on a %s connection, contact reads TSP %s → %s (TSP rides either DIDComm version)',
    async (flag, version, reads, expected) => {
      ceremony().setTspCarriageEnabled(flag)
      const { agent } = makeFakeAgent({
        'conn-1': {
          did: 'did:example:a',
          theirDid: 'did:example:b',
          didcommVersion: version as 'v1' | 'v2',
          tspCapability: reads ? yes : freshNo,
        },
      })
      expect(await ceremony().selectCarriage(agent, 'conn-1')).toBe(expected)
    }
  )
})

describe('TspCarriage over a DIDComm v2 connection whose DID rotated (V2T change 3)', () => {
  test('an envelope sealed to our PREVIOUS DID, from the peer, is accepted and handled', async () => {
    const invitationDid = 'did:example:witness-invitation'
    const rotatedDid = 'did:example:witness-rotated'
    const walletDid = 'did:example:wallet'
    registerIdentity(invitationDid)
    registerIdentity(rotatedDid)
    registerIdentity(walletDid)

    // The wallet still addresses the invitation DID; the witness has already rotated.
    const wallet = makeFakeAgent({ w: { did: walletDid, theirDid: invitationDid, didcommVersion: 'v2' } })
    const witness = makeFakeAgent({
      w: { did: rotatedDid, theirDid: walletDid, didcommVersion: 'v2', previousDids: [invitationDid] },
    })

    const walletCarriage = createTspCarriage(wallet.agent)
    const witnessCarriage = createTspCarriage(witness.agent)
    const received: Record<string, unknown>[] = []
    witnessCarriage.onDocument(async (document) => {
      received.push(document)
    })

    await walletCarriage.send({ type: 'x', id: 'sealed-to-previous' }, { connectionId: 'w' })
    witness.sent.push(wallet.sent.pop())
    await witness.deliver('w')
    expect(received).toEqual([{ type: 'x', id: 'sealed-to-previous' }])
  })

  test('an envelope from a DID the counterparty never held is still refused', async () => {
    const walletDid = 'did:example:wallet-2'
    const witnessDid = 'did:example:witness-2'
    const strangerDid = 'did:example:stranger'
    registerIdentity(walletDid)
    registerIdentity(witnessDid)
    registerIdentity(strangerDid)

    const stranger = makeFakeAgent({ s: { did: strangerDid, theirDid: witnessDid, didcommVersion: 'v2' } })
    const witness = makeFakeAgent({
      s: { did: witnessDid, theirDid: walletDid, didcommVersion: 'v2', previousTheirDids: [] },
    })
    let handlerRan = false
    createTspCarriage(witness.agent).onDocument(async () => {
      handlerRan = true
    })
    await createTspCarriage(stranger.agent).send({ type: 'x', id: 'forged' }, { connectionId: 's' })
    witness.sent.push(stranger.sent.pop())
    await expect(witness.deliver('s')).rejects.toThrow(/not a DID of/)
    expect(handlerRan).toBe(false)
  })
})
