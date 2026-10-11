/**
 * signInSteps — what the sign-in screen calls, behind one object, so the
 * screen is tested with fakes and the protocol stays in `oobSignIn`.
 *
 * `community` reads Keyring's own records only (no network): whether this
 * phone holds a current membership of the community, and the name it knows
 * it by. Every other step is a protocol call: `claim` (claimSignIn),
 * `identifyAndProve`, `approve` (approveSignIn) and `cancel` (cancelSignIn).
 *
 * @module trust-tasks/module/signInSteps
 */
import type { Agent } from '@credo-ts/core'
import { Platform } from 'react-native'

import {
  agentDidResolver,
  cancelSignIn,
  claimSignIn,
  httpsPost,
  SignInError,
  type ClaimedSignIn,
  type SignInDeps,
  type SignInFailure,
} from './oobSignIn'
import {
  approveSignIn,
  enrolUvKey,
  ensureSignInVaultEntry,
  identifyAndProve,
  signInAgentDeps,
  signInFailureFromAgent,
  type ProvedSignIn,
  type SignInAgentDeps,
} from './oobSignInAgent'
import { readTrigger, triggerAction } from './triggerLink'
import { vtaAgent } from './vtaAgent'
import { GenericRecordsCommunityStore, isCurrentMembership } from './VtiCommunityStore'
import { communityTarget } from './vtiCommunityLink'

export type { ProvedSignIn, SignInRequester } from './oobSignInAgent'

/** Every reason a sign-in can end without being approved, as the screen words them. */
export type SignInEndReason = SignInFailure

export type SignInSteps = {
  /** Local only: membership and the recorded name. Never reaches the network. */
  community: (vtcDid: string) => Promise<{ member: boolean; name?: string }>
  claim: (link: string) => Promise<ClaimedSignIn>
  identifyAndProve: (claimed: ClaimedSignIn, enteredNumber: string) => Promise<ProvedSignIn>
  approve: (proved: ProvedSignIn) => Promise<{ status: 'approved' }>
  cancel: (claimed: ClaimedSignIn) => Promise<{ cancelled: boolean }>
}

/** Whether this phone holds a current membership of `vtcDid`, and the name its records keep. */
async function recordedCommunity(agent: Agent, vtcDid: string): Promise<{ member: boolean; name?: string }> {
  const store = new GenericRecordsCommunityStore(agent)
  const memberships = await store.listMemberships()
  const member = memberships.some((m) => m.communityDid === vtcDid && isCurrentMembership(m))
  const name =
    communityTarget.publishedNameOf(vtcDid) ??
    (await store.listCommunityNames().catch(() => [])).find((n) => n.communityDid === vtcDid)?.name
  return { member, name }
}

/**
 * The member's agent for one community: the sign-in dependencies over a
 * signed-in client, and the persona with its vault entry (made if missing).
 * A phone not linked, or holding no persona there, is not a member to sign in.
 */
async function memberAgent(
  agent: Agent,
  vtcDid: string
): Promise<{ deps: SignInAgentDeps; persona: { did: string; entryId: string } }> {
  const session = await vtaAgent.signInSession(agent, vtcDid).catch((error: unknown) => {
    const reason = (error as { reason?: unknown } | null)?.reason
    if (reason === 'notLinked') throw new SignInError('notAMember', 'this phone is linked to no agent')
    throw signInFailureFromAgent(error)
  })
  if (!session.persona)
    throw new SignInError('notAMember', 'this phone holds no persona for the community on its agent')
  const deps = signInAgentDeps(agent, session.client, { platform: Platform.OS })
  const { did, contextId } = session.persona
  // The key as the persona's DID document names it: the form the live entry was proven with (findings G-section).
  const entryId = await ensureSignInVaultEntry(vtcDid, { did, contextId, signingKeyId: `${did}#key-0` }, deps)
  return { deps, persona: { did, entryId } }
}

/** The production steps, over the Credo agent and the phone's linked agent. */
export function agentSignInSteps(agent: Agent): SignInSteps {
  const claimDeps: SignInDeps = {
    resolveDid: agentDidResolver(agent),
    post: httpsPost,
    isKnownCommunity: async (vtcDid) => (await recordedCommunity(agent, vtcDid)).member,
  }
  let member: { vtcDid: string; deps: SignInAgentDeps } | undefined
  return {
    community: (vtcDid) => recordedCommunity(agent, vtcDid),
    claim: (link) => claimSignIn(link, claimDeps),
    identifyAndProve: async (claimed, enteredNumber) => {
      const { deps, persona } = await memberAgent(agent, claimed.vtcDid)
      member = { vtcDid: claimed.vtcDid, deps }
      return identifyAndProve(claimed, enteredNumber, { ...deps, persona })
    },
    approve: async (proved) => {
      const deps =
        member?.vtcDid === proved.claimed.vtcDid ? member.deps : (await memberAgent(agent, proved.claimed.vtcDid)).deps
      await enrolUvKey(deps)
      return approveSignIn(proved, deps)
    },
    cancel: (claimed) => cancelSignIn(claimed, claimDeps),
  }
}

/**
 * Who a scanned sign-in code is from, read offline — or why it can't be
 * used. The same reading `claimSignIn` does first, so the screen can name the
 * community before anything is sent.
 */
export function signInCommunityOf(
  link: string,
  now?: number
): { vtcDid: string; exp: number | null } | { reason: SignInEndReason } {
  const action = triggerAction(readTrigger(link, { now }))
  if (action.kind === 'proceed' && action.flow === 'sign-in') {
    return { vtcDid: action.trigger.from, exp: action.trigger.exp }
  }
  const ui = action.kind === 'say' ? action.ui : 'update'
  return { reason: ui === 'pass-on' ? 'invalid' : ui }
}

/** A thrown error's sign-in reason, when it carries one. Read by shape, so a later SignInError counts too. */
export function signInReasonOf(error: unknown): SignInEndReason | undefined {
  if (error instanceof SignInError) return error.reason
  const reason = (error as { name?: unknown; reason?: unknown } | null)?.reason
  if ((error as { name?: unknown } | null)?.name === 'SignInError' && typeof reason === 'string') {
    return reason as SignInEndReason
  }
  return undefined
}

/**
 * A sign-in code the scanner accepted, held until the sign-in screen reads it
 * (as `pendingVettingTicket` holds a vetter's ticket): the scanner's
 * navigation carries a destination, not params. Read during render, so a
 * double render reads it twice; the screen clears it once it has it.
 */
let pendingLink: string | undefined
export const pendingSignInLink = {
  set(link: string): void {
    pendingLink = link
  },
  peek(): string | undefined {
    return pendingLink
  },
  clear(): void {
    pendingLink = undefined
  },
}
