/**
 * The names this phone has shown for a community's room authors, from the community's directory (`query/0.1`): what
 * each member wrote as their own name, for those who show their identity to members. Kept so a room does not ask the
 * community again for every author each time it opens, and kept narrowly:
 *
 * - only names a room has shown, never a list of the community's members (`vtc/directory/entries/show/0.1`: a viewer
 *   "MUST NOT reuse [the projection] to build a list of the community's members outside the directory");
 * - in the agent's encrypted store, as one record per community, never in AsyncStorage;
 * - each for `NAME_TTL_MS`: what a room shows before the community answers, and offline. A room asks again each time
 *   it opens (`useDirectoryNames`), so a new name or a rename shows then, not after the week;
 * - dropped when the community no longer shows it (`notFound`), and all of a community's when the phone leaves it.
 *
 * A drop rewrites the community's record without the name rather than deleting a record per member, so nothing is
 * left behind that says which members were looked up.
 *
 * @module directory/names
 */
import type { Agent } from '@credo-ts/core'

import { createKeyLock } from '../../utils/keyLock'

const NAMES_TYPE = 'directory-names'
const recordId = (communityDid: string) => `${NAMES_TYPE}:${communityDid}`

/** How long a name is kept to show offline: a week. */
export const NAME_TTL_MS = 7 * 24 * 60 * 60 * 1000

type Kept = Record<string, { name: string; at: number }>

// One community's reads and writes in turn: two keeps at once would each write the record without the other's name.
const inTurn = createKeyLock()

const fresh = (kept: Kept, now: number): Kept => {
  const out: Kept = {}
  for (const [did, entry] of Object.entries(kept))
    if (typeof entry?.name === 'string' && typeof entry.at === 'number' && now - entry.at < NAME_TTL_MS)
      out[did] = { name: entry.name, at: entry.at }
  return out
}

async function read(agent: Agent, communityDid: string) {
  const record = await agent.genericRecords.findById(recordId(communityDid))
  const names = record?.content?.names
  return { record, kept: names !== null && typeof names === 'object' ? (names as Kept) : {} }
}

/** The names kept for this community and not yet expired, by member DID. */
export function loadDirectoryNames(
  agent: Agent,
  communityDid: string,
  now: number = Date.now()
): Promise<Map<string, string>> {
  return inTurn(communityDid, async () => {
    const { kept } = await read(agent, communityDid)
    return new Map(Object.entries(fresh(kept, now)).map(([did, entry]) => [did, entry.name]))
  })
}

/**
 * Keep `name` for this member, or with none, drop theirs: the community no longer shows it. Expired names are dropped
 * on the way.
 */
export function keepDirectoryName(
  agent: Agent,
  communityDid: string,
  memberDid: string,
  name: string | undefined,
  now: number = Date.now()
): Promise<void> {
  return inTurn(communityDid, async () => {
    const { record, kept } = await read(agent, communityDid)
    const next = fresh(kept, now)
    if (name) next[memberDid] = { name, at: now }
    else delete next[memberDid]
    if (record) {
      record.content = { names: next }
      await agent.genericRecords.update(record)
    } else if (name) {
      await agent.genericRecords.save({
        id: recordId(communityDid),
        content: { names: next },
        tags: { type: NAMES_TYPE },
      })
    }
  })
}

/**
 * The community still shows these members' names as kept: keep them another week. Only names past half their week
 * are written again, in one write, so a room opened often doesn't rewrite the record each time, and a name the
 * community confirms never expires from what a room shows offline.
 */
export function confirmDirectoryNames(
  agent: Agent,
  communityDid: string,
  memberDids: readonly string[],
  now: number = Date.now()
): Promise<void> {
  return inTurn(communityDid, async () => {
    const { record, kept } = await read(agent, communityDid)
    if (!record) return
    const next = fresh(kept, now)
    let changed = Object.keys(next).length !== Object.keys(kept).length
    for (const did of memberDids) {
      const entry = next[did]
      if (entry && now - entry.at >= NAME_TTL_MS / 2) {
        next[did] = { name: entry.name, at: now }
        changed = true
      }
    }
    if (!changed) return
    record.content = { names: next }
    await agent.genericRecords.update(record)
  })
}

/** Drop every name kept for this community: the phone left it. */
export function dropDirectoryNames(agent: Agent, communityDid: string): Promise<void> {
  return inTurn(communityDid, async () => {
    const { record } = await read(agent, communityDid)
    if (!record) return
    record.content = { names: {} }
    await agent.genericRecords.update(record)
  })
}
