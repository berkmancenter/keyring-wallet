/**
 * The names communities published, as saved on this phone, put where every screen reads them, once at app start.
 *
 * A screen names a community from `communityTarget`, which holds the names in memory. They are saved on the phone
 * when learned (`saveCommunityName`), but only the My Agent screen read them back, so after a start of the app
 * every other screen showed "(no name published yet)" until My Agent had been opened in that run: Messages'
 * community chips and the Wallet's community cards among them (IN-814). They are now read when the tabs first
 * show (`useSavedCommunityNames`, from the tab navigator), for every screen at once.
 *
 * Nothing is asked of a community here, and when its public profile is read does not change
 * (`communityNameRefresh`): this reads the phone's own records only.
 *
 * @module trust-tasks/module/savedCommunityNames
 */
import type { Agent } from '@credo-ts/core'
import { useEffect } from 'react'

import { namesLoadedLine, namesNotLoadedLine } from './communityNamesLog'
import { GenericRecordsCommunityStore } from './VtiCommunityStore'
import { communityTarget } from './vtiCommunityLink'

const reads = new WeakMap<object, Promise<number>>()

/**
 * Read the saved names and teach them to `communityTarget`. Resolves with how many were saved; never rejects (a
 * failed read is logged and counts as none).
 *
 * Once per agent: every caller shares the one read, while it is out and after it has ended, since a name learned
 * later is put in memory by whatever learned it. A read that failed is not kept, so the next caller reads again.
 */
export function loadSavedCommunityNames(agent: Agent): Promise<number> {
  const known = reads.get(agent)
  if (known) return known
  const read = (async () => {
    try {
      const names = await new GenericRecordsCommunityStore(agent).listCommunityNames()
      for (const { communityDid, name } of names) communityTarget.publishedName(communityDid, name)
      agent.config?.logger?.info?.(namesLoadedLine(names.length))
      return names.length
    } catch (e) {
      if (reads.get(agent) === read) reads.delete(agent)
      agent.config?.logger?.info?.(namesNotLoadedLine(e instanceof Error ? e.name : 'unknown'))
      return 0
    }
  })()
  reads.set(agent, read)
  return read
}

/**
 * For tests: the next call reads again, as after a start of the app. It drops this module's note that the read was
 * made, which is in memory only; nothing saved on the phone is touched.
 */
export function resetSavedCommunityNamesRead(agent: Agent): void {
  reads.delete(agent)
}

/**
 * The read, started as soon as there is an agent: for the tab navigator, which is there from unlock on, so the
 * names are in memory before a person can reach a screen that shows one.
 */
export function useSavedCommunityNames(agent: Agent | undefined): void {
  useEffect(() => {
    if (agent) void loadSavedCommunityNames(agent)
  }, [agent])
}
