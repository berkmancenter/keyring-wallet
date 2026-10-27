import { Agent } from '@credo-ts/core'
import { DidCommEventTypes, DidCommMessageProcessedEvent, DidCommMessageSentEvent } from '@credo-ts/didcomm'

import { isLivePickupEnabled } from './livePickup'

/**
 * How often the app asks its mediator for new messages while it is open.
 *
 * Each ask is a Pickup 2.0 status-request the mediator answers from its queue
 * (bc-agent-modules.ts, mediatorPollingInterval). At one a second an open app
 * sent 3,600 an hour (measured 1.00/s, 2026-10-25), nearly all of the shared
 * mediator's inbound traffic, and the mediator retains memory per inbound
 * message. So the steady loop asks every 5 s, and only a phone in use asks
 * every second: for a short window after the agent starts, after the app
 * returns to the foreground, and after it sends something to a contact or
 * receives something from one.
 *
 * A peer's message reaches a phone on that phone's next ask. In a back-and-
 * forth (a chat, a relationship exchange) both phones are inside their window
 * and see each other within about a second, as before; so does someone only
 * reading a run of messages, from the second message on. A phone that has been
 * idle for a while sees the first message of a new exchange up to 5 s later.
 * In the background the OS stops the loop anyway, and a push wake brings the
 * app back for a peer message.
 */
export const PICKUP_IDLE_INTERVAL_MS = 5_000
export const PICKUP_ACTIVE_INTERVAL_MS = 1_000
export const PICKUP_ACTIVE_WINDOW_MS = 30_000

export interface PickupBoost {
  /** Ask every second from now until the window ends; a boost inside a window extends it. */
  boost(): void
  stop(): void
}

/**
 * The 1 s window on its own, around any single ask: one ask at a time, so a
 * slow mediator never stacks asks up, and a failed ask is reported, not thrown.
 */
export const createPickupBoost = ({
  pickupOnce,
  onError,
  now = Date.now,
}: {
  pickupOnce: () => Promise<void>
  onError?: (error: unknown) => void
  now?: () => number
}): PickupBoost => {
  let timer: ReturnType<typeof setInterval> | undefined
  let until = 0
  let asking = false

  const stop = () => {
    if (timer) clearInterval(timer)
    timer = undefined
  }

  const tick = async () => {
    if (now() >= until) {
      stop()
      return
    }
    if (asking) return
    asking = true
    try {
      await pickupOnce()
    } catch (error) {
      onError?.(error)
    } finally {
      asking = false
    }
  }

  return {
    boost: () => {
      until = now() + PICKUP_ACTIVE_WINDOW_MS
      if (!timer) timer = setInterval(() => void tick(), PICKUP_ACTIVE_INTERVAL_MS)
    },
    stop,
  }
}

/**
 * The window for a running agent: asks the default mediator with the same call
 * credo's own loop makes (Pickup 2.0, the mediator this app is provisioned
 * with), and opens the window whenever the app sends a message to, or gets
 * one from, anyone but the mediator. Traffic with the mediator (each ask and
 * its answer, keylist updates) must not count, or every ask would extend its
 * own window.
 */
export const startPickupBoost = (agent: Agent, logger: { warn: (message: string) => void }): PickupBoost => {
  let mediatorConnectionId: string | undefined
  const mediatorConnection = async (): Promise<string | undefined> => {
    if (!mediatorConnectionId) {
      mediatorConnectionId = (await agent.modules.didcomm.mediationRecipient.findDefaultMediatorConnection())?.id
    }
    return mediatorConnectionId
  }
  // Learned up front, so a send before the first ask is already told apart.
  void mediatorConnection().catch(() => undefined)

  let warned = false
  const boost = createPickupBoost({
    pickupOnce: async () => {
      const connectionId = await mediatorConnection()
      if (!connectionId) return
      await agent.modules.didcomm.messagePickup?.pickupMessages({ connectionId, protocolVersion: 'v2' })
    },
    onError: (error) => {
      // Once per window owner: the steady loop keeps running, and a log line a
      // second while the mediator is down would bury everything else.
      if (warned) return
      warned = true
      logger.warn(`Fast message pickup failed, the 5 s pickup continues: ${(error as Error)?.message ?? error}`)
    },
  })

  // Live pickup gets each message pushed as it arrives, so the window has
  // nothing to add and would only send status-requests over the socket.
  const boostUnlessLive = () => {
    if (!isLivePickupEnabled()) boost.boost()
  }
  const withContact = (connectionId: string | undefined) => {
    if (!connectionId || connectionId === mediatorConnectionId) return
    boostUnlessLive()
  }
  const onSent = (event: DidCommMessageSentEvent) => withContact(event.payload.message.connection?.id)
  const onProcessed = (event: DidCommMessageProcessedEvent) => withContact(event.payload.connection?.id)
  agent.events.on<DidCommMessageSentEvent>(DidCommEventTypes.DidCommMessageSent, onSent)
  agent.events.on<DidCommMessageProcessedEvent>(DidCommEventTypes.DidCommMessageProcessed, onProcessed)

  return {
    boost: boostUnlessLive,
    stop: () => {
      boost.stop()
      agent.events.off<DidCommMessageSentEvent>(DidCommEventTypes.DidCommMessageSent, onSent)
      agent.events.off<DidCommMessageProcessedEvent>(DidCommEventTypes.DidCommMessageProcessed, onProcessed)
    },
  }
}
