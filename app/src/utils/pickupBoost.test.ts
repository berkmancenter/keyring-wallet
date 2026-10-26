import { Agent } from '@credo-ts/core'

import { createPickupBoost, PICKUP_ACTIVE_INTERVAL_MS, PICKUP_ACTIVE_WINDOW_MS, startPickupBoost } from './pickupBoost'

describe('createPickupBoost', () => {
  let clock = 0
  const now = () => clock
  const advance = async (ms: number) => {
    // Advance the timers and the clock the window reads in step, a second at a time.
    for (let elapsed = 0; elapsed < ms; elapsed += PICKUP_ACTIVE_INTERVAL_MS) {
      clock += PICKUP_ACTIVE_INTERVAL_MS
      jest.advanceTimersByTime(PICKUP_ACTIVE_INTERVAL_MS)
      await Promise.resolve()
    }
  }

  beforeEach(() => {
    jest.useFakeTimers()
    clock = 0
  })
  afterEach(() => jest.useRealTimers())

  it('asks every second for the window after a boost, then stops', async () => {
    const pickupOnce = jest.fn(async () => undefined)
    const boost = createPickupBoost({ pickupOnce, now })
    boost.boost()
    await advance(PICKUP_ACTIVE_WINDOW_MS + 10_000)
    // One ask a second inside the window, none after it: the 5 s loop alone covers the rest.
    expect(pickupOnce).toHaveBeenCalledTimes(PICKUP_ACTIVE_WINDOW_MS / PICKUP_ACTIVE_INTERVAL_MS - 1)
    boost.stop()
  })

  it('extends the window on a boost inside it, without a second timer', async () => {
    const pickupOnce = jest.fn(async () => undefined)
    const boost = createPickupBoost({ pickupOnce, now })
    boost.boost()
    await advance(20_000)
    boost.boost()
    boost.boost()
    await advance(PICKUP_ACTIVE_WINDOW_MS + 10_000)
    // 20 s, then a full window from the second boost: still one ask a second, never two.
    expect(pickupOnce).toHaveBeenCalledTimes((20_000 + PICKUP_ACTIVE_WINDOW_MS) / PICKUP_ACTIVE_INTERVAL_MS - 1)
    boost.stop()
  })

  it('never stacks asks while one is still waiting on the mediator', async () => {
    let release!: () => void
    const pickupOnce = jest.fn(() => new Promise<void>((resolve) => (release = resolve)))
    const boost = createPickupBoost({ pickupOnce, now })
    boost.boost()
    await advance(5_000)
    expect(pickupOnce).toHaveBeenCalledTimes(1)
    release()
    await Promise.resolve()
    await advance(1_000)
    expect(pickupOnce).toHaveBeenCalledTimes(2)
    boost.stop()
  })

  it('reports a failed ask and keeps asking', async () => {
    const pickupOnce = jest.fn().mockRejectedValueOnce(new Error('mediator down')).mockResolvedValue(undefined)
    const onError = jest.fn()
    const boost = createPickupBoost({ pickupOnce, onError, now })
    boost.boost()
    await advance(3_000)
    expect(onError).toHaveBeenCalledWith(new Error('mediator down'))
    expect(pickupOnce.mock.calls.length).toBeGreaterThan(1)
    boost.stop()
  })

  it('asks nothing after stop', async () => {
    const pickupOnce = jest.fn(async () => undefined)
    const boost = createPickupBoost({ pickupOnce, now })
    boost.boost()
    boost.stop()
    await advance(10_000)
    expect(pickupOnce).not.toHaveBeenCalled()
  })

  describe('startPickupBoost', () => {
    // A minimal agent: the default mediator's connection, the pickup call, and the sent event.
    const fakeAgent = () => {
      const handlers: Record<string, Array<(event: unknown) => void>> = {}
      const pickupMessages = jest.fn(async () => undefined)
      const agent = {
        modules: {
          didcomm: {
            mediationRecipient: { findDefaultMediatorConnection: jest.fn(async () => ({ id: 'mediator' })) },
            messagePickup: { pickupMessages },
          },
        },
        events: {
          on: jest.fn((type: string, handler: (event: unknown) => void) => (handlers[type] ??= []).push(handler)),
          off: jest.fn(),
        },
      }
      const sent = (connectionId: string) =>
        handlers.DidCommMessageSent?.forEach((handler) =>
          handler({ payload: { message: { connection: { id: connectionId } } } })
        )
      const processed = (connectionId: string) =>
        handlers.DidCommMessageProcessed?.forEach((handler) =>
          handler({ payload: { connection: { id: connectionId } } })
        )
      return { agent: agent as unknown as Agent, pickupMessages, sent, processed, off: agent.events.off }
    }

    it("opens the window on a message to a contact, not on the app's own asks to the mediator", async () => {
      const { agent, pickupMessages, sent } = fakeAgent()
      const boost = startPickupBoost(agent, { warn: jest.fn() })
      await Promise.resolve()
      // Each ask is itself a message to the mediator: counting it would keep the window open forever.
      sent('mediator')
      await advance(5_000)
      expect(pickupMessages).not.toHaveBeenCalled()
      sent('a-contact')
      await advance(3_000)
      expect(pickupMessages).toHaveBeenCalledWith({ connectionId: 'mediator', protocolVersion: 'v2' })
      boost.stop()
    })

    it("opens the window on a contact's message arriving, not on the mediator's answers", async () => {
      const { agent, pickupMessages, processed } = fakeAgent()
      const boost = startPickupBoost(agent, { warn: jest.fn() })
      await Promise.resolve()
      processed('mediator')
      await advance(5_000)
      expect(pickupMessages).not.toHaveBeenCalled()
      // Someone reading a run of messages from a contact: the window opens at the first.
      processed('a-contact')
      await advance(3_000)
      expect(pickupMessages).toHaveBeenCalled()
      boost.stop()
    })

    it('stops listening when stopped', () => {
      const { agent, off } = fakeAgent()
      startPickupBoost(agent, { warn: jest.fn() }).stop()
      expect(off).toHaveBeenCalledTimes(2)
    })
  })
})
