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

import { bareDid, classifyDidDocument } from './classifyDid'
import { GenericRecordsCommunityStore } from './VtiCommunityStore'
import { vtaAgent } from './vtaAgent'
import { communityTarget, isCommunityLink, parseCommunityLink } from './vtiCommunityLink'
import { isVtiInvitationLink, parseVtiInvitationLink } from './vtiInvitation'

/**
 * A link of ours that cannot be used, said in words for the person: the
 * scanner shows its message as the headline rather than "Invalid QR code".
 */
export class KeyringLinkError extends Error {}

export type KeyringAgentLinkKind = 'enrolment' | 'invitation' | 'ticket' | 'community' | 'did'

/** Which of our links this is, if any — cheap, no parsing beyond the prefix. */
export function keyringAgentLinkKind(text: string): KeyringAgentLinkKind | undefined {
  const trimmed = text.trim()
  if (isEnrolmentLink(trimmed)) return 'enrolment'
  if (isVtiInvitationLink(trimmed)) return 'invitation'
  if (isTicketUri(trimmed)) return 'ticket'
  if (isCommunityLink(trimmed)) return 'community'
  // A bare did:webvh — what upstream's QR codes carry for an agent or a
  // community (the VTC page, `pnm vta qr`, the browser plugin). Other methods
  // stay with the DIDComm handling, which takes a did:peer as an invitation.
  if (bareDid(trimmed)?.startsWith('did:webvh:')) return 'did'
  return undefined
}

/** How long a scanned DID may take to resolve before the scanner says so. */
const DID_RESOLVE_TIMEOUT_MS = 15_000

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
  let doc
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    doc = await Promise.race([
      agent.dids.resolveDidDocument(did),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), DID_RESOLVE_TIMEOUT_MS)
      }),
    ])
  } catch {
    throw new KeyringLinkError("This code couldn't be read. Check your connection and try again.")
  } finally {
    // Whichever way it ended, the timer must not outlive the lookup.
    if (timer) clearTimeout(timer)
  }
  const kind = classifyDidDocument(doc as never, did)
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
        throw new KeyringLinkError('This community link could not be read.')
      }
      communityTarget.set(link)
      navigate(communityLinkReturn.take() ? 'VtiInvited' : 'VtiJoin')
      return
    }
    case 'did':
      return routeBareDid(bareDid(trimmed) as string, agent, navigate)
    default:
      throw new Error('not a Keyring agent link')
  }
}
