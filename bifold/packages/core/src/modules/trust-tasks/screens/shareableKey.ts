/**
 * Sending the phone's code somewhere it will be read by a person.
 *
 * A bare `did:peer:2…` is a URI, and a receiving system treats it as one: an
 * AirDrop to a Mac produced Finder's "There is no application set to open the
 * URL did:peer:2…" — so the code arrived as a failure rather than as text
 * (report #26, 2026-09-23). Nothing was wrong with the code; it was handed
 * over in a form that invited the OS to try to open it.
 *
 * So what goes out is a short message *containing* the code, with a subject
 * that says what it is. The code is on its own line so a person can select it
 * cleanly, and the words around it stop the receiving system taking the whole
 * payload for a link to follow.
 *
 * @module trust-tasks/screens/shareableKey
 */

import type { TFunction } from 'i18next'

export interface ShareableKey {
  title: string
  message: string
}

export function shareableKey(t: TFunction, label: string, did: string): ShareableKey {
  return {
    title: t('VtaLink.ShareKeyTitle', { label, interpolation: { escapeValue: false } }) as string,
    // The trailing newline matters less than the leading sentence, but both
    // keep the DID from being the entire contents of the message.
    message: `${t('VtaLink.ShareKeyMessage', { label, interpolation: { escapeValue: false } })}\n\n${did}\n`,
  }
}
