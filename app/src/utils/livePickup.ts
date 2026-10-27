/**
 * Mediator pickup over a live WebSocket (Pickup 2.0 live mode), behind the
 * Developer option "Live message pickup" (store developer.enableLivePickup;
 * LIVE_MESSAGE_PICKUP=true in app/.env sets the build's default). Off, the app
 * polls (utils/pickupBoost.ts).
 *
 * Why live: an idle open app polling every 5 s still sends 720 requests an
 * hour, and the mediator keeps native memory per request; an idle socket sends
 * none. The mediator's Postgres pickup queue holds every pushed message as
 * 'sending' until the phone acks it, and puts it back when the live session
 * ends, so a push into a socket that dies is delivered again on reconnect.
 * Measured on a local mediator built like production:
 * docs/plans/mediator-migration-plan/2026-10-25-al.md part 7.
 *
 * Why the backstop: a socket can die without a close event (NAT or proxy
 * reaping, a suspended app), and React Native gives JavaScript no pong to
 * notice it by. Credo reconnects only on a close event, and its own
 * initiateMessagePickup reuses a dead socket that is still in its transport
 * table: measured, a return to the foreground after a half-open socket
 * delivered nothing until the socket was closed. So every 60 s while the app is
 * in the foreground, and on every return, this asks the mediator for its status
 * over the socket with a short timeout; on a timeout or an error it closes the
 * socket first, then starts live pickup again.
 *
 * Ships first in a STORE build (273), behind the switch, because it changes
 * the transport. tier.mjs would allow an OTA (no native or dependency change);
 * that is not a reason to send it by OTA.
 *
 * The only file allowed to start live mode (mediatorPickupStrategy.guard.test.ts).
 */
import { MessagePickupLifecycle, defaultMessagePickupLifecycle } from '@bifold/core'
import { Agent } from '@credo-ts/core'
import { DidCommMediatorPickupStrategy } from '@credo-ts/didcomm'

export const LIVE_CHECK_INTERVAL_MS = 60_000
export const LIVE_CHECK_TIMEOUT_MS = 5_000

let liveEnabled = false

/** Set from the store at startup and by the Developer toggle. */
export const setLivePickupEnabled = (enabled: boolean): void => {
  liveEnabled = enabled
}

export const isLivePickupEnabled = (): boolean => liveEnabled

// --- the agent's WebSockets ---

type SocketLike = { close(): void; addEventListener(type: 'close', listener: () => void): void }
const openSockets = new Set<SocketLike>()

/**
 * The agent's WebSocket class, remembering each socket until it closes, so a
 * dead one can be closed on purpose. Credo opens a socket per endpoint and
 * connection; in this app the only WebSocket endpoint it uses is the
 * mediator's. Installed whatever the switch says: it only keeps a list.
 */
export const trackingWebSocketClass = <T extends new (...args: any[]) => SocketLike>(Base: T): T =>
  class TrackedWebSocket extends Base {
    constructor(...args: any[]) {
      super(...args)
      openSockets.add(this)
      this.addEventListener('close', () => openSockets.delete(this))
    }
  }

/** Closes every socket the agent has open; returns how many. */
export const closeAgentSockets = (): number => {
  const sockets = [...openSockets]
  for (const socket of sockets) {
    openSockets.delete(socket)
    try {
      socket.close()
    } catch {
      // Already closing; Credo's close handler cleans up either way.
    }
  }
  return sockets.length
}

// --- the controller ---

export interface LivePickup {
  /** Stops whatever pickup runs, starts live pickup, and arms the 60 s check. */
  start(): Promise<void>
  /** One status round trip over the socket; on failure, closes it and starts again. True when healthy. */
  check(): Promise<boolean>
  /** The app went to the background: no checks, no socket, no pickup. */
  pause(): Promise<void>
  /** Disarms the check (the app is switching to polling). */
  disarm(): void
}

interface LivePickupDeps {
  agent: Agent
  logger: { info(message: string): void; warn(message: string): void }
  closeSockets?: () => number
  setInterval?: typeof setInterval
  clearInterval?: typeof clearInterval
}

export const createLivePickup = ({
  agent,
  logger,
  closeSockets = closeAgentSockets,
  setInterval: arm = setInterval,
  clearInterval: disarmTimer = clearInterval,
}: LivePickupDeps): LivePickup => {
  const recipient = agent.modules.didcomm.mediationRecipient
  let timer: ReturnType<typeof setInterval> | undefined
  let checking: Promise<boolean> | undefined

  const disarm = () => {
    if (timer) disarmTimer(timer)
    timer = undefined
  }

  const initiate = async () => {
    // A stop first: credo starts one reconnect monitor per live start, and only
    // a stop ends it (guarded by mediatorPickupStrategy.guard.test.ts).
    await recipient.stopMessagePickup()
    await recipient.initiateMessagePickup(undefined, DidCommMediatorPickupStrategy.PickUpV2LiveMode)
  }

  const restart = async (why: string) => {
    const closed = closeSockets()
    logger.warn(`Live message pickup restarting (${why}); closed ${closed} socket(s)`)
    try {
      await initiate()
    } catch (error) {
      // The mediator is unreachable now; the next check tries again.
      logger.warn(`Live message pickup could not restart: ${(error as Error)?.message ?? error}`)
    }
  }

  const runCheck = async (): Promise<boolean> => {
    try {
      const connectionId = (await recipient.findDefaultMediatorConnection())?.id
      if (!connectionId) return true
      await agent.modules.didcomm.messagePickup.pickupMessages({
        connectionId,
        protocolVersion: 'v2',
        awaitCompletion: true,
        awaitCompletionTimeoutMs: LIVE_CHECK_TIMEOUT_MS,
      })
      return true
    } catch (error) {
      await restart(`status check failed: ${(error as Error)?.message ?? error}`)
      return false
    }
  }

  const check = (): Promise<boolean> => {
    // One check at a time: a slow mediator must not stack them up.
    if (!checking) checking = runCheck().finally(() => (checking = undefined))
    return checking
  }

  const armCheck = () => {
    disarm()
    timer = arm(() => void check(), LIVE_CHECK_INTERVAL_MS)
  }

  return {
    start: async () => {
      // A socket left from before (a suspended app, a switch from polling) may
      // be dead and would be reused; start on a fresh one.
      closeSockets()
      try {
        await initiate()
        logger.info('Live message pickup started')
      } catch (error) {
        logger.warn(`Live message pickup did not start: ${(error as Error)?.message ?? error}`)
      }
      armCheck()
    },
    check,
    pause: async () => {
      disarm()
      await recipient.stopMessagePickup()
      // Close the socket so the mediator queues instead of pushing into a
      // suspended app. A push wake still comes: the mediator sends one for
      // every queued message, live session or not.
      closeSockets()
    },
    disarm,
  }
}

let current: { agent: Agent; pickup: LivePickup } | undefined

/** The controller for this agent; a new agent (a restart) replaces the old one's. */
export const livePickupFor = (agent: Agent, logger: LivePickupDeps['logger']): LivePickup => {
  if (current?.agent !== agent) {
    current?.pickup.disarm()
    current = { agent, pickup: createLivePickup({ agent, logger }) }
  }
  return current.pickup
}

/** Stops the live check, if any (the app is switching to polling). */
export const disarmLivePickup = (): void => current?.pickup.disarm()

/**
 * Bifold's ActivityProvider hands background and foreground here
 * (TOKENS.UTIL_MESSAGE_PICKUP). Background: live pauses; polling stops as
 * before. Foreground: nothing here, because the app's own foreground handler
 * (useBCAgentSetup) restarts pickup in either mode, also after a lock-out,
 * which ActivityProvider skips. Two restarts would race.
 */
export const appMessagePickupLifecycle = (logger: LivePickupDeps['logger']): MessagePickupLifecycle => ({
  onBackground: async (agent) => {
    if (isLivePickupEnabled()) await livePickupFor(agent, logger).pause()
    else await defaultMessagePickupLifecycle.onBackground(agent)
  },
  onForeground: async () => undefined,
})
