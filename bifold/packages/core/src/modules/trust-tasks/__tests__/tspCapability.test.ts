import {
  TSP_SERVICE_TYPE,
  chooseCarriage,
  clearTspCapabilityCache,
  documentAdvertisesTsp,
  documentTspService,
  parseAdvertisedTspVersion,
  peerAdvertisesTsp,
  setPreferDidcommForUpstream,
} from '../module/tspCapability'

// §4.2: the envelope format is chosen from the peer's DID document, cached with
// a bounded TTL, and any fallback is announced. These pin the three halves of
// that rule — reading the document, expiring the answer, and saying which way
// it went — because each one fails silently if it is wrong.

const logs: { level: string; message: string }[] = []
const agentWith = (doc: unknown, onResolve?: () => void) =>
  ({
    config: {
      logger: {
        info: (m: string) => logs.push({ level: 'info', message: m }),
        warn: (m: string) => logs.push({ level: 'warn', message: m }),
        debug: (m: string) => logs.push({ level: 'debug', message: m }),
        error: () => undefined,
      },
    },
    dids: {
      resolveDidDocument: async () => {
        onResolve?.()
        if (doc instanceof Error) throw doc
        return doc
      },
    },
  }) as never

// Release lines (`releaseWarn`) go to console.warn.
const released: string[] = []
let warnSpy: jest.SpyInstance
beforeEach(() => {
  logs.length = 0
  released.length = 0
  clearTspCapabilityCache()
  warnSpy = jest.spyOn(console, 'warn').mockImplementation((m: unknown) => void released.push(String(m)))
})
afterEach(() => warnSpy.mockRestore())

describe('reading a document', () => {
  it('finds TSPTransport as a bare string, the way vta-service writes it', () => {
    expect(documentAdvertisesTsp({ service: [{ type: 'TSPTransport' }] })).toBe(true)
  })

  it('finds it inside an array, which DID Core equally permits', () => {
    // The Farm's mediator uses the array form for its own services, so a
    // reader that only understands strings calls a conformant document
    // incapable — the same class of bug as Credo refusing the document outright.
    expect(documentAdvertisesTsp({ service: [{ type: ['TSPTransport'] }] })).toBe(true)
    expect(documentAdvertisesTsp({ service: [{ type: ['DIDCommMessaging', 'TSPTransport'] }] })).toBe(true)
  })

  it('is not fooled by a near miss or an absent service list', () => {
    expect(documentAdvertisesTsp({ service: [{ type: 'TSPTransportX' }] })).toBe(false)
    expect(documentAdvertisesTsp({ service: [{ type: 'DIDCommMessaging' }] })).toBe(false)
    expect(documentAdvertisesTsp({ service: [] })).toBe(false)
    expect(documentAdvertisesTsp(undefined)).toBe(false)
  })
})

describe('caching', () => {
  it('reads the document once within the TTL', async () => {
    let resolves = 0
    const agent = agentWith({ service: [{ type: TSP_SERVICE_TYPE }] }, () => (resolves += 1))
    expect(await peerAdvertisesTsp(agent, 'did:example:a', { ttlMs: 60_000 })).toBe(true)
    expect(await peerAdvertisesTsp(agent, 'did:example:a', { ttlMs: 60_000 })).toBe(true)
    expect(resolves).toBe(1)
  })

  it('re-reads once the TTL lapses — upstream edits documents without rotating keys', async () => {
    // `vta services tsp enable` publishes a new version of an existing
    // document. A cache keyed on rotation would never see it; this is why the
    // plan asks for bounded staleness rather than until-rotation.
    let resolves = 0
    const agent = agentWith({ service: [{ type: TSP_SERVICE_TYPE }] }, () => (resolves += 1))
    await peerAdvertisesTsp(agent, 'did:example:b', { ttlMs: 0 })
    await peerAdvertisesTsp(agent, 'did:example:b', { ttlMs: 0 })
    expect(resolves).toBe(2)
  })

  it('treats an unresolvable peer as not TSP-capable rather than throwing', async () => {
    const agent = agentWith(new Error('nope'))
    await expect(peerAdvertisesTsp(agent, 'did:example:gone')).resolves.toBe(false)
  })
})

// TSP 1.0 cutover stopgap: upstream services move to TSP 1.0, which this build's Rev 3 codec cannot speak. A peer
// that advertises TSPTransport is spoken to over DIDComm v2 until the 1.0 codec ships.
describe('the TSP 1.0 stopgap: upstream services over DIDComm v2', () => {
  let warn: jest.SpyInstance
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => warn.mockRestore())

  it('a VTA or VTC that offers TSP, and a session that could speak it: DIDComm, said in Release', async () => {
    const agent = agentWith({ service: [{ type: TSP_SERVICE_TYPE }] })
    expect(await chooseCarriage(agent, 'did:example:vta', true)).toBe('didcomm')
    expect(warn.mock.calls.map(([l]) => String(l)).join('\n')).toMatch(
      /did:example:vta advertises TSPTransport — using DIDComm v2 until this build speaks TSP 1\.0/
    )
    expect(logs.some((l) => l.message.includes('using TSP for this session'))).toBe(false)
  })

  it('kept for the session, like any decision: no TSP on a later ask', async () => {
    const decided = new Map<string, 'tsp' | 'didcomm'>()
    const agent = agentWith({ service: [{ type: TSP_SERVICE_TYPE }] })
    expect(await chooseCarriage(agent, 'did:example:vtc', true, { decided })).toBe('didcomm')
    expect(await chooseCarriage(agent, 'did:example:vtc', true, { decided })).toBe('didcomm')
    expect(decided.get('did:example:vtc')).toBe('didcomm')
  })

  it('a peer that offers nothing is unchanged: DIDComm, with no stopgap line', async () => {
    const agent = agentWith({ service: [{ type: 'DIDCommMessaging' }] })
    expect(await chooseCarriage(agent, 'did:example:plain', true)).toBe('didcomm')
    expect(warn.mock.calls.map(([l]) => String(l)).join('\n')).not.toMatch(/until this build speaks TSP 1\.0/)
  })
})

// The TSP path itself, for when the stopgap is lifted: the rule as it stands without it.
describe('choosing, and saying so', () => {
  beforeEach(() => setPreferDidcommForUpstream(false))
  afterEach(() => setPreferDidcommForUpstream(true))

  it('uses TSP when the peer offers TSP 1.0 and we can speak it', async () => {
    const agent = agentWith({ service: [{ type: TSP_SERVICE_TYPE, version: '1.0' }] })
    expect(await chooseCarriage(agent, 'did:example:c', true)).toBe('tsp')
    expect(released.some((m) => m.includes('using TSP 1.0'))).toBe(true)
  })

  it('falls back LOUDLY when the peer offers TSP and we cannot speak it', async () => {
    // The distinction that matters: this is a gap on our side, and it must not
    // read the same as a peer that simply does not offer TSP.
    const agent = agentWith({ service: [{ type: TSP_SERVICE_TYPE }] })
    expect(await chooseCarriage(agent, 'did:example:d', false)).toBe('didcomm')
    expect(logs.some((l) => l.level === 'warn' && l.message.includes('no TSP identity'))).toBe(true)
  })

  it('uses DIDComm without complaint when the peer does not offer TSP', async () => {
    const agent = agentWith({ service: [{ type: 'DIDCommMessaging' }] })
    expect(await chooseCarriage(agent, 'did:example:e', true)).toBe('didcomm')
    expect(logs.some((l) => l.level === 'warn')).toBe(false)
  })

  it('decides once per peer per session, and does not re-read afterwards', async () => {
    // Per-message selection would let one peer flap a session between two
    // envelope formats; §4.2 asks for the decision to be session-scoped.
    let resolves = 0
    const decided = new Map<string, 'tsp' | 'didcomm'>()
    const agent = agentWith({ service: [{ type: TSP_SERVICE_TYPE, version: '1.0' }] }, () => (resolves += 1))
    expect(await chooseCarriage(agent, 'did:example:f', true, { decided })).toBe('tsp')
    expect(await chooseCarriage(agent, 'did:example:f', true, { decided })).toBe('tsp')
    expect(resolves).toBe(1)
    expect(released.filter((m) => m.includes('using TSP'))).toHaveLength(1)
  })
})

// TSP 1.0 cutover plan §6.2: the per-peer rule, and the probe it asks for.
describe('the per-peer rule (cutover plan §6.2)', () => {
  beforeEach(() => setPreferDidcommForUpstream(false))
  afterEach(() => setPreferDidcommForUpstream(true))

  const tspDoc = (extra: Record<string, unknown> = {}) => ({
    service: [{ id: 'did:example:x#tsp', type: TSP_SERVICE_TYPE, ...extra }],
  })

  it('reads a stated version leniently, and anything else as another version', () => {
    for (const v of ['1', '1.0', 'v1', 'YTSP-BAA', 1]) expect(parseAdvertisedTspVersion(v)).toBe('1.0')
    for (const v of ['0.2', 'rev3', 'YTSP-AAC', '2.0']) expect(parseAdvertisedTspVersion(v)).toBe('other')
    for (const v of [undefined, null, '']) expect(parseAdvertisedTspVersion(v)).toBeUndefined()
    expect(documentTspService(tspDoc({ tspVersion: '1.0' }))).toEqual({
      advertises: true,
      serviceId: 'did:example:x#tsp',
      version: '1.0',
    })
    expect(documentTspService(tspDoc())).toEqual({ advertises: true, serviceId: 'did:example:x#tsp' })
  })

  it('row 2: a document that names TSP 1.0 is TSP, and no probe is asked for', async () => {
    const onProbeWanted = jest.fn()
    expect(await chooseCarriage(agentWith(tspDoc({ version: '1.0' })), 'did:r2a', true, { onProbeWanted })).toBe('tsp')
    expect(onProbeWanted).not.toHaveBeenCalled()
  })

  it('row 2: a document that names another version is DIDComm, and no probe is asked for', async () => {
    const onProbeWanted = jest.fn()
    expect(await chooseCarriage(agentWith(tspDoc({ version: '0.2' })), 'did:r2b', true, { onProbeWanted })).toBe(
      'didcomm'
    )
    expect(onProbeWanted).not.toHaveBeenCalled()
    expect(released.some((m) => m.includes('does not send'))).toBe(true)
  })

  it('row 3: no version, but a fresh TSP 1.0 record: TSP, and no probe', async () => {
    const onProbeWanted = jest.fn()
    const freshV1 = jest.fn(async () => true)
    expect(await chooseCarriage(agentWith(tspDoc()), 'did:r3', true, { freshV1, onProbeWanted })).toBe('tsp')
    expect(freshV1).toHaveBeenCalledWith('did:r3')
    expect(onProbeWanted).not.toHaveBeenCalled()
  })

  it('row 4: no version and no fresh record: DIDComm, and a probe is asked for with the service id', async () => {
    const onProbeWanted = jest.fn()
    const freshV1 = jest.fn(async () => false)
    expect(await chooseCarriage(agentWith(tspDoc()), 'did:r4', true, { freshV1, onProbeWanted })).toBe('didcomm')
    expect(onProbeWanted).toHaveBeenCalledWith('did:r4', 'did:example:x#tsp')
    expect(released.some((m) => m.includes('probing TSP 1.0 in the background'))).toBe(true)
  })

  it('a record that cannot be read counts as not fresh: DIDComm, never a guess', async () => {
    const freshV1 = jest.fn(async () => {
      throw new Error('wallet locked')
    })
    expect(await chooseCarriage(agentWith(tspDoc()), 'did:r4b', true, { freshV1 })).toBe('didcomm')
  })

  it('row 5 and no identity: DIDComm, and no probe either way', async () => {
    const onProbeWanted = jest.fn()
    expect(
      await chooseCarriage(agentWith({ service: [{ type: 'DIDCommMessaging' }] }), 'did:r5', true, { onProbeWanted })
    ).toBe('didcomm')
    expect(await chooseCarriage(agentWith(tspDoc()), 'did:r5b', false, { onProbeWanted })).toBe('didcomm')
    expect(onProbeWanted).not.toHaveBeenCalled()
  })
})

describe('the kill-switch (row 1)', () => {
  // On by default: the stopgap's preference stays the shipped behaviour until
  // the release that turns it off.
  it('with the switch on, no probe starts, and nothing is said about probing', async () => {
    const onProbeWanted = jest.fn()
    const freshV1 = jest.fn(async () => true)
    for (const doc of [
      { service: [{ type: TSP_SERVICE_TYPE }] },
      { service: [{ type: TSP_SERVICE_TYPE, version: '1.0' }] },
    ]) {
      clearTspCapabilityCache()
      expect(await chooseCarriage(agentWith(doc), 'did:k', true, { freshV1, onProbeWanted })).toBe('didcomm')
    }
    expect(onProbeWanted).not.toHaveBeenCalled()
    expect(freshV1).not.toHaveBeenCalled()
    expect(logs.some((l) => /prob/i.test(l.message))).toBe(false)
    expect(released.some((m) => /prob/i.test(m))).toBe(false)
  })
})

describe('Release lines (the stopgap switch off)', () => {
  beforeEach(() => setPreferDidcommForUpstream(false))
  afterEach(() => setPreferDidcommForUpstream(true))

  it('each decision is said in Release once, naming the peer by prefix only', async () => {
    const did = 'did:webvh:QmVeryLongIdentifierThatMustNotReachAReport:example.org:agent'
    const decided = new Map<string, 'tsp' | 'didcomm'>()
    const agent = agentWith({ service: [{ type: TSP_SERVICE_TYPE, version: '1.0' }] })
    await chooseCarriage(agent, did, true, { decided })
    await chooseCarriage(agent, did, true, { decided })
    const lines = released.filter((m) => m.includes('using TSP 1.0'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain(did)
  })
})
