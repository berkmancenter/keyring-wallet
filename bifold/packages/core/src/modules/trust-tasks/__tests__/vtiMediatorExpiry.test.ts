import {
  REOPEN_BOUND_MS,
  VtiMediatorSession,
  accessTokenExpiry,
  type VtiClientIdentity,
  type VtiMediatorEndpoints,
} from '../module/VtiMediatorTransport'

// The 229 lab gate, 2026-10-01: a vetter's attest stuck at "check" for good.
// The mediator closes every socket when its access token expires (15 min,
// affinidi-messaging-mediator handlers/websocket.rs auth_timeout), and a
// reconnect presenting the expired token is ACCEPTED, then closed at once
// ("JWT access token has expired. Closing Session", websocket.rs:671). The
// session reopened with its cached token, so `openSocket` resolved on the open
// and the cached-token retry never ran; `start` then sent live-delivery through
// `send` → `ensureOpen`, which found the socket closed and waited on the very
// reopen it was part of. Nothing settled again: the reopen, and every send
// after it — the vetter's statement among them.

const identity: VtiClientIdentity = { did: 'did:peer:2:vetter', kid: 'did:peer:2:vetter#key-2', senderKey: {} as never }
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

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
/** An access token shaped as the mediator's: a JWT whose `exp` is `inSec` from now. */
const jwt = (name: string, inSec: number) =>
  `${b64url({ alg: 'EdDSA' })}.${b64url({ sub: name, exp: Math.floor(Date.now() / 1000) + inSec })}.sig`

/**
 * The mediator's socket: a token in `expired` is upgraded and then closed with
 * "authentication token expired", as websocket.rs does; any other token stays
 * open. Records each token presented and each frame sent.
 */
function mediatorSockets(expired: string[]) {
  const opened: string[] = []
  const frames: { token: string; frame: unknown }[] = []
  const live: { close: () => void }[] = []
  class FakeSocket {
    readyState = 0
    onmessage: unknown
    private listeners: Record<string, ((e?: unknown) => void)[]> = {}
    private token: string
    constructor(_url: string, protocols: string[]) {
      this.token = (protocols.find((p) => p.startsWith('bearer.')) ?? '').slice('bearer.'.length)
      opened.push(this.token)
      live.push(this)
      setTimeout(() => {
        this.readyState = 1
        this.emit('open')
        // The mediator upgrades, then closes before it reads a frame: whatever
        // the client sends after the open is lost.
        if (expired.includes(this.token)) this.serverClose('authentication token expired')
      }, 0)
    }
    emit(name: string, e?: unknown) {
      const listeners = [...(this.listeners[name] ?? [])]
      listeners.forEach((f) => f(e))
    }
    serverClose(reason: string) {
      if (this.readyState === 3) return
      this.readyState = 3
      this.emit('close', { code: 1008, reason })
    }
    addEventListener(name: string, fn: (e?: unknown) => void) {
      const listeners = (this.listeners[name] ??= [])
      listeners.push(fn)
    }
    removeEventListener(name: string, fn: (e?: unknown) => void) {
      this.listeners[name] = (this.listeners[name] ?? []).filter((f) => f !== fn)
    }
    send(frame: unknown) {
      if (this.readyState !== 1) throw new Error('INVALID_STATE_ERR')
      frames.push({ token: this.token, frame })
    }
    close() {
      this.readyState = 3
    }
    // The mediator's auth_timeout: the server ends the socket at the token's expiry.
    close_byServer() {
      this.serverClose('token expiry')
    }
  }
  return { FakeSocket, opened, frames, live }
}

function stubLogin(tokens: string[], calls: { count: number }) {
  global.fetch = (async (url: string) => {
    if (String(url).endsWith('/challenge')) {
      return { status: 200, text: async () => JSON.stringify({ data: { challenge: 'c', session_id: 's' } }) }
    }
    const token = tokens[Math.min(calls.count, tokens.length - 1)]
    calls.count += 1
    return { status: 200, json: async () => ({ data: { access_token: token } }) }
  }) as never
}

/** Rejects if `p` has not settled within `ms`: the bug was a promise that never did. */
const within = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} did not settle in ${ms} ms`)), ms)),
  ])

const tsp = new Uint8Array([0xf8, 0x01, 0x02, 0x03]) // a qb2 TSP frame: its leading byte is TSP_MAGIC_BYTE

describe('VtiMediatorSession — an access token that expires under a live session', () => {
  const realWebSocket = global.WebSocket
  const realFetch = global.fetch
  afterEach(() => {
    global.WebSocket = realWebSocket
    global.fetch = realFetch
  })

  test('a reopen presenting the expired token, accepted then closed, signs in again instead of waiting for ever', async () => {
    const stale = jwt('stale', -5)
    const fresh = jwt('fresh', 900)
    const m = mediatorSockets([stale])
    global.WebSocket = m.FakeSocket as never
    const logins = { count: 0 }
    stubLogin([fresh], logins)

    const session = new VtiMediatorSession(agent, identity, mediator, {})
    ;(session as unknown as { accessToken?: string }).accessToken = stale

    await within(session.start(), 5000, 'start')
    expect(session.isOpen).toBe(true)
    expect(logins.count).toBe(1)
    // Never re-presents a token it can read has expired.
    expect(m.opened).toEqual([fresh])
    await session.stop()
  })

  test('a send made after the mediator closed the socket at expiry goes out on a fresh sign-in', async () => {
    const first = jwt('first', 900)
    const second = jwt('second', 900)
    const m = mediatorSockets([])
    global.WebSocket = m.FakeSocket as never
    const logins = { count: 0 }
    stubLogin([first, second], logins)

    const session = new VtiMediatorSession(agent, identity, mediator, {})
    await within(session.start(), 5000, 'start')
    // 15 minutes later: the token has expired and the mediator ends the socket.
    ;(session as unknown as { accessToken?: string }).accessToken = jwt('first', -1)
    ;(m.live.at(-1) as unknown as { close_byServer: () => void }).close_byServer()

    await within(session.sendTspFrame(tsp), 5000, 'the send after expiry')
    const statement = m.frames.at(-1)!
    expect(statement.frame).toBeInstanceOf(ArrayBuffer)
    expect(statement.token).toBe(second)
    expect(logins.count).toBe(2)
    await session.stop()
  })

  test('a token that expires within the minute is replaced before the socket is opened with it', async () => {
    const nearlyDone = jwt('nearly', 30)
    const fresh = jwt('fresh', 900)
    const m = mediatorSockets([])
    global.WebSocket = m.FakeSocket as never
    const logins = { count: 0 }
    stubLogin([fresh], logins)

    const session = new VtiMediatorSession(agent, identity, mediator, {})
    ;(session as unknown as { accessToken?: string }).accessToken = nearlyDone
    await within(session.start(), 5000, 'start')
    expect(m.opened).toEqual([fresh])
    await session.stop()
  })

  test('a cached token it cannot read the expiry of, upgraded then closed at once, is replaced by a sign-in', async () => {
    const m = mediatorSockets(['opaque-dead'])
    global.WebSocket = m.FakeSocket as never
    const fresh = jwt('fresh', 900)
    const logins = { count: 0 }
    stubLogin([fresh], logins)

    const session = new VtiMediatorSession(agent, identity, mediator, {})
    ;(session as unknown as { accessToken?: string }).accessToken = 'opaque-dead'
    await within(session.start(), 5000, 'start')
    expect(m.opened).toEqual(['opaque-dead', fresh])
    expect(logins.count).toBe(1)
    expect(session.isOpen).toBe(true)
    await session.stop()
  })

  test('a send waiting on a reopen that never finishes is rejected after REOPEN_BOUND_MS, not left hanging', async () => {
    jest.useFakeTimers()
    try {
      const session = new VtiMediatorSession(agent, identity, mediator, {})
      jest.spyOn(session, 'start').mockImplementation(() => new Promise<void>(() => undefined))
      const sent = session.sendTspFrame(tsp)
      const outcome = sent.then(
        () => 'resolved',
        (e: Error) => e.message
      )
      await jest.advanceTimersByTimeAsync(REOPEN_BOUND_MS + 1)
      expect(await outcome).toMatch(/did not reopen within/)
      await session.stop()
    } finally {
      jest.useRealTimers()
    }
  })

  test('reads the expiry the mediator puts in its access token', () => {
    expect(accessTokenExpiry(jwt('x', 600))).toBeGreaterThan(Date.now() / 1000 + 590)
    expect(accessTokenExpiry('opaque')).toBeUndefined()
    expect(accessTokenExpiry(undefined)).toBeUndefined()
  })
})
