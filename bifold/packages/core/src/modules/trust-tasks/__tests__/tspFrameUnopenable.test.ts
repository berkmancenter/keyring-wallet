/**
 * A TSP frame that can never be opened here is acknowledged and dropped; one
 * that cannot be opened YET stays queued (report D7FG-2Y9J, 2026-10-21).
 *
 * A frame left queued for ever comes back on every delivery-request and fills
 * the queue a peer's replies need: the mediator refuses them, and the agent
 * marks the phone as not collecting its inbox. But acknowledging drops a frame
 * for good, so only a lasting reason counts: the receiver's key used and the
 * frame still shut, or bytes no codec can read. A key not in memory yet, a
 * sender's DID that did not resolve, a signature checked against a document
 * just rotated: those frames wait, and are opened once they can be.
 */
import { tsp } from '@bifold/trust-tasks'

import { isTspFrameUnopenable } from '../module/tspFrameUnopenable'
import { VtiMediatorSession, type VtiClientIdentity, type VtiMediatorEndpoints } from '../module/VtiMediatorTransport'
import { unpackTrustTaskFromPeer, type TspSessionIdentity } from '../module/vtiTsp'

const ME = 'did:peer:2.manager'
const AGENT = 'did:webvh:QmA:dids.example:agent'
const KEYS = { signingPublicKey: new Uint8Array(32), encryptionPublicKey: new Uint8Array(32) }

type Stage = 'read' | 'resolve' | 'verify' | 'agree' | 'open'
/** A codec whose unpack walks the stages a real rev3 unpack does, failing at `failAt` (or answering `receiver`). */
function sessionFailingAt(failAt: Stage | 'none', options: { keyLoaded?: boolean; receiver?: string } = {}) {
  const agree = jest.fn(async () => {
    if (options.keyLoaded === false) throw new Error('KeyNotFound: no in-memory copy of the key yet')
    return new Uint8Array(32).fill(7)
  })
  const resolve = jest.fn(async () => {
    if (failAt === 'resolve') throw new Error('fetch failed: the DID host did not answer')
    return KEYS
  })
  const unpack = jest.fn(async (_bytes: Uint8Array, identity: tsp.TspIdentity, resolver: tsp.VidResolver) => {
    if (failAt === 'read') throw new Error('tsp: message too short')
    await resolver.resolve(AGENT)
    if (failAt === 'verify') throw new Error('tsp: signature verification failed')
    await identity.keyAgreement.agree(new Uint8Array(32))
    if (failAt === 'open') throw new Error('tsp: hpke open failed')
    return {
      sender: AGENT,
      receiver: options.receiver ?? ME,
      payload: tsp.encodeTrustTaskEnvelope({ id: 'urn:uuid:1', type: 'https://example/x/0.1', payload: {} }),
    } as never
  })
  const session = {
    identity: { signingKey: {} as never, keyAgreement: { publicKey: new Uint8Array(32), agree } },
    resolver: { resolve },
    codec: { unpack, pack: jest.fn() },
  } as unknown as TspSessionIdentity
  return { session, agree, resolve }
}
const BYTES = new Uint8Array(64)
const reasonOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'opened',
    (error: unknown) => (isTspFrameUnopenable(error) ? error.reason : 'left queued')
  )

describe('which frames can never be opened here', () => {
  it('the key used, and the frame still shut: sealed to another key or relationship, lasting', async () => {
    expect(await reasonOf(unpackTrustTaskFromPeer(sessionFailingAt('open').session, BYTES, ME))).toBe('unsealFailed')
  })

  it('bytes no codec can read, before anything is resolved: lasting', async () => {
    expect(await reasonOf(unpackTrustTaskFromPeer(sessionFailingAt('read').session, BYTES, ME))).toBe('malformed')
  })

  it('opened, but for another identity, or naming another issuer: lasting', async () => {
    const other = sessionFailingAt('none', { receiver: 'did:peer:2.someone-else' })
    expect(await reasonOf(unpackTrustTaskFromPeer(other.session, BYTES, ME))).toBe('otherReceiver')
  })

  it("the receiver's key not in memory yet: transient, left queued", async () => {
    const { session, agree } = sessionFailingAt('none', { keyLoaded: false })
    expect(await reasonOf(unpackTrustTaskFromPeer(session, BYTES, ME))).toBe('left queued')
    expect(agree).toHaveBeenCalled()
  })

  it("the sender's DID not resolved, or its signature not matching (a document just rotated): left queued", async () => {
    expect(await reasonOf(unpackTrustTaskFromPeer(sessionFailingAt('resolve').session, BYTES, ME))).toBe('left queued')
    expect(await reasonOf(unpackTrustTaskFromPeer(sessionFailingAt('verify').session, BYTES, ME))).toBe('left queued')
  })

  it('a frame that opens is read as before', async () => {
    expect(await reasonOf(unpackTrustTaskFromPeer(sessionFailingAt('none').session, BYTES, ME))).toBe('opened')
  })
})

// The session: a lasting failure is acknowledged and said; a transient one is not, and is taken once it can be.
const identity: VtiClientIdentity = { did: ME, kid: `${ME}#key-2`, senderKey: {} as never }
const mediator: VtiMediatorEndpoints = {
  did: 'did:webvh:QmM:dids.example:mediator',
  authEndpoint: 'https://mediator.example/mediator/v1',
  wsEndpoint: 'wss://mediator.example/mediator/v1/ws',
  publicJwk: {} as never,
  kid: 'did:webvh:QmM:dids.example:mediator#key-1',
}
const agent = {
  config: { logger: { info: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined } },
} as never
const FRAME = '-EABXAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const DELIVERY = 'https://didcomm.org/messagepickup/3.0/delivery'

function collecting(consumer: (bytes: Uint8Array) => Promise<void>) {
  const onError = jest.fn()
  const s = new VtiMediatorSession(agent, identity, mediator, { onTspFrame: consumer, onMessage: jest.fn(), onError })
  const internals = s as unknown as {
    acknowledge: (ids: string[]) => Promise<void>
    handleFrame: (raw: string) => Promise<void>
    handleDelivery: (d: unknown) => Promise<void>
  }
  const acknowledge = jest.fn(async (_ids: string[]) => undefined)
  internals.acknowledge = acknowledge
  return {
    acknowledge,
    onError,
    live: () => internals.handleFrame(FRAME),
    pickup: () =>
      internals.handleDelivery({
        type: DELIVERY,
        attachments: [{ id: tsp.tspFrameQueueId(FRAME), data: { base64: FRAME } }],
      }),
  }
}

describe('what the session does with each', () => {
  let warn: jest.SpyInstance
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => warn.mockRestore())
  const said = () => warn.mock.calls.map(([line]) => String(line)).join('\n')

  it('a frame that can never be opened, pushed live: acknowledged, and the log names the reason class', async () => {
    const s = collecting((bytes) =>
      unpackTrustTaskFromPeer(sessionFailingAt('open').session, bytes, ME).then(() => undefined)
    )
    await s.live()
    expect(s.acknowledge).toHaveBeenCalledWith([tsp.tspFrameQueueId(FRAME)])
    expect(said()).toMatch(/dropped a TSP frame .* that can never be opened here \(unsealFailed\)/)
  })

  it('the same from a backlog drain: acknowledged, and the drain says what it found', async () => {
    const s = collecting((bytes) =>
      unpackTrustTaskFromPeer(sessionFailingAt('read').session, bytes, ME).then(() => undefined)
    )
    await s.pickup()
    expect(s.acknowledge).toHaveBeenCalledWith([tsp.tspFrameQueueId(FRAME)])
    expect(said()).toMatch(/\(malformed\)/)
    expect(said()).toMatch(/drained 1 queued .*: 1 taken, 1 dropped as never openable, 0 left queued/)
  })

  it('a frame whose key is not in memory yet: left queued, then taken once the key is there', async () => {
    let keyLoaded = false
    const consumer = jest.fn(async (bytes: Uint8Array) => {
      await unpackTrustTaskFromPeer(sessionFailingAt('none', { keyLoaded }).session, bytes, ME)
    })
    const s = collecting(consumer)
    await s.live()
    expect(s.acknowledge).not.toHaveBeenCalled()
    expect(said()).not.toMatch(/dropped a TSP frame/)
    // The key arrives (a fetch after a resume); the mediator delivers the frame again.
    keyLoaded = true
    await s.pickup()
    expect(consumer).toHaveBeenCalledTimes(2)
    expect(s.acknowledge).toHaveBeenCalledTimes(1)
    expect(s.acknowledge).toHaveBeenCalledWith([tsp.tspFrameQueueId(FRAME)])
  })

  it('a backlog frame left queued is counted as left, not taken', async () => {
    const s = collecting((bytes) =>
      unpackTrustTaskFromPeer(sessionFailingAt('none', { keyLoaded: false }).session, bytes, ME).then(() => undefined)
    )
    await s.pickup()
    expect(s.acknowledge).not.toHaveBeenCalled()
    expect(said()).toMatch(/drained 1 queued .*: 0 taken, 0 dropped as never openable, 1 left queued/)
  })
})
