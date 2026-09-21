/**
 * vtiLinks — the links about agents and communities that the app's one
 * scanner, the paste-URL screen and deep links all hand over (plan §5, U4).
 *
 * Every QR in these flows has a link twin, so scanning, pasting and opening a
 * deep link are the same act and land in the same place — the hand-over the
 * peer-to-peer VRC exchange already uses. Today: an agent enrolment offer and
 * a community invitation. A vetting ticket joins them when the vetting screens
 * are split (plan U5).
 *
 * @module trust-tasks/module/vtiLinks
 */

import type { Agent } from '@credo-ts/core'

import { EnrolmentOfferError, isEnrolmentLink, parseEnrolmentLink } from '@bifold/trust-tasks'

import { GenericRecordsCommunityStore } from './VtiCommunityStore'
import { vtaAgent } from './vtaAgent'
import { isVtiInvitationLink, parseVtiInvitationLink } from './vtiInvitation'

export type KeyringAgentLinkKind = 'enrolment' | 'invitation'

/** Which of our links this is, if any — cheap, no parsing beyond the prefix. */
export function keyringAgentLinkKind(text: string): KeyringAgentLinkKind | undefined {
  const trimmed = text.trim()
  if (isEnrolmentLink(trimmed)) return 'enrolment'
  if (isVtiInvitationLink(trimmed)) return 'invitation'
  return undefined
}

/** Where a link lands, inside the My Agent stack. */
export type MyAgentDestination = 'VtaLink' | 'MyAgent'

/**
 * Act on one of our links: an enrolment offer goes to the link screen (the
 * person confirms there — nothing is minted by scanning), an invitation is
 * kept and shown on My Agent. Throws with a plain message on a link it cannot
 * use, so the scanner can say why instead of reporting a parse error.
 */
export async function routeKeyringAgentLink(
  text: string,
  agent: Agent,
  navigate: (destination: MyAgentDestination) => void
): Promise<void> {
  const trimmed = text.trim()
  switch (keyringAgentLinkKind(trimmed)) {
    case 'enrolment': {
      let offer
      try {
        offer = parseEnrolmentLink(trimmed)
      } catch (error) {
        if (error instanceof EnrolmentOfferError && error.reason === 'expired') {
          throw new Error('This link has expired. Ask for a new one.')
        }
        throw new Error('This link could not be read.')
      }
      vtaAgent.scanOffer(offer)
      navigate('VtaLink')
      return
    }
    case 'invitation': {
      await new GenericRecordsCommunityStore(agent).saveInvitation(parseVtiInvitationLink(trimmed))
      navigate('MyAgent')
      return
    }
    default:
      throw new Error('not a Keyring agent link')
  }
}
