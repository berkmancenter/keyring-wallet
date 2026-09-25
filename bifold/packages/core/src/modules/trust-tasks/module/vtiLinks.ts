/**
 * vtiLinks — the links about agents and communities that the app's one
 * scanner, the paste-URL screen and deep links all hand over (plan §5, U4).
 *
 * Every QR in these flows has a link twin, so scanning, pasting and opening a
 * deep link are the same act and land in the same place — the hand-over the
 * peer-to-peer VRC exchange already uses: an agent enrolment offer, a
 * community invitation (as our link, or as the offer a community's admin
 * console shows), and a vetter's ticket.
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

import { bareDid, classifyDid } from './classifyDid'
import { GenericRecordsCommunityStore } from './VtiCommunityStore'
import { GenericRecordsIdentityStore } from './VtiIdentityStore'
import { vtaAgent } from './vtaAgent'
import { communityTarget, isCommunityLink, parseCommunityLink } from './vtiCommunityLink'
import { isVtiInvitationLink, parseVtiInvitationLink } from './vtiInvitation'
import {
  isInvitationOfferLink,
  parseInvitationOfferLink,
  redeemInvitationOffer,
  VtiInvitationOfferError,
} from './vtiInvitationOffer'
import { VettingTicketError } from './vtiVetting'

/**
 * A link of ours that cannot be used, said in words for the person: the
 * scanner shows its message as the headline rather than "Invalid QR code".
 */
export class KeyringLinkError extends Error {
  constructor(
    message: string,
    /** For a vetter's ticket that cannot be used here: why, typed, so a screen can word it. */
    readonly ticket?: VettingTicketError
  ) {
    super(message)
  }
}

export type KeyringAgentLinkKind =
  | 'enrolment'
  | 'invitation'
  | 'invitationOffer'
  | 'ticket'
  | 'community'
  | 'did'
  | 'otherDid'

/** Which of our links this is, if any — cheap, no parsing beyond the prefix. */
export function keyringAgentLinkKind(text: string): KeyringAgentLinkKind | undefined {
  const trimmed = text.trim()
  if (isEnrolmentLink(trimmed)) return 'enrolment'
  if (isVtiInvitationLink(trimmed)) return 'invitation'
  // A community admin console's invitation QR: an OID4VCI offer whose issuer
  // is the community's DID. Ours, not the OpenID flow's, which cannot redeem
  // it (VTI-Q32) and used to end on an error screen with no way back.
  if (isInvitationOfferLink(trimmed)) return 'invitationOffer'
  if (isTicketUri(trimmed)) return 'ticket'
  if (isCommunityLink(trimmed)) return 'community'
  // A bare did:webvh — what upstream's QR codes carry for an agent or a
  // community (the VTC page, `pnm vta qr`, the browser plugin).
  const did = bareDid(trimmed)
  if (did?.startsWith('did:webvh:')) return 'did'
  // Any other bare DID. The browser plugin draws a QR beside every DID it
  // shows, so a person can scan a did:key (a manager or admin key) or the
  // wallet's own did:peer holder address. Neither is an agent or a community,
  // and DIDComm cannot use one either: a DIDComm invitation is a URL carrying
  // oob=, c_i= or d_m=, never a bare DID, which Credo takes for a short URL and
  // fails to fetch. So it is answered here, in words.
  if (did) return 'otherDid'
  return undefined
}

/** Why an invitation offer could not be taken, in the person's words. */
export function invitationOfferMessage(error: unknown): string {
  const reason = error instanceof VtiInvitationOfferError ? error.reason : 'failed'
  switch (reason) {
    case 'noIdentity':
      return 'This invitation is for an identity this phone has not made yet. Open My Agent, choose I was invited, and send the identity it shows to the admin.'
    case 'otherIdentity':
      return 'This invitation is for a different identity from the one this phone uses for that community. Ask the admin to invite the identity under I was invited.'
    case 'used':
      return 'This invitation has already been used, or the admin replaced it. Ask the admin to send it again.'
    case 'unreachable':
      return "Keyring couldn't reach the community. Check your connection and try again."
    case 'cannotSign':
      return "This phone can't sign for that identity yet. Open My Agent and try again."
    default:
      return "The community didn't hand over the invitation. Ask the admin to send it again."
  }
}

/**
 * Why a bare DID of a method other than did:webvh is of no use here, in the
 * person's words. Agents and communities are did:webvh; nothing is resolved.
 */
export function otherDidMessage(did: string): string {
  const method = did.split(':')[1]
  if (method === 'key') return "This code is a key, not an agent or a community. There's nothing to link to or join."
  if (method === 'peer') {
    return "This code is a private connection address, not an agent or a community. There's nothing to link to or join."
  }
  return "This code isn't an agent or a community, so there's nothing to do with it here."
}

/** The host inside a did:webvh — what a person recognises — else the DID. */
const didHost = (did: string) => did.split(':')[3] ?? did

/**
 * A bare DID, classified by what its document advertises and routed: an agent
 * to linking, a community to Join (or back to "I was invited", when that is
 * where the person came from). Anything else says, in words, why there is
 * nothing to do with it here — the scanner shows the message.
 */
async function routeBareDid(
  did: string,
  agent: Agent,
  navigate: (destination: MyAgentDestination) => void
): Promise<void> {
  // Resolved and classified in one call, never longer than its 15 s cap, with
  // why it could not be read when it could not (keyring-bifold#80).
  const kind = await classifyDid(agent, did)
  switch (kind.kind) {
    case 'community':
      communityTarget.set({ communityDid: did })
      navigate(communityLinkReturn.take() ? 'VtiInvited' : 'VtiJoin')
      return
    case 'agent':
      if (vtaAgent.getState().link.kind === 'linked') {
        throw new KeyringLinkError('This phone is already linked to an agent.')
      }
      await vtaAgent.startManualLink(agent, did, didHost(did))
      navigate('VtaLink')
      return
    case 'ambiguous':
      throw new KeyringLinkError(
        'This code belongs to both an agent and a community. Ask whoever gave it to you which one it is.'
      )
    case 'relay':
      throw new KeyringLinkError(
        "This is a mediator's code. It relays messages; there is nothing here to link to or join."
      )
    case 'unresolvable':
      // Why, in words: the network, a code no host knows, or not a code at all.
      throw new KeyringLinkError(
        kind.reason === 'notFound'
          ? 'No agent or community has this code.'
          : kind.reason === 'invalid'
            ? "This isn't a code Keyring can read."
            : "This code couldn't be read. Check your connection and try again."
      )
    default:
      throw new KeyringLinkError("This code isn't an agent or a community, so there's nothing to do with it here.")
  }
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
          throw new KeyringLinkError('This link has expired. Ask for a new one.')
        }
        throw new KeyringLinkError('This link could not be read.')
      }
      vtaAgent.scanOffer(offer)
      navigate('VtaLink')
      return
    }
    case 'ticket': {
      // The ticket names the community it is for. A phone that has made its
      // identity for a community is vetted there: a ticket for another one is
      // refused here, before the vetting screen is switched to that community —
      // switching first would make the screen's own check compare the ticket
      // with itself and pass (p220 item 3). With no community chosen yet, the
      // ticket's community is the one being joined.
      let ticketCommunity: string | undefined
      try {
        ticketCommunity = parseTicketUri(trimmed).community
      } catch {
        // an unreadable ticket is reported by the vetting screen, where it is used
      }
      const chosen = communityTarget.getChosen()?.communityDid
      if (ticketCommunity && chosen && ticketCommunity !== chosen) {
        throw new KeyringLinkError(
          "This vetter's code is for a different community than the one you're joining.",
          new VettingTicketError('otherCommunity', ticketCommunity)
        )
      }
      if (ticketCommunity) communityTarget.set({ communityDid: ticketCommunity })
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
    case 'invitationOffer': {
      const offer = parseInvitationOfferLink(trimmed)
      if (!offer) throw new KeyringLinkError('This invitation could not be read.')
      // The community binds the offer to the identity it invited, the one
      // this phone made for that community on "I was invited".
      const persona = await new GenericRecordsIdentityStore(agent).getPersona(offer.communityDid)
      let invitation
      try {
        invitation = await redeemInvitationOffer(agent, offer, persona)
      } catch (e) {
        throw new KeyringLinkError(invitationOfferMessage(e))
      }
      communityTarget.set({ communityDid: offer.communityDid })
      await new GenericRecordsCommunityStore(agent).saveInvitation(invitation)
      navigate(vtaAgent.getState().link.kind === 'linked' ? 'VtiInvited' : 'MyAgent')
      return
    }
    case 'community': {
      let link
      try {
        link = parseCommunityLink(trimmed)
      } catch {
        throw new KeyringLinkError('This community link could not be read.')
      }
      communityTarget.set(link)
      navigate(communityLinkReturn.take() ? 'VtiInvited' : 'VtiJoin')
      return
    }
    case 'did':
      return routeBareDid(bareDid(trimmed) as string, agent, navigate)
    case 'otherDid':
      throw new KeyringLinkError(otherDidMessage(bareDid(trimmed) as string))
    default:
      throw new Error('not a Keyring agent link')
  }
}
