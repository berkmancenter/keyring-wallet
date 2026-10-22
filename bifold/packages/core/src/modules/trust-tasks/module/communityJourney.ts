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
import { GenericRecordsCommunityStore } from './VtiCommunityStore'
import { GenericRecordsIdentityStore } from './VtiIdentityStore'
import { pickOwnVetterGrant, type VetterGrantState } from './vtiGrantState'
import { readJoinState, type CommunityJoinState } from './vtiJoin'
import { GenericRecordsVettingStore, type VettingApplication } from './vtiVetting'

export interface CommunityJourney {
  join: CommunityJoinState
  application?: VettingApplication
  vetterGrant: VetterGrantState
}

/** How each part is read; the defaults read this phone's stores. Tests replace them. */
export interface CommunityJourneyReaders {
  join: (agent: Agent, communityDid: string, options: { poll: boolean }) => Promise<CommunityJoinState>
  application: (agent: Agent, communityDid: string) => Promise<VettingApplication | undefined>
  vetterGrant: (agent: Agent, communityDid: string) => Promise<VetterGrantState>
}

export const defaultJourneyReaders: CommunityJourneyReaders = {
  join: (agent, communityDid, { poll }) => readJoinState(agent, communityDid, { poll }),
  application: (agent, communityDid) => new GenericRecordsVettingStore(agent).getApplication(communityDid),
  vetterGrant: async (agent, communityDid) => {
    const grants = await new GenericRecordsCommunityStore(agent).listHeldCredentials('vetter-grant', communityDid)
    if (grants.length === 0) return { state: 'none' }
    const persona = await new GenericRecordsIdentityStore(agent).getPersona(communityDid)
    const mine = persona ? grants.filter((g) => g.subjectDid === persona.did) : []
    return (await pickOwnVetterGrant(agent, mine.length > 0 ? mine : grants, { allowInsecureLocal: __DEV__ })).state
  },
}

/** Read all three parts; a part that cannot be read reads as nothing, never as an error. */
export async function readCommunityJourney(
  agent: Agent,
  communityDid: string,
  options: { poll?: boolean; readers?: Partial<CommunityJourneyReaders> } = {}
): Promise<CommunityJourney> {
  const readers = { ...defaultJourneyReaders, ...options.readers }
  // A reader that throws before it returns a promise is caught the same way.
  const attempt = <T>(read: () => Promise<T>, fallback: T): Promise<T> =>
    Promise.resolve()
      .then(read)
      .catch(() => fallback)
  const [join, application, vetterGrant] = await Promise.all([
    attempt<CommunityJoinState>(() => readers.join(agent, communityDid, { poll: options.poll ?? false }), {
      kind: 'none',
    }),
    attempt<VettingApplication | undefined>(() => readers.application(agent, communityDid), undefined),
    attempt<VetterGrantState>(() => readers.vetterGrant(agent, communityDid), { state: 'none' }),
  ])
  return { join, application, vetterGrant }
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
    { journey?: CommunityJourney; seq: number; agent?: Agent; readers?: Partial<CommunityJourneyReaders> }
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

  read(
    agent: Agent,
    communityDid: string,
    options: { poll: boolean; readers?: Partial<CommunityJourneyReaders> }
  ): Promise<void> {
    const key = this.keyOf(communityDid)
    const entry = this.entries.get(key) ?? { seq: 0 }
    entry.agent = agent
    entry.readers = options.readers
    const seq = ++entry.seq
    this.entries.set(key, entry)
    return readCommunityJourney(agent, communityDid, { poll: options.poll, readers: options.readers }).then(
      (journey) => {
        if (this.entries.get(key) !== entry || entry.seq !== seq) return
        entry.journey = journey
        this.listeners.forEach((l) => l())
      }
    )
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

  /** For tests: forget every reading. */
  forget(): void {
    this.entries.clear()
  }
}

export const communityJourneys = new CommunityJourneyStore()

export interface UseCommunityJourney {
  /** Undefined until the first reading lands. */
  journey?: CommunityJourney
  refresh: () => void
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

  const refresh = useCallback(() => void read(false), [read])
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
