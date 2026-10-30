/**
 * Your own names for the people in a community's rooms ("your name for them"). A room shows a member as an identity,
 * never a name (types.ts), so a name the person gives a member is theirs alone: kept on this phone, shown beside the
 * identity and never in its place, and never sent anywhere.
 *
 * A name ties a DID to a real person, so it is kept where messages are, in the agent's encrypted store as a generic
 * record, not in AsyncStorage. It is kept per community and member DID, since a member's identity is per community.
 *
 * @module rooms/petnames
 */

import type { Agent } from '@credo-ts/core'

import { createKeyLock } from '../../utils/keyLock'

const PETNAME_TYPE = 'rooms-petname'
const petnameId = (communityDid: string, memberDid: string): string => `${PETNAME_TYPE}:${communityDid}|${memberDid}`

/** The longest name kept, in characters. */
export const PETNAME_MAX = 64

/** A name as it is kept: on one line, trimmed and at most PETNAME_MAX characters. Nothing left means no name. */
export const tidyPetname = (name: string | undefined): string | undefined => {
  const tidy = Array.from((name ?? '').replace(/\s+/g, ' ').trim())
    .slice(0, PETNAME_MAX)
    .join('')
    .trim()
  return tidy || undefined
}

// One member's reads and writes in turn: two saves at once would both find no record and both create one.
const inTurn = createKeyLock()

// Screens showing a community's names, told when one changes so a name given on the sheet shows in the chat at once.
const listeners = new Map<string, Set<() => void>>()

/** Call `onChange` whenever a name in this community changes; returns the unsubscribe. */
export function onPetnamesChange(communityDid: string, onChange: () => void): () => void {
  const set = listeners.get(communityDid) ?? new Set()
  set.add(onChange)
  listeners.set(communityDid, set)
  return () => {
    set.delete(onChange)
    if (set.size === 0) listeners.delete(communityDid)
  }
}

const named = (content: Record<string, unknown> | undefined): string | undefined =>
  typeof content?.name === 'string' ? tidyPetname(content.name) : undefined

/** Your name for this member, or undefined when you gave none. */
export function loadPetname(agent: Agent, communityDid: string, memberDid: string): Promise<string | undefined> {
  const id = petnameId(communityDid, memberDid)
  return inTurn(id, async () => named((await agent.genericRecords.findById(id))?.content))
}

/** Every name you gave a member of this community, by member DID. */
export async function loadPetnames(agent: Agent, communityDid: string): Promise<Map<string, string>> {
  const records = await agent.genericRecords.findAllByQuery({ type: PETNAME_TYPE, communityDid })
  const names = new Map<string, string>()
  for (const record of records) {
    const memberDid = record.getTags().memberDid
    const name = named(record.content)
    if (typeof memberDid === 'string' && name) names.set(memberDid, name)
  }
  return names
}

/**
 * Keep `name` as your name for this member, in place of any you gave before. A blank name changes nothing: removing
 * a name you gave is not offered yet (it comes with a store build), so the screens never let one be saved blank.
 */
export async function savePetname(agent: Agent, communityDid: string, memberDid: string, name: string): Promise<void> {
  const id = petnameId(communityDid, memberDid)
  const tidy = tidyPetname(name)
  if (!tidy) return
  await inTurn(id, async () => {
    const existing = await agent.genericRecords.findById(id)
    if (existing) {
      existing.content = { name: tidy }
      await agent.genericRecords.update(existing)
      return
    }
    await agent.genericRecords.save({
      id,
      content: { name: tidy },
      tags: { type: PETNAME_TYPE, communityDid, memberDid },
    })
  })
  listeners.get(communityDid)?.forEach((onChange) => onChange())
}
