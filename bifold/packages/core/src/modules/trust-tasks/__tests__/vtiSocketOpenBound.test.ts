/**
 * A websocket that never opens must not hold a session for ever.
 *
 * Found 2026-09-25 on an iPhone linking to the lab's agent: the mediator
 * logged the login and never an upgrade, and the link failed after the grant
 * check's 30 s with "Something went wrong while linking"; a second tap linked.
 * `openSocket` waited for open, error or close with no bound, so a connect that
 * stalled (none of the three) was only ended by the caller's deadline.
 */
import {
  SOCKET_OPEN_TIMEOUT_MS,
  VtiMediatorSession,
  type VtiClientIdentity,
  type VtiMediatorEndpoints,
} from '../module/VtiMediatorTransport'

const identity: VtiClientIdentity = {
  did: 'did:peer:2:member',
  kid: 'did:peer:2:member#key-2',
  senderKey: {} as never,
}
const mediator: VtiMediatorEndpoints = {
  did: 'did:peer:2:mediator',
  authEndpoint: 'https://mediator.example/mediator/v1',
  wsEndpoint: 'wss://mediator.example/mediator/v1/ws',
  publicJwk: {} as never,
  kid: 'did:peer:2:mediator#key-1',
}
const agent = {
  config: { logger: { info: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined } },
} as never

/** A WebSocket whose open is scripted per construction: 'never', 'open' or 'error'. */
class ScriptedSocket {
  static script: Array<'never' | 'open' | 'error'> = []
  static made: ScriptedSocket[] = []
  readyState = 0
  closed = false
  onmessage?: unknown
  private listeners: Record<string, Array<(e?: unknown) => void>> = {}
  constructor() {
    ScriptedSocket.made.push(this)
    const how = ScriptedSocket.script.shift() ?? 'never'
    if (how !== 'never') {
      setTimeout(() => {
        if (how === 'open') this.readyState = 1
        this.emit(how === 'open' ? 'open' : 'error', { message: 'refused' })
      }, 10)
    }
  }
  addEventListener(type: string, fn: (e?: unknown) => void) {
    this.listeners[type] = [...(this.listeners[type] ?? []), fn]
  }
  removeEventListener(type: string, fn: (e?: unknown) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn)
  }
  close() {
    this.closed = true
  }
  private emit(type: string, e?: unknown) {
    for (const fn of [...(this.listeners[type] ?? [])]) fn(e)
  }
}

function freshSession() {
  const session = new VtiMediatorSession(agent, identity, mediator, {})
  const internals = session as unknown as {
    accessToken?: string
    ensureAccessToken: () => Promise<void>
    startLiveDelivery: () => Promise<void>
  }
  // A good login: the token is fresh, not cached from an earlier start.
  internals.ensureAccessToken = async () => {
    internals.accessToken = 'jwt'
  }
  internals.startLiveDelivery = async () => undefined
  return session
}

describe('opening the mediator socket', () => {
  const realWebSocket = global.WebSocket
  beforeEach(() => {
    jest.useFakeTimers()
    ScriptedSocket.script = []
    ScriptedSocket.made = []
    ;(global as unknown as { WebSocket: unknown }).WebSocket = ScriptedSocket
  })
  afterEach(() => {
    jest.useRealTimers()
    ;(global as unknown as { WebSocket: unknown }).WebSocket = realWebSocket
  })

  it('gives a stalled open up after the bound, closes it, and opens a fresh socket', async () => {
    ScriptedSocket.script = ['never', 'open']
    const started = freshSession().start()
    await jest.advanceTimersByTimeAsync(SOCKET_OPEN_TIMEOUT_MS + 50)
    await expect(started).resolves.toBeUndefined()
    expect(ScriptedSocket.made).toHaveLength(2)
    // The stalled one is closed, so a late open cannot leave a second socket.
    expect(ScriptedSocket.made[0].closed).toBe(true)
    expect(ScriptedSocket.made[1].readyState).toBe(1)
  })

  it('fails, rather than hanging, when neither try opens — inside a 30 s connect deadline', async () => {
    ScriptedSocket.script = ['never', 'never']
    const started = freshSession().start()
    const outcome = started.then(
      () => 'opened',
      (e: Error) => e.message
    )
    await jest.advanceTimersByTimeAsync(2 * SOCKET_OPEN_TIMEOUT_MS + 50)
    expect(await outcome).toMatch(/socket did not open after 8000 ms/)
    expect(2 * SOCKET_OPEN_TIMEOUT_MS).toBeLessThan(30000)
  })

  it('does not retry a fresh token the mediator refuses outright', async () => {
    ScriptedSocket.script = ['error', 'open']
    const started = freshSession().start()
    const outcome = started.then(
      () => 'opened',
      (e: Error) => e.message
    )
    await jest.advanceTimersByTimeAsync(100)
    expect(await outcome).toMatch(/socket failed to open: refused/)
    expect(ScriptedSocket.made).toHaveLength(1)
  })
})
