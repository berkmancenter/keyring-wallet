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
 *
 * @module trust-tasks/module/vtaPresence
 */
import { useEffect } from 'react'
import { DeviceEventEmitter, Platform } from 'react-native'

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

/** Emitted with the {@link AgentDevice} when another device starts acting as this agent. */
export const SIBLING_SEEN_EVENT = 'keyring/agent-sibling-seen'

export interface AgentPresenceDeps {
  /** A signed-in client while the phone is linked; undefined otherwise. */
  port: () => Promise<AgentDevicePort | undefined>
  platform: string
  now?: () => Date
  onSiblingSeen: (device: AgentDevice) => void
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
        await registerThisDevice(port, {
          displayName: defaultDeviceName(this.deps.platform, now),
          platform: this.deps.platform,
        })
        this.registered = true
      }
      await heartbeat(port)
      const live = liveSiblings(await listAgentDevices(port), now)
      const liveNow = new Set(live.map((d) => d.did))
      for (const device of live) if (!this.announced.has(device.did)) this.deps.onSiblingSeen(device)
      this.announced = liveNow
    } catch (e) {
      this.deps.log?.(`[VTA] telling the agent this phone is here: ${(e as Error)?.message ?? e}`)
    } finally {
      this.running = false
    }
  }
}

/**
 * Run {@link AgentPresence} while the app runs, from app start. `port` answers
 * a signed-in client while the phone is linked (the controller's
 * `presencePort`). Emits {@link SIBLING_SEEN_EVENT}.
 */
export function useAgentPresence(port: (() => Promise<AgentDevicePort | undefined>) | undefined): void {
  useEffect(() => {
    if (!port) return
    const presence = new AgentPresence({
      port,
      platform: Platform.OS,
      onSiblingSeen: (device) => DeviceEventEmitter.emit(SIBLING_SEEN_EVENT, device),
    })
    void presence.tick()
    const timer = setInterval(() => void presence.tick(), HEARTBEAT_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [port])
}
