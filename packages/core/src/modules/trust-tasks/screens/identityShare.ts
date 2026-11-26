/**
 * Naming a community for people, and handing an identity to its admin — shared
 * by the agent screen's identity rows and the "I was invited" flow.
 *
 * @module trust-tasks/screens/identityShare
 */

import type { TFunction } from 'i18next'
import { Share } from 'react-native'

import { agentHost } from './VtaLink'

/** A person-readable name for a community or persona DID: its host, else a short form. */
export function didName(did: string): string {
  return agentHost(did) ?? `${did.slice(0, 16)}…${did.slice(-6)}`
}

/** What the person sends the admin: plain words, with the DID inside. */
export function identityShareText(t: TFunction, communityDid: string, personaDid: string): string {
  return t('Invited.ShareText', {
    community: didName(communityDid),
    did: personaDid,
    interpolation: { escapeValue: false },
  }) as string
}

/** Opens the system share sheet with the identity; a dismissed sheet is not an error. */
export async function shareIdentity(t: TFunction, communityDid: string, personaDid: string): Promise<void> {
  await Share.share({
    title: t('Invited.ShareTitle', { community: didName(communityDid), interpolation: { escapeValue: false } }),
    message: identityShareText(t, communityDid, personaDid),
  }).catch(() => undefined)
}
