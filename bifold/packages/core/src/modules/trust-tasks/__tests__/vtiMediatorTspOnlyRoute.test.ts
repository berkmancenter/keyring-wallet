import {
  ROUTE_LOOKUP_TIMEOUT_MS,
  VtiMediatorSession,
  type VtiClientIdentity,
  type VtiMediatorEndpoints,
} from '../module/VtiMediatorTransport'

// A community whose only messaging service is TSPTransport → another mediator (the SEDI VTC, 2026-11-17) is
// reached over DIDComm through that mediator: two forward layers. Every other document keeps the one forward it
// always had — the control rows below.

jest.mock('@credo-ts/core', () => ({
  ...jest.requireActual('@credo-ts/core'),
  // The mediator's key as Credo would read it; here, which verification method it came from is all a row needs.
  getPublicJwkFromVerificationMethod: (vm: { id: string }) => ({ kty: 'OKP', crv: 'X25519', vm: vm.id }),
}))

const OURS = 'did:webvh:QmFarm:farm.example:mediator'
const STORM = 'did:webvh:QmR5xGk8pkd3ymu7xpfkjr7XZmwDALA5ZJmgG7qcrD2mKA:webvh.storm.ws:mediator'
const SEDI = 'did:webs:webvh.storm.ws:sedi-vtc:EN7G2PZkzjb3TTWBrG3-oE5-A71XwLeX4et38jeh0C-a'
const FIRST_VTC = 'did:webvh:Qme5ThEEr1qRLRHYMrcrmjecG3znC8FBPEoswuSjebFkhx:webvh.storm.ws:first-vtc'
const LAB_VTC = 'did:webvh:QmLab:farm.example:lab-vtc'
const VTA = 'did:webvh:QmVta:farm.example:vta'

const mediatorDoc = (did: string, host: string) => ({
  id: did,
  keyAgreement: [`${did}#key-1`],
  dereferenceKey: (id: string) => ({ id }),
  service: [
    { id: `${did}#tsp`, type: 'TSPTransport', serviceEndpoint: `https://${host}/mediator/v1` },
    {
      id: `${did}#service`,
      type: ['DIDCommMessaging'],
      serviceEndpoint: [
        { accept: ['didcomm/v2'], routingKeys: [], uri: `https://${host}/mediator/v1` },
        { accept: ['didcomm/v2'], routingKeys: [], uri: `wss://${host}/mediator/v1/ws` },
      ],
    },
    { id: `${did}#auth`, type: ['Authentication'], serviceEndpoint: `https://${host}/mediator/v1/authenticate` },
  ],
})

/** The documents as published (services only; the keys a forward packs to are the mediators'). */
const DOCS: Record<string, unknown> = {
  [STORM]: mediatorDoc(STORM, 'mediator.vtc.storm.ws'),
  [OURS]: mediatorDoc(OURS, 'mediator.farm.example'),
  // SEDI: TSPTransport only, among its messaging services.
  [SEDI]: {
    id: SEDI,
    service: [
      { id: `${SEDI}#tsp`, type: ['TSPTransport'], serviceEndpoint: STORM },
      { id: `${SEDI}#vtc-rest`, type: ['VTCRest'], serviceEndpoint: 'https://sedi-vtc.openvti.net/v1' },
      { id: `${SEDI}#trust-tasks`, type: ['TrustTaskHTTPS'], serviceEndpoint: 'https://sedi-vtc.openvti.net/v1' },
    ],
  },
  // storm's first-vtc: TSPTransport AND DIDCommMessaging, both naming storm's mediator.
  [FIRST_VTC]: {
    id: FIRST_VTC,
    service: [
      { id: `${FIRST_VTC}#tsp`, type: 'TSPTransport', serviceEndpoint: STORM },
      { id: `${FIRST_VTC}#didcomm`, type: 'DIDCommMessaging', serviceEndpoint: STORM },
      { id: `${FIRST_VTC}#vtc-rest`, type: 'VTCRest', serviceEndpoint: 'https://first.openvtc.net/v1' },
    ],
  },
  // A lab community on our own mediator.
  [LAB_VTC]: {
    id: LAB_VTC,
    service: [
      { id: `${LAB_VTC}#tsp`, type: 'TSPTransport', serviceEndpoint: OURS },
      { id: `${LAB_VTC}#didcomm`, type: 'DIDCommMessaging', serviceEndpoint: [{ uri: OURS, accept: ['didcomm/v2'] }] },
    ],
  },
  // A VTA: DIDCommMessaging, no TSPTransport.
  [VTA]: { id: VTA, service: [{ id: `${VTA}#didcomm`, type: 'DIDCommMessaging', serviceEndpoint: OURS }] },
}

const identity: VtiClientIdentity = {
  did: 'did:webvh:QmPersona:farm.example:p',
  kid: 'p#key-1',
  senderKey: {} as never,
}
const mediator: VtiMediatorEndpoints = {
  did: OURS,
  authEndpoint: 'https://mediator.farm.example/mediator/v1/authenticate',
  wsEndpoint: 'wss://mediator.farm.example/mediator/v1/ws',
  publicJwk: {} as never,
  kid: `${OURS}#key-1`,
}

function makeAgent(docs: Record<string, unknown>) {
  const resolved: string[] = []
  const agent = {
    config: {
      logger: { info: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined },
    },
    context: {},
    dids: {
      resolveDidDocument: async (did: string) => {
        resolved.push(did)
        const doc = docs[did]
        if (!doc) throw new Error(`notFound ${did}`)
        return doc
      },
    },
    // A "pack" that shows who a layer was packed for, around the plaintext as it was.
    dependencyManager: {
      resolve: () => ({
        pack: async (_c: unknown, plaintext: unknown, o: { recipientKey: { keyId: string } }) => ({
          packedFor: o.recipientKey.keyId,
          plaintext,
        }),
      }),
    },
  } as never
  return { agent, resolved }
}

/** A session with an open socket that records each frame sent. */
function openSession(agent: never) {
  const session = new VtiMediatorSession(agent, identity, mediator, {})
  const frames: unknown[] = []
  ;(session as unknown as { socket: unknown }).socket = {
    readyState: 1,
    send: (frame: string) => frames.push(JSON.parse(frame)),
    close: () => undefined,
  }
  return { session, frames }
}

type Layer = {
  packedFor: string
  plaintext: {
    type: string
    from: string
    to: string[]
    body: { next: string }
    attachments: { data: { json: unknown } }[]
  }
}

const INNER_JWE = { protected: 'eyJ…', ciphertext: 'the authcrypted Trust Task, for the community' }
const FORWARD = 'https://didcomm.org/routing/2.0/forward'

/** The one forward every peer got before: to our mediator, `next` = the peer, the peer's JWE as it was. */
function expectSingleForward(frame: unknown, peer: string) {
  const layer = frame as Layer
  expect(layer.packedFor).toBe(`${OURS}#key-1`)
  expect(Object.keys(layer.plaintext).sort()).toEqual(
    ['attachments', 'body', 'created_time', 'expires_time', 'from', 'id', 'to', 'typ', 'type'].sort()
  )
  expect(layer.plaintext).toMatchObject({ type: FORWARD, from: identity.did, to: [OURS], body: { next: peer } })
  expect(layer.plaintext.attachments).toHaveLength(1)
  expect(layer.plaintext.attachments[0].data).toEqual({ json: INNER_JWE })
}

describe('VtiMediatorSession.forward — a community that publishes only TSPTransport', () => {
  test('SEDI-shaped: two layers — our mediator relays to the TSP mediator, which delivers to the community', async () => {
    const { agent } = makeAgent(DOCS)
    const { session, frames } = openSession(agent)
    await session.forward(SEDI, JSON.stringify(INNER_JWE))

    expect(frames).toHaveLength(1)
    const outer = frames[0] as Layer
    expect(outer.packedFor).toBe(`${OURS}#key-1`)
    expect(outer.plaintext).toMatchObject({ type: FORWARD, from: identity.did, to: [OURS], body: { next: STORM } })
    const inner = outer.plaintext.attachments[0].data.json as Layer
    // Packed for storm's mediator's key: only it opens this layer.
    expect(inner.packedFor).toBe(`${STORM}#key-1`)
    expect(inner.plaintext).toMatchObject({ type: FORWARD, from: identity.did, to: [STORM], body: { next: SEDI } })
    expect(inner.plaintext.attachments[0].data).toEqual({ json: INNER_JWE })
  })

  test('SEDI-shaped: the route is read once a session, not once a message', async () => {
    const { agent, resolved } = makeAgent(DOCS)
    const { session, frames } = openSession(agent)
    await session.forward(SEDI, INNER_JWE)
    await session.forward(SEDI, INNER_JWE)
    expect(frames).toHaveLength(2)
    expect(resolved.filter((d) => d === SEDI)).toHaveLength(1)
    expect(resolved.filter((d) => d === STORM)).toHaveLength(1)
    expect((frames[1] as Layer).plaintext.body.next).toBe(STORM)
  })
})

// SEDI as it publishes since ~19:30Z on 11-17: DIDCommMessaging → storm's mediator beside TSPTransport. A single
// forward would leave our mediator to resolve the did:webs; through storm's mediator nothing on the way has to.
const SEDI_WITH_DIDCOMM = {
  id: SEDI,
  service: [
    { id: `${SEDI}#tsp`, type: ['TSPTransport'], serviceEndpoint: STORM },
    { id: `${SEDI}#didcomm`, type: ['DIDCommMessaging'], serviceEndpoint: [{ accept: ['didcomm/v2'], uri: STORM }] },
    { id: `${SEDI}#trust-tasks`, type: ['TrustTaskHTTPS'], serviceEndpoint: 'https://sedi-vtc.openvti.net/v1' },
  ],
}

describe('VtiMediatorSession.forward — a did:webs community whose DIDCommMessaging names another mediator', () => {
  test('SEDI as published now: two layers, through the mediator its DIDCommMessaging names', async () => {
    const { agent } = makeAgent({ ...DOCS, [SEDI]: SEDI_WITH_DIDCOMM })
    const { session, frames } = openSession(agent)
    await session.forward(SEDI, INNER_JWE)
    expect(frames).toHaveLength(1)
    const outer = frames[0] as Layer
    expect(outer.packedFor).toBe(`${OURS}#key-1`)
    expect(outer.plaintext).toMatchObject({ type: FORWARD, to: [OURS], body: { next: STORM } })
    const inner = outer.plaintext.attachments[0].data.json as Layer
    expect(inner.packedFor).toBe(`${STORM}#key-1`)
    expect(inner.plaintext).toMatchObject({ type: FORWARD, to: [STORM], body: { next: SEDI } })
    expect(inner.plaintext.attachments[0].data).toEqual({ json: INNER_JWE })
  })

  test('a did:webs whose DIDCommMessaging names OUR mediator: one forward, as before', async () => {
    const peer = 'did:webs:farm.example:vtc:EOurs'
    const { agent } = makeAgent({
      ...DOCS,
      [peer]: { id: peer, service: [{ id: `${peer}#didcomm`, type: ['DIDCommMessaging'], serviceEndpoint: OURS }] },
    })
    const { session, frames } = openSession(agent)
    await session.forward(peer, INNER_JWE)
    expectSingleForward(frames[0], peer)
  })

  test('a did:webs whose DIDCommMessaging is a URL, not a mediator DID: one forward, as before', async () => {
    const peer = 'did:webs:elsewhere.example:vtc:EUrl'
    const { agent } = makeAgent({
      ...DOCS,
      [peer]: {
        id: peer,
        service: [
          { id: `${peer}#tsp`, type: 'TSPTransport', serviceEndpoint: STORM },
          { id: `${peer}#didcomm`, type: 'DIDCommMessaging', serviceEndpoint: 'https://elsewhere.example/didcomm' },
        ],
      },
    })
    const { session, frames } = openSession(agent)
    await session.forward(peer, INNER_JWE)
    expectSingleForward(frames[0], peer)
  })

  test("its mediator's document does not answer: forwarded as before after ROUTE_LOOKUP_TIMEOUT_MS, never held longer", async () => {
    jest.useFakeTimers()
    try {
      const { agent } = makeAgent({ ...DOCS, [SEDI]: SEDI_WITH_DIDCOMM })
      const dids = (agent as unknown as { dids: { resolveDidDocument: (did: string) => Promise<unknown> } }).dids
      const peerOnly = dids.resolveDidDocument
      // The community's document answers; storm's mediator's never does.
      dids.resolveDidDocument = (did: string) => (did === STORM ? new Promise<never>(() => undefined) : peerOnly(did))
      const { session, frames } = openSession(agent)
      let done = false
      const sent = session.forward(SEDI, INNER_JWE).then(() => (done = true))
      await jest.advanceTimersByTimeAsync(ROUTE_LOOKUP_TIMEOUT_MS + 1)
      expect(done).toBe(true)
      await sent
      expectSingleForward(frames[0], SEDI)
    } finally {
      jest.useRealTimers()
    }
  })

  test('a did:webvh shaped exactly like SEDI now (DIDCommMessaging → storm): one forward, as first-vtc', async () => {
    const peer = 'did:webvh:QmSame:webvh.storm.ws:same-shape'
    const { agent } = makeAgent({ ...DOCS, [peer]: { ...SEDI_WITH_DIDCOMM, id: peer } })
    const { session, frames } = openSession(agent)
    await session.forward(peer, INNER_JWE)
    expectSingleForward(frames[0], peer)
  })
})

describe('VtiMediatorSession.forward — every other document is forwarded as before (controls)', () => {
  test.each([
    ["storm's first-vtc (TSPTransport and DIDCommMessaging, another mediator)", FIRST_VTC],
    ['a lab community on our own mediator', LAB_VTC],
    ['a VTA (DIDCommMessaging only)', VTA],
  ])('%s: one forward, next = the peer', async (_what, peer) => {
    const { agent, resolved } = makeAgent(DOCS)
    const { session, frames } = openSession(agent)
    await session.forward(peer, INNER_JWE)
    expect(frames).toHaveLength(1)
    expectSingleForward(frames[0], peer)
    // No mediator document is read for it: nothing but the peer's own.
    expect(resolved).toEqual([peer])
  })

  test('TSPTransport only, but through OUR mediator: one forward, as before', async () => {
    const peer = 'did:webvh:QmTspOnly:farm.example:vtc'
    const { agent } = makeAgent({
      ...DOCS,
      [peer]: { id: peer, service: [{ id: `${peer}#tsp`, type: 'TSPTransport', serviceEndpoint: OURS }] },
    })
    const { session, frames } = openSession(agent)
    await session.forward(peer, INNER_JWE)
    expectSingleForward(frames[0], peer)
  })

  test('TSPTransport only, to a mediator whose document has no DIDCommMessaging pair: one forward, as before', async () => {
    const bare = 'did:webvh:QmBare:bare.example:mediator'
    const peer = 'did:webvh:QmTspOnly:bare.example:vtc'
    const { agent } = makeAgent({
      ...DOCS,
      [bare]: { id: bare, keyAgreement: [`${bare}#k`], dereferenceKey: (id: string) => ({ id }), service: [] },
      [peer]: { id: peer, service: [{ id: `${peer}#tsp`, type: 'TSPTransport', serviceEndpoint: bare }] },
    })
    const { session, frames } = openSession(agent)
    await session.forward(peer, INNER_JWE)
    expectSingleForward(frames[0], peer)
  })

  test('a peer whose document cannot be read: one forward, as before, and it is read again next time', async () => {
    const { agent, resolved } = makeAgent({ [STORM]: DOCS[STORM] })
    const { session, frames } = openSession(agent)
    await session.forward(SEDI, INNER_JWE)
    await session.forward(SEDI, INNER_JWE)
    expectSingleForward(frames[0], SEDI)
    expectSingleForward(frames[1], SEDI)
    expect(resolved.filter((d) => d === SEDI)).toHaveLength(2)
  })

  test('a peer whose document does not answer: forwarded as before after ROUTE_LOOKUP_TIMEOUT_MS, never held longer', async () => {
    jest.useFakeTimers()
    try {
      const { agent } = makeAgent(DOCS)
      ;(agent as unknown as { dids: { resolveDidDocument: () => Promise<never> } }).dids.resolveDidDocument = () =>
        new Promise<never>(() => undefined)
      const { session, frames } = openSession(agent)
      const sent = session.forward(SEDI, INNER_JWE)
      await jest.advanceTimersByTimeAsync(ROUTE_LOOKUP_TIMEOUT_MS + 1)
      await sent
      expect(ROUTE_LOOKUP_TIMEOUT_MS).toBeLessThanOrEqual(3_000)
      expectSingleForward(frames[0], SEDI)
    } finally {
      jest.useRealTimers()
    }
  })
})
