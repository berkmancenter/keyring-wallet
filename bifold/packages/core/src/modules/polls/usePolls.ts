/**
 * What the polls screens read: the service on this phone's agent, a community's polls with this phone's record of
 * each, and one poll whole.
 *
 * One service per agent, made the first time a screen asks: a vote left on its way (a kill, a background, no network)
 * is taken on again then, the same cast as before (`pollService`).
 *
 * Polls are read when a screen opens and when it is returned to, never on a timer: the community sees each read.
 *
 * @module polls/usePolls
 */
import type { Agent } from '@credo-ts/core'
import { useAgent } from '@bifold/react-hooks'
import { useFocusEffect } from '@react-navigation/native'
import { useCallback, useRef, useState } from 'react'

import { createAgentPollsBackend } from './agentPollsBackend'
import { createPollService, PollRefusal, type PollRecord, type PollService } from './pollService'
import type { PollListItem, PollShown } from './pollTasks'

let made: { agent: Agent; service: PollService } | undefined

/** The poll service on this phone's agent, or none before the agent is up. */
export function pollServiceFor(agent: Agent | undefined): PollService | undefined {
  if (!agent) return undefined
  if (made?.agent !== agent) {
    const service = createPollService(createAgentPollsBackend(agent))
    made = { agent, service }
    void service.resumePending()
  }
  return made.service
}

/** Forget the service (tests). */
export function resetPollService(): void {
  made = undefined
}

export function usePollService(): PollService | undefined {
  const { agent } = useAgent()
  return pollServiceFor(agent as Agent | undefined)
}

export interface CommunityPoll {
  poll: PollListItem
  record?: PollRecord
}

/** Open polls first, soonest close first; then the rest, the latest close first. */
export function orderPolls(polls: CommunityPoll[], now: number): CommunityPoll[] {
  const open = (p: CommunityPoll) => Date.parse(p.poll.votingClosesAt) > now && p.poll.state !== 'cancelled'
  const closes = (p: CommunityPoll) => Date.parse(p.poll.votingClosesAt)
  return [
    ...polls.filter(open).sort((a, b) => closes(a) - closes(b)),
    ...polls.filter((p) => !open(p)).sort((a, b) => closes(b) - closes(a)),
  ]
}

/** A community's polls, read on opening and on coming back. A community that serves no polls lists none. */
export function useCommunityPolls(communityDid: string): { polls?: CommunityPoll[]; failed: boolean } {
  const service = usePollService()
  const [state, setState] = useState<{ polls?: CommunityPoll[]; failed: boolean }>({ failed: false })
  const reading = useRef(false)
  useFocusEffect(
    useCallback(() => {
      if (!service || reading.current) return
      reading.current = true
      let live = true
      void (async () => {
        try {
          const polls = (await service.readPolls(communityDid)).filter(
            (p) => p.state !== 'pendingRegistration' && p.state !== 'registrationRefused'
          )
          const withRecords = await Promise.all(
            polls.map(async (poll) => ({
              poll,
              record: await service.record(communityDid, poll.electionId).catch(() => undefined),
            }))
          )
          if (live) setState({ polls: orderPolls(withRecords, Date.now()), failed: false })
        } catch {
          if (live) setState((s) => ({ polls: s.polls, failed: true }))
        } finally {
          reading.current = false
        }
      })()
      return () => {
        live = false
      }
    }, [service, communityDid])
  )
  return state
}

export interface PollState {
  shown?: PollShown
  record?: PollRecord
  readiness?: 'ready' | 'noAgent' | 'tooOld'
  /** A poll this version of the app can't read at any version it knows. */
  behind?: boolean
  failed: boolean
  reload: () => Promise<void>
}

/** One poll whole, this phone's record of it, and whether the agent can vote, read on opening and on coming back. */
export function usePoll(communityDid: string, electionId: string): PollState {
  const service = usePollService()
  const [state, setState] = useState<Omit<PollState, 'reload'>>({ failed: false })
  const reload = useCallback(async () => {
    if (!service) return
    try {
      const shown = await service.readPoll(communityDid, electionId)
      const [record, readiness] = await Promise.all([
        service.record(communityDid, electionId, shown.manifest.community),
        service.agentReadiness(),
      ])
      setState({ shown, record, readiness, failed: false })
    } catch (e) {
      // A poll this agent, or this app, can't carry: which of them to update is what the member can act on.
      const reason = e instanceof PollRefusal ? e.reason : undefined
      setState((s) => ({
        ...s,
        failed: true,
        ...(reason === 'agentTooOld' ? { readiness: 'tooOld' as const } : {}),
        ...(reason === 'appBehind' ? { behind: true } : {}),
      }))
    }
  }, [service, communityDid, electionId])
  useFocusEffect(
    useCallback(() => {
      void reload()
    }, [reload])
  )
  return { ...state, reload }
}
