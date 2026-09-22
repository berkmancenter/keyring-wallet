/**
 * What a join starts from: the profile the person chose at "Join as", copied
 * once into the community's new identity (seed by copy — no live link to the
 * profile afterwards; decided 2026-09-22). The vetting card's name
 * is filled from here, so the person never types it twice.
 *
 * Held in memory for the join in progress, keyed by community.
 *
 * @module trust-tasks/module/vtiJoinSeed
 */

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
