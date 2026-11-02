/**
 * Where this phone stands with one community, read from what it has stored:
 * its join (member, sent, pending, left…), its vetting application, and its own
 * vetter grant. One reading for every journey screen, so they cannot disagree.
 *
 * It re-reads when a screen comes into view and whenever the community
 * changes — never on a timer. The reading is kept in one store per community
 * (for the agent current now), read with useSyncExternalStore: every screen
 * shows the same reading, a screen that mounts shows the last one at once
 * rather than nothing, and a change is read even while no screen is mounted
 * (tabs unmount on blur), so coming back never shows the state before it
 * (UI-smoothness plan, Phase 2).
 *
 * @module trust-tasks/module/communityJourney
 */

import type { Agent } from '@credo-ts/core'
import { useIsFocused } from '@react-navigation/native'
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { DeviceEventEmitter } from 'react-native'

import { COMMUNITY_CHANGED_EVENT, VTI_PERSONA_DELIVERIES_EVENT } from './communityChanged'
import { currentAgentDid } from './currentAgent'
import { GenericRecordsCommunityStore, ofCurrentAgent } from './VtiCommunityStore'
import { GenericRecordsIdentityStore } from './VtiIdentityStore'
import { pickOwnVetterGrant, type VetterGrantState } from './vtiGrantState'
import { readJoinState, type CommunityJoinState } from './vtiJoin'
import { GenericRecordsVettingStore, type VettingApplication } from './vtiVetting'

export interface CommunityJourney {
  join: CommunityJoinState
  application?: VettingApplication
  vetterGrant: VetterGrantState
  /**
   * The parts that could not be read and hold a stand-in ("none") rather than
   * an answer — absent when every part was read. A stand-in is not a "no": a
   * member whose read failed is not thereby a non-member (UI-smoothness plan,
   * Phase 2). Read the join through {@link joinKnown}.
   */
  unread?: ReadonlyArray<JourneyPart>
  /**
   * The unread parts whose last read failed: "could not read", not "reading"
   * — a screen that waits for a part says so and offers to read again, rather
   * than waiting on nothing. Read through {@link readFailed}.
   */
  failed?: ReadonlyArray<JourneyPart>
}

export type JourneyPart = 'join' | 'application' | 'vetterGrant'

/** The join state when it was read; undefined when not read yet or when its read failed — unknown, never "none". */
export function joinKnown(journey: CommunityJourney | undefined): CommunityJoinState | undefined {
  return journey && !journey.unread?.includes('join') ? journey.join : undefined
}

/** Whether `part` is unknown because its read failed, not because it has not come back yet. */
export function readFailed(journey: CommunityJourney | undefined, part: JourneyPart): boolean {
  return Boolean(journey?.failed?.includes(part))
}

/** The vetter grant when it was read; undefined when unknown. */
export function vetterGrantKnown(journey: CommunityJourney | undefined): VetterGrantState | undefined {
  return journey && !journey.unread?.includes('vetterGrant') ? journey.vetterGrant : undefined
}

/** Nothing read yet: every part a stand-in, and listed unread (unknown, never "none"). */
const NOTHING_READ: CommunityJourney = {
  join: { kind: 'none' },
  vetterGrant: { state: 'none' },
  unread: ['join', 'application', 'vetterGrant'],
}

/**
 * One part landing on the reading before it. A part that was read replaces
 * that part and leaves the unread list; a part that could not be read keeps
 * the last value read — a passing failure must not replace an answer with a
 * stand-in for every screen — and stays unread if it never was read, marked
 * failed.
 */
export function withPart(
  before: CommunityJourney | undefined,
  part: JourneyPart,
  read: { ok: boolean; value: unknown }
): CommunityJourney {
  const base = before ?? NOTHING_READ
  if (!read.ok) {
    if (!base.unread?.includes(part) || base.failed?.includes(part)) return base
    return { ...base, failed: [...(base.failed ?? []), part] }
  }
  const next: CommunityJourney = { ...base }
  if (part === 'join') next.join = read.value as CommunityJoinState
  else if (part === 'application') next.application = read.value as VettingApplication | undefined
  else next.vetterGrant = read.value as VetterGrantState
  const unread = (base.unread ?? []).filter((p) => p !== part)
  if (unread.length) next.unread = unread
  else delete next.unread
  const failed = (base.failed ?? []).filter((p) => p !== part)
  if (failed.length) next.failed = failed
  else delete next.failed
  return next
}

/** How each part is read; the defaults read this phone's stores. Tests replace them. */
export interface CommunityJourneyReaders {
  /** `local`: only what this phone holds, with no network read (see readJoinState). */
  join: (agent: Agent, communityDid: string, options: { poll: boolean; local?: boolean }) => Promise<CommunityJoinState>
  application: (agent: Agent, communityDid: string) => Promise<VettingApplication | undefined>
  vetterGrant: (agent: Agent, communityDid: string) => Promise<VetterGrantState>
}

export const defaultJourneyReaders: CommunityJourneyReaders = {
  join: (agent, communityDid, { poll, local }) => readJoinState(agent, communityDid, { poll, local }),
  application: (agent, communityDid) => new GenericRecordsVettingStore(agent).getApplication(communityDid),
  vetterGrant: async (agent, communityDid) => {
    const grants = await new GenericRecordsCommunityStore(agent).listHeldCredentials('vetter-grant', communityDid)
    if (grants.length === 0) return { state: 'none' }
    const persona = await new GenericRecordsIdentityStore(agent).getPersona(communityDid)
    const mine = persona ? grants.filter((g) => g.subjectDid === persona.did) : []
    const held = mine.length > 0 ? mine : await ofCurrentAgent(agent, grants, (g) => g.subjectDid)
    return (await pickOwnVetterGrant(agent, held, { allowInsecureLocal: __DEV__ })).state
  },
}

/** Read all three parts; a part that cannot be read holds a stand-in and is listed in `unread`, never thrown. */
export async function readCommunityJourney(
  agent: Agent,
  communityDid: string,
  options: { poll?: boolean; readers?: Partial<CommunityJourneyReaders> } = {}
): Promise<CommunityJourney> {
  const readers = { ...defaultJourneyReaders, ...options.readers }
  // A reader that throws before it returns a promise is caught the same way.
  const unread: JourneyPart[] = []
  const attempt = <T>(part: JourneyPart, read: () => Promise<T>, fallback: T): Promise<T> =>
    Promise.resolve()
      .then(read)
      .catch(() => {
        unread.push(part)
        return fallback
      })
  const [join, application, vetterGrant] = await Promise.all([
    attempt<CommunityJoinState>('join', () => readers.join(agent, communityDid, { poll: options.poll ?? false }), {
      kind: 'none',
    }),
    attempt<VettingApplication | undefined>('application', () => readers.application(agent, communityDid), undefined),
    attempt<VetterGrantState>('vetterGrant', () => readers.vetterGrant(agent, communityDid), { state: 'none' }),
  ])
  return { join, application, vetterGrant, ...(unread.length ? { unread } : {}) }
}

/**
 * The journeys this phone has read, one per community for the agent current
 * now. Only the newest reading of a community lands: an older one finishing
 * late must not put back a state the phone has already moved past. Once
 * anything subscribes, a change to a community already read is read again at
 * module level, whether or not a screen is mounted.
 */
class CommunityJourneyStore {
  private readonly entries = new Map<
    string,
    {
      journey?: CommunityJourney
      seq: number
      /** The read each part last landed from. */
      landed: Partial<Record<JourneyPart, number>>
      /** A read that asks the community, while it is out. */
      polling?: Promise<void>
      agent?: Agent
      readers?: Partial<CommunityJourneyReaders>
    }
  >()
  private readonly listeners = new Set<() => void>()
  private watching = false

  /** The agent current now is part of the key: another agent's reading of the same community is not this one's. */
  private keyOf(communityDid: string): string {
    return `${currentAgentDid() ?? ''}|${communityDid}`
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    this.watch()
    return () => {
      this.listeners.delete(listener)
    }
  }

  get(communityDid: string | undefined): CommunityJourney | undefined {
    return communityDid ? this.entries.get(this.keyOf(communityDid))?.journey : undefined
  }

  /**
   * Read every part; each lands as soon as it is read, not when the slowest
   * is — the join was held up by the vetter grant's status-list fetch, a
   * network read, and a screen waited for an answer it did not need (Phase
   * 2b). Only the newest read of a part lands: a part from an older read
   * finishing after a newer one's does not put back what was before.
   *
   * A read that does not ask, started while one that asks is out, waits for
   * it: started alongside, it could read the record before the answer is
   * stored and land after it — a request the community said it never got
   * shown as "Sent" again.
   */
  read(
    agent: Agent,
    communityDid: string,
    options: { poll: boolean; readers?: Partial<CommunityJourneyReaders> }
  ): Promise<void> {
    const key = this.keyOf(communityDid)
    const entry = this.entries.get(key) ?? { seq: 0, landed: {} }
    if (!options.poll && entry.polling) {
      const asking = entry.polling
      return asking.then(() => (this.entries.get(key) === entry ? this.read(agent, communityDid, options) : undefined))
    }
    entry.agent = agent
    entry.readers = options.readers
    const seq = ++entry.seq
    this.entries.set(key, entry)
    const readers = { ...defaultJourneyReaders, ...options.readers }
    const land = (part: JourneyPart, run: () => Promise<unknown>): Promise<void> =>
      // A reader that throws before it returns a promise is caught the same way.
      Promise.resolve()
        .then(run)
        .then(
          (value) => ({ ok: true, value }),
          () => ({ ok: false, value: undefined })
        )
        .then((result) => {
          if (this.entries.get(key) !== entry || seq < (entry.landed[part] ?? 0)) return
          entry.landed[part] = seq
          entry.journey = withPart(entry.journey, part, result)
          this.listeners.forEach((l) => l())
        })
    const reading = Promise.all([
      // The join waits on the network (the card's status list, and the
      // community while a request is open): what the phone holds lands first,
      // then the full read (a first visit sat on "reading" for the whole wait —
      // a member, up to the status list's timeout).
      land('join', () => readers.join(agent, communityDid, { poll: false, local: true })).then(() =>
        land('join', () => readers.join(agent, communityDid, { poll: options.poll }))
      ),
      land('application', () => readers.application(agent, communityDid)),
      land('vetterGrant', () => readers.vetterGrant(agent, communityDid)),
    ]).then(() => undefined)
    if (options.poll) {
      entry.polling = reading
      void reading.then(() => {
        if (entry.polling === reading) entry.polling = undefined
      })
    }
    return reading
  }

  /** A change to a community already read, wherever it came from, is read again; changes that land together, once. */
  private watch(): void {
    if (this.watching) return
    this.watching = true
    const queued = new Set<string>()
    const onChange = (e?: { communityDid?: string }) => {
      const prefix = `${currentAgentDid() ?? ''}|`
      const keys = [...this.entries.keys()].filter(
        (k) => k.startsWith(prefix) && (!e?.communityDid || k === prefix + e.communityDid)
      )
      for (const key of keys) {
        if (queued.has(key)) continue
        queued.add(key)
        setTimeout(() => {
          queued.delete(key)
          const entry = this.entries.get(key)
          if (entry?.agent)
            void this.read(entry.agent, key.slice(prefix.length), { poll: false, readers: entry.readers })
        }, 0)
      }
    }
    DeviceEventEmitter.addListener(COMMUNITY_CHANGED_EVENT, onChange)
    DeviceEventEmitter.addListener(VTI_PERSONA_DELIVERIES_EVENT, onChange)
  }

  /**
   * Forget one agent's readings (an unlink: its communities are not this
   * phone's any more), or every reading (tests). Another agent's stay, so its
   * screens do not start again from nothing. `''` is the readings made with
   * no agent current. A read still out for a forgotten reading does not land.
   */
  forget(agentDid?: string): void {
    if (agentDid === undefined) return this.entries.clear()
    for (const key of [...this.entries.keys()]) if (key.startsWith(`${agentDid}|`)) this.entries.delete(key)
  }
}

export const communityJourneys = new CommunityJourneyStore()

export interface UseCommunityJourney {
  /** Undefined until the first reading lands. */
  journey?: CommunityJourney
  /** Read again; resolves when the reading lands (a caller may wait for it). */
  refresh: () => Promise<void>
  /** Ask the community where a request stands now; resolves when the reading lands. */
  check: () => Promise<void>
}

/**
 * The journey for `communityDid`, kept current. `poll` asks the community about
 * an open join request on focus (the event-driven re-reads never do — they only
 * reflect what this phone just stored).
 */
export function useCommunityJourney(
  agent: Agent | undefined,
  communityDid: string | undefined,
  options: { poll?: boolean; readers?: Partial<CommunityJourneyReaders> } = {}
): UseCommunityJourney {
  // This community's reading, from the store: the same for every screen, and
  // there from the first render when it has been read before.
  const journey = useSyncExternalStore(communityJourneys.subscribe, () => communityJourneys.get(communityDid))
  const { poll = false, readers } = options
  const readersRef = useRef(readers)
  readersRef.current = readers

  const read = useCallback(
    (withPoll: boolean): Promise<void> => {
      if (!agent || !communityDid) return Promise.resolve()
      return communityJourneys.read(agent, communityDid, { poll: withPoll, readers: readersRef.current })
    },
    [agent, communityDid]
  )

  const refresh = useCallback(() => read(false), [read])
  /** Ask the community where a request stands now (the person's "Check now"). */
  const check = useCallback(() => read(true), [read])

  // Coming into view: an effect on focus, so it runs once each time the screen
  // is shown (not on every render). A change while it is shown is read by the
  // store itself.
  const focused = useIsFocused()
  useEffect(() => {
    if (focused) void read(poll)
  }, [focused, read, poll])

  return { journey, refresh, check }
}

/**
 * The readings of several communities, from the store, without reading them:
 * a screen listing communities (whose cards read each) works out from the
 * same readings what the cards show, in render, rather than being told by
 * each card after it painted. The same array until one of them changes.
 */
export function useCommunityJourneysOf(communityDids: readonly string[]): ReadonlyArray<CommunityJourney | undefined> {
  const last = useRef<{ dids: readonly string[]; journeys: ReadonlyArray<CommunityJourney | undefined> }>(undefined)
  const snapshot = () => {
    const journeys = communityDids.map((did) => communityJourneys.get(did))
    const before = last.current
    if (
      before &&
      before.dids.length === communityDids.length &&
      communityDids.every((did, i) => did === before.dids[i] && journeys[i] === before.journeys[i])
    )
      return before.journeys
    last.current = { dids: communityDids, journeys }
    return journeys
  }
  return useSyncExternalStore(communityJourneys.subscribe, snapshot)
}
