/**
 * Which of the phone's agents hold an identity in a community. Join used it
 * to offer "Join <community> with which agent?"; joining now uses the current
 * agent, as chosen on "Your agent" (Alberto, 239), and the community and
 * invitation screens use it to tell another agent's standing from this one's.
 *
 * @module trust-tasks/screens/agentsHoldingIdentity
 */
import { useAgent } from '@bifold/react-hooks'
import { useEffect, useState, useSyncExternalStore } from 'react'

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
  const [holders, setHolders] = useState<string[]>([])
  const [tick, setTick] = useState(0)
  useCommunityChanged(() => setTick((n) => n + 1))
  useEffect(() => {
    if (!agent || !communityDid) return
    let live = true
    void new GenericRecordsIdentityStore(agent)
      .listPersonas()
      .then((all) => {
        if (live) setHolders(all.filter((p) => p.communityDid === communityDid).map((p) => p.vtaDid))
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [agent, communityDid, tick, current])
  // A legacy identity kept with no agent counts as the current agent's. Not
  // only with several agents linked: an identity of an agent since unlinked
  // is another agent's too (Alberto's iPhone, 10-06: al-phone's membership
  // on al-signer).
  const onlyOthers = !!current && holders.length > 0 && !holders.some((h) => !h || h === current)
  const linked = new Set((state.agents ?? []).map((a) => a.vtaDid))
  return {
    holders,
    current,
    onlyOthers,
    linkedHolders: holders.filter((h) => !!h && linked.has(h)),
    several,
  }
}
