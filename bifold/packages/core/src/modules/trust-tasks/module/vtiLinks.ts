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
import { agentHomeScreen } from '../screens/agentHome'

import { AgentHostConnectionError, looksLikeAgentHostQr, parseAgentHostQr } from './agentHostConnection'
import { bareDid, classifyDid } from './classifyDid'
import { sameIdentity } from './didScid'
import {
  readTrigger,
  TRIGGER_UI_MESSAGE_KEYS,
  TRIGGER_UI_MESSAGES,
  triggerAction,
  triggerLinkSignInEnabled,
  type TriggerUi,
} from './triggerLink'
import { GenericRecordsCommunityStore, isCurrentMembership } from './VtiCommunityStore'
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
    readonly ticket?: VettingTicketError,
    /** The words, as a localization key, for a screen that can translate; `message` stays the English. */
    readonly messageKey?: string
  ) {
    super(message)
  }
}

/** A KeyringLinkError in the person's language where the screen can translate it, else as written. */
export const keyringLinkErrorText = (e: KeyringLinkError, t?: (key: string) => string): string =>
  e.messageKey && t ? t(e.messageKey) : e.message

/**
 * The app's own link to the waiting approvals (the agent home). A push notification
 * opens it: the notification carries no content, so a tap can only say "go to
 * where approvals wait", and the approval itself is fetched after unlocking.
 */
export const APPROVALS_LINK = 'keyring://vta/approvals'

/**
 * The app's own link to the Messages tab. A push notification for a message
 * waiting at the mediator opens it: like an approval's, the notification
 * carries no content, so a tap can only say "go to where messages are". Not
 * one of the agent links below: it leads to a tab, not to My Agent.
 */
export const MESSAGES_LINK = 'keyring://messages'

/** Whether `text` is {@link MESSAGES_LINK}, exactly. */
export const isMessagesLink = (text: string): boolean => text.trim() === MESSAGES_LINK

export type KeyringAgentLinkKind =
  | 'agentHost'
  | 'triggerLink'
  | 'approvals'
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
  // An agent host's automatic connection: JSON with a callback. Claimed even
  // when it fails its checks, so the scanner says why rather than "invalid".
  if (looksLikeAgentHostQr(trimmed)) return 'agentHost'
  // A one-scan trigger link (a community sign-in, an agent claim). Keyring
  // reads none of its flows yet, so it is claimed here to be answered in
  // words instead of reaching the connection handler, which reported it as
  // an invalid DIDComm invitation (`_oob`, `oob`, `c_i` or `d_m`).
  if (isTriggerLink(trimmed)) return 'triggerLink'
  if (trimmed === APPROVALS_LINK) return 'approvals'
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

/** The names a trigger link reserves in its fragment (dtgwg-vti-spec trigger links). */
const TRIGGER_NAMES = ['_from', '_id', '_exp', '_type']

/**
 * Whether `text` is a trigger link: an `https` (or `http`, or Keyring's own
 * `keyring:`) URL whose fragment carries one of the reserved names. Only the
 * fragment is read, as a trigger is never in the query. Nothing is checked
 * beyond that: it is enough to know the code is one Keyring can't use yet.
 */
export function isTriggerLink(text: string): boolean {
  if (!/^(https?|keyring):\/\//i.test(text)) return false
  const hash = text.indexOf('#')
  if (hash < 0) return false
  const names = new URLSearchParams(text.slice(hash + 1))
  return TRIGGER_NAMES.some((name) => names.has(name))
}

/**
 * What the scanner says of a trigger link. With sign-in off (the default) it
 * is the words the trigger-link spec gives a reader for a flow it does not
 * implement (outcome `update`), whatever the link. With it on, the link is
 * read, and a code that cannot be used says why (expired, can't be used, …).
 * Either way nothing is sent and nothing is logged. A sign-in the reader
 * accepts goes to the sign-in screen instead (`signInToOpen`).
 */
function triggerLinkError(text: string): KeyringLinkError {
  let ui: Exclude<TriggerUi, 'pass-on'> = 'update'
  if (triggerLinkSignInEnabled()) {
    const action = triggerAction(readTrigger(text, { channel: 'scan' }))
    if (action.kind === 'say' && action.ui !== 'pass-on') ui = action.ui
  }
  return new KeyringLinkError(TRIGGER_UI_MESSAGES[ui], undefined, TRIGGER_UI_MESSAGE_KEYS[ui])
}

/**
 * Whether a trigger link opens the sign-in screen: only with sign-in switched
 * on, and only for a code the reader accepts as a sign-in. Read offline;
 * nothing is sent until the person continues on that screen.
 */
function signInToOpen(text: string): boolean {
  if (!triggerLinkSignInEnabled()) return false
  const action = triggerAction(readTrigger(text, { channel: 'scan' }))
  return action.kind === 'proceed' && action.flow === 'sign-in'
}

/**
 * Whether a trigger link opens the agent-setup screen: an agent host's
 * one-scan code (`vta-claim`) the reader accepts. Read offline; nothing is
 * sent until the person continues on that screen.
 */
function vtaClaimToOpen(text: string): boolean {
  const action = triggerAction(readTrigger(text, { channel: 'scan' }))
  return action.kind === 'proceed' && action.flow === 'vta-claim'
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
    case 'busy':
      return 'The community is busy right now. Try again in a minute.'
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
 * Whether the phone is part-way through joining `communityDid`: it holds an
 * identity for it and is not yet a member. A failed read counts as under way,
 * so a ticket is never applied to the wrong join by mistake.
 */
async function joinUnderWay(agent: Agent, communityDid: string): Promise<boolean> {
  try {
    const persona = await new GenericRecordsIdentityStore(agent).getPersona(communityDid)
    if (!persona) return false
    const memberships = await new GenericRecordsCommunityStore(agent).listMemberships()
    return !memberships.some(
      (m) => m.communityDid === communityDid && sameIdentity(m.personaDid, persona.did) && isCurrentMembership(m)
    )
  } catch {
    return true
  }
}

/**
 * An agent scanned on a phone already linked to one: added beside it, as My
 * Agent's "Add another agent" does (several agents). The scan refused it
 * outright before, though the phone can hold several agents (feedback,
 * 10-05). The current agent is left, not forgotten; a link given up goes back
 * to it (`cancelLink`). One this phone already has is said so instead.
 */
async function makeRoomForAgent(vtaDid: string): Promise<boolean> {
  // Checked whatever the link is now (IN-132): after an "Add" the current
  // agent has been left, and the agent named may be the one left.
  if (vtaAgent.hasAgent(vtaDid)) {
    throw new KeyringLinkError(
      'This phone already has that agent. Switch to it on Your agent.',
      undefined,
      'VtaLink.FailedAlreadyLinked'
    )
  }
  if (vtaAgent.getState().link.kind !== 'linked') return false
  await vtaAgent.startAddingAgent()
  return true
}

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
    case 'other':
      // No REST endpoint, so it does not say it is an agent, but it is reached
      // through a mediator the way an agent linked by its address is: tried as
      // one. A mediator's own code is classified as a relay, never this.
      if (!kind.reachable) {
        throw new KeyringLinkError(
          "Keyring can't tell what this code is. If it's your agent, link it with “No code? Use your agent's address” on My Agent.",
          undefined,
          'Scan.UnknownCodeUseAddress'
        )
      }
    // falls through
    case 'agent': {
      const adding = await makeRoomForAgent(did)
      // Scanned or pasted: usually another phone's "Add another phone" code, so
      // this phone shows its own code for that phone to scan (#30).
      try {
        await vtaAgent.startManualLink(agent, did, didHost(did), {
          via: 'scan',
          // Not declared an agent: checked at once, and said if it is not one.
          ...(kind.kind === 'other' ? { probe: true } : {}),
        })
      } catch (error) {
        // The link screen never opened: the add it started is given up, and
        // the agent before comes back (IN-138).
        if (adding) vtaAgent.cancelLink()
        throw error
      }
      navigate('VtaLink')
      return
    }
    case 'ambiguous':
      throw new KeyringLinkError(
        'This code belongs to both an agent and a community. Ask whoever gave it to you which one it is.',
        undefined,
        'Scan.BothAgentAndCommunity'
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
  }
}

/** A screen a link lands on, inside the My Agent stack. Not SignIn: that one is reached only with its code (below). */
export type MyAgentScreenName =
  | 'VtaLink'
  | 'MyAgent'
  | 'VtaAgent'
  | 'VtaRequests'
  | 'VtiVetting'
  | 'VtiJoin'
  | 'VtiInvited'

/**
 * A scanned code, carried to its screen as the route's params: a sign-in, or an
 * agent host's one-scan setup. Each scan is its own screen (`scanId`, the
 * route's id): a second code scanned while one is on screen opens a new one,
 * and never shows the first one's code or result.
 */
export type ScannedCodeDestination = { screen: 'SignIn' | 'VtaClaim'; link: string; scanId: string }

/** Where a link lands, inside the My Agent stack. */
export type MyAgentDestination = MyAgentScreenName | ScannedCodeDestination

export const MY_AGENT_SCREEN: Record<MyAgentScreenName | ScannedCodeDestination['screen'], Screens> = {
  VtaLink: Screens.VtaLink,
  MyAgent: Screens.MyAgent,
  VtaAgent: Screens.VtaAgent,
  // What waits for the person's decision (VtaRequests).
  VtaRequests: Screens.VtaRequests,
  VtiVetting: Screens.VtiVetting,
  VtiJoin: Screens.VtiJoin,
  VtiInvited: Screens.VtiInvited,
  // A community sign-in code, read and accepted (trigger-link sign-in on).
  SignIn: Screens.SignIn,
  // An agent host's one-scan setup code, read and accepted.
  VtaClaim: Screens.VtaClaim,
}

/**
 * The My Agent stack's params for a link's destination. `initial: false` keeps
 * the stack's own first screen ("Your agent") under the screen a link opens.
 * Every tab unmounts on blur, so a link that arrived from another tab made that
 * screen the stack's only route: Join opened by a community link had no back,
 * and a press on the My Agent tab stayed on it (233). The first screen itself
 * goes without it, or it would sit on top of itself.
 */
export function myAgentLinkParams(destination: MyAgentDestination): {
  screen: Screens
  initial?: false
  params?: { link: string; scanId: string }
} {
  if (typeof destination !== 'string') {
    const { link, scanId } = destination
    return { screen: MY_AGENT_SCREEN[destination.screen], initial: false, params: { link, scanId } }
  }
  const screen = MY_AGENT_SCREEN[destination]
  return screen === agentHomeScreen() ? { screen } : { screen, initial: false }
}

/** A new id for each scan of a code: unique within this run of the app. */
let scans = 0
export function newScanId(): string {
  scans += 1
  return `${Date.now()}-${scans}`
}

/**
 * "I was invited" asks which community first — the admin invites an identity
 * made for a community, so the community has to be known before any
 * invitation exists. When it sends the person to the scanner for that, the
 * community link they bring should land back on "I was invited", not on Join.
 * One-shot: taken by the next community link, whoever brings it, and
 * cancelled when the scanner closes or "I was invited" is left without one:
 * left set, a later scan of a community for any other reason — a guide's
 * "scan the community DID to send a join request" — landed on "I was
 * invited" instead of Join (IN-304).
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
  /** The scanner closed, or "I was invited" was left: nothing is brought back there. */
  cancel(): void {
    communityLinkForInvited = false
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
    case 'agentHost': {
      let offer
      try {
        offer = parseAgentHostQr(trimmed)
      } catch (error) {
        if (error instanceof AgentHostConnectionError && error.reason === 'hostNotAllowed') {
          throw new KeyringLinkError(
            "This code is from a site Keyring doesn't connect to, so nothing was sent. Use the Admin DID option on your agent host's page instead."
          )
        }
        throw error
      }
      if (!offer)
        throw new KeyringLinkError("This agent host's code couldn't be read. Make a new one and scan it again.")
      await makeRoomForAgent(offer.vtaDid)
      vtaAgent.scanHostOffer(offer)
      navigate('VtaLink')
      return
    }
    case 'approvals':
      // Look at the other agents as well: the request a notification is for
      // may wait at one that is not current, and a tap made while Keyring is
      // open (the foreground banner) brings no return to the foreground to
      // look for it. With Requests already open, navigating again changes
      // nothing, so without this its row never came (IN-329).
      void vtaAgent.lookAtOtherAgents(agent).catch(() => undefined)
      navigate('VtaRequests')
      return
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
      // ticket's community is the one being joined. Only a join still under
      // way counts: a community left, removed from the phone, or already
      // joined stays remembered, and a member could never be vetted into a
      // second community (IN-144).
      let ticketCommunity: string | undefined
      try {
        ticketCommunity = parseTicketUri(trimmed).community
      } catch {
        // an unreadable ticket is reported by the vetting screen, where it is used
      }
      const chosen = communityTarget.getChosen()?.communityDid
      if (ticketCommunity && chosen && ticketCommunity !== chosen && (await joinUnderWay(agent, chosen))) {
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
      // Kept, and announced by the store: an open "I was invited" shows it.
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
    case 'triggerLink':
      if (signInToOpen(trimmed)) {
        navigate({ screen: 'SignIn', link: trimmed, scanId: newScanId() })
        return
      }
      if (vtaClaimToOpen(trimmed)) {
        navigate({ screen: 'VtaClaim', link: trimmed, scanId: newScanId() })
        return
      }
      throw triggerLinkError(trimmed)
    default:
      throw new Error('not a Keyring agent link')
  }
}
