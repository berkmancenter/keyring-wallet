/**
 * The names communities published, as saved on this phone, put where every screen reads them.
 *
 * A screen names a community from `communityTarget`, which holds the names in memory. They are saved on the phone
 * when learned (`saveCommunityName`), but only the My Agent screen read them back, so after a start of the app
 * every other screen showed "(no name published yet)" until My Agent had been opened in that run: Messages'
 * community chips, for one (IN-814). A screen that shows communities now asks for this read itself.
 *
 * Nothing is asked of a community here, and when its public profile is read does not change
 * (`communityNameRefresh`): this reads the phone's own records only.
 *
 * @module trust-tasks/module/savedCommunityNames
 */
import type { Agent } from '@credo-ts/core'

import { namesLoadedLine, namesNotLoadedLine } from './communityNamesLog'
import { GenericRecordsCommunityStore } from './VtiCommunityStore'
import { communityTarget } from './vtiCommunityLink'

const reading = new WeakMap<object, Promise<number>>()

/**
 * Read the saved names and teach them to `communityTarget`. Resolves with how many were saved; never rejects (a
 * failed read is logged and counts as none). One read at a time per agent: callers that ask meanwhile share it.
 * It is read again each time it is asked for after that, since a name is cheap to read and the in-memory names
 * can be cleared (`communityTarget.clear`).
 */
export function loadSavedCommunityNames(agent: Agent): Promise<number> {
  const running = reading.get(agent)
  if (running) return running
  const read = (async () => {
    try {
      const names = await new GenericRecordsCommunityStore(agent).listCommunityNames()
      for (const { communityDid, name } of names) communityTarget.publishedName(communityDid, name)
      agent.config?.logger?.info?.(namesLoadedLine(names.length))
      return names.length
    } catch (e) {
      agent.config?.logger?.info?.(namesNotLoadedLine(e instanceof Error ? e.name : 'unknown'))
      return 0
    } finally {
      reading.delete(agent)
    }
  })()
  reading.set(agent, read)
  return read
}
