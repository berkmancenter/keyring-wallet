/**
 * TSP Rev 3 on the VTI peer leg: a Trust Task document between two personas
 * as a TSP frame on the mediator socket (`vtiTsp`, `VtiMediatorSession`,
 * `vtiAgent`). No Agent/KMS: the ports are raw-key wrappers, the mediator
 * socket is a fake, and the adapter that would reach into Askar is mocked
 * away — what is under test is the framing, the demux, the acknowledgement
 * contract, the binding envelope, the identity rule, and that the controller
 * hands a TSP-carried document to the same inbox a DIDComm one reaches.
 */
import { unpack as upstreamUnpack } from '@openvtc/vti-tsp-js'
import { ed25519, x25519 } from '@noble/curves/ed25519.js'
import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'

import { tsp } from '@bifold/trust-tasks'

import { VtiMediatorSession, type VtiClientIdentity, type VtiMediatorEndpoints } from '../module/VtiMediatorTransport'
import { vtiAgent } from '../module/vtiAgent'
import {
  getPeerLegCarriage,
  MemoryTspPeerRevisionStore,
  packTrustTaskForPeer,
  plaintextFromTrustTask,
  setPeerLegCarriage,
  unpackTrustTaskFromPeer,
  type TspSessionIdentity,
} from '../module/vtiTsp'

jest.mock('@bifold/credo-tsp-adapter', () => ({
  keyAgreementFromAskarKey: () => {
    throw new Error('not used in this suite')
  },
  signingKeyFromEd25519Key: () => {
    throw new Error('not used in this suite')
  },
}))

const utf8 = (s: string) => new TextEncoder().encode(s)
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])

function personaKeys(vid: string) {
  const signSk = ed25519.utils.randomSecretKey()
  const encSk = x25519.utils.randomSecretKey()
  return {
    vid,
    signSk,
    encSk,
    keys: { signingPublicKey: ed25519.getPublicKey(signSk), encryptionPublicKey: x25519.getPublicKey(encSk) },
    identity: {
      signingKey: { publicKey: ed25519.getPublicKey(signSk), sign: async (m: Uint8Array) => ed25519.sign(m, signSk) },
      keyAgreement: {
        publicKey: x25519.getPublicKey(encSk),
        agree: async (p: Uint8Array) => x25519.getSharedSecret(encSk, p),
      },
    } as tsp.TspIdentity,
  }
}

const applicant = personaKeys('did:webvh:example:applicant')
const vetter = personaKeys('did:webvh:example:vetter')
const resolver: tsp.VidResolver = {
  async resolve(vid) {
    const p = [applicant, vetter].find((x) => x.vid === vid)
    if (!p) throw new Error(`unknown vid ${vid}`)
    return p.keys
  },
}
const sessionFor = (p: typeof applicant): TspSessionIdentity => ({
  identity: p.identity,
  resolver,
  codec: tsp.createTspCodec(),
})

const request = {
  id: 'urn:uuid:request-1',
  type: 'https://trusttasks.org/spec/vetting/request/0.1',
  issuer: applicant.vid,
  recipient: vetter.vid,
  issuedAt: '2026-09-18T00:00:00Z',
  payload: { ticketId: 't1', preferredMethod: 'inPerson' },
}

describe('a Trust Task between two personas as a TSP Rev 3 frame', () => {
  test('packs the binding envelope, and the peer opens it to the same document', async () => {
    const packed = await packTrustTaskForPeer(sessionFor(applicant), applicant.vid, vetter.vid, request)
    expect(packed.revision).toBe('rev3')
    expect(tsp.isTspFrameBytes(packed.bytes)).toBe(true)

    const opened = await unpackTrustTaskFromPeer(sessionFor(vetter), packed.bytes, vetter.vid)
    expect(opened).toBeDefined()
    expect(opened!.unpacked.sender).toBe(applicant.vid)
    expect(opened!.plaintext.body).toEqual(request)
    expect(opened!.plaintext.type).toBe(request.type)
    expect(opened!.plaintext.id).toBe(request.id)
    expect(opened!.plaintext.from).toBe(applicant.vid)

    // The wire is what upstream's own reader sees: a Rev 3 direct message
    // whose payload is the binding envelope.
    const raw = await upstreamUnpack(packed.bytes, {
      receiverDecryptionKey: vetter.encSk,
      senderSigningKey: applicant.keys.signingPublicKey,
    })
    expect(JSON.parse(new TextDecoder().decode(raw.payload))).toEqual({
      type: tsp.TSP_BINDING_ENVELOPE_TYPE,
      document: request,
    })
  })

  test('a reply threads on the request document, and reads as a plaintext with thid', async () => {
    const response = {
      ...request,
      id: 'urn:uuid:response-1',
      type: `${request.type}#response`,
      threadId: request.id,
      issuer: vetter.vid,
      recipient: applicant.vid,
    }
    const packed = await packTrustTaskForPeer(sessionFor(vetter), vetter.vid, applicant.vid, response)
    const opened = await unpackTrustTaskFromPeer(sessionFor(applicant), packed.bytes, applicant.vid)
    expect(opened!.plaintext.thid).toBe(request.id)
    expect(opened!.plaintext.type).toBe(`${request.type}#response`)
  })

  test('the identity rule: an in-band issuer that is not the TSP sender is identityMismatch', async () => {
    const forged = { ...request, issuer: 'did:webvh:example:someone-else' }
    const packed = await packTrustTaskForPeer(sessionFor(applicant), applicant.vid, vetter.vid, forged)
    await expect(unpackTrustTaskFromPeer(sessionFor(vetter), packed.bytes, vetter.vid)).rejects.toThrow(
      /identityMismatch/
    )
  })

  test('a frame addressed to another persona is refused, and a non-envelope payload is not dispatched', async () => {
    const packed = await packTrustTaskForPeer(sessionFor(applicant), applicant.vid, vetter.vid, request)
    await expect(unpackTrustTaskFromPeer(sessionFor(vetter), packed.bytes, 'did:webvh:example:other')).rejects.toThrow(
      /not this persona/
    )

    const plain = await tsp.pack(utf8('not a trust task'), applicant.vid, vetter.vid, applicant.identity, resolver)
    expect(await unpackTrustTaskFromPeer(sessionFor(vetter), plain.bytes, vetter.vid)).toBeUndefined()
  })

  test('plaintextFromTrustTask reads like a DIDComm v2 plaintext to the vetting handlers', () => {
    const p = plaintextFromTrustTask({ id: 'a', type: 't', threadId: 'thr' }, 'did:s', 'did:r')
    expect(p).toMatchObject({ id: 'a', type: 't', thid: 'thr', from: 'did:s', to: ['did:r'] })
    expect(plaintextFromTrustTask({ id: 'a', type: 't' }, 'did:s', 'did:r').thid).toBeUndefined()
  })
})

describe('VtiMediatorSession — TSP frames on the DIDComm socket', () => {
  const identity: VtiClientIdentity = { did: applicant.vid, kid: `${applicant.vid}#key-2`, senderKey: {} as never }
  const mediator: VtiMediatorEndpoints = {
    did: 'did:peer:2:mediator',
    authEndpoint: 'https://mediator.example/mediator/v1',
    wsEndpoint: 'wss://mediator.example/mediator/v1/ws',
    publicJwk: {} as never,
    kid: 'did:peer:2:mediator#key-1',
  }
  const logs: string[] = []
  const agent = {
    config: {
      logger: {
        info: (m: string) => logs.push(m),
        debug: (m: string) => logs.push(m),
        warn: (m: string) => logs.push(m),
        error: () => undefined,
      },
    },
    context: {},
    // The mediator-bound pack is the envelope service's; here it is the identity function.
    dependencyManager: { resolve: () => ({ pack: async (_ctx: unknown, plaintext: unknown) => plaintext }) },
  } as never

  function fakeSession(options: ConstructorParameters<typeof VtiMediatorSession>[3]) {
    const session = new VtiMediatorSession(agent, identity, mediator, options)
    const sent: unknown[] = []
    ;(session as unknown as { socket: unknown }).socket = {
      readyState: 1,
      send: (d: unknown) => sent.push(d),
      close: () => undefined,
    }
    return {
      session,
      sent,
      handleFrame: (raw: string) =>
        (session as unknown as { handleFrame(raw: string): Promise<void> }).handleFrame(raw),
    }
  }

  test('a "-E…" text frame is decoded to bytes for the consumer, then acknowledged by sha256(text)', async () => {
    const packed = await packTrustTaskForPeer(sessionFor(applicant), applicant.vid, vetter.vid, request)
    const text = tsp.toBase64Url(packed.bytes)
    expect(text.startsWith('-E')).toBe(true)
    const received: Uint8Array[] = []
    const { sent, handleFrame } = fakeSession({ onTspFrame: (bytes) => void received.push(bytes) })
    await handleFrame(text)
    expect(received).toHaveLength(1)
    expect(eq(received[0], packed.bytes)).toBe(true)
    const ack = JSON.parse(sent[0] as string) as { type: string; body: { message_id_list: string[] } }
    expect(ack.type).toBe('https://didcomm.org/messagepickup/3.0/messages-received')
    expect(ack.body.message_id_list).toEqual([tsp.tspFrameQueueId(text)])
  })

  test('a long-framed "--E…" frame (past 4095 quadlets) is routed the same way', async () => {
    const big = { ...request, payload: { blob: 'x'.repeat(13000) } }
    const packed = await packTrustTaskForPeer(sessionFor(applicant), applicant.vid, vetter.vid, big)
    const text = tsp.toBase64Url(packed.bytes)
    expect(text.startsWith('--E')).toBe(true)
    expect(packed.bytes[0]).toBe(tsp.TSP_MAGIC_BYTE_LONG)
    const received: Uint8Array[] = []
    const { sent, handleFrame } = fakeSession({ onTspFrame: (bytes) => void received.push(bytes) })
    await handleFrame(text)
    expect(received).toHaveLength(1)
    expect(sent).toHaveLength(1)
    const opened = await unpackTrustTaskFromPeer(sessionFor(vetter), received[0], vetter.vid)
    expect(opened!.plaintext.body).toEqual(big)
  })

  test('a consumer that throws withholds the acknowledgement; no consumer leaves the frame queued', async () => {
    const packed = await packTrustTaskForPeer(sessionFor(applicant), applicant.vid, vetter.vid, request)
    const text = tsp.toBase64Url(packed.bytes)
    const errors: string[] = []
    const failing = fakeSession({
      onTspFrame: () => {
        throw new Error('could not persist')
      },
      onError: (e) => void errors.push(e.message),
    })
    await failing.handleFrame(text)
    expect(failing.sent).toHaveLength(0)
    expect(errors).toEqual(['could not persist'])

    const deaf = fakeSession({})
    await deaf.handleFrame(text)
    expect(deaf.sent).toHaveLength(0)
  })

  test('a Pickup 3.0 status frame and a JSON frame are not mistaken for TSP', async () => {
    const received: Uint8Array[] = []
    const { sent, handleFrame } = fakeSession({ onTspFrame: (bytes) => void received.push(bytes) })
    await handleFrame(JSON.stringify({ type: 'https://didcomm.org/messagepickup/3.0/status', body: {} }))
    expect(received).toHaveLength(0)
    expect(sent).toHaveLength(0)
  })

  test('sendTspFrame ships the bytes as a standalone ArrayBuffer and refuses non-TSP bytes', async () => {
    const packed = await packTrustTaskForPeer(sessionFor(applicant), applicant.vid, vetter.vid, request)
    const { session, sent } = fakeSession({})
    const view = new Uint8Array(packed.bytes.length + 8)
    view.set(packed.bytes, 4)
    await session.sendTspFrame(view.subarray(4, 4 + packed.bytes.length))
    expect(sent).toHaveLength(1)
    const buffer = sent[0] as ArrayBuffer
    expect(buffer).toBeInstanceOf(ArrayBuffer)
    expect(eq(new Uint8Array(buffer), packed.bytes)).toBe(true)
    await expect(session.sendTspFrame(utf8('{"not":"tsp"}'))).rejects.toThrow(/not a TSP frame/)
  })
})

describe('vtiAgent — the peer leg on TSP', () => {
  const inbox: DidCommV2PlaintextMessage[] = []
  const controller = vtiAgent as unknown as {
    session?: { sendTo: jest.Mock; sendTspFrame: jest.Mock; isOpen: boolean; stop: () => Promise<void> }
    state: Record<string, unknown>
    tsp?: TspSessionIdentity
    agent?: unknown
    peerRevisionStore?: MemoryTspPeerRevisionStore
    receiveTspFrame(bytes: Uint8Array, myDid: string): Promise<void>
  }
  const logs: string[] = []
  const fakeAgent = {
    config: {
      logger: { info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), debug: () => undefined },
    },
  }

  beforeEach(() => {
    inbox.length = 0
    logs.length = 0
    controller.session = { sendTo: jest.fn(), sendTspFrame: jest.fn(), isOpen: true, stop: async () => undefined }
    controller.agent = fakeAgent
    controller.tsp = sessionFor(applicant)
    controller.peerRevisionStore = new MemoryTspPeerRevisionStore()
  })
  afterEach(() => {
    setPeerLegCarriage('didcomm')
  })

  test('the default wiring is DIDComm, and stays DIDComm when the build says nothing', async () => {
    expect(getPeerLegCarriage()).toBe('didcomm')
    controller.state = { status: 'connected', did: applicant.vid, peerLeg: 'didcomm' }
    await vtiAgent.send(vetter.vid, request.type, request)
    expect(controller.session!.sendTo).toHaveBeenCalledTimes(1)
    expect(controller.session!.sendTspFrame).not.toHaveBeenCalled()
  })

  test('wired for TSP, send() puts a Rev 3 frame on the socket that the peer can open', async () => {
    setPeerLegCarriage('tsp')
    controller.state = { status: 'connected', did: applicant.vid, peerLeg: 'tsp', tspReady: true }
    await vtiAgent.send(vetter.vid, request.type, request)
    expect(controller.session!.sendTo).not.toHaveBeenCalled()
    // Two frames, and the order is the protocol: §7.2.2 forbids opening with
    // an application message, so the greeting (`XRFI`) goes first and the task
    // second. A peer that has not been greeted drops what follows in silence,
    // so this is not an optimisation to collapse.
    expect(controller.session!.sendTspFrame).toHaveBeenCalledTimes(2)
    expect(logs.some((l) => /\[TrustTasks:VtiTsp\] greeted did:webvh:example:vetter with an XRFI invite/.test(l))).toBe(
      true
    )
    const bytes = controller.session!.sendTspFrame.mock.calls[1][0] as Uint8Array
    const opened = await unpackTrustTaskFromPeer(sessionFor(vetter), bytes, vetter.vid)
    expect(opened!.plaintext.body).toEqual(request)
    expect(logs.some((l) => /\[TrustTasks:VtiTsp\] sent rev3 short frame to did:webvh:example:vetter/.test(l))).toBe(
      true
    )
  })

  test("an inbound TSP frame reaches the inbox as a plaintext, and the peer's revision is recorded", async () => {
    controller.state = {
      status: 'connected',
      did: applicant.vid,
      peerLeg: 'didcomm',
      tspReady: true,
      peerRevisions: [],
    }
    const stop = vtiAgent.onInbound((m) => void inbox.push(m))
    const packed = await packTrustTaskForPeer(sessionFor(vetter), vetter.vid, applicant.vid, {
      ...request,
      id: 'urn:uuid:response-1',
      type: `${request.type}#response`,
      threadId: request.id,
      issuer: vetter.vid,
      recipient: applicant.vid,
    })
    await controller.receiveTspFrame(packed.bytes, applicant.vid)
    stop()
    expect(inbox).toHaveLength(1)
    expect(inbox[0].type).toBe(`${request.type}#response`)
    expect(inbox[0].thid).toBe(request.id)
    expect(inbox[0].from).toBe(vetter.vid)
    const record = await controller.peerRevisionStore!.get(vetter.vid)
    expect(record?.revision).toBe('rev3')
    expect(record?.minor).toBe(2)
    expect((vtiAgent.getState().peerRevisions ?? []).map((r) => r.vid)).toContain(vetter.vid)
  })

  test('the per-peer record keeps "since when" across the same revision and restarts it on a change', async () => {
    const store = new MemoryTspPeerRevisionStore()
    const first = await store.observe('did:x', 'rev3', 2)
    await new Promise((r) => setTimeout(r, 5))
    const second = await store.observe('did:x', 'rev3', 2)
    expect(second.firstSeenAt).toBe(first.firstSeenAt)
    expect(second.lastSeenAt >= first.lastSeenAt).toBe(true)
    const changed = await store.observe('did:x', 'rev2', 1)
    expect(changed.firstSeenAt).not.toBe(first.firstSeenAt)
    expect((await store.list()).map((r) => r.revision)).toEqual(['rev2'])
  })
})
