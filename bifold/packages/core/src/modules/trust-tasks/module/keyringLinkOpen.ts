/**
 * One of our links arriving from outside the app — a Keyring link, or a bare
 * DID that the phone's own camera opened through the `did` URL scheme — acted
 * on exactly as a scan from the QR tab would be, with the person told what is
 * happening: a DID is looked up first (up to 15 s), and a code that cannot be
 * used says why, in the words the scanner would show. Before, a link that
 * failed here was only logged, and the person saw nothing at all.
 *
 * @module trust-tasks/module/keyringLinkOpen
 */

import type { Agent } from '@credo-ts/core'

import { KeyringLinkError, keyringAgentLinkKind, routeKeyringAgentLink, type MyAgentDestination } from './vtiLinks'

/** What to tell the person while and after a link is opened. */
export type KeyringLinkNotice =
  /** A DID is being looked up; it can take a while. */
  | { kind: 'reading' }
  /** It worked: the screen it leads to is on its way. */
  | { kind: 'opened' }
  /** It cannot be used. `message` is the plain reason, when there is one. */
  | { kind: 'unusable'; message?: string }

export async function openKeyringLink(
  link: string,
  agent: Agent,
  navigate: (destination: MyAgentDestination) => void,
  notify: (notice: KeyringLinkNotice) => void
): Promise<void> {
  // A did:webvh is resolved, and a community's invitation offer redeemed, over
  // the network; everything else is read from the link itself and answers at once.
  const kind = keyringAgentLinkKind(link)
  if (kind === 'did' || kind === 'invitationOffer') notify({ kind: 'reading' })
  try {
    await routeKeyringAgentLink(link, agent, navigate)
    notify({ kind: 'opened' })
  } catch (error) {
    notify({ kind: 'unusable', message: error instanceof KeyringLinkError ? error.message : undefined })
  }
}
