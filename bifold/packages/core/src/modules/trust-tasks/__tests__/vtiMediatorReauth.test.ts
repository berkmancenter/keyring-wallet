import { VtiMediatorSession, type VtiClientIdentity, type VtiMediatorEndpoints } from '../module/VtiMediatorTransport'

// A cached access token the mediator will no longer honour was the one failure
// this transport could not recover from: every reopen path presents the same
// dead bearer, so the socket fails identically for ever and only recreating the
// object clears it — in practice, relaunching the app. Measured on 2026-09-20
// when forgetting the community mid-session left the wallet reporting "socket
// failed to open" for the rest of an e2e run.
//
// These pin the rule that fixes it: a handshake refused while using a CACHED
// token is a verdict on the token, not on the connection.

const identity: VtiClientIdentity = { did: 'did:peer:2:applicant', kid: 'did:peer:2:applicant#key-2', senderKey: {} as never }
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

/** A socket that opens only when handed one of `accepts`, and errors otherwise. */
function fakeWebSocketClass(accepts: string[], opened: string[]) {
  return class {
    readyState = 0
    onmessage: unknown
    private listeners: Record<string, ((e?: unknown) => void)[]> = {}
    constructor(_url: string, protocols: string[]) {
      const bearer = protocols.find((p) => p.startsWith('bearer.')) ?? ''
      const token = bearer.slice('bearer.'.length)
      opened.push(token)
      // The event has to arrive after the caller has attached its listeners.
      setTimeout(() => {
        if (accepts.includes(token)) {
          this.readyState = 1
          this.listeners.open?.forEach((f) => f())
        } else {
          this.listeners.error?.forEach((f) => f({ message: 'unauthorised' }))
        }
      }, 0)
    }
    addEventListener(name: string, fn: (e?: unknown) => void) {
      ;(this.listeners[name] ??= []).push(fn)
    }
    removeEventListener(name: string, fn: (e?: unknown) => void) {
      this.listeners[name] = (this.listeners[name] ?? []).filter((f) => f !== fn)
    }
    send() {
      /* live-delivery and delivery-request frames; not under test */
    }
    close() {
      this.readyState = 3
    }
  }
}

function stubLogin(token: string, calls: { count: number }) {
  global.fetch = (async (url: string) => {
    if (String(url).endsWith('/challenge')) {
      return { status: 200, text: async () => JSON.stringify({ data: { challenge: 'c', session_id: 's' } }) }
    }
    calls.count += 1
    return { status: 200, json: async () => ({ data: { access_token: token } }) }
  }) as never
}

describe('VtiMediatorSession — a refused cached token', () => {
  const realWebSocket = global.WebSocket
  const realFetch = global.fetch
  afterEach(() => {
    global.WebSocket = realWebSocket
    global.fetch = realFetch
  })

  test('is dropped and re-minted once, so the transport recovers without a relaunch', async () => {
    const opened: string[] = []
    const logins = { count: 0 }
    // The mediator accepts only a freshly minted token; the cached one is dead.
    global.WebSocket = fakeWebSocketClass(['fresh'], opened) as never
    stubLogin('fresh', logins)

    const session = new VtiMediatorSession(agent, identity, mediator, {})
    ;(session as unknown as { accessToken?: string }).accessToken = 'stale'

    await session.start()

    // It tried the cached token, was refused, logged in again and got in.
    expect(opened).toEqual(['stale', 'fresh'])
    expect(logins.count).toBe(1)
    expect((session as unknown as { accessToken?: string }).accessToken).toBe('fresh')
    await session.stop()
  })

  test('is not retried when the token was just minted, so a real refusal is reported', async () => {
    const opened: string[] = []
    const logins = { count: 0 }
    // Nothing is accepted: the fresh token is refused too.
    global.WebSocket = fakeWebSocketClass([], opened) as never
    stubLogin('fresh', logins)

    const session = new VtiMediatorSession(agent, identity, mediator, {})

    await expect(session.start()).rejects.toThrow(/socket failed to open/)
    // One login, one attempt — a refusal of a token this call minted is a real
    // failure, and looping on it would hammer the mediator while hiding it.
    expect(opened).toEqual(['fresh'])
    expect(logins.count).toBe(1)
  })
})
