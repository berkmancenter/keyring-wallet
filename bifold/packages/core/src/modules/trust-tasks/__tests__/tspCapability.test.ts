import {
  TSP_SERVICE_TYPE,
  chooseCarriage,
  clearTspCapabilityCache,
  documentAdvertisesTsp,
  peerAdvertisesTsp,
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

beforeEach(() => {
  logs.length = 0
  clearTspCapabilityCache()
})

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

describe('choosing, and saying so', () => {
  it('uses TSP when the peer offers it and we can speak it', async () => {
    const agent = agentWith({ service: [{ type: TSP_SERVICE_TYPE }] })
    expect(await chooseCarriage(agent, 'did:example:c', true)).toBe('tsp')
    expect(logs.some((l) => l.level === 'info' && l.message.includes('using TSP'))).toBe(true)
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
    const agent = agentWith({ service: [{ type: TSP_SERVICE_TYPE }] }, () => (resolves += 1))
    expect(await chooseCarriage(agent, 'did:example:f', true, { decided })).toBe('tsp')
    expect(await chooseCarriage(agent, 'did:example:f', true, { decided })).toBe('tsp')
    expect(resolves).toBe(1)
    expect(logs.filter((l) => l.message.includes('using TSP'))).toHaveLength(1)
  })
})
