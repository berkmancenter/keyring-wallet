/**
 * Where the member has read each room to, kept by their own agent so that every one of their devices agrees
 * (`rooms/keys/read-marker/set/0.1`, `rooms/keys/list/0.3`, `rooms/keys/read-marker/moved/0.1`; upstream
 * `docs/02-vta/data-rooms.md`, "Where you have read to, on every device", vta-service 0.84.0).
 *
 * Until this, what was read was kept on this phone alone (`rooms.seenVersions`): a room read here still showed unread
 * in the person's browser, and the other way round.
 *
 * - **Told when the room's screen shows a post**, never for a room met for the first time or put away: those are this
 *   phone's own conventions for its count, and the marker says what the person has seen.
 * - **Forward only, and the agent decides.** The agent keeps the further of its marker and the one sent, and answers
 *   with the marker in force, which is adopted here: another device may have read further.
 * - **One at a time for a room, and not at once.** A set waits {@link READ_MARKER_SETTLE_MS} for the reading to
 *   settle, and one out is answered before the next goes, so a conversation on screen costs a trip every few seconds,
 *   not one per message.
 * - **A change made elsewhere is taken as it is.** The list brings each room's marker; the agent's `moved` notice
 *   brings one as it changes. A marker behind the agent's last is the person marking the room unread on another
 *   device, and is taken too. One further on than the agent's last is another device reading on, and only ever moves
 *   this phone forward, even where it is behind what this phone's screen shows.
 * - **A room marked unread elsewhere stays unread here until its screen is entered again.** A screen left open on the
 *   room would otherwise say "seen" again at its next listing and undo the person's own choice within seconds;
 *   upstream warns of exactly that ("not a forward set issued before a rewind sent since"). So after such a marker no
 *   set goes for the room, a waiting one is dropped, and the rows do not count its screen as seen
 *   ({@link RoomReadMarkers.markedUnread}), until {@link RoomReadMarkers.entered}.
 * - **The notice reaches only a device watching the room.** The agent sends `moved` to the member's other clients
 *   that hold a `rooms/keys/watch` on the room as that member. A room this phone only polls (its watch refused, or an
 *   agent that serves none) gets no notice, and learns of a change at the next key list.
 * - **A hold is kept for a day**, as a watch's is (consentHolds.ts): the task goes with `waitForConsent: false`, and an
 *   agent whose rules hold it is not asked again for a day. A refusal of the task itself stops it for this session.
 * - **Nothing is said per set.** Upstream writes no audit row and no log line for one, because when a person read a
 *   room is theirs. The log here says only why markers are not kept, once.
 *
 * @module rooms/real/readMarkers
 */
import { consentPendingOf } from '../../trust-tasks/module/VtaClient'

import { failureCategory } from '../roomsLogWords'

import type { ConsentHolds } from './consentHolds'
import {
  parseReadMarkerMoved,
  parseReadMarkerSet,
  refusalCode,
  ROOMS_TASK,
  type HeldRoom,
  type ReadMarker,
} from './wire'

/** How long a set waits before it goes: the newest marker asked for in that time is the one sent. */
export const READ_MARKER_SETTLE_MS = 3_000
/** How long a set is waited on. The agent asks no host to serve one. */
export const READ_MARKER_TIMEOUT_MS = 30_000

/**
 * The set task's versions, newest first: one today. Sent at the newest the agent serves.
 *
 * @versionLadder rooms/keys/read-marker/set
 */
const SET_TYPES: readonly string[] = [ROOMS_TASK.keysReadMarkerSet01]

/**
 * Whether `a` is further on than `b`: the greater version; at an equal one, the later `createdAt`, an absent one
 * before any present (the task's schema, `ReadMarker`). No marker at all is behind every marker.
 */
export function furtherOn(a: ReadMarker, b: ReadMarker | undefined): boolean {
  if (!b) return true
  if (a.version !== b.version) return a.version > b.version
  const at = (m: ReadMarker) => (m.createdAt ? Date.parse(m.createdAt) : Number.NEGATIVE_INFINITY)
  return at(a) > at(b)
}

export interface ReadMarkerDeps {
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
  /** Whether the release keeps read markers at the agent (readMarkerSwitch.ts): asked at each set and each marker heard. */
  on(): boolean
  /** Whether the agent holds `roomId` as `member`, by its last key list: a notice naming anything else is not acted on. */
  holds(roomId: string, member: string): boolean
  /** Run `run` after `ms`. Tests pass their own. */
  later?(run: () => void, ms: number): void
}

/**
 * A marker heard from the agent, to adopt:
 * - `further`: it may only move what this phone holds forward (a set's answer, or a marker further on than the
 *   agent's last: another device read on);
 * - `moved`: the agent's marker went back, which only "mark as unread" does. It is taken as it is.
 */
export type ReadMarkerHeard = (roomId: string, member: string, marker: ReadMarker, how: 'further' | 'moved') => void

const keyOf = (roomId: string, member: string) => `${roomId}\n${member}`

export class RoomReadMarkers {
  /** The marker the agent holds, as last heard from it, by room and member. */
  private readonly inForce = new Map<string, ReadMarker>()
  /** The marker to send next, by room and member. */
  private readonly wanted = new Map<string, { roomId: string; member: string; marker: ReadMarker }>()
  /** Rooms with a set waiting out its settle time, or out. */
  private readonly busy = new Set<string>()
  /** When the agent last answered a set, by room and member: a list asked before that says nothing newer. */
  private readonly answeredAt = new Map<string, number>()
  /** Rooms marked unread on another device, until their screen is entered again here: no set goes for them. */
  private readonly heldUnread = new Set<string>()
  /** Rooms the agent refused a set for: not asked again this session. */
  private readonly refused = new Set<string>()
  private readonly listeners = new Set<ReadMarkerHeard>()
  /** Why no set goes out this session; undefined while they may. */
  private stopped?: string
  /** The last reason said for sending nothing. */
  private notKeptSaid?: string
  /** Bumped by {@link forget}: an answer to a set sent before it is not kept. */
  private generation = 0

  constructor(private readonly deps: ReadMarkerDeps) {}

  /** Hear each marker the agent holds that this phone should adopt. Returns the way to stop hearing. */
  onHeard(listener: ReadMarkerHeard): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** The marker the agent holds for `roomId` as `member`, as last heard; undefined when none was. */
  held(roomId: string, member: string): ReadMarker | undefined {
    return this.deps.on() ? this.inForce.get(keyOf(roomId, member)) : undefined
  }

  /**
   * True from when `roomId` was marked unread on another of the person's devices until its screen is entered again
   * here: what a screen left open on it shows is not to be counted as seen, here or at the agent.
   */
  markedUnread(roomId: string, member: string): boolean {
    return this.heldUnread.has(keyOf(roomId, member))
  }

  /**
   * The person navigated to the room's screen (useRoomEntered): what it shows is seen from here on. Never called for
   * the app coming back to the foreground with the room still open.
   */
  entered(roomId: string): void {
    for (const k of [...this.heldUnread]) if (k.startsWith(`${roomId}\n`)) this.heldUnread.delete(k)
  }

  /**
   * The person has seen `roomId` to `marker` on this phone. Told to the agent unless it already holds one as far on,
   * or the room was marked unread elsewhere and its screen has not been entered again. Returns at once.
   */
  read(roomId: string, member: string, marker: ReadMarker): void {
    if (this.heldUnread.has(keyOf(roomId, member))) return
    const why = this.notKept()
    if (why) {
      if (this.notKeptSaid !== why) {
        this.notKeptSaid = why
        this.deps.warn(`rooms: what is read is kept on this phone only (${why})`)
      }
      return
    }
    this.notKeptSaid = undefined
    const k = keyOf(roomId, member)
    if (this.refused.has(k)) return
    if (!furtherOn(marker, this.inForce.get(k))) return
    if (!furtherOn(marker, this.wanted.get(k)?.marker)) return
    this.wanted.set(k, { roomId, member, marker })
    if (this.busy.has(k)) return
    this.busy.add(k)
    const generation = this.generation
    ;(this.deps.later ?? ((run: () => void, ms: number) => void setTimeout(run, ms)))(() => {
      if (generation === this.generation) void this.send(k)
    }, READ_MARKER_SETTLE_MS)
  }

  /**
   * The agent's key list (`rooms/keys/list/0.3`, `includePersonal`): each entry's marker is the one it holds. One
   * further on than the last heard moves this phone forward; one behind it is a room marked unread elsewhere whose
   * notice did not arrive, and is taken as it is. A room with a set waiting or out is left to that set's answer, and
   * so is one whose set was answered after the list was asked (`askedAt`): that list is the older word.
   */
  listed(rooms: readonly HeldRoom[], askedAt: number = this.deps.now()): void {
    if (!this.deps.on()) return
    for (const room of rooms) {
      if (!room.member || !room.readMarker) continue
      const k = keyOf(room.roomId, room.member)
      if (this.busy.has(k) || (this.answeredAt.get(k) ?? Number.NEGATIVE_INFINITY) >= askedAt) continue
      const before = this.inForce.get(k)
      if (before && before.version === room.readMarker.version && before.createdAt === room.readMarker.createdAt)
        continue
      this.take(k, room.roomId, room.member, room.readMarker)
    }
  }

  /**
   * A marker the agent holds that this phone did not set. Behind the agent's last: the room was marked unread on
   * another device, and is held unread here until its screen is entered again. Otherwise another device read on.
   */
  private take(k: string, roomId: string, member: string, marker: ReadMarker): void {
    const before = this.inForce.get(k)
    const wentBack = before !== undefined && furtherOn(before, marker)
    this.inForce.set(k, marker)
    const waiting = this.wanted.get(k)
    if (wentBack) {
      this.heldUnread.add(k)
      // Whatever waits was seen before the room was marked unread: it is not to undo that.
      this.wanted.delete(k)
    } else if (waiting && !furtherOn(waiting.marker, marker)) this.wanted.delete(k)
    this.tell(roomId, member, marker, wentBack ? 'moved' : 'further')
  }

  /**
   * A `rooms/keys/read-marker/moved/0.1` the agent pushed: the member's marker for a room moved on another device.
   * Acted on only for a room the agent holds as that member; taken as the marker in force, behind or not. A set
   * still waiting that is no further on has nothing left to say, and is dropped.
   */
  moved(payload: unknown): void {
    if (!this.deps.on()) return
    const notice = parseReadMarkerMoved(payload)
    if (!notice || !this.deps.holds(notice.roomId, notice.member)) return
    this.take(keyOf(notice.roomId, notice.member), notice.roomId, notice.member, notice.readMarker)
  }

  /** Forget every marker and every set waiting (the wallet locked, the person logged out). Nothing is asked of the agent. */
  forget(): void {
    this.inForce.clear()
    this.answeredAt.clear()
    this.wanted.clear()
    this.busy.clear()
    this.refused.clear()
    this.heldUnread.clear()
    this.generation++
  }

  /**
   * The version a set goes at: the newest the agent serves.
   *
   * @versionLadder rooms/keys/read-marker/set
   */
  private setType(): string | undefined {
    const served = this.deps.served()
    return SET_TYPES.find((type) => served?.includes(type))
  }

  private notKept(): string | undefined {
    if (!this.deps.on()) return 'read markers are off'
    if (this.stopped) return this.stopped
    if (this.deps.served() === undefined) return 'what the agent serves is not known yet'
    return this.setType() ? undefined : 'the agent does not serve rooms/keys/read-marker/set'
  }

  private tell(roomId: string, member: string, marker: ReadMarker, how: 'further' | 'moved'): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(roomId, member, marker, how)
      } catch {
        // One listener's failure is its own.
      }
    }
  }

  /** @versionLadder rooms/keys/read-marker/set */
  private async send(k: string): Promise<void> {
    const generation = this.generation
    const done = () => {
      if (generation === this.generation) this.busy.delete(k)
    }
    const next = this.wanted.get(k)
    this.wanted.delete(k)
    const setType = this.setType()
    if (!next || !setType || this.notKept() || !furtherOn(next.marker, this.inForce.get(k))) return done()
    const holds = this.deps.consentHolds
    if (holds && (await holds.heldRecently(setType, this.deps.now()).catch(() => true))) {
      this.stop('held for consent in the last day')
      return done()
    }
    let answer: ReturnType<typeof parseReadMarkerSet>
    try {
      answer = parseReadMarkerSet(
        await this.deps.agentTask(
          setType,
          { roomId: next.roomId, member: next.member, readMarker: next.marker },
          { timeoutMs: READ_MARKER_TIMEOUT_MS, waitForConsent: false }
        )
      )
    } catch (e) {
      if (generation !== this.generation) return
      const code = refusalCode(e)
      if (consentPendingOf(e)) {
        // The agent has asked its approvers already. Kept, so no session asks again today (consentHolds.ts).
        await holds?.noteHeld(setType, this.deps.now()).catch(() => undefined)
        this.stop('held for consent')
      } else if (code === 'unsupportedType' || code === 'unsupportedVersion') this.stop(failureCategory(e))
      // Any other refusal is this room's (not held as that member, not the member's own device): not asked again this
      // session. No answer at all: the next post seen asks again.
      else if (code) this.refused.add(k)
      return done()
    }
    if (generation !== this.generation) return
    if (answer) {
      this.inForce.set(k, answer.readMarker)
      this.answeredAt.set(k, this.deps.now())
      // Another device had read further: this phone moves up to it.
      if (furtherOn(answer.readMarker, next.marker)) this.tell(next.roomId, next.member, answer.readMarker, 'further')
    }
    // What was seen while this one was out goes next, without a second wait.
    if (this.wanted.has(k)) return this.send(k)
    done()
  }

  private stop(why: string): void {
    this.stopped = why
    this.wanted.clear()
    this.notKeptSaid = why
    this.deps.warn(`rooms: what is read is kept on this phone only (${why})`)
  }
}
