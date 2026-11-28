/**
 * The socket's receive path, end to end from `socket.onmessage`: every frame the mediator sends reaches its handling,
 * once, in order, whatever else arrives around it. This path carries every released VTI session's traffic (rooms and
 * community tasks, the VTA, the mailbox). Before this suite no test drove more than one frame through `onmessage`:
 * the session suites call `handleFrame` directly, below it, so an `onmessage` that lost frames would go unseen.
 */
import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'

import { VtiMediatorSession, type VtiClientIdentity, type VtiMediatorEndpoints } from '../module/VtiMediatorTransport'

const identity: VtiClientIdentity = { did: 'did:peer:2:phone', kid: 'did:peer:2:phone#key-2', senderKey: {} as never }
const mediator: VtiMediatorEndpoints = {
  did: 'did:peer:2:mediator',
  authEndpoint: 'https://mediator.example/mediator/v1',
  wsEndpoint: 'wss://mediator.example/mediator/v1/ws',
  publicJwk: {} as never,
  kid: 'did:peer:2:mediator#key-1',
}
const agent = {
  config: { logger: { info: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined } },
  context: {},
  dependencyManager: { resolve: () => ({ pack: async (_c: unknown, plaintext: unknown) => plaintext }) },
} as never
const PROBLEM_REPORT = 'https://didcomm.org/report-problem/2.0/problem-report'
const BASIC = 'https://didcomm.org/basicmessage/2.0/message'

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
/** A token good for 15 minutes from now, minted when the session signs in: the suite's clock is not the module's. */
const freshJwt = () =>
  `${b64url({ alg: 'EdDSA' })}.${b64url({ sub: 't', exp: Math.floor(Date.now() / 1000) + 900 })}.sig`

/** One fake socket at a time, opening on the next tick; `deliver` is the mediator writing a frame to it. */
function mediatorSocket() {
  const sockets: FakeSocket[] = []
  class FakeSocket {
    readyState = 0
    onmessage?: (event: { data: string }) => void
    private listeners: Record<string, ((e?: unknown) => void)[]> = {}
    constructor() {
      sockets.push(this)
      setTimeout(() => {
        this.readyState = 1
        this.emit('open')
      }, 0)
    }
    emit(name: string, e?: unknown) {
      ;[...(this.listeners[name] ?? [])].forEach((f) => f(e))
    }
    addEventListener(name: string, fn: (e?: unknown) => void) {
      ;(this.listeners[name] ??= []).push(fn)
    }
    removeEventListener(name: string, fn: (e?: unknown) => void) {
      this.listeners[name] = (this.listeners[name] ?? []).filter((f) => f !== fn)
    }
    send() {
      if (this.readyState !== 1) throw new Error('INVALID_STATE_ERR')
    }
    close() {
      this.readyState = 3
    }
  }
  /** The mediator writes to the session's socket: the newest one listening. */
  const deliver = (data: string) => {
    const listening = [...sockets].reverse().find((socket) => socket.readyState === 1 && socket.onmessage)
    if (!listening?.onmessage)
      throw new Error(`no socket is listening (${sockets.length} opened, states ${sockets.map((x) => x.readyState)})`)
    listening.onmessage({ data })
  }
  return { FakeSocket, deliver, opened: () => sockets.length }
}

/** Every session a test opened, stopped after it whether it passed or not: a live one's timers would hold jest open. */
const opened: VtiMediatorSession[] = []

async function openSession() {
  const socket = mediatorSocket()
  global.WebSocket = socket.FakeSocket as never
  global.fetch = (async (url: string) =>
    String(url).endsWith('/challenge')
      ? { status: 200, text: async () => JSON.stringify({ data: { challenge: 'c', session_id: 's' } }) }
      : { status: 200, json: async () => ({ data: { access_token: freshJwt() } }) }) as never
  const handed: string[] = []
  const onError = jest.fn()
  const session = new VtiMediatorSession(agent, identity, mediator, {
    onError,
    onMessage: async (plaintext: DidCommV2PlaintextMessage) => {
      handed.push(String((plaintext.body as { n?: unknown })?.n))
    },
  })
  // The decrypt step stands in: each frame's ciphertext names its plaintext.
  const plaintexts = new Map<string, Record<string, unknown>>()
  session['unpack'] = async (encrypted: { ciphertext: string }) => {
    const found = plaintexts.get(encrypted.ciphertext)
    if (!found) throw new Error(`no decrypt for ${encrypted.ciphertext}`)
    return found as DidCommV2PlaintextMessage
  }
  session['acknowledge'] = jest.fn(async () => undefined)
  opened.push(session)
  await session.start()
  const settle = async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r))
  }
  // What the start says after it returns is said here, inside the test.
  await settle()
  const frame = (name: string, plaintext: Record<string, unknown>) => {
    plaintexts.set(name, plaintext)
    socket.deliver(JSON.stringify({ protected: 'e30', ciphertext: name }))
  }
  return { session, frame, handed, settle, deliver: socket.deliver, opened: socket.opened, onError }
}

let warn: jest.SpyInstance
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(async () => {
  await Promise.all(opened.splice(0).map((session) => session.stop()))
  warn.mockRestore()
})

describe('the receive path from the socket', () => {
  test('every peer frame the socket delivers is handed on, once each, in the order delivered', async () => {
    const { frame, handed, settle } = await openSession()
    for (let n = 1; n <= 6; n++) frame(`peer-${n}`, { type: BASIC, from: 'did:peer:2.a-peer', body: { n } })
    await settle()
    expect(handed).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  test('CONTROL: the session holds one socket through all of it; none of these cases reopens', async () => {
    const { frame, settle, opened } = await openSession()
    for (let n = 1; n <= 3; n++) frame(`peer-${n}`, { type: BASIC, from: 'did:peer:2.a-peer', body: { n } })
    await settle()
    expect(opened()).toBe(1)
  })

  test('a frame whose handling fails is reported once and takes nothing with it: no other frame, not the socket', async () => {
    const { frame, handed, settle, deliver, opened, onError } = await openSession()
    frame('peer-1', { type: BASIC, from: 'did:peer:2.a-peer', body: { n: 1 } })
    // No decrypt for this one: its handling fails.
    deliver(JSON.stringify({ protected: 'e30', ciphertext: 'unopenable' }))
    frame('peer-3', { type: BASIC, from: 'did:peer:2.a-peer', body: { n: 3 } })
    await settle()
    expect(handed).toEqual(['1', '3'])
    // handleFrame catches its own failure and reports it (onError); nothing rejects unhandled, and the session does
    // not reopen, so a failure that recurs on every drain cannot make the socket flap.
    expect(onError).toHaveBeenCalledTimes(1)
    expect(String(onError.mock.calls[0][0])).toContain('no decrypt for unopenable')
    expect(opened()).toBe(1)
  })

  test('the mediator’s own frames between them are taken as before: each problem-report said, no peer frame lost', async () => {
    const { frame, handed, settle } = await openSession()
    for (let n = 1; n <= 4; n++) {
      frame(`peer-${n}`, { type: BASIC, from: 'did:peer:2.a-peer', body: { n } })
      frame(`pr-${n}`, {
        type: PROBLEM_REPORT,
        from: mediator.did,
        pthid: `urn:uuid:forward-${n}`,
        body: { code: `e.p.msg.code-${n}` },
      })
    }
    await settle()
    expect(handed).toEqual(['1', '2', '3', '4'])
    const said = warn.mock.calls.map(([line]) => String(line)).join('\n')
    for (let n = 1; n <= 4; n++) expect(said).toContain(`e.p.msg.code-${n}`)
  })
})
