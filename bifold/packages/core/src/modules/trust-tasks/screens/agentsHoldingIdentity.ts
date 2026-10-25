/**
 * Which of the phone's agents hold an identity in a community. Join used it
 * to offer "Join <community> with which agent?"; joining now uses the current
 * agent, as chosen on "Your agent" (Alberto, 239), and the community and
 * invitation screens use it to tell another agent's standing from this one's.
 *
 * @module trust-tasks/screens/agentsHoldingIdentity
 */
import { useAgent } from '@bifold/react-hooks'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import { GenericRecordsIdentityStore } from '../module/VtiIdentityStore'
import { vtaAgent } from '../module/vtaAgent'
import { useCommunityChanged } from '../module/communityChanged'

/**
 * The agents on this phone that hold an identity in `communityDid`, and the
 * current one. `onlyOthers`: some do, and the current agent does not — what the
 * phone knows of this community (a membership, a request) is then another
 * agent's, not the current one's (the community store keeps one entry per
 * community, not per agent).
 */
export function useAgentsHoldingIdentity(communityDid: string | undefined): {
  /**
   * Whether the holders have been read for this community. Until they have, a
   * screen cannot tell this agent's standing from another's: shown as this
   * agent's, a membership another agent holds read as the current one's, then
   * turned into "another agent's".
   */
  known: boolean
  /** The read failed: not known, and said so, with `retry` to read again (never a wait on nothing). */
  failed: boolean
  retry: () => void
  holders: string[]
  current?: string
  onlyOthers: boolean
  /** The holders still linked to this phone: an agent unlinked since cannot be switched to. */
  linkedHolders: string[]
  several: boolean
} {
  const { agent } = useAgent()
  const state = useSyncExternalStore(vtaAgent.subscribe, vtaAgent.getState)
  const current = state.link.kind === 'linked' ? state.link.vtaDid : undefined
  const several = (state.agents ?? []).length > 1
  // The holders, with the community they were read for: another community's are not this one's.
  const [read, setRead] = useState<{ communityDid: string; holders: string[] }>()
  // The community whose read failed, until a read of it succeeds.
  const [failedFor, setFailedFor] = useState<string>()
  const [tick, setTick] = useState(0)
  useCommunityChanged(() => setTick((n) => n + 1))
  const retry = useCallback(() => {
    setFailedFor(undefined)
    setTick((n) => n + 1)
  }, [])
  useEffect(() => {
    if (!agent || !communityDid) return
    let live = true
    void new GenericRecordsIdentityStore(agent)
      .listPersonas()
      .then((all) => {
        if (live)
          setRead({ communityDid, holders: all.filter((p) => p.communityDid === communityDid).map((p) => p.vtaDid) })
      })
      .catch(() => {
        if (live) setFailedFor(communityDid)
      })
    return () => {
      live = false
    }
  }, [agent, communityDid, tick, current])
  // Nothing to read without an agent or a community: nothing is held.
  const known = !agent || !communityDid || read?.communityDid === communityDid
  const holders = read && read.communityDid === communityDid ? read.holders : []
  const failed = !known && failedFor === communityDid
  // A legacy identity kept with no agent counts as the current agent's. Not
  // only with several agents linked: an identity of an agent since unlinked
  // is another agent's too (Alberto's iPhone, 10-06: al-phone's membership
  // on al-signer).
  const onlyOthers = !!current && holders.length > 0 && !holders.some((h) => !h || h === current)
  const linked = new Set((state.agents ?? []).map((a) => a.vtaDid))
  return {
    known,
    failed,
    retry,
    holders,
    current,
    onlyOthers,
    linkedHolders: holders.filter((h) => !!h && linked.has(h)),
    several,
  }
}
