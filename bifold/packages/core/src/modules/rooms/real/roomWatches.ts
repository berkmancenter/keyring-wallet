/**
 * Watches on rooms, so a room in view learns of a change from the person's own agent instead of asking every 10
 * seconds (`rooms/keys/watch/0.1` and `rooms/keys/changed/0.1`; rooms-slow-1105.md §8 phase A′).
 *
 * After a room is read, it is armed (or armed again) at its host, as its member, from the version read
 * (`sinceVersion`): the host signals once the room moves past it, the agent passes that signal on, and the room is
 * read once. **One arming is one signal**: the agent forgets a watch before it passes the signal on (vta-service
 * `room_key_watch.rs`), so a room is armed again after each read that moved it.
 *
 * - **Serial, and grouped.** The agent arms a request's rooms one after another, and the agent client sends one task
 *   at a time, so every room wanted at one host as one member goes in one request (up to {@link WATCH_ROOMS_MAX}), and
 *   requests go one after another.
 * - **Polling stays, as the fallback.** A room is watched only while its watch is armed. An agent that does not serve
 *   the task, a host that refuses it (VTC < 0.24 answers `hostRefused`), a room refused on its own (`notAMember`,
 *   `limitReached`, …) or a request that gets no answer leaves the room polled as before.
 * - **A hold is kept for a day.** The task is declared `Mutating`, and a rule set elsewhere on that class holds it,
 *   after the agent has sent its approvers a request (consentHolds.ts). It goes with `waitForConsent: false`, a hold
 *   is noted, and no watch goes to that agent until a day has passed. A refusal of the task itself
 *   (`unsupportedType`) stops watches for this session.
 * - **A signal is trusted only as far as a read.** It is acted on only when it names a room armed here, as the member
 *   and at the host it was armed with, and then only by reading that room once.
 *
 * @module rooms/real/roomWatches
 */
import { consentPendingOf } from '../../trust-tasks/module/VtaClient'

import { failureCategory, loggedRefusalCode } from '../roomsLogWords'

import type { ConsentHolds } from './consentHolds'
import { parseChanged, parseWatch, refusalCode, ROOMS_TASK } from './wire'

/** The most rooms one `rooms/keys/watch/0.1` request names (its schema's `maxItems`). */
export const WATCH_ROOMS_MAX = 64
/** How long a watch is asked to last if it does not fire: a week (the plan's lease; upstream allows up to 30 days). */
export const WATCH_LEASE_SECONDS = 7 * 24 * 60 * 60
/** How long an arming is waited on. The agent arms the rooms one after another, each a request to the host. */
export const WATCH_TIMEOUT_MS = 60_000

export interface RoomWatchDeps {
  /** The task types the agent serves; undefined while not known. */
  served(): readonly string[] | undefined
  agentTask(
    type: string,
    payload: Record<string, unknown>,
    options?: { timeoutMs?: number; waitForConsent?: boolean }
  ): Promise<unknown>
  consentHolds?: ConsentHolds
  now(): number
  warn(line: string): void
  /** A short, loggable form of a room id. */
  logRef(roomId: string): string
  /** Whether live delivery is on (liveDeliverySwitch.ts): asked at each arming and each signal. Off: nothing is armed and no signal is acted on. */
  on(): boolean
}

type Watch =
  | { state: 'arming'; member: string; host: string; since: number }
  | { state: 'armed'; member: string; host: string; since: number; expiresAt: number }
  | { state: 'fired'; member: string; host: string; since: number }
  | { state: 'polled'; member: string; host: string; since: number; why: string }

const group = (member: string, host: string) => `${member}\n${host}`

export class RoomWatches {
  private readonly watches = new Map<string, Watch>()
  /** Rooms waiting to be armed, by member and host: each group goes as one request. */
  private readonly wanted = new Map<string, Map<string, number>>()
  /** The last reason said for not arming before a request (switch off, task not served or not known yet). */
  private unwatchedSaid?: string
  /** Why no watch goes out this session (the agent refused the task itself); undefined while they may. */
  private stopped?: string
  private chain: Promise<void> = Promise.resolve()
  private flushing = false
  /** Bumped by {@link forget}: an answer to a request sent before it is not kept. */
  private generation = 0

  constructor(private readonly deps: RoomWatchDeps) {}

  /**
   * Arm `roomId` at `host` as `member` from `sinceVersion`, unless a watch from that version or a later one is armed
   * already. Returns at once; the request goes after any still out.
   */
  want(roomId: string, member: string, host: string, sinceVersion: number): void {
    // Stopped is said once, when the refusal came in; the other reasons are said here, each once until a
    // want passes all three checks (on, what the agent serves known, the task in it): a reason back after that is said again.
    if (this.stopped) return
    const served = this.deps.served()
    const unwatched = !this.deps.on()
      ? 'live delivery is off'
      : served === undefined
        ? 'what the agent serves is not known yet'
        : !served.includes(ROOMS_TASK.keysWatch01)
          ? 'the agent does not serve rooms/keys/watch/0.1'
          : undefined
    if (unwatched) {
      if (this.unwatchedSaid !== unwatched) {
        this.unwatchedSaid = unwatched
        this.deps.warn(`rooms: no room is watched (${unwatched}): they are polled`)
      }
      return
    }
    this.unwatchedSaid = undefined
    const held = this.watches.get(roomId)
    if (held && held.member === member && held.host === host) {
      if (held.state === 'polled') return
      if (held.state === 'arming' && held.since >= sinceVersion) return
      if (held.state === 'armed' && held.since >= sinceVersion && held.expiresAt > this.deps.now()) return
    }
    const k = group(member, host)
    const rooms = this.wanted.get(k) ?? new Map<string, number>()
    rooms.set(roomId, Math.max(sinceVersion, rooms.get(roomId) ?? 0))
    this.wanted.set(k, rooms)
    this.watches.set(roomId, { state: 'arming', member, host, since: sinceVersion })
    if (!this.flushing) {
      this.flushing = true
      this.chain = this.chain.then(() => this.flush())
    }
  }

  /** True while `roomId` has a watch armed that has neither fired nor lapsed: its timed poll can wait. */
  watched(roomId: string): boolean {
    // Off: no room counts as watched, so every one is polled at today's pace, whatever was armed before.
    if (!this.deps.on()) return false
    const w = this.watches.get(roomId)
    return w?.state === 'armed' && w.expiresAt > this.deps.now()
  }

  /**
   * A `rooms/keys/changed/0.1` the agent pushed. Returns the room to read when it names a watch armed here, as the
   * member and at the host it was armed with; anything else changes nothing and returns undefined.
   */
  signal(payload: unknown): string | undefined {
    if (!this.deps.on()) return undefined
    const changed = parseChanged(payload)
    if (!changed) return undefined
    const w = this.watches.get(changed.roomId)
    // Not checked against expiresAt, as watched() is: that asks whether the poll can wait, this whether the push names a
    // watch armed here. A signal sent before the lease ended and delivered after it is still that watch's one signal,
    // and accepting it costs one read; refusing it would leave a real change to the next poll.
    if (w?.state !== 'armed' || w.member !== changed.member || w.host !== changed.host) return undefined
    // The agent has forgotten it: one arming, one signal. The read that follows arms it again.
    this.watches.set(changed.roomId, { state: 'fired', member: w.member, host: w.host, since: w.since })
    return changed.roomId
  }

  /** End `roomId`'s watch (the member left): asked of the agent when one is armed, forgotten here either way. */
  cancel(roomId: string): void {
    const w = this.watches.get(roomId)
    this.watches.delete(roomId)
    if (!w) return
    for (const rooms of this.wanted.values()) rooms.delete(roomId)
    if (w.state !== 'armed') return
    this.chain = this.chain.then(() =>
      this.deps
        .agentTask(
          ROOMS_TASK.keysWatch01,
          { member: w.member, host: w.host, rooms: [{ roomId }], cancel: true },
          { timeoutMs: WATCH_TIMEOUT_MS, waitForConsent: false }
        )
        .then(
          () => undefined,
          // The agent forgets a member's watches once it no longer holds their keys to the room; the host, at its lease.
          () => undefined
        )
    )
  }

  /** Forget every watch (the wallet locked, the person logged out). Nothing is asked of the agent. */
  forget(): void {
    this.watches.clear()
    this.wanted.clear()
    this.generation++
  }

  /** Settles once every request asked so far has been answered or has failed (for tests). */
  idle(): Promise<void> {
    return this.chain
  }

  private async flush(): Promise<void> {
    this.flushing = false
    const groups = [...this.wanted.entries()]
    this.wanted.clear()
    if (groups.length === 0) return
    const holds = this.deps.consentHolds
    if (holds && (await holds.heldRecently(ROOMS_TASK.keysWatch01, this.deps.now()).catch(() => true))) {
      for (const [, rooms] of groups)
        for (const roomId of rooms.keys()) this.polled(roomId, 'held for consent in the last day')
      return
    }
    for (const [k, rooms] of groups) {
      const [member, host] = k.split('\n')
      const all = [...rooms.entries()]
      for (let i = 0; i < all.length; i += WATCH_ROOMS_MAX) {
        if (this.stopped) {
          for (const [roomId] of all.slice(i)) this.polled(roomId, this.stopped)
          break
        }
        await this.arm(member, host, all.slice(i, i + WATCH_ROOMS_MAX))
      }
    }
  }

  private async arm(member: string, host: string, rooms: [string, number][]): Promise<void> {
    const generation = this.generation
    const mine = (roomId: string) => {
      const w = this.watches.get(roomId)
      return generation === this.generation && w?.state === 'arming' && w.member === member && w.host === host
    }
    let answer: ReturnType<typeof parseWatch>
    try {
      answer = parseWatch(
        await this.deps.agentTask(
          ROOMS_TASK.keysWatch01,
          {
            member,
            host,
            rooms: rooms.map(([roomId, sinceVersion]) => ({ roomId, sinceVersion })),
            leaseSeconds: WATCH_LEASE_SECONDS,
          },
          { timeoutMs: WATCH_TIMEOUT_MS, waitForConsent: false }
        )
      )
    } catch (e) {
      const code = refusalCode(e)
      // By kind only, as every rooms line says a refusal (roomsLogWords): a code off the list reads as `other`.
      let why = code ? failureCategory(e) : 'no answer'
      if (consentPendingOf(e)) {
        // The agent has asked its approvers already. Kept, so no session asks again today (consentHolds.ts).
        await this.deps.consentHolds?.noteHeld(ROOMS_TASK.keysWatch01, this.deps.now()).catch(() => undefined)
        why = 'held for consent'
        this.stopped = why
      } else if (code === 'unsupportedType') this.stopped = why
      this.deps.warn(
        `rooms: a watch of ${rooms.length} rooms ${why}: they are polled${
          this.stopped
            ? why === 'held for consent'
              ? ', and none is armed for a day'
              : ', as is every room this session'
            : ''
        }`
      )
      for (const [roomId] of rooms)
        if (mine(roomId)) {
          // No answer: the next read asks again. A refusal: polled for this session.
          if (code || this.stopped) this.polled(roomId, why)
          else this.watches.delete(roomId)
        }
      return
    }
    const byRoom = new Map(answer.watches.map((w) => [w.roomId, w]))
    let armed = 0
    for (const [roomId, since] of rooms) {
      if (!mine(roomId)) continue
      const outcome = byRoom.get(roomId)
      const expiresAt = outcome?.expiresAt ? Date.parse(outcome.expiresAt) : NaN
      if (outcome?.armed && Number.isFinite(expiresAt)) {
        this.watches.set(roomId, { state: 'armed', member, host, since, expiresAt })
        armed++
      } else
        this.polled(
          roomId,
          outcome?.refused
            ? `refused (${loggedRefusalCode(outcome.refused)}${outcome.hostCode ? `: ${loggedRefusalCode(outcome.hostCode)}` : ''})`
            : 'not armed'
        )
    }
    this.deps.warn(`rooms: watching ${armed} of ${rooms.length} rooms at ${this.deps.logRef(host)}`)
  }

  private polled(roomId: string, why: string): void {
    const w = this.watches.get(roomId)
    if (!w) return
    this.watches.set(roomId, { state: 'polled', member: w.member, host: w.host, since: w.since, why })
    this.deps.warn(`rooms: ${this.deps.logRef(roomId)} polled: its watch ${why}`)
  }
}
