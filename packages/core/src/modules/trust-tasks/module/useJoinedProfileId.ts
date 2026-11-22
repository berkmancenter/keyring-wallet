/**
 * The profile the person joined a community as (vtiJoinSeed's kept pointer), for screens that name the person there.
 * Undefined while reading, when none was kept (a join from before it was kept), or without an agent: the screen then
 * names the active profile.
 *
 * @module trust-tasks/module/useJoinedProfileId
 */
import { useAgent } from '@bifold/react-hooks'
import { useEffect, useState } from 'react'

import { loadJoinedProfileId } from './vtiJoinSeed'

export function useJoinedProfileId(communityDid?: string): string | undefined {
  const { agent } = useAgent()
  const [profileId, setProfileId] = useState<string>()

  useEffect(() => {
    setProfileId(undefined)
    if (!agent || !communityDid) return
    let live = true
    loadJoinedProfileId(agent, communityDid)
      .then((kept) => {
        if (live) setProfileId(kept)
      })
      .catch((error) => agent.config?.logger?.warn('[VTI] the profile joined as was not read', { error }))
    return () => {
      live = false
    }
  }, [agent, communityDid])

  return profileId
}
