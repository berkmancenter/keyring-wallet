/**
 * What a join starts from: the profile the person chose at "Join as", copied
 * once into the community's new identity (seed by copy — no live link to the
 * profile afterwards; decided 2026-09-22). The vetting card's name
 * is filled from here, so the person never types it twice.
 *
 * Held in memory for the join in progress, keyed by community.
 *
 * Which profile it was is also kept, in the agent's encrypted store, so a
 * screen can name the person by the profile they joined as when they hold
 * several (Work, Personal). That is a pointer to the profile, not a copy of
 * it: a profile since deleted names no one, and the screen falls back to the
 * active one.
 *
 * @module trust-tasks/module/vtiJoinSeed
 */

import type { Agent } from '@credo-ts/core'

export interface JoinSeed {
  /** The name the vetter will see, as the profile gives it. */
  legalName: string
  /** The profile's own label ("Personal", "Work"), to say where the name came from. */
  profileLabel?: string
}

const seeds = new Map<string, JoinSeed>()

export const joinSeed = {
  set(communityDid: string, seed: JoinSeed): void {
    seeds.set(communityDid, seed)
  },
  get(communityDid: string): JoinSeed | undefined {
    return seeds.get(communityDid)
  },
  clear(communityDid: string): void {
    seeds.delete(communityDid)
  },
}

const JOINED_PROFILE_TYPE = 'joined-profile'
const joinedProfileRecordId = (communityDid: string): string => `${JOINED_PROFILE_TYPE}:${communityDid}`

/**
 * Keep the profile the person joined this community as. A later join (again, or as another profile) replaces it. It
 * never fails the join: a profile not kept only means the screens name the active one.
 */
export async function keepJoinedProfile(agent: Agent, communityDid: string, profileId: string): Promise<void> {
  if (!communityDid || !profileId) return
  try {
    const id = joinedProfileRecordId(communityDid)
    const existing = await agent.genericRecords.findById(id)
    if (existing) {
      existing.content = { profileId }
      await agent.genericRecords.update(existing)
      return
    }
    await agent.genericRecords.save({
      id,
      content: { profileId },
      tags: { type: JOINED_PROFILE_TYPE, communityDid },
    })
  } catch (error) {
    agent.config?.logger?.warn(`[VTI] the profile joined as was not kept for ${communityDid}`, { error })
  }
}

/** The profile the person joined this community as, or undefined when none was kept. */
export async function loadJoinedProfileId(agent: Agent, communityDid: string): Promise<string | undefined> {
  const record = await agent.genericRecords.findById(joinedProfileRecordId(communityDid))
  const profileId = record?.content?.profileId
  return typeof profileId === 'string' && profileId ? profileId : undefined
}
