/**
 * vtiLinks — the links about agents and communities that the app's one
 * scanner, the paste-URL screen and deep links all hand over (plan §5, U4).
 *
 * Every QR in these flows has a link twin, so scanning, pasting and opening a
 * deep link are the same act and land in the same place — the hand-over the
 * peer-to-peer VRC exchange already uses: an agent enrolment offer, a
 * community invitation, and a vetter's ticket.
 *
 * @module trust-tasks/module/vtiLinks
 */

import type { Agent } from '@credo-ts/core'

import {
  EnrolmentOfferError,
  isEnrolmentLink,
  isTicketUri,
  parseEnrolmentLink,
  parseTicketUri,
} from '@bifold/trust-tasks'

import { Screens } from '../../../types/navigators'

import { GenericRecordsCommunityStore } from './VtiCommunityStore'
import { vtaAgent } from './vtaAgent'
import { communityTarget, isCommunityLink, parseCommunityLink } from './vtiCommunityLink'
import { isVtiInvitationLink, parseVtiInvitationLink } from './vtiInvitation'

export type KeyringAgentLinkKind = 'enrolment' | 'invitation' | 'ticket' | 'community'

/** Which of our links this is, if any — cheap, no parsing beyond the prefix. */
export function keyringAgentLinkKind(text: string): KeyringAgentLinkKind | undefined {
  const trimmed = text.trim()
  if (isEnrolmentLink(trimmed)) return 'enrolment'
  if (isVtiInvitationLink(trimmed)) return 'invitation'
  if (isTicketUri(trimmed)) return 'ticket'
  if (isCommunityLink(trimmed)) return 'community'
  return undefined
}

/** Where a link lands, inside the My Agent stack. */
export type MyAgentDestination = 'VtaLink' | 'MyAgent' | 'VtiVetting' | 'VtiJoin' | 'VtiInvited'

export const MY_AGENT_SCREEN: Record<MyAgentDestination, Screens> = {
  VtaLink: Screens.VtaLink,
  MyAgent: Screens.MyAgent,
  VtiVetting: Screens.VtiVetting,
  VtiJoin: Screens.VtiJoin,
  VtiInvited: Screens.VtiInvited,
}

/**
 * "I was invited" asks which community first — the admin invites an identity
 * made for a community, so the community has to be known before any
 * invitation exists. When it sends the person to the scanner for that, the
 * community link they bring should land back on "I was invited", not on Join.
 * One-shot: taken by the next community link, whoever brings it.
 */
let communityLinkForInvited = false
export const communityLinkReturn = {
  toInvited(): void {
    communityLinkForInvited = true
  },
  take(): boolean {
    const back = communityLinkForInvited
    communityLinkForInvited = false
    return back
  },
}

/**
 * A vetter's ticket scanned or pasted outside the vetting screen, held until
 * that screen takes it. The applicant still asks — taking the ticket only
 * fills in what they would otherwise paste.
 */
let pendingTicket: string | undefined
const ticketListeners = new Set<() => void>()
export const pendingVettingTicket = {
  take(): string | undefined {
    const ticket = pendingTicket
    pendingTicket = undefined
    return ticket
  },
  subscribe(listener: () => void) {
    ticketListeners.add(listener)
    return () => {
      ticketListeners.delete(listener)
    }
  },
}

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
    case 'ticket': {
      // The ticket names the community it is for: that is the one being joined.
      try {
        const ticket = parseTicketUri(trimmed)
        if (ticket.community) communityTarget.set({ communityDid: ticket.community })
      } catch {
        // an unreadable ticket is reported by the vetting screen, where it is used
      }
      pendingTicket = trimmed
      ticketListeners.forEach((listener) => listener())
      navigate('VtiVetting')
      return
    }
    case 'invitation': {
      const invitation = parseVtiInvitationLink(trimmed)
      if (invitation.communityDid) communityTarget.set({ communityDid: invitation.communityDid })
      await new GenericRecordsCommunityStore(agent).saveInvitation(invitation)
      // A linked phone accepts it on "I was invited"; the operator panel,
      // where it used to land, is only for a phone with a build-named agent.
      navigate(vtaAgent.getState().link.kind === 'linked' ? 'VtiInvited' : 'MyAgent')
      return
    }
    case 'community': {
      let link
      try {
        link = parseCommunityLink(trimmed)
      } catch {
        throw new Error('This community link could not be read.')
      }
      communityTarget.set(link)
      navigate(communityLinkReturn.take() ? 'VtiInvited' : 'VtiJoin')
      return
    }
    default:
      throw new Error('not a Keyring agent link')
  }
}
