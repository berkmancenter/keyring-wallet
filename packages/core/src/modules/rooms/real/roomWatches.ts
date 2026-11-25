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
 * - **The room on screen is watched live, where its host allows it** (`rooms/keys/watch/0.2`, liveWatchSwitch.ts). A
 *   live watch signals every change, at most one a second, and is not spent by a signal; it is renewed about once a
 *   minute, because a host leases one for at most 120 s. A host arms one only where the room's signal delay is `none`.
 *   Anything else (the host's `liveNotPermitted`, an agent or host that arms it one-shot, a request with no answer)
 *   leaves the room watched one signal at a time, exactly as above, and live is asked again after a wait. A room is
 *   live only while a screen holds it: leaving the room arms the one-shot watch again, which ends the live one.
 *
 * @module rooms/real/roomWatches
 */
import { consentPendingOf } from '../../trust-tasks/module/VtaClient'

import { failureCategory, loggedRefusalCode } from '../roomsLogWords'

import type { ConsentHolds } from './consentHolds'
import { LIVE_NOT_PERMITTED, parseChanged, parseWatch, refusalCode, ROOMS_TASK } from './wire'

/** The most rooms one `rooms/keys/watch/0.1` request names (its schema's `maxItems`). */
export const WATCH_ROOMS_MAX = 64
/** How long a watch is asked to last if it does not fire: a week (the plan's lease; upstream allows up to 30 days). */
export const WATCH_LEASE_SECONDS = 7 * 24 * 60 * 60
/** How long an arming is waited on. The agent arms the rooms one after another, each a request to the host. */
export const WATCH_TIMEOUT_MS = 60_000
/** The lease asked for a live watch: the most a host gives one, counted from each renewal (`rooms/watch/0.2`). */
export const LIVE_LEASE_SECONDS = 120
/** A live watch is renewed once less than this is left of its lease: about once a minute. */
export const LIVE_RENEW_BEFORE_MS = 60_000
/** After a host did not arm a room live, how long before it is asked again: its administrators may change the room's signal delay. */
export const LIVE_RETRY_MS = 10 * 60_000
/** After a live request got no answer, how long before the next. */
export const LIVE_NO_ANSWER_MS = 60_000

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
  /** Whether the room on screen may be watched live (liveWatchSwitch.ts): asked at each arming. Absent or off: one-shot watches only. */
  liveOn?(): boolean
}

type Watch =
  | { state: 'arming'; member: string; host: string; since: number }
  | { state: 'armed'; member: string; host: string; since: number; expiresAt: number }
  | { state: 'live'; member: string; host: string; since: number; expiresAt: number }
  | { state: 'fired'; member: string; host: string; since: number }
  | { state: 'polled'; member: string; host: string; since: number; why: string }

const group = (member: string, host: string) => `${member}\n${host}`

export class RoomWatches {
  private readonly watches = new Map<string, Watch>()
  /** Rooms waiting to be armed, by member and host: each group goes as one request. */
  private readonly wanted = new Map<string, Map<string, number>>()
  /** Rooms a screen holds open: each is watched live where it can be, and one signal at a time where it can't. */
  private readonly liveHeld = new Set<string>()
  /** Live requests waiting to go, by member and host. */
  private readonly wantedLive = new Map<string, Map<string, number>>()
  /** Rooms with a live request waiting or out: one at a time for a room. */
  private readonly askingLive = new Set<string>()
  /** Rooms not asked live again before a time: the host did not arm one live, or the request got no answer. */
  private readonly noLiveUntil = new Map<string, number>()
  /** Why no live watch goes out this session (the agent held or refused the task itself); undefined while they may. */
  private liveStopped?: string
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
   *
   * `live: true` says a screen holds the room open: it is watched live where its host allows it, until `live: false`
   * says the screen let go, which arms the one-shot watch again. Without `live` the room is left as it is held, so a
   * caller that knows nothing of the screen (Messages' rows) never ends the open room's live watch.
   */
  want(roomId: string, member: string, host: string, sinceVersion: number, options: { live?: boolean } = {}): void {
    if (options.live === true) this.liveHeld.add(roomId)
    else if (options.live === false) this.letGo(roomId)
    // Stopped is said once, when the refusal came in; the other reasons are said here, each once until a
    // want passes all three checks (on, what the agent serves known, the task in it): a reason back after that is said again.
    if (this.stopped) return
    const served = this.deps.served()
    // version-pinned: a one-shot watch is the 0.1 task, served wherever 0.2 is; 0.2 is asked only for a live watch (armLive)
    const oneShotServed = served?.includes(ROOMS_TASK.keysWatch01) === true
    const unwatched = !this.deps.on()
      ? 'live delivery is off'
      : served === undefined
        ? 'what the agent serves is not known yet'
        : !oneShotServed
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
    const same = held && held.member === member && held.host === host ? held : undefined
    if (same?.state === 'polled') return
    if (this.liveHeld.has(roomId) && this.liveMay(roomId, served ?? [])) {
      this.wantLive(roomId, member, host, sinceVersion, same)
      return
    }
    if (held && held.member === member && held.host === host) {
      if (held.state === 'arming' && held.since >= sinceVersion) return
      if (held.state === 'armed' && held.since >= sinceVersion && held.expiresAt > this.deps.now()) return
    }
    const k = group(member, host)
    const rooms = this.wanted.get(k) ?? new Map<string, number>()
    rooms.set(roomId, Math.max(sinceVersion, rooms.get(roomId) ?? 0))
    this.wanted.set(k, rooms)
    this.watches.set(roomId, { state: 'arming', member, host, since: sinceVersion })
    this.kick()
  }

  /**
   * The open room's tick: renew its live watch when one is due, or ask for one again once a refusal's wait has passed.
   * Sends nothing otherwise, and never arms a one-shot watch: the read that follows a signal does that, from the
   * version it read, and arming from an older one here would have the host signal a change already read.
   */
  renew(roomId: string): void {
    if (!this.liveHeld.has(roomId) || this.stopped || !this.deps.on()) return
    const w = this.watches.get(roomId)
    if (w?.state !== 'live' && w?.state !== 'armed') return
    if (!this.liveMay(roomId, this.deps.served() ?? [])) return
    this.wantLive(roomId, w.member, w.host, w.since, w)
  }

  /** True while `roomId` has a watch armed that has neither fired nor lapsed: its timed poll can wait. */
  watched(roomId: string): boolean {
    // Off: no room counts as watched, so every one is polled at today's pace, whatever was armed before.
    if (!this.deps.on()) return false
    const w = this.watches.get(roomId)
    return (w?.state === 'armed' || w?.state === 'live') && w.expiresAt > this.deps.now()
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
    if (!w || w.member !== changed.member || w.host !== changed.host) return undefined
    // A live watch is not spent by a signal: the next change is signalled too, with nothing armed in between.
    if (w.state === 'live') return changed.roomId
    if (w.state !== 'armed') return undefined
    // The agent has forgotten it: one arming, one signal. The read that follows arms it again.
    this.watches.set(changed.roomId, { state: 'fired', member: w.member, host: w.host, since: w.since })
    return changed.roomId
  }

  /** End `roomId`'s watch (the member left): asked of the agent when one is armed, forgotten here either way. */
  cancel(roomId: string): void {
    const w = this.watches.get(roomId)
    this.watches.delete(roomId)
    this.letGo(roomId)
    this.noLiveUntil.delete(roomId)
    if (!w) return
    for (const rooms of this.wanted.values()) rooms.delete(roomId)
    // One cancel ends the member's watch of the room at this agent, live or not: it holds one for a room at a time.
    if (w.state !== 'armed' && w.state !== 'live') return
    this.chain = this.chain.then(() =>
      this.deps
        .agentTask(
          ROOMS_TASK.keysWatch01, // version-pinned: one-shot is the 0.1 task, served wherever 0.2 is
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
    this.liveHeld.clear()
    this.wantedLive.clear()
    this.askingLive.clear()
    this.noLiveUntil.clear()
    this.generation++
  }

  /** Settles once every request asked so far has been answered or has failed (for tests). */
  idle(): Promise<void> {
    return this.chain
  }

  private kick(): void {
    if (this.flushing) return
    this.flushing = true
    this.chain = this.chain.then(() => this.flush())
  }

  /**
   * Whether `roomId` may be asked live now: the release allows it, the agent serves it, and no wait is running.
   *
   * @versionLadder rooms/keys/watch
   */
  private liveMay(roomId: string, served: readonly string[]): boolean {
    return (
      !this.liveStopped &&
      this.deps.liveOn?.() === true &&
      served.includes(ROOMS_TASK.keysWatch02) &&
      !((this.noLiveUntil.get(roomId) ?? 0) > this.deps.now())
    )
  }

  /** Ask for `roomId` live, or renew it: nothing while its live watch has more than a minute left, or a request is out. */
  private wantLive(roomId: string, member: string, host: string, sinceVersion: number, held?: Watch): void {
    let since = sinceVersion
    if (held?.state === 'live') {
      since = Math.max(held.since, sinceVersion)
      if (since !== held.since) this.watches.set(roomId, { ...held, since })
      if (held.expiresAt - this.deps.now() > LIVE_RENEW_BEFORE_MS) return
    }
    if (this.askingLive.has(roomId)) return
    this.askingLive.add(roomId)
    const k = group(member, host)
    const rooms = this.wantedLive.get(k) ?? new Map<string, number>()
    rooms.set(roomId, since)
    this.wantedLive.set(k, rooms)
    this.kick()
  }

  /** The screen let go of `roomId`: no live request of it stays waiting. What is held is ended by the watch armed next. */
  private letGo(roomId: string): void {
    this.liveHeld.delete(roomId)
    this.askingLive.delete(roomId)
    for (const rooms of this.wantedLive.values()) rooms.delete(roomId)
  }

  private async flush(): Promise<void> {
    this.flushing = false
    const groups = [...this.wanted.entries()]
    this.wanted.clear()
    const live = [...this.wantedLive.entries()]
    this.wantedLive.clear()
    await this.flushOneShot(groups)
    await this.flushLive(live)
  }

  /**
   * The rooms wanted live, a host at a time. The family's step-down is here and in `armLive`: 0.2 is asked first, and
   * a room it does not make live is armed at 0.1 by `want`.
   *
   * @versionLadder rooms/keys/watch
   */
  private async flushLive(groups: [string, Map<string, number>][]): Promise<void> {
    const holds = this.deps.consentHolds
    for (const [k, rooms] of groups) {
      if (rooms.size === 0) continue
      const [member, host] = k.split('\n')
      const all = [...rooms.entries()]
      if (
        !this.liveStopped &&
        holds &&
        (await holds.heldRecently(ROOMS_TASK.keysWatch02, this.deps.now()).catch(() => true))
      ) {
        this.liveStopped = 'held for consent in the last day'
        this.deps.warn(`rooms: no room is watched live (${this.liveStopped}): each signals once per watch`)
      }
      if (this.liveStopped || this.stopped) {
        for (const [roomId, since] of all) {
          this.askingLive.delete(roomId)
          this.want(roomId, member, host, since)
        }
        continue
      }
      for (let i = 0; i < all.length; i += WATCH_ROOMS_MAX)
        await this.armLive(member, host, all.slice(i, i + WATCH_ROOMS_MAX))
    }
  }

  /**
   * One live request (`rooms/keys/watch/0.2`, `live: true`): a first arming, or a renewal. A room is live only where
   * its outcome says so. Every other outcome leaves it watched one signal at a time, and live is asked again later.
   *
   * @versionLadder rooms/keys/watch
   */
  private async armLive(member: string, host: string, rooms: [string, number][]): Promise<void> {
    const generation = this.generation
    let answer: ReturnType<typeof parseWatch>
    try {
      answer = parseWatch(
        await this.deps.agentTask(
          ROOMS_TASK.keysWatch02,
          {
            member,
            host,
            rooms: rooms.map(([roomId, sinceVersion]) => ({ roomId, sinceVersion })),
            leaseSeconds: LIVE_LEASE_SECONDS,
            live: true,
          },
          { timeoutMs: WATCH_TIMEOUT_MS, waitForConsent: false }
        )
      )
    } catch (e) {
      const code = refusalCode(e)
      let why = code ? failureCategory(e) : 'no answer'
      if (consentPendingOf(e)) {
        await this.deps.consentHolds?.noteHeld(ROOMS_TASK.keysWatch02, this.deps.now()).catch(() => undefined)
        why = 'held for consent'
        this.liveStopped = why
      } else if (code === 'unsupportedType' || code === 'unsupportedVersion') {
        // An agent from before the live watch serves the task at 0.1 only and answers `unsupportedVersion` here: it
        // will not learn 0.2 while this session lasts, so it is not asked every ten minutes for nothing.
        this.liveStopped = why
      }
      this.deps.warn(
        `rooms: a live watch of ${rooms.length} rooms ${why}: ${
          this.liveStopped ? 'none is asked again this session' : 'asked again later'
        }`
      )
      for (const [roomId, since] of rooms) {
        this.askingLive.delete(roomId)
        if (generation !== this.generation) continue
        this.noLiveUntil.set(roomId, this.deps.now() + (code ? LIVE_RETRY_MS : LIVE_NO_ANSWER_MS))
        // A live watch held here keeps its lease's end: a renewal with no answer may still have landed, and past that
        // end the room is polled and armed again. Where none is held, the room is watched one signal at a time.
        if (this.watches.get(roomId)?.state !== 'live') this.want(roomId, member, host, since)
      }
      return
    }
    const byRoom = new Map(answer.watches.map((w) => [w.roomId, w]))
    for (const [roomId, since] of rooms) {
      this.askingLive.delete(roomId)
      if (generation !== this.generation) continue
      const outcome = byRoom.get(roomId)
      const expiresAt = outcome?.expiresAt ? Date.parse(outcome.expiresAt) : NaN
      const before = this.watches.get(roomId)
      if (outcome?.armed && outcome.live && Number.isFinite(expiresAt) && this.liveHeld.has(roomId)) {
        this.watches.set(roomId, { state: 'live', member, host, since: Math.max(since, before?.since ?? 0), expiresAt })
        if (before?.state !== 'live') this.deps.warn(`rooms: ${this.deps.logRef(roomId)} is watched live`)
        continue
      }
      // Not live, or no longer wanted live. Whatever the host holds now is ended by the one-shot watch armed next: a
      // live watch the screen let go of, and a one-shot watch armed with a live watch's two-minute lease.
      if (this.liveHeld.has(roomId)) {
        this.noLiveUntil.set(roomId, this.deps.now() + LIVE_RETRY_MS)
        const why = outcome?.armed
          ? 'armed for one signal only'
          : outcome?.refused === 'hostRefused' && outcome.hostCode === LIVE_NOT_PERMITTED
            ? "the room's signal delay is not none"
            : outcome?.refused
              ? `refused (${loggedRefusalCode(outcome.refused)})`
              : 'not armed'
        this.deps.warn(`rooms: ${this.deps.logRef(roomId)} is not watched live (${why}): it signals once per watch`)
      }
      // A refused first asking leaves a one-shot watch already armed in place (the agent keeps it), so that one is
      // kept. Anything else is armed again, one-shot: a renewal the host refused is forgotten by the agent.
      const kept = !outcome?.armed && before?.state === 'armed' && before.expiresAt > this.deps.now()
      if (!kept) this.watches.delete(roomId)
      this.want(roomId, member, host, Math.max(since, before?.since ?? 0))
    }
  }

  private async flushOneShot(groups: [string, Map<string, number>][]): Promise<void> {
    if (groups.length === 0) return
    const holds = this.deps.consentHolds
    // version-pinned: a one-shot watch is the 0.1 task, served wherever 0.2 is; 0.2 is asked only for a live watch (armLive)
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
          ROOMS_TASK.keysWatch01, // version-pinned: one-shot is the 0.1 task, served wherever 0.2 is
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
        // version-pinned: a one-shot watch is the 0.1 task, served wherever 0.2 is; 0.2 is asked only for a live watch (armLive)
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
