/**
 * What a community sends a persona, collected wherever the person is in the app.
 *
 * A vetter grant, a membership, an invitation's issue, a community's
 * invitation offer — each arrives as a
 * message to the persona's DID, and the mediator holds it until a session for
 * that DID collects it. Until 2026-09-22 only the Vetting screen and a join
 * in flight opened that session, so a grant issued while the person was
 * elsewhere sat at the mediator: the seat stayed "being vetted" until they
 * happened to open Vetting (measured: the community's outbox sent it, and the
 * phone showed nothing until Vetting was opened once).
 *
 * `startPersonaInbox` keeps the persona's session open from unlock and stores
 * what arrives, the same way Vetting does. It never takes the session from
 * anything else: `vtiAgent` holds one session, so when some flow has opened it
 * (a join, Vetting, a community connect) the inbox only listens, and it
 * reconnects as the persona only when nothing is open.
 */
import type { Agent } from '@credo-ts/core'
import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'
import { useEffect, useState } from 'react'
import { DeviceEventEmitter } from 'react-native'

import { VTI_PERSONA_DELIVERIES_EVENT, VTI_PERSONA_KEYS_HELD_EVENT } from './communityChanged'
import { currentAgentDid } from './currentAgent'
import { GenericRecordsCommunityStore } from './VtiCommunityStore'
import { GenericRecordsIdentityStore, type VtiPersona } from './VtiIdentityStore'
import { holdForStatusCheck } from './vtiCardStatusRetry'
import { cardRef, deliveredCardCheck, VtiCardStatusUnreadable } from './vtiDeliveredCheck'
import { receiveCommunityNotice, REMOVAL_NOTICE, SUBMIT_RECEIPT } from './vtiCommunityNotices'
import { receiveIssue, type VtiReceivedCredential } from './vtiInbox'
import { REQUEST_VMC } from './vtiMemberVmc'
import { receiveRequestVmc, reciprocateIfOwed } from './vtiReciprocate'
import { invitationOfferOfMessage, redeemInvitationOffer, VtiInvitationOfferError } from './vtiInvitationOffer'
import { didPrefix } from './didPrefix'
import { releaseWarn } from './releaseLog'
import { vtiAgent } from './vtiAgent'
import { vtaAgent } from './vtaAgent'
import { refusedAsNotOnAcl } from './VtaClient'
import { KeyCopyUnavailable } from './EphemeralKeyManagementService'
import { GenericRecordsTspPeerRevisionStore } from './vtiTsp'
import { GenericRecordsVettingStore, VtiApplicant } from './vtiVetting'

/** Emitted with `{ communityDid, kinds }` whenever the inbox stores something. */
export { VTI_PERSONA_DELIVERIES_EVENT }

export interface PersonaInboxOptions {
  /** Fallback only: a persona is reached through the mediator its own DID document names. */
  mediatorDid?: string
  /** The community whose persona to listen as; the most recent persona when absent. */
  communityDid?: string
  /** How often to look again for a persona or a closed session. */
  intervalMs?: number
  onError?: (error: unknown) => void
}

async function personaFor(agent: Agent, communityDid?: string): Promise<VtiPersona | undefined> {
  const identity = new GenericRecordsIdentityStore(agent)
  if (communityDid) return (await identity.getPersona(communityDid)) ?? undefined
  // The latest of the identities under the agent this phone acts with now, as
  // getPersona answers for one community. Another agent's persona cannot sign
  // in here: its key is borrowed only while that agent is connected (IN-114:
  // the second agent current, the first agent's persona tried, key not found).
  const vtaDid = currentAgentDid()
  const all = (await identity.listPersonas()).filter((p) => !vtaDid || p.vtaDid === vtaDid)
  return all.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0]
}

/** The messages this inbox takes: a community's notices, a delivered credential, an invitation offer. */
function ownedByInbox(message: { type?: unknown; body?: unknown }): boolean {
  const type = String(message.type ?? '')
  return (
    type === REMOVAL_NOTICE ||
    type === SUBMIT_RECEIPT ||
    type === REQUEST_VMC ||
    type.startsWith('https://trusttasks.org/spec/credential-exchange/issue/') ||
    Boolean(invitationOfferOfMessage(message as never))
  )
}

/**
 * Keep what a community sent one of this phone's identities: a removal notice
 * or a join receipt applied, an invitation offer taken, a card kept. The same
 * for the shared session's identity (the inbox below) and for every other
 * identity's listener (vtiIdentityListeners). Throws when the message should
 * stay on the mediator for another try.
 */
export async function keepForPersona(
  agent: Agent,
  target: VtiPersona,
  message: DidCommV2PlaintextMessage,
  options: Pick<PersonaInboxOptions, 'onError'> = {}
): Promise<void> {
  const community = new GenericRecordsCommunityStore(agent)
  const vetting = new GenericRecordsVettingStore(agent)
  // The community removed this persona, or received its join request: applied
  // once checked (vtiCommunityNotices), and nothing else to do with it.
  if (message.type === REMOVAL_NOTICE || message.type === SUBMIT_RECEIPT) {
    return receiveCommunityNotice(agent, community, target.did, message).then(async (outcome) => {
      // A removal ends what was gathered to join, too: joining again is a new
      // identity, and a new application (IN-104).
      if (outcome === 'removed') await vetting.forgetApplication(target.communityDid).catch(() => undefined)
      if (outcome === 'removed' || outcome === 'acknowledged')
        DeviceEventEmitter.emit(VTI_PERSONA_DELIVERIES_EVENT, {
          communityDid: target.communityDid,
          kinds: [outcome],
        })
    })
  }
  // The community asking for this member's acknowledgement again (vtc/members/request-vmc/0.1).
  if (message.type === REQUEST_VMC) {
    await receiveRequestVmc(agent, community, target, message)
    return
  }
  // A community admin console's Send: an offer of the invitation, redeemed
  // here for the invitation itself, which "I was invited" then joins with.
  const offer = invitationOfferOfMessage(message)
  if (offer) return takeInvitationOffer(agent, community, target, offer, options)
  // Returned: stored before the mediator is told it was taken (vtiAgent.onInbound).
  // A statement is kept only through the applicant's full check.
  const acceptStatement = (m: typeof message) => new VtiApplicant(agent, target, vetting, community).receiveStatement(m)
  const onRefused = (item: VtiReceivedCredential, refusal: string) =>
    agent.config?.logger?.warn?.(`[VTI] delivered ${item.kind} credential not kept (${refusal})`, {
      from: String(message.from ?? ''),
    })
  const onFiled = (item: VtiReceivedCredential) =>
    agent.config?.logger?.info?.(`[VTI] card filed: ${cardRef(item.credential)} as ${item.kind}`)
  return receiveIssue(community, target.did, message, {
    acceptStatement,
    onRefused,
    onFiled,
    checkCard: deliveredCardCheck(agent),
  }).then(
    (got: VtiReceivedCredential[]) => {
      // A membership card kept: the member's half of the pair goes back (vtc/members/vmc/0.1).
      if (got.some((c) => c.kind === 'membership'))
        void reciprocateIfOwed(agent, community, target, target.communityDid)
      if (got.length) {
        DeviceEventEmitter.emit(VTI_PERSONA_DELIVERIES_EVENT, {
          communityDid: target.communityDid,
          kinds: got.map((c) => c.kind),
        })
      }
    },
    (e) => {
      // A card whose status list could not be read stays off the mediator for
      // redelivery as before, and is now also tried again here and said on the
      // community's card (IN-258). The check is the same either way.
      if (e instanceof VtiCardStatusUnreadable) {
        holdForStatusCheck(`${target.communityDid}|${String(message.id ?? '')}`, {
          communityDid: target.communityDid,
          host: e.host,
          retry: () => keepForPersona(agent, target, message, options),
        })
      }
      options.onError?.(e)
      throw e
    }
  )
}

/** A look that has been busy this long says so: something it waits on has not settled. */
export const PERSONA_INBOX_STUCK_MS = 60_000

/** Start collecting; returns the function that stops it. */
/**
 * vtiAgent's `VtiSessionHeld`: a look's background sign-in refused because a step keeps the session as another
 * identity. Read by name, so a suite that mocks vtiAgent need not carry the class; the literal must match the one its
 * constructor sets (pinned in sharedSessionHolds.test.ts), which a minified build keeps.
 */
const isSessionKept = (e: unknown): boolean => e instanceof Error && e.name === 'VtiSessionHeld'

export function startPersonaInbox(agent: Agent, options: PersonaInboxOptions): () => void {
  // Before the first look signs in: a persona's key copy is borrowed into
  // memory and gone after an install or restart, and only the fetcher can get
  // it back. Left to the VTA controller's `restore`, it was installed after
  // this inbox's first sign-in on a fresh install (#422).
  vtaAgent.installKeyFetcher(agent)
  const peerRevisionStore = new GenericRecordsTspPeerRevisionStore(agent)
  let persona: VtiPersona | undefined
  let stopped = false
  let busy = false
  // A look asked for while one was running: run it once that one is done.
  let again = false
  // A look that met someone else's sign-in in flight: run it once that settles.
  let afterAgent = false
  // When the running look began, and whether it has already said it is stuck.
  let busySince = 0
  let saidStuck = false
  // Why the last look did not open the session. Said in the Release log when it
  // changes, so an inbox that never opens says why once, not every 30 s (227
  // gate, Farm: the invitation push never reached the phone, and the inbox
  // left no line at all).
  let lastWhy = ''
  const said = (why: string) => {
    if (why === lastWhy) return
    lastWhy = why
    const { status, did } = vtiAgent.getState()
    releaseWarn(
      `[VTI] persona inbox (${options.communityDid ? didPrefix(options.communityDid) : 'latest persona'}): ${why}; ` +
        `persona ${persona ? didPrefix(persona.did) : 'none'}, keyAgreement ${persona?.kmsKeyIds?.keyAgreement ? 'yes' : 'no'}, ` +
        `session ${vtiAgent.isConnected ? `open as ${did ? didPrefix(did) : '?'}` : 'closed'}, status ${status}`
    )
  }

  // Registered before any connect: opening the session drains what the
  // mediator held, and a listener attached after the connect misses that
  // backlog for good (the measurement in VtiVetting's inbox effect).
  const stopListening = vtiAgent.onInbound(async (message) => {
    // Only for the persona the session is connected as: another flow may hold
    // it as a different identity (a join as a new persona, a community
    // connect), and what arrives then is not this persona's to store. A message
    // this inbox would have taken says why it was skipped: silence looks
    // exactly like a message that never came (lab, 2026-09-29).
    const owned = ownedByInbox(message)
    const skipped = (why: string) => {
      if (!owned) return
      agent.config?.logger?.warn?.(
        `[VTI] persona inbox skipped ${String(message.type ?? '')} from ${didPrefix(message.from)}: ${why}`
      )
    }
    // What waited at the mediator is drained the moment the socket opens, and
    // can arrive before this inbox's first look has read its persona (227.1).
    const target = persona ?? (persona = await personaFor(agent, options.communityDid))
    // Whose the session is: connected as, or signing in as while the backlog
    // drains — before `did` is set. Skipped then, a message was acknowledged
    // and lost (227.1: five invitation offers; a vetter grant, 227 gate).
    const { did, signingInAs } = vtiAgent.getState()
    const sessionDid = did ?? signingInAs
    if (owned && !sessionDid) {
      // Not taken, so not acknowledged: the mediator keeps it for the next drain.
      throw new Error(
        `[VTI] persona inbox: ${String(message.type ?? '')} from ${didPrefix(message.from)} not taken yet: the session's identity is not known`
      )
    }
    // Kept for whichever of this phone's identities the session is: the other
    // identities each have a listener, which steps aside while the session
    // holds theirs (vtiIdentityListeners), so this is where theirs arrive then.
    const holder =
      target?.did === sessionDid
        ? target
        : sessionDid
          ? (await new GenericRecordsIdentityStore(agent).listPersonas().catch(() => [])).find(
              (p) => p.did === sessionDid
            )
          : undefined
    if (!holder)
      return skipped(
        target
          ? `the session is ${sessionDid ? didPrefix(sessionDid) : 'not connected'}, not an identity of this phone`
          : `no persona for ${options.communityDid ? didPrefix(options.communityDid) : 'any community'}`
      )
    return keepForPersona(agent, holder, message, options)
  })

  const tick = async (): Promise<void> => {
    if (stopped) return
    if (busy) {
      again = true
      if (!saidStuck && Date.now() - busySince > PERSONA_INBOX_STUCK_MS) {
        saidStuck = true
        const { status } = vtiAgent.getState()
        releaseWarn(
          `[VTI] persona inbox: a look has been running ${Math.round((Date.now() - busySince) / 1000)} s ` +
            `(status ${status}); later looks wait for it`
        )
      }
      return
    }
    busy = true
    busySince = Date.now()
    saidStuck = false
    again = false
    try {
      persona = await personaFor(agent, options.communityDid)
      if (!persona) return said('no persona for this community yet')
      if (!persona.kmsKeyIds?.keyAgreement) return said("the persona's key-agreement key is not borrowed yet")
      // Only when nothing holds the session: never take it from a flow that
      // opened it on purpose.
      const { status, did } = vtiAgent.getState()
      if (vtiAgent.isConnected)
        return said(
          did === persona.did
            ? 'listening (the session is this persona)'
            : 'listening only: another identity holds the session'
        )
      if (status === 'resolving' || status === 'authenticating') {
        // Another sign-in is running (after an unlock, the inbox that just
        // stopped): this look is not dropped but waits for it (228 lab check).
        afterAgent = true
        return said('waiting for a sign-in already running')
      }
      said('signing in as the persona')
      // A look is a poll: it never takes the session from a step holding it as another identity (VtiSessionHeld).
      const signIn = (who: VtiPersona) =>
        vtiAgent.connect(agent, options.mediatorDid, { persona: who, peerRevisionStore, background: true })
      try {
        await signIn(persona)
      } catch (e) {
        if (isSessionKept(e)) return said('listening only: another identity keeps the session')
        if (!isMissingKeyCopy(e)) throw e
        // The persona's borrowed key is not in memory (an install, a restart,
        // a lock). Borrow it again through its agent and sign in once more; if
        // the agent cannot be reached, say that, not "this persona is broken".
        said('its borrowed key is not in memory; borrowing it again')
        try {
          await vtaAgent.refetchPersonaKeys(agent, persona)
        } catch (fetchError) {
          throw new PersonaAgentUnreachable(persona, fetchError)
        }
        await signIn(persona)
      }
      setAgentState(persona, undefined)
      said('signed in')
    } catch (e) {
      // Kept by a step after the key was borrowed again: not a failure.
      if (isSessionKept(e)) return said('listening only: another identity keeps the session')
      if (e instanceof PersonaAgentUnreachable && persona) setAgentState(persona, e)
      said(`sign-in failed: ${e instanceof Error ? e.message : String(e)}`)
      options.onError?.(e)
    } finally {
      busy = false
    }
    if (again) return tick()
  }

  // After an unlock the identity's keys come back a moment after the agent
  // does; a sign-in before then cannot sign, and waiting for the next look
  // left messages unread for ~30 s (227 gate). Look again when they are back.
  const keysHeld = DeviceEventEmitter.addListener(VTI_PERSONA_KEYS_HELD_EVENT, (e: { did?: string }) => {
    if (!persona || e?.did === persona.did) void tick()
  })

  const stopWatchingAgent = vtiAgent.subscribe(() => {
    const { status } = vtiAgent.getState()
    if (!afterAgent || status === 'resolving' || status === 'authenticating') return
    afterAgent = false
    void tick()
  })

  void tick()
  const timer = setInterval(() => void tick(), options.intervalMs ?? 30_000)
  return () => {
    stopped = true
    clearInterval(timer)
    keysHeld.remove()
    stopWatchingAgent()
    stopListening()
  }
}

/**
 * Redeem a pushed invitation offer and keep the invitation. Safe to run twice:
 * the message comes back when a handler fails, and a code already redeemed is
 * answered 404, so only a community that could not be reached leaves the
 * message on the mediator for another try. Anything else is logged and let go.
 */
async function takeInvitationOffer(
  agent: Agent,
  community: GenericRecordsCommunityStore,
  persona: VtiPersona,
  offer: NonNullable<ReturnType<typeof invitationOfferOfMessage>>,
  options: Pick<PersonaInboxOptions, 'onError'>
): Promise<void> {
  const logger = agent.config?.logger
  if (offer.communityDid !== persona.communityDid) {
    logger?.warn?.(
      `[VTI] invitation offer from ${offer.communityDid} reached the identity for ${persona.communityDid}; not taken`
    )
    return
  }
  try {
    const invitation = await redeemInvitationOffer(agent, offer, persona)
    await community.saveInvitation(invitation)
    DeviceEventEmitter.emit(VTI_PERSONA_DELIVERIES_EVENT, { communityDid: persona.communityDid, kinds: ['invitation'] })
  } catch (e) {
    if (e instanceof VtiInvitationOfferError && e.reason === 'unreachable') {
      options.onError?.(e)
      throw e
    }
    logger?.warn?.(`[VTI] invitation offer not taken: ${(e as Error).message}`)
  }
}

/** Whether a sign-in failed because a borrowed key copy is not in memory (#422). */
export function isMissingKeyCopy(error: unknown): boolean {
  if (error instanceof KeyCopyUnavailable) return true
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /not found in backend 'ephemeral'|in-memory copy of .* could not be fetched/.test(message)
}

/**
 * A persona could not sign in because its borrowed key could not be fetched
 * again: its agent refused this phone, did not answer, or is no longer linked.
 * What the person can do depends on which, and none of them is a persona that
 * is broken, so it is said as its own state (#422). A refusal is told apart
 * by the VTA's own ACL words; the error only ever comes from this phone's
 * agent (borrowing the key again), never from a community (IN-350).
 */
export class PersonaAgentUnreachable extends Error {
  /**
   * `refused` when the agent no longer accepts this phone (not, or no longer,
   * on its ACL); `notLinked` when it is no longer linked to this phone; else
   * `unreachable`.
   */
  readonly kind: 'refused' | 'unreachable' | 'notLinked'
  constructor(
    readonly persona: Pick<VtiPersona, 'did' | 'communityDid'>,
    readonly fetchError: unknown
  ) {
    const reason = fetchError instanceof Error ? fetchError.message : String(fetchError)
    super(`this identity's agent could not be reached to borrow its key again: ${reason}`)
    this.name = 'PersonaAgentUnreachable'
    this.kind = refusedAsNotOnAcl(fetchError)
      ? 'refused'
      : /no longer linked/.test(reason)
        ? 'notLinked'
        : 'unreachable'
  }
}

/** Said when a community's identity's agent cannot be reached, or can again (`undefined`). */
export const VTI_PERSONA_AGENT_STATE_EVENT = 'vti:persona-agent-state'
const agentStates = new Map<string, PersonaAgentUnreachable>()

function setAgentState(persona: Pick<VtiPersona, 'communityDid'>, state: PersonaAgentUnreachable | undefined): void {
  const key = persona.communityDid
  if (!key || (state === undefined && !agentStates.has(key))) return
  if (state) agentStates.set(key, state)
  else agentStates.delete(key)
  try {
    DeviceEventEmitter.emit(VTI_PERSONA_AGENT_STATE_EVENT, { communityDid: key, unreachable: state?.kind })
  } catch {
    // A listener's failure is the listener's.
  }
}

/** Whether `communityDid`'s identity is waiting on its agent to be reconnected, and why. */
export function personaAgentState(communityDid: string): PersonaAgentUnreachable | undefined {
  return agentStates.get(communityDid)
}

/** The same, for a screen: re-read whenever the inbox says it changed. */
export function usePersonaAgentState(communityDid: string | undefined): PersonaAgentUnreachable | undefined {
  const [state, setState] = useState(() => (communityDid ? personaAgentState(communityDid) : undefined))
  useEffect(() => {
    if (!communityDid) return setState(undefined)
    setState(personaAgentState(communityDid))
    const sub = DeviceEventEmitter.addListener(VTI_PERSONA_AGENT_STATE_EVENT, (e: { communityDid?: string }) => {
      if (e?.communityDid === communityDid) setState(personaAgentState(communityDid))
    })
    return () => sub.remove()
  }, [communityDid])
  return state
}

/** Run the persona inbox while the app is unlocked and an agent exists. */
export function useVtiPersonaInbox(agent: Agent | undefined, options: Partial<PersonaInboxOptions>): void {
  const { mediatorDid, communityDid, onError } = options
  useEffect(() => {
    if (!agent) return
    return startPersonaInbox(agent, { mediatorDid, communityDid, onError })
  }, [agent, mediatorDid, communityDid, onError])
}

/** Call `refresh` whenever the inbox stores something (for `communityDid`, when given). */
export function useVtiPersonaDeliveries(refresh: () => void, communityDid?: string): void {
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(VTI_PERSONA_DELIVERIES_EVENT, (e: { communityDid?: string }) => {
      if (!communityDid || !e?.communityDid || e.communityDid === communityDid) refresh()
    })
    return () => sub.remove()
  }, [refresh, communityDid])
}
