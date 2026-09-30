/**
 * The phone telling its agent it is still here (#10, plan part F).
 *
 * While the phone is linked, each tick registers it once (with the default
 * name, so a name the person chose on the link screen is never overwritten),
 * sends a heartbeat, and reads the agent's devices. Another device seen within
 * the liveness window is acting as the same agent; the person is told once per
 * device that becomes live, as openvtc does (`device_presence.rs`: siblings
 * "that were not live last time we looked"), because two devices on one
 * persona share its mediator connection and interrupt each other.
 *
 * The tick runs every {@link HEARTBEAT_INTERVAL_MS} from app start
 * ({@link useAgentPresence}), so a notice listener mounted near the root hears
 * the first one. An agent that cannot be reached is tried again next tick.
 * A failed tick is handed on (`onFailed`): the agent refuses a phone another
 * device removed ("DID not in ACL"), and the controller moves the link on
 * that, as it does for a refused sign-in.
 *
 * @module trust-tasks/module/vtaPresence
 */
import { useEffect } from 'react'
import { DeviceEventEmitter, Platform } from 'react-native'

import type { VtaLinkState } from './vtaLinkMachine'

import {
  defaultDeviceName,
  heartbeat,
  HEARTBEAT_INTERVAL_MS,
  listAgentDevices,
  liveSiblings,
  registerThisDevice,
  type AgentDevice,
  type AgentDevicePort,
} from './vtaDevices'

/**
 * Whether the phone's link to its agent is up: linked, with a session online.
 * Presence runs only then, and starts over — beating at once — each time it
 * comes up.
 */
export function isLinkOnline(link: VtaLinkState): boolean {
  return link.kind === 'linked' && link.connection.kind === 'online'
}

/** Emitted with the {@link AgentDevice} when another device starts acting as this agent. */
export const SIBLING_SEEN_EVENT = 'keyring/agent-sibling-seen'

export interface AgentPresenceDeps {
  /** A signed-in client while the phone is linked; undefined otherwise. */
  port: () => Promise<AgentDevicePort | undefined>
  platform: string
  now?: () => Date
  onSiblingSeen: (device: AgentDevice) => void
  /** A tick that failed, for the controller to read (a removed phone's refusal). */
  onFailed?: (error: unknown) => void
  log?: (message: string) => void
}

export class AgentPresence {
  private registered = false
  private announced = new Set<string>()
  private running = false

  constructor(private readonly deps: AgentPresenceDeps) {}

  /** One round: register once, beat, and announce newly live siblings. Never throws. */
  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const port = await this.deps.port()
      if (!port) return
      const now = this.deps.now?.() ?? new Date()
      if (!this.registered) {
        // A failed claim does not stop the beat: a phone the agent already
        // knows still has to say it is here.
        try {
          await registerThisDevice(port, {
            displayName: defaultDeviceName(this.deps.platform, now),
            platform: this.deps.platform,
          })
          this.registered = true
        } catch (e) {
          this.deps.log?.(`[VTA] registering this phone with its agent: ${(e as Error)?.message ?? e}`)
        }
      }
      await heartbeat(port)
      const live = liveSiblings(await listAgentDevices(port), now)
      const liveNow = new Set(live.map((d) => d.did))
      for (const device of live) if (!this.announced.has(device.did)) this.deps.onSiblingSeen(device)
      this.announced = liveNow
    } catch (e) {
      this.deps.log?.(`[VTA] telling the agent this phone is here: ${(e as Error)?.message ?? e}`)
      this.deps.onFailed?.(e)
    } finally {
      this.running = false
    }
  }
}

/**
 * Run {@link AgentPresence} while the app runs, from app start. `port` answers
 * a signed-in client while the phone is linked (the controller's
 * `presencePort`); `onFailed` hears a failed tick (the controller's
 * `presenceFailed`). Emits {@link SIBLING_SEEN_EVENT}.
 */
export function useAgentPresence(
  port: (() => Promise<AgentDevicePort | undefined>) | undefined,
  onFailed?: (error: unknown) => void,
  log?: (message: string) => void
): void {
  useEffect(() => {
    if (!port) return
    const presence = new AgentPresence({
      port,
      platform: Platform.OS,
      onSiblingSeen: (device) => DeviceEventEmitter.emit(SIBLING_SEEN_EVENT, device),
      onFailed,
      log,
    })
    void presence.tick()
    const timer = setInterval(() => void presence.tick(), HEARTBEAT_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [port, onFailed, log])
}
