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
import { useEffect, useRef } from 'react'
import { DeviceEventEmitter, Platform } from 'react-native'

import type { VtaLinkState } from './vtaLinkMachine'
import { deviceRefusalOf } from './vtaOwner'
import { releaseWarn } from './releaseLog'

import {
  defaultDeviceName,
  heartbeat,
  HEARTBEAT_INTERVAL_MS,
  listRegisteredDevices,
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

/** The link as one word or two, for a Release line: `linked/online`, `linked/reconnecting`, `notLinked`. */
export function linkSummary(link: VtaLinkState | undefined): string {
  if (!link) return 'unknown'
  return link.kind === 'linked' ? `linked/${link.connection.kind}` : link.kind
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
  /** The link now, said on the tick's Release lines (IN-350: a removal the heartbeat never reported). */
  link?: () => VtaLinkState | undefined
}

/**
 * How long a tick waits for the heartbeat's answer. Nothing else waits on it (it goes beside the agent client's
 * queue, vtaReadLane.ts), so this bounds only the tick: an answer usually comes within a second, and one that has not
 * in this long is taken as none, and tried again next tick.
 */
export const PRESENCE_HEARTBEAT_TIMEOUT_MS = 10_000

/** How many healthy ticks in a row before an "ok" is said again with no change: once an hour at five minutes. */
export const PRESENCE_OK_EVERY = 12

export class AgentPresence {
  private registered = false
  private announced = new Set<string>()
  private running = false
  /** The last healthy line said ("ok (…)" or "skipped, …"), and how many ticks have read the same since. */
  private quiet?: { line: string; since: number }

  constructor(private readonly deps: AgentPresenceDeps) {}

  private linkNow(): string {
    return linkSummary(this.deps.link?.())
  }

  /**
   * A healthy outcome is said when it changes — the first after a start or a failure, or a new link state — and
   * once every {@link PRESENCE_OK_EVERY} ticks, so a log shows the loop alive without a line every five minutes in a
   * channel kept for the few that matter. A failure is always said (below).
   */
  private sayHealthy(line: string): void {
    if (this.quiet?.line === line && ++this.quiet.since < PRESENCE_OK_EVERY) return
    const again = this.quiet?.line === line
    releaseWarn(`[VTA] presence tick: ${line}${again ? `, ${PRESENCE_OK_EVERY} in a row` : ''}`)
    this.quiet = { line, since: 0 }
  }

  /** One round: register once, beat, and announce newly live siblings. Never throws. */
  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const port = await this.deps.port()
      if (!port) {
        this.sayHealthy(`skipped, no signed-in agent (${this.linkNow()})`)
        return
      }
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
      await heartbeat(port, undefined, PRESENCE_HEARTBEAT_TIMEOUT_MS)
      // device/list alone: an acl/list here held the agent client's one-at-a-time queue for its whole timeout
      // when the agent did not answer it. Without the access list a narrower key that beats can be
      // named too; My devices still marks it limited.
      const live = liveSiblings(await listRegisteredDevices(port), now)
      const liveNow = new Set(live.map((d) => d.did))
      for (const device of live) if (!this.announced.has(device.did)) this.deps.onSiblingSeen(device)
      this.announced = liveNow
      this.sayHealthy(`ok (${this.linkNow()})`)
    } catch (e) {
      // Said in Release with its reason class, so a run can tell a removal the agent refused (accessRevoked) from
      // an agent that did not answer (noAnswer) — only the first ends the link.
      releaseWarn(`[VTA] presence tick: failed, ${deviceRefusalOf(e).reason} (${this.linkNow()})`)
      this.quiet = undefined
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
  log?: (message: string) => void,
  link?: () => VtaLinkState
): void {
  // Read through a ref, not a dependency: an inline getter would otherwise restart the heartbeat on every render.
  const linkRef = useRef(link)
  linkRef.current = link
  useEffect(() => {
    const linkNow = () => linkRef.current?.()
    if (!port) return
    const presence = new AgentPresence({
      port,
      platform: Platform.OS,
      onSiblingSeen: (device) => DeviceEventEmitter.emit(SIBLING_SEEN_EVENT, device),
      onFailed,
      log,
      link: linkNow,
    })
    // Started and stopped are said in Release: the heartbeat runs only while the link is online, and a removal it
    // never reported could not be told from a loop that was not running (IN-350).
    releaseWarn(`[VTA] presence: started, every ${HEARTBEAT_INTERVAL_MS / 1000} s (${linkSummary(linkNow())})`)
    void presence.tick()
    const timer = setInterval(() => void presence.tick(), HEARTBEAT_INTERVAL_MS)
    return () => {
      clearInterval(timer)
      releaseWarn(`[VTA] presence: stopped (${linkSummary(linkNow())})`)
    }
  }, [port, onFailed, log])
}
