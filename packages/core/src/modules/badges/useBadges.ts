/**
 * What the badges screens read: the service on this phone's agent, the member's own badges in a community, and
 * another member's wall.
 *
 * One service per agent, made the first time a screen asks, as polls has it (`usePolls`). Badges are read when a screen
 * opens and when it is returned to, never on a timer: the community sees each read. Nothing is read, and nothing
 * shown, while badges are off (`badgesSwitch`).
 *
 * Tests put a service in with `setBadgeServiceForTests` (e.g. the fake in `fakeBadgeService`) and take it out again with
 * `resetBadgeService`; a screen test may instead mock this module, as the polls tests mock `usePolls`.
 *
 * @module badges/useBadges
 */
import type { Agent } from '@credo-ts/core'
import { useAgent } from '@bifold/react-hooks'
import { useFocusEffect } from '@react-navigation/native'
import { useCallback, useEffect, useRef, useState } from 'react'

import { createAgentBadgesBackend } from './agentBadgesBackend'
import { createBadgeService } from './badgeService'
import { isMemberBadgesOn } from './badgesSwitch'
import type { BadgeService, MemberWallState, MyBadges, MyBadgesState } from './types'

let made: { agent: Agent; service: BadgeService } | undefined
let injected: BadgeService | undefined

/** The badge service on this phone's agent, or none before the agent is up, or while badges are off. */
export function badgeServiceFor(agent: Agent | undefined): BadgeService | undefined {
  if (!isMemberBadgesOn()) return undefined
  if (injected) return injected
  if (!agent) return undefined
  if (made?.agent !== agent) made = { agent, service: createBadgeService(createAgentBadgesBackend(agent)) }
  return made.service
}

/** Put a service in place of the agent's (tests; the screens' build against the fake). */
export function setBadgeServiceForTests(service: BadgeService | undefined): void {
  injected = service
}

/** Forget the service and any injected one (tests). */
export function resetBadgeService(): void {
  made = undefined
  injected = undefined
}

export function useBadgeService(): BadgeService | undefined {
  const { agent } = useAgent()
  return badgeServiceFor(agent as Agent | undefined)
}

/** Whether the component is still mounted: an answer that comes after it is gone sets nothing. */
function useMounted() {
  const mounted = useRef(true)
  useEffect(
    () => () => {
      mounted.current = false
    },
    []
  )
  return mounted
}

/** The same answer twice sets nothing: a screen re-rendered by its own read does not read again for nothing. */
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * The member's own badges and offers in one community, read on opening and on coming back.
 *
 * As `useCommunityPolls`: nothing is set during the focus callback itself (a navigator may run it on every render), one
 * read at a time (`reading`), and the answer set only after it comes, while the screen is still mounted. Leaving focus
 * does not drop an answer on its way: it is the same answer the next focus would read.
 */
export function useMyBadges(communityDid: string): MyBadgesState {
  const service = useBadgeService()
  const [answer, setAnswer] = useState<{ badges?: MyBadges; served: boolean; loading: boolean }>({
    served: false,
    loading: true,
  })
  const reading = useRef(false)
  const mounted = useMounted()
  const read = useCallback(() => {
    if (!service || reading.current) return
    reading.current = true
    void (async () => {
      try {
        const mine = await service.mine(communityDid)
        const next =
          mine === 'notServed' ? { served: false, loading: false } : { badges: mine, served: true, loading: false }
        if (mounted.current) setAnswer((was) => (same(was, next) ? was : next))
      } catch {
        // A read that failed shows what was shown before; the next visit asks again.
        if (mounted.current) setAnswer((was) => (was.loading ? { ...was, loading: false } : was))
      } finally {
        reading.current = false
      }
    })()
  }, [service, communityDid, mounted])
  useFocusEffect(read)
  const refresh = useCallback(() => {
    reading.current = false
    read()
  }, [read])
  return {
    badges: service ? answer.badges : undefined,
    served: !!service && answer.served,
    loading: !!service && answer.loading,
    refresh,
  }
}

/** Another member's wall in one community, by their directory entry, read on opening and on coming back. */
export function useMemberWall(communityDid: string, entryId: string | undefined): MemberWallState {
  const service = useBadgeService()
  const [answer, setAnswer] = useState<MemberWallState>({ state: 'loading' })
  const reading = useRef(false)
  const mounted = useMounted()
  useFocusEffect(
    useCallback(() => {
      if (!service || !entryId || reading.current) return
      reading.current = true
      void (async () => {
        try {
          const wall = await service.wall(communityDid, entryId)
          const next: MemberWallState =
            wall === 'notServed' || wall === 'hidden' ? { state: wall } : { state: 'shown', wall }
          if (mounted.current) setAnswer((was) => (same(was, next) ? was : next))
        } catch {
          if (mounted.current) setAnswer((was) => (was.state === 'loading' ? { state: 'notServed' } : was))
        } finally {
          reading.current = false
        }
      })()
    }, [service, communityDid, entryId, mounted])
  )
  return !service || !entryId ? { state: 'notServed' } : answer
}
