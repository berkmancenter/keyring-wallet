/**
 * Where this phone stands with one community, read from what it has stored:
 * its join (member, sent, pending, left…), its vetting application, and its own
 * vetter grant. One reading for every journey screen, so they cannot disagree.
 *
 * It re-reads when the screen comes into view and whenever the community
 * changes ([`useCommunityChanged`]) — never on a timer. A screen that remounts
 * reads the same stored answer again, so a finished step stays finished.
 *
 * @module trust-tasks/module/communityJourney
 */

import type { Agent } from '@credo-ts/core'
import { useIsFocused } from '@react-navigation/native'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useCommunityChanged } from './communityChanged'
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

export interface UseCommunityJourney {
  /** Undefined until the first reading lands. */
  journey?: CommunityJourney
  refresh: () => void
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
  const [journey, setJourney] = useState<CommunityJourney | undefined>()
  const latest = useRef(0)
  const mounted = useRef(true)
  const { poll = false, readers } = options
  const readersRef = useRef(readers)
  readersRef.current = readers

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const read = useCallback(
    (withPoll: boolean) => {
      if (!agent || !communityDid) return
      // Only the newest reading may land: an older one finishing late must not
      // put back a state the phone has already moved past.
      const seq = ++latest.current
      void readCommunityJourney(agent, communityDid, { poll: withPoll, readers: readersRef.current }).then((j) => {
        if (mounted.current && seq === latest.current) setJourney(j)
      })
    },
    [agent, communityDid]
  )

  const refresh = useCallback(() => read(false), [read])

  // A different community is a different journey: never show the old one's.
  useEffect(() => {
    setJourney(undefined)
  }, [communityDid])

  // Coming into view: an effect on focus, so it runs once each time the screen
  // is shown (not on every render).
  const focused = useIsFocused()
  useEffect(() => {
    if (focused) read(poll)
  }, [focused, read, poll])

  useCommunityChanged(refresh, communityDid)

  return { journey, refresh }
}
