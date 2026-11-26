import { DidCommMediatorPickupStrategy } from '@credo-ts/didcomm'

import {
  LIVE_CHECK_INTERVAL_MS,
  LIVE_CHECK_TIMEOUT_MS,
  appMessagePickupLifecycle,
  appRestartsPickupOnReturn,
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
  const restartOnReturn = jest.fn(async () => undefined)
  afterEach(() => setLivePickupEnabled(false))

  it('polling: background stops pickup, as before', async () => {
    setLivePickupEnabled(false)
    const { agent, calls } = makeAgent()
    await appMessagePickupLifecycle(logger, restartOnReturn).onBackground(agent)
    expect(calls).toEqual(['stop'])
  })

  it('live: background pauses live pickup', async () => {
    setLivePickupEnabled(true)
    const { agent, calls } = makeAgent()
    await appMessagePickupLifecycle(logger, restartOnReturn).onBackground(agent)
    expect(calls).toEqual(['stop'])
    // No check fires afterwards.
    jest.useFakeTimers()
    await jest.advanceTimersByTimeAsync(LIVE_CHECK_INTERVAL_MS)
    expect(agent.modules.didcomm.messagePickup.pickupMessages).not.toHaveBeenCalled()
    jest.useRealTimers()
  })

  it("foreground is the app's own restart, with the agent, in either mode; nothing of bifold's", async () => {
    for (const live of [false, true]) {
      setLivePickupEnabled(live)
      restartOnReturn.mockClear()
      const { agent, calls } = makeAgent()
      await appMessagePickupLifecycle(logger, restartOnReturn).onForeground(agent)
      expect(restartOnReturn).toHaveBeenCalledTimes(1)
      expect(restartOnReturn).toHaveBeenCalledWith(agent)
      expect(calls).toEqual([])
    }
  })
})

// One restart per return, by whichever handler owns it (ZAF5-PR5N: the app's own restart ran on a return that locked
// the app, on the agent whose store the lock-out was closing, and failed with "Invalid store handle").
describe('appRestartsPickupOnReturn: who restarts pickup on a return', () => {
  const restartOnReturn = jest.fn(async () => undefined)
  beforeEach(() => {
    restartOnReturn.mockClear()
    appRestartsPickupOnReturn('background', 'active') // whatever an earlier case left: the next return is unowned
  })

  it('a return ActivityProvider saw is its own: the app handler leaves it alone', async () => {
    const { agent } = makeAgent()
    await appMessagePickupLifecycle(logger, restartOnReturn).onBackground(agent)
    expect(appRestartsPickupOnReturn('background', 'active')).toBe(false)
  })

  it('a return that locks restarts nothing (ActivityProvider locks and does not call onForeground)', async () => {
    const { agent, calls } = makeAgent()
    const lifecycle = appMessagePickupLifecycle(logger, restartOnReturn)
    await lifecycle.onBackground(agent)
    calls.length = 0
    expect(appRestartsPickupOnReturn('background', 'active')).toBe(false)
    expect(restartOnReturn).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it('the control: a return that does not lock restarts exactly once, through onForeground', async () => {
    const { agent } = makeAgent()
    const lifecycle = appMessagePickupLifecycle(logger, restartOnReturn)
    await lifecycle.onBackground(agent)
    const appRestarts = appRestartsPickupOnReturn('background', 'active')
    await lifecycle.onForeground(agent)
    expect(appRestarts).toBe(false)
    expect(restartOnReturn).toHaveBeenCalledTimes(1)
  })

  it("without ActivityProvider (onboarding, the agent already running), the return is the app handler's", () => {
    expect(appRestartsPickupOnReturn('background', 'active')).toBe(true)
  })

  it("the hand-over is taken once: the next return ActivityProvider did not see is the app handler's", async () => {
    const { agent } = makeAgent()
    await appMessagePickupLifecycle(logger, restartOnReturn).onBackground(agent)
    expect(appRestartsPickupOnReturn('background', 'active')).toBe(false)
    expect(appRestartsPickupOnReturn('background', 'active')).toBe(true)
  })

  it('only a return from the background counts, as ActivityProvider counts one', () => {
    expect(appRestartsPickupOnReturn('inactive', 'active')).toBe(false) // a Face ID sheet, Control Center
    expect(appRestartsPickupOnReturn('active', 'inactive')).toBe(false)
    expect(appRestartsPickupOnReturn('active', 'background')).toBe(false)
    expect(appRestartsPickupOnReturn('inactive', 'background')).toBe(false)
    expect(appRestartsPickupOnReturn('background', 'inactive')).toBe(true)
  })

  it('a flip that is not a return leaves the hand-over in place for the real return', async () => {
    const { agent } = makeAgent()
    await appMessagePickupLifecycle(logger, restartOnReturn).onBackground(agent)
    expect(appRestartsPickupOnReturn('inactive', 'active')).toBe(false)
    expect(appRestartsPickupOnReturn('background', 'active')).toBe(false)
  })

  it('a background whose pause fails still hands the return to ActivityProvider', async () => {
    const { agent, mediationRecipient } = makeAgent()
    mediationRecipient.stopMessagePickup.mockRejectedValueOnce(new Error('Invalid store handle'))
    await expect(appMessagePickupLifecycle(logger, restartOnReturn).onBackground(agent)).rejects.toThrow()
    expect(appRestartsPickupOnReturn('background', 'active')).toBe(false)
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
