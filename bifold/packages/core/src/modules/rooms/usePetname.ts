/**
 * The screens' side of your names for a community's members (rooms/petnames): one member's name for the identity
 * sheet, and every name in the community for the chat and the members list, read once rather than one read per row.
 * Both read again when a name in that community changes.
 *
 * @module rooms/usePetname
 */

import { useAgent } from '@bifold/react-hooks'
import { useCallback, useEffect, useState } from 'react'

import { loadPetname, loadPetnames, onPetnamesChange, removePetname, savePetname } from './petnames'

export interface Petname {
  /** Your name for them; undefined while reading or when you gave none. */
  name?: string
  /** True once the kept name has been read. */
  loaded: boolean
  /** Keep a name for them, in place of any you gave; a blank one changes nothing (the screen never offers one). */
  set: (name: string) => Promise<void>
  /** Remove your name for them. */
  remove: () => Promise<void>
}

export function usePetname(communityDid?: string, memberDid?: string): Petname {
  const { agent } = useAgent()
  const [name, setName] = useState<string>()
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setName(undefined)
    setLoaded(false)
    if (!agent || !communityDid || !memberDid) return
    let live = true
    const read = () =>
      loadPetname(agent, communityDid, memberDid)
        .then((kept) => {
          if (!live) return
          setName(kept)
          setLoaded(true)
        })
        .catch((error) => {
          agent.config?.logger?.warn('[Rooms:petname] a name was not read', { error })
          if (live) setLoaded(true)
        })
    void read()
    const unsubscribe = onPetnamesChange(communityDid, () => void read())
    return () => {
      live = false
      unsubscribe()
    }
  }, [agent, communityDid, memberDid])

  const set = useCallback(
    async (next: string) => {
      if (!agent || !communityDid || !memberDid) return
      await savePetname(agent, communityDid, memberDid, next)
    },
    [agent, communityDid, memberDid]
  )

  const remove = useCallback(async () => {
    if (!agent || !communityDid || !memberDid) return
    await removePetname(agent, communityDid, memberDid)
  }, [agent, communityDid, memberDid])

  return { name, loaded, set, remove }
}

const NONE: ReadonlyMap<string, string> = new Map()

/** Your names for this community's members, by member DID; empty while reading or when you gave none. */
export function usePetnames(communityDid?: string): ReadonlyMap<string, string> {
  const { agent } = useAgent()
  const [names, setNames] = useState<ReadonlyMap<string, string>>(NONE)

  useEffect(() => {
    setNames(NONE)
    if (!agent || !communityDid) return
    let live = true
    const read = () =>
      loadPetnames(agent, communityDid)
        .then((kept) => {
          if (live) setNames(kept)
        })
        .catch((error) => agent.config?.logger?.warn('[Rooms:petname] the names were not read', { error }))
    void read()
    const unsubscribe = onPetnamesChange(communityDid, () => void read())
    return () => {
      live = false
      unsubscribe()
    }
  }, [agent, communityDid])

  return names
}
