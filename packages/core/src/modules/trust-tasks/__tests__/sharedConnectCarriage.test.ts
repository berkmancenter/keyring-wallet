/** The connectionless carriages against a fake relay session (plan WP5, WP14). */
const mockGreet = jest.fn()
const mockPack = jest.fn()
const mockUnpack = jest.fn()
jest.mock('../module/vtiTsp', () => ({
  greetPeerOverTsp: (...a: unknown[]) => mockGreet(...a),
  packTrustTaskForPeer: (...a: unknown[]) => mockPack(...a),
  unpackTrustTaskFromPeer: (...a: unknown[]) => mockUnpack(...a),
  tspSessionForManager: jest.fn(),
}))
jest.mock('../module/VtiMediatorTransport', () => ({
  VtiMediatorSession: class {},
  vtiClientIdentityFromDid: jest.fn(),
}))

import {
  chooseEncounterCarriage,
  createDidCommEncounterCarriage,
  createTspEncounterCarriage,
  type EncounterRelaySession,
} from '../module/sharedConnectCarriage'
import type { EncounterRecord } from '../module/sharedConnectEncounter'

const MY = 'did:peer:2.me'
const THEIR = 'did:peer:2.them'
const MEDIATOR = { did: 'did:peer:2.mediator' } as never
const encounter: EncounterRecord = {
  enactment: 'XOcGXOQTCHb5iz4T2JD2RQ',
  myVid: MY,
  theirVid: THEIR,
  carriage: 'tsp',
  relay: 'did:peer:2.mediator',
  exp: 2_000_000_000,
  state: 'confirmed',
  createdAt: '2026-11-05T00:00:00Z',
}
const agent = { config: { logger: { info: jest.fn(), warn: jest.fn() } } } as never

const rig = (carriage: 'tsp' | 'didcomm' = 'tsp') => {
  const relay = {
    start: jest.fn(),
    stop: jest.fn(),
    sendTspFrame: jest.fn(),
    sendTo: jest.fn(),
  } satisfies EncounterRelaySession
  let handlers: { onTspFrame: (b: Uint8Array) => Promise<void>; onMessage: (p: never) => Promise<void> }
  const documents: Record<string, unknown>[] = []
  const options = {
    agent,
    encounter: { ...encounter, carriage },
    mediator: MEDIATOR,
    onDocument: (d: Record<string, unknown>) => void documents.push(d),
    openSession: async (h: typeof handlers) => ((handlers = h), relay),
    tspIdentity: async () => ({}) as never,
  }
  return { relay, options, documents, handlers: () => handlers }
}

describe('TSP encounter carriage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGreet.mockResolvedValue({ bytes: new Uint8Array([1]) })
    mockPack.mockResolvedValue({ bytes: new Uint8Array([2, 2]), revision: 'v1' })
  })

  it("packs TSP 1.0 on every frame, the XRFI included: the codec's default is Rev 3, which a 1.0 reader drops", async () => {
    const { options } = rig()
    const carriage = createTspEncounterCarriage(options)
    await carriage.start()
    await carriage.send({ type: 'a/b/c/0.1' })
    await carriage.send({ type: 'a/b/c/0.1' })
    expect(mockGreet.mock.calls.map((c) => c[4])).toEqual(['v1'])
    expect(mockPack.mock.calls.map((c) => c[4])).toEqual(['v1', 'v1'])
  })

  it('forms the relationship once, routed back to us, before the first and only the first document', async () => {
    const { relay, options } = rig()
    const carriage = createTspEncounterCarriage(options)
    await carriage.start()
    await carriage.send({ type: 'a/b/c/0.1' })
    await carriage.send({ type: 'a/b/c/0.1' })
    expect(mockGreet).toHaveBeenCalledTimes(1)
    expect(mockGreet.mock.calls[0].slice(1, 4)).toEqual([MY, THEIR, ['did:peer:2.mediator', MY]])
    expect(relay.sendTspFrame.mock.calls.map((c) => c[0].length)).toEqual([1, 2, 2])
  })

  it('hands on a document from the inviter and drops a control frame or another sender', async () => {
    const { options, documents, handlers } = rig()
    await createTspEncounterCarriage(options).start()
    mockUnpack.mockResolvedValueOnce(undefined)
    await handlers().onTspFrame(new Uint8Array([9]))
    mockUnpack.mockResolvedValueOnce({ unpacked: { sender: 'did:peer:2.mallory' }, plaintext: { body: { id: 'x' } } })
    await handlers().onTspFrame(new Uint8Array([9]))
    mockUnpack.mockResolvedValueOnce({ unpacked: { sender: THEIR }, plaintext: { body: { id: 'ok' } } })
    await handlers().onTspFrame(new Uint8Array([9]))
    expect(documents).toEqual([{ id: 'ok' }])
  })

  it('fails to send before the session is open', async () => {
    const { options } = rig()
    await expect(createTspEncounterCarriage(options).send({})).rejects.toThrow()
  })
})

describe('DIDComm encounter carriage', () => {
  it('sends the document as the body of a plaintext to the inviter, on the thread', async () => {
    const { relay, options } = rig('didcomm')
    const carriage = createDidCommEncounterCarriage(options)
    await carriage.start()
    await carriage.send({ type: 'a/b/c/0.1', threadId: 'T' })
    const [peer, plaintext] = relay.sendTo.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(peer).toBe(THEIR)
    expect(plaintext).toMatchObject({ type: 'a/b/c/0.1', from: MY, to: [THEIR], thid: 'T', body: { threadId: 'T' } })
    expect(mockGreet).not.toHaveBeenCalled()
  })

  it('accepts only the inviter, and only a document whose issuer is the sender', async () => {
    const { options, documents, handlers } = rig('didcomm')
    await createDidCommEncounterCarriage(options).start()
    await handlers().onMessage({ from: 'did:peer:2.mallory', body: { id: 'x' } } as never)
    await handlers().onMessage({ from: THEIR, body: { id: 'y', issuer: 'did:peer:2.other' } } as never)
    await handlers().onMessage({ from: THEIR, body: { id: 'z', issuer: THEIR } } as never)
    expect(documents).toEqual([{ id: 'z', issuer: THEIR }])
  })

  it('is chosen by the record', () => {
    expect(chooseEncounterCarriage(rig('tsp').options)).toBeDefined()
    expect(chooseEncounterCarriage(rig('didcomm').options)).toBeDefined()
  })
})
