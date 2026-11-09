import { DidCommMediatorPickupStrategy } from '@credo-ts/didcomm'

import {
  LIVE_CHECK_INTERVAL_MS,
  LIVE_CHECK_TIMEOUT_MS,
  appMessagePickupLifecycle,
  closeAgentSockets,
  createLivePickup,
  livePickupFor,
  setLivePickupEnabled,
  trackingWebSocketClass,
} from './livePickup'

const logger = { info: jest.fn(), warn: jest.fn() }

const makeAgent = ({ pickup }: { pickup?: () => Promise<void> } = {}) => {
  const calls: string[] = []
  const mediationRecipient = {
    stopMessagePickup: jest.fn(async () => {
      calls.push('stop')
    }),
    initiateMessagePickup: jest.fn(async (_record: unknown, strategy: string) => {
      calls.push(`initiate ${strategy}`)
    }),
    findDefaultMediatorConnection: jest.fn(async () => ({ id: 'mediator-connection' })),
  }
  const messagePickup = {
    pickupMessages: jest.fn(async () => {
      calls.push('status')
      await pickup?.()
    }),
  }
  const agent = { modules: { didcomm: { mediationRecipient, messagePickup } } } as any
  return { agent, mediationRecipient, messagePickup, calls }
}

const LIVE = `initiate ${DidCommMediatorPickupStrategy.PickUpV2LiveMode}`

describe('createLivePickup', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
  })
  afterEach(() => jest.useRealTimers())

  it('starts on a fresh socket: closes old sockets, stops, then starts live mode', async () => {
    const { agent, calls } = makeAgent()
    const closeSockets = jest.fn(() => {
      calls.push('close')
      return 1
    })
    await createLivePickup({ agent, logger, closeSockets }).start()
    expect(calls).toEqual(['close', 'stop', LIVE])
  })

  it('checks over the socket every 60 s with a short timeout, and leaves a healthy socket alone', async () => {
    const { agent, messagePickup, calls } = makeAgent()
    const closeSockets = jest.fn(() => 0)
    await createLivePickup({ agent, logger, closeSockets }).start()
    calls.length = 0
    closeSockets.mockClear()

    await jest.advanceTimersByTimeAsync(LIVE_CHECK_INTERVAL_MS)

    expect(messagePickup.pickupMessages).toHaveBeenCalledWith({
      connectionId: 'mediator-connection',
      protocolVersion: 'v2',
      awaitCompletion: true,
      awaitCompletionTimeoutMs: LIVE_CHECK_TIMEOUT_MS,
    })
    expect(calls).toEqual(['status'])
    expect(closeSockets).not.toHaveBeenCalled()
  })

  it('on a failed check closes the socket BEFORE starting again (a dead socket would be reused)', async () => {
    const { agent, calls } = makeAgent({
      pickup: async () => {
        throw new Error('Timeout has occurred')
      },
    })
    const closeSockets = jest.fn(() => {
      calls.push('close')
      return 1
    })
    const pickup = createLivePickup({ agent, logger, closeSockets })

    await expect(pickup.check()).resolves.toBe(false)
    expect(calls).toEqual(['status', 'close', 'stop', LIVE])
  })

  it('runs one check at a time', async () => {
    let release: () => void = () => undefined
    const { agent, messagePickup } = makeAgent({ pickup: () => new Promise<void>((r) => (release = r)) })
    const pickup = createLivePickup({ agent, logger, closeSockets: () => 0 })

    const first = pickup.check()
    const second = pickup.check()
    await Promise.resolve()
    expect(messagePickup.pickupMessages).toHaveBeenCalledTimes(1)
    release()
    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(true)
  })

  it('a start that fails (mediator unreachable) still arms the check, which tries again', async () => {
    const { agent, mediationRecipient } = makeAgent()
    mediationRecipient.initiateMessagePickup.mockRejectedValueOnce(new Error('Timeout has occurred'))
    const pickup = createLivePickup({ agent, logger, closeSockets: () => 0 })
    await pickup.start()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('did not start'))

    await jest.advanceTimersByTimeAsync(LIVE_CHECK_INTERVAL_MS)
    expect(agent.modules.didcomm.messagePickup.pickupMessages).toHaveBeenCalledTimes(1)
  })

  it('pause stops checking, stops pickup and closes the socket', async () => {
    const { agent, messagePickup, calls } = makeAgent()
    const closeSockets = jest.fn(() => {
      calls.push('close')
      return 1
    })
    const pickup = createLivePickup({ agent, logger, closeSockets })
    await pickup.start()
    calls.length = 0

    await pickup.pause()
    expect(calls).toEqual(['stop', 'close'])

    await jest.advanceTimersByTimeAsync(LIVE_CHECK_INTERVAL_MS * 3)
    expect(messagePickup.pickupMessages).not.toHaveBeenCalled()
  })

  it('a restart re-arms one timer, not two', async () => {
    const { agent, messagePickup } = makeAgent()
    const pickup = createLivePickup({ agent, logger, closeSockets: () => 0 })
    await pickup.start()
    await pickup.start()
    await jest.advanceTimersByTimeAsync(LIVE_CHECK_INTERVAL_MS)
    expect(messagePickup.pickupMessages).toHaveBeenCalledTimes(1)
  })
})

describe('the agent WebSocket class', () => {
  class FakeSocket {
    listeners: Array<() => void> = []
    closed = 0
    constructor(public url: string) {}
    addEventListener(_type: 'close', listener: () => void) {
      this.listeners.push(listener)
    }
    close() {
      this.closed++
      this.listeners.forEach((l) => l())
    }
  }

  it('remembers open sockets until they close, and closes the rest on demand', () => {
    const Tracked = trackingWebSocketClass(FakeSocket)
    const a = new Tracked('wss://mediator.example') as FakeSocket
    const b = new Tracked('wss://mediator.example') as FakeSocket
    a.close() // closed on its own: no longer tracked

    expect(closeAgentSockets()).toBe(1)
    expect(a.closed).toBe(1)
    expect(b.closed).toBe(1)
    expect(closeAgentSockets()).toBe(0)
  })

  it('keeps the base class behaviour', () => {
    const Tracked = trackingWebSocketClass(FakeSocket)
    const socket = new Tracked('wss://mediator.example') as FakeSocket
    expect(socket).toBeInstanceOf(FakeSocket)
    expect(socket.url).toBe('wss://mediator.example')
    closeAgentSockets()
  })
})

describe('appMessagePickupLifecycle (ActivityProvider)', () => {
  afterEach(() => setLivePickupEnabled(false))

  it('polling: background stops pickup, as before', async () => {
    setLivePickupEnabled(false)
    const { agent, calls } = makeAgent()
    await appMessagePickupLifecycle(logger).onBackground(agent)
    expect(calls).toEqual(['stop'])
  })

  it('live: background pauses live pickup', async () => {
    setLivePickupEnabled(true)
    const { agent, calls } = makeAgent()
    await appMessagePickupLifecycle(logger).onBackground(agent)
    expect(calls).toEqual(['stop'])
    // No check fires afterwards.
    jest.useFakeTimers()
    await jest.advanceTimersByTimeAsync(LIVE_CHECK_INTERVAL_MS)
    expect(agent.modules.didcomm.messagePickup.pickupMessages).not.toHaveBeenCalled()
    jest.useRealTimers()
  })

  it('foreground does nothing: the app restarts pickup itself (useBCAgentSetup), in either mode', async () => {
    for (const live of [false, true]) {
      setLivePickupEnabled(live)
      const { agent, calls } = makeAgent()
      await appMessagePickupLifecycle(logger).onForeground(agent)
      expect(calls).toEqual([])
    }
  })
})

describe('livePickupFor', () => {
  it('keeps one controller per agent, and a new agent replaces the old one', async () => {
    jest.useFakeTimers()
    const first = makeAgent()
    const pickup = livePickupFor(first.agent, logger)
    expect(livePickupFor(first.agent, logger)).toBe(pickup)
    await pickup.start()

    const second = makeAgent()
    expect(livePickupFor(second.agent, logger)).not.toBe(pickup)
    // The old agent's check is disarmed.
    await jest.advanceTimersByTimeAsync(LIVE_CHECK_INTERVAL_MS)
    expect(first.messagePickup.pickupMessages).not.toHaveBeenCalled()
    jest.useRealTimers()
  })
})
