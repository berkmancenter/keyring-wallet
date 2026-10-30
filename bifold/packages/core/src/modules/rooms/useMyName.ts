/**
 * The member's own name for the rooms screens: the active Keyring profile's, read on this phone and shown only
 * here. Nothing in a room carries it: the room's members see the identity the member acts as, never this name.
 * Undefined when there is no profile, or it has no name yet.
 *
 * A community's identity takes its name from the profile chosen at "Join as", once; which profile that was is not
 * kept, so a person with several profiles sees the active one's name.
 *
 * @module rooms/useMyName
 */
import { useStore } from '../../contexts/store'
import { formInputFromTemplate } from '../vrc/types/rcard'

export interface MyName {
  name?: string
  /** The profile to open for "Open profile"; none when there is no profile yet. */
  profileId?: string
}

export const useMyName = (): MyName => {
  const [store] = useStore()
  const profiles = store.rCard?.profiles ?? []
  const profile = profiles.find((p) => p.id === store.rCard?.activeProfileId) ?? profiles[0]
  if (!profile) return {}
  const form = formInputFromTemplate(profile)
  const name = [form.firstName, form.lastName].filter(Boolean).join(' ').trim()
  return { name: name || undefined, profileId: profile.id }
}
