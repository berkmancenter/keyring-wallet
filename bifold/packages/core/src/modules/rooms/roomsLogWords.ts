/**
 * What a rooms log line may say about a community and about why a read did not happen.
 *
 * A read refused because a step keeps the community session as another of this phone's identities (vtiAgent
 * `VtiSessionHeld`) carries that step's reason ("signed in for a step just now", "polls"). Beside a community's DID
 * that pairs a step, possibly a hidden-vetting persona's, with a community, which the hold's own rule forbids. A
 * tester's 277.8 report logged it every 30 s (34VR-Y58H, 11-03). Any other error's words can name an identity too. So
 * the community is named by short id, and why a read failed by its kind alone.
 *
 * @module rooms/roomsLogWords
 */
import { RoomsRefused, RoomsUnavailable } from './types'

/** vtiAgent's `VtiSessionHeld`, by name, as the rooms backend and the persona inbox read it. */
const isSessionHeld = (e: unknown): boolean => e instanceof Error && e.name === 'VtiSessionHeld'

/**
 * A community or room in a log line: enough to tell it apart, never the whole DID. The short form the screens use
 * (communityName `shortDid`), kept here so the rooms hooks import no screen.
 */
export const logRef = (did: string | undefined): string =>
  !did ? 'none' : did.length <= 28 ? did : `${did.slice(0, 16)}…${did.slice(-8)}`

/**
 * Why a read failed, by kind only: no persona, step or task detail. The only form a line that names a community or room
 * may use. An error's own words can name an identity ("did:key:…'s agent is no longer linked"), and beside a
 * community that is the pairing the hold's rule forbids, whatever the error.
 */
export function failureCategory(e: unknown): string {
  if (isSessionHeld(e)) return 'the session is kept for another identity'
  if (e instanceof RoomsUnavailable) return `unavailable (${e.reason})`
  if (e instanceof RoomsRefused) return `refused (${e.code})`
  if (e instanceof Error && e.name === 'VtiSentNoAnswer') return 'no answer yet'
  return e instanceof Error && e.name && e.name !== 'Error' ? e.name : 'failed'
}
