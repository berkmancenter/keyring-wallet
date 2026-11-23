import { PEER_ROUTE_READ_ONCE, PEER_ROUTE_TRIES_FOR_WEBS, VtiPeerRouteUnread } from '../module/peerRouteSwitch'
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

const SHIPPED = { ...PEER_ROUTE_READ_ONCE }
afterEach(() => Object.assign(PEER_ROUTE_READ_ONCE, SHIPPED))

function makeAgent(docs: Record<string, unknown>) {
  const resolved: string[] = []
  const said: string[] = []
  const agent = {
    config: {
      logger: {
        info: (line: string) => void said.push(line),
        debug: () => undefined,
        warn: (line: string) => void said.push(line),
        error: () => undefined,
      },
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
  return { agent, resolved, said }
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

  /** SEDI as published now, whose mediator's document never answers; the community's own does. */
  const stormSilent = () => {
    const made = makeAgent({ ...DOCS, [SEDI]: SEDI_WITH_DIDCOMM })
    const dids = (made.agent as unknown as { dids: { resolveDidDocument: (did: string) => Promise<unknown> } }).dids
    const peerOnly = dids.resolveDidDocument
    dids.resolveDidDocument = (did: string) => (did === STORM ? new Promise<never>(() => undefined) : peerOnly(did))
    return made
  }

  test("its mediator's document does not answer: read twice, then the send fails and nothing goes through our mediator alone", async () => {
    jest.useFakeTimers()
    try {
      const { agent, said } = stormSilent()
      const { session, frames } = openSession(agent)
      let outcome: unknown = 'pending'
      const sent = session.forward(SEDI, INNER_JWE).then(
        () => (outcome = 'sent'),
        (e: unknown) => (outcome = e)
      )
      // One try's time: still reading (the second try).
      await jest.advanceTimersByTimeAsync(ROUTE_LOOKUP_TIMEOUT_MS + 1)
      expect(outcome).toBe('pending')
      await jest.advanceTimersByTimeAsync(ROUTE_LOOKUP_TIMEOUT_MS + 1)
      await sent
      expect(outcome).toBeInstanceOf(VtiPeerRouteUnread)
      expect((outcome as VtiPeerRouteUnread).code).toBe('peerRouteUnread')
      // Through our mediator alone a did:webs cannot arrive: not sent at all.
      expect(frames).toEqual([])
      const lines = said.filter((line) => line.includes('could not be read'))
      expect(lines).toHaveLength(PEER_ROUTE_TRIES_FOR_WEBS)
      expect(lines[0]).toMatch(/\(no answer in time\), try 1 of 2$/)
      expect(lines[1]).toMatch(
        /\(no answer in time\), try 2 of 2: nothing is sent, through our mediator alone it cannot arrive$/
      )
    } finally {
      jest.useRealTimers()
    }
  })

  test("killed, its mediator's document does not answer: forwarded as before after ROUTE_LOOKUP_TIMEOUT_MS, never held longer, and said", async () => {
    PEER_ROUTE_READ_ONCE.remoteOff = true
    jest.useFakeTimers()
    try {
      const { agent, said } = stormSilent()
      const { session, frames } = openSession(agent)
      let done = false
      const sent = session.forward(SEDI, INNER_JWE).then(() => (done = true))
      await jest.advanceTimersByTimeAsync(ROUTE_LOOKUP_TIMEOUT_MS + 1)
      expect(done).toBe(true)
      await sent
      expectSingleForward(frames[0], SEDI)
      // The line is written whether the switch is on or off: this loss used to be silent.
      expect(said.filter((line) => line.includes('could not be read'))).toEqual([
        expect.stringMatching(/try 1 of 1: forwarded through our mediator alone this time$/),
      ])
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

  // A peer that is not a did:webs and cannot be read is forwarded through our mediator alone: for it that is the route.
  const UNREADABLE = 'did:webvh:QmGone:elsewhere.example:vtc'

  test('a did:webvh peer whose document cannot be read: one try, one forward as before, said, and read again next time', async () => {
    const { agent, resolved, said } = makeAgent({ [STORM]: DOCS[STORM] })
    const { session, frames } = openSession(agent)
    await session.forward(UNREADABLE, INNER_JWE)
    await session.forward(UNREADABLE, INNER_JWE)
    expectSingleForward(frames[0], UNREADABLE)
    expectSingleForward(frames[1], UNREADABLE)
    expect(resolved.filter((d) => d === UNREADABLE)).toHaveLength(2)
    expect(said.filter((line) => line.includes('could not be read'))).toEqual([
      expect.stringMatching(/\(the read failed\), try 1 of 1: forwarded through our mediator alone this time$/),
      expect.stringMatching(/\(the read failed\), try 1 of 1: forwarded through our mediator alone this time$/),
    ])
  })

  test('a did:webvh peer whose document does not answer: forwarded as before after ROUTE_LOOKUP_TIMEOUT_MS, never held longer', async () => {
    jest.useFakeTimers()
    try {
      const { agent } = makeAgent(DOCS)
      ;(agent as unknown as { dids: { resolveDidDocument: () => Promise<never> } }).dids.resolveDidDocument = () =>
        new Promise<never>(() => undefined)
      const { session, frames } = openSession(agent)
      const sent = session.forward(UNREADABLE, INNER_JWE)
      await jest.advanceTimersByTimeAsync(ROUTE_LOOKUP_TIMEOUT_MS + 1)
      await sent
      expect(ROUTE_LOOKUP_TIMEOUT_MS).toBeLessThanOrEqual(3_000)
      expectSingleForward(frames[0], UNREADABLE)
    } finally {
      jest.useRealTimers()
    }
  })

  test('a did:webs peer whose own document cannot be read: the send fails, nothing is kept, and the next send reads it again', async () => {
    const docs: Record<string, unknown> = { [STORM]: DOCS[STORM] }
    const { agent, resolved } = makeAgent(docs)
    const { session, frames } = openSession(agent)
    await expect(session.forward(SEDI, INNER_JWE)).rejects.toBeInstanceOf(VtiPeerRouteUnread)
    expect(frames).toEqual([])
    expect(resolved.filter((d) => d === SEDI)).toHaveLength(PEER_ROUTE_TRIES_FOR_WEBS)
    // The document can be read now: the next send reads it, and goes the two-layer way.
    docs[SEDI] = SEDI_WITH_DIDCOMM
    await session.forward(SEDI, INNER_JWE)
    expect(frames).toHaveLength(1)
    expect((frames[0] as Layer).plaintext.body.next).toBe(STORM)
  })
})

// Report BC46-XSQD (279.4, 11-18): nine asks to SEDI in one millisecond after the session connected. Each send that
// got to the forward before the first had stored the route read it for itself, and one whose read failed went through
// our mediator alone, where a did:webs cannot arrive, with nothing said. Two of the nine were never answered.
describe('VtiMediatorSession.forward — many sends to one peer at once', () => {
  const NINE = Array.from({ length: 9 }, (_, i) => i)
  const sediNow = () => makeAgent({ ...DOCS, [SEDI]: SEDI_WITH_DIDCOMM })
  const twoLayers = (frame: unknown) => (frame as Layer).plaintext.body.next === STORM

  test('nine at once: the route is read once, and all nine go the two-layer way', async () => {
    const { agent, resolved } = sediNow()
    const { session, frames } = openSession(agent)
    await Promise.all(NINE.map(() => session.forward(SEDI, INNER_JWE)))
    expect(frames).toHaveLength(9)
    expect(frames.every(twoLayers)).toBe(true)
    expect(resolved.filter((d) => d === SEDI)).toHaveLength(1)
    expect(resolved.filter((d) => d === STORM)).toHaveLength(1)
  })

  test('killed (control): nine at once each read it for themselves, the burst there was before', async () => {
    PEER_ROUTE_READ_ONCE.remoteOff = true
    const { agent, resolved } = sediNow()
    const { session, frames } = openSession(agent)
    await Promise.all(NINE.map(() => session.forward(SEDI, INNER_JWE)))
    expect(frames).toHaveLength(9)
    expect(resolved.filter((d) => d === STORM)).toHaveLength(9)
  })

  test.each([
    ['on false', { on: false, remoteOff: false }],
    ['on not a boolean', { on: 'true', remoteOff: false }],
    ['remoteOff not a boolean', { on: true, remoteOff: 'false' }],
    ['remoteOff missing', { on: true, remoteOff: undefined }],
  ])('fails closed (%s): each send reads for itself', async (_name, values) => {
    Object.assign(PEER_ROUTE_READ_ONCE, values)
    const { agent, resolved } = sediNow()
    const { session } = openSession(agent)
    await Promise.all([0, 1, 2].map(() => session.forward(SEDI, INNER_JWE)))
    expect(resolved.filter((d) => d === STORM)).toHaveLength(3)
  })

  // `resolveVtiMediator` retries a refused resolution itself, patiently, and the route's own time limit cuts that off:
  // a try that fails is one that ran out of time. So these rows run on fake timers.
  const unreadLines = (said: string[]) => said.filter((line) => line.includes('could not be read'))

  test("the mediator's document is refused through the first try, then answers: all nine wait for the one read and go the two-layer way", async () => {
    jest.useFakeTimers()
    try {
      const { agent, said } = sediNow()
      const dids = (agent as unknown as { dids: { resolveDidDocument: (did: string) => Promise<unknown> } }).dids
      const real = dids.resolveDidDocument
      // Refused (a host's 421 under a burst) until the first try has been given up.
      dids.resolveDidDocument = (did: string) =>
        did === STORM && unreadLines(said).length === 0
          ? Promise.reject(new Error('421 Misdirected Request'))
          : real(did)
      const { session, frames } = openSession(agent)
      const sent = Promise.all(NINE.map(() => session.forward(SEDI, INNER_JWE)))
      // Just short of the first try's time: all nine are waiting on the one read, and none has gone through our
      // mediator alone.
      await jest.advanceTimersByTimeAsync(ROUTE_LOOKUP_TIMEOUT_MS - 1)
      expect(frames).toEqual([])
      expect(unreadLines(said)).toEqual([])
      // The first try is given up, and the second finds the document answering.
      await jest.advanceTimersByTimeAsync(2)
      await sent
      expect(frames).toHaveLength(9)
      expect(frames.every(twoLayers)).toBe(true)
      expect(unreadLines(said)).toEqual([expect.stringMatching(/\(no answer in time\), try 1 of 2$/)])
    } finally {
      jest.useRealTimers()
    }
  })

  test('the route cannot be read at all: all nine fail the same way, none is sent, and it was tried twice, not eighteen times', async () => {
    jest.useFakeTimers()
    try {
      const { agent, said } = makeAgent({ ...DOCS, [SEDI]: SEDI_WITH_DIDCOMM, [STORM]: undefined })
      const { session, frames } = openSession(agent)
      const ended = Promise.allSettled(NINE.map(() => session.forward(SEDI, INNER_JWE)))
      await jest.advanceTimersByTimeAsync(2 * (ROUTE_LOOKUP_TIMEOUT_MS + 1))
      const results = await ended
      expect(results.map((one) => one.status)).toEqual(NINE.map(() => 'rejected'))
      for (const one of results) expect((one as PromiseRejectedResult).reason).toBeInstanceOf(VtiPeerRouteUnread)
      expect(frames).toEqual([])
      expect(unreadLines(said)).toHaveLength(PEER_ROUTE_TRIES_FOR_WEBS)
    } finally {
      jest.useRealTimers()
    }
  })

  test('a did:webvh peer that cannot be read, three at once: one read, and each is forwarded as before', async () => {
    const peer = 'did:webvh:QmGone:elsewhere.example:vtc'
    const { agent, resolved } = makeAgent({ [STORM]: DOCS[STORM] })
    const { session, frames } = openSession(agent)
    await Promise.all([0, 1, 2].map(() => session.forward(peer, INNER_JWE)))
    expect(frames).toHaveLength(3)
    for (const frame of frames) expectSingleForward(frame, peer)
    expect(resolved.filter((d) => d === peer)).toHaveLength(1)
  })

  test('the line about an unread route names the peer by its prefix and carries nothing of the message', async () => {
    const { agent, said } = makeAgent({ [STORM]: DOCS[STORM] })
    const { session } = openSession(agent)
    await session.forward(SEDI, INNER_JWE).catch(() => undefined)
    const lines = said.filter((line) => line.includes('could not be read'))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line).not.toContain(INNER_JWE.ciphertext)
      expect(line).not.toContain(INNER_JWE.protected)
      expect(line).not.toContain(identity.did)
    }
  })
})
