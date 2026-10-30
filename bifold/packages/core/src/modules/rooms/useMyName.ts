/**
 * The member's own name for the rooms screens: their Keyring profile's, read on this phone and shown only here.
 * Nothing in a room carries it: the room's members see the identity the member acts as, never this name.
 * Undefined when there is no profile, or it has no name yet.
 *
 * The profile is the one the member joined the room's community as, when that was kept; a join from before it was
 * kept, or a profile since removed, names the active profile instead.
 *
 * @module rooms/useMyName
 */
import { useStore } from '../../contexts/store'
import { useJoinedProfileId } from '../trust-tasks/module/useJoinedProfileId'
import { formInputFromTemplate } from '../vrc/types/rcard'

export interface MyName {
  name?: string
  /** The profile to open for "Open profile"; none when there is no profile yet. */
  profileId?: string
}

export const useMyName = (communityDid?: string): MyName => {
  const [store] = useStore()
  const joined = useJoinedProfileId(communityDid)
  const profiles = store.rCard?.profiles ?? []
  const profile =
    profiles.find((p) => p.id === joined) ?? profiles.find((p) => p.id === store.rCard?.activeProfileId) ?? profiles[0]
  if (!profile) return {}
  const form = formInputFromTemplate(profile)
  const name = [form.firstName, form.lastName].filter(Boolean).join(' ').trim()
  return { name: name || undefined, profileId: profile.id }
}
