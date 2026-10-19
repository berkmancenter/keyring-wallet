/**
 * signInSteps — what the sign-in screen calls, behind one object, so the
 * screen is tested with fakes and the protocol stays in `oobSignIn`.
 *
 * `community` reads Keyring's own records: whether this phone holds a
 * current membership of the community, and the name it knows it by. Only for
 * a member with no name on record does it read the name the community
 * publishes; for any other community nothing goes out before Continue. It also
 * finds every identity the phone could sign in as (IN-296): a persona any of
 * its linked agents holds for the community, from that agent's own vault
 * (`vault/list`, matched here), not only one joined on this phone — the
 * browser plugin's memberships too. Only the agents are asked, never the
 * community. Every other step is a protocol call: `claim` (claimSignIn),
 * `identifyAndProve`, `approve` (approveSignIn) and `cancel` (cancelSignIn),
 * through whichever agent holds the identity.
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
import type { VtaVaultEntry } from './VtaClient'
import { vtaAgent } from './vtaAgent'
import { GenericRecordsCommunityStore, isCurrentMembership } from './VtiCommunityStore'
import { GenericRecordsIdentityStore, type VtiPersona } from './VtiIdentityStore'
import { readPublicProfileName } from './vtiAgent'
import { communityTarget } from './vtiCommunityLink'

export type { ProvedSignIn, SignInRequester } from './oobSignInAgent'

/** Every reason a sign-in can end without being approved, as the screen words them. */
export type SignInEndReason = SignInFailure

/**
 * An identity this phone can sign in to a community as (IN-296): a persona one
 * of its linked agents holds there, and which agent holds it.
 */
export type SignInIdentity = {
  /** The agent that holds the persona, and what this phone calls it. */
  vtaDid: string
  agentName: string
  /** Whether that agent is the one this phone acts with now. */
  current: boolean
  /** The persona's DID, and the VTA context its keys live in. */
  did: string
  contextId: string
  /** Its sign-in vault entry, when the agent has one already. */
  entryId?: string
  /** The persona's name, when known: this phone's record, else the vault entry's label. */
  label?: string
  /** Joined on this phone, or found on the agent only (made elsewhere: the browser plugin, another phone). */
  source: 'thisPhone' | 'agent'
}

export type SignInSteps = {
  /**
   * Membership and the recorded name; the published name only for a member with none on record. `identities`:
   * every identity the phone could sign in as, the current agent's first. A community where it holds any is one
   * it is a member of.
   */
  community: (vtcDid: string) => Promise<{ member: boolean; name?: string; identities?: SignInIdentity[] }>
  claim: (link: string) => Promise<ClaimedSignIn>
  /** `identity`: the one the person chose; the first found when none was chosen. */
  identifyAndProve: (claimed: ClaimedSignIn, enteredNumber: string, identity?: SignInIdentity) => Promise<ProvedSignIn>
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
    (await store.listCommunityNames().catch(() => [])).find((n) => n.communityDid === vtcDid)?.name ??
    // A community this phone is a member of but has no name on record for:
    // the one it publishes, read once, so it is not shown as a raw DID
    // (IN-249). Only for a member: before the person continues, nothing is
    // resolved for a community the phone does not know (VTI-LNK-050, 051).
    (member ? await publishedName(agent, vtcDid) : undefined)
  return { member, name }
}

/** The name a community's public profile gives it, or undefined (unreachable, unnamed, not answered in 3 s). */
async function publishedName(agent: Agent, vtcDid: string): Promise<string | undefined> {
  try {
    const doc = await agent.dids.resolveDidDocument(vtcDid)
    const service = doc.service?.find((s) => s.type === 'VTCRest')
    const base = typeof service?.serviceEndpoint === 'string' ? service.serviceEndpoint : undefined
    return base ? await readPublicProfileName(base, vtcDid) : undefined
  } catch {
    return undefined
  }
}

const isDidSelfIssued = (kind: unknown) => kind === 'did-self-issued' || kind === 'didSelfIssued'

/**
 * Every identity for `vtcDid` among what the phone and its agents hold, the
 * current agent's first and the phone's own before the agent's: the personas
 * this phone joined with (on any linked agent), and each agent's active
 * self-issued vault entries whose targets name the community, matched here as
 * the browser plugin matches them (VTI-LNK-073). `entries` is undefined for an
 * agent that could not be asked: its personas on this phone still count.
 */
export function signInIdentitiesFrom(
  vtcDid: string,
  agents: { vtaDid: string; name: string; current: boolean }[],
  personas: Pick<VtiPersona, 'communityDid' | 'vtaDid' | 'did' | 'contextId' | 'label'>[],
  entries: Record<string, VtaVaultEntry[] | undefined>
): SignInIdentity[] {
  const found: SignInIdentity[] = []
  for (const a of agents) {
    const forCommunity = (entries[a.vtaDid] ?? []).filter(
      (e) =>
        isDidSelfIssued(e.secretKind) &&
        (e.status === undefined || e.status === 'active') &&
        Boolean(e.principalDid && e.contextId) &&
        (e.targets ?? []).some((t) => t.kind === 'did' && t.did === vtcDid)
    )
    const held = { vtaDid: a.vtaDid, agentName: a.name, current: a.current }
    for (const p of personas.filter((p) => p.communityDid === vtcDid && p.vtaDid === a.vtaDid)) {
      const entry = forCommunity.find((e) => e.principalDid === p.did)
      found.push({
        ...held,
        did: p.did,
        contextId: p.contextId,
        entryId: entry?.id,
        label: p.label,
        source: 'thisPhone',
      })
    }
    for (const e of forCommunity) {
      if (found.some((f) => f.vtaDid === a.vtaDid && f.did === e.principalDid)) continue
      found.push({
        ...held,
        did: e.principalDid as string,
        contextId: e.contextId as string,
        entryId: e.id,
        label: e.label,
        source: 'agent',
      })
    }
  }
  return found
}

/** How long one agent is given to list its vault before the sign-in goes on without it. */
export const VAULT_LIST_WAIT_MS = 8000

/** Every identity this phone could sign in to `vtcDid` as: its own records and each linked agent's vault. */
async function findIdentities(agent: Agent, vtcDid: string): Promise<SignInIdentity[]> {
  const agents = await vtaAgent.linkedAgents(agent).catch(() => [])
  if (!agents.length) return []
  const personas = await new GenericRecordsIdentityStore(agent).listPersonas().catch(() => [])
  const listed = await Promise.all(
    agents.map(async ({ vtaDid }) => {
      const list = vtaAgent.withAgentSession(agent, vtaDid, (client) => client.vaultList({}))
      let timer: ReturnType<typeof setTimeout> | undefined
      const late = new Promise<undefined>(
        (resolve) => (timer = setTimeout(() => resolve(undefined), VAULT_LIST_WAIT_MS))
      )
      const entries = await Promise.race([list.catch(() => undefined), late]).finally(() => clearTimeout(timer))
      if (!entries)
        agent.config?.logger?.info?.(`[SignIn] ${vtaDid.slice(0, 32)}… did not list its vault; its own personas only`)
      return [vtaDid, entries] as const
    })
  )
  return signInIdentitiesFrom(vtcDid, agents, personas, Object.fromEntries(listed))
}

/**
 * `use` with the member's agent for one identity: the sign-in dependencies
 * over a session with the agent that holds it, and the persona with its vault
 * entry (made if missing). A phone linked to that agent no longer is not a
 * member to sign in.
 */
async function withMember<T>(
  agent: Agent,
  vtcDid: string,
  identity: SignInIdentity,
  use: (deps: SignInAgentDeps, persona: { did: string; entryId: string }) => Promise<T>
): Promise<T> {
  const asMember = (error: unknown): never => {
    if (error instanceof SignInError) throw error
    const reason = (error as { reason?: unknown } | null)?.reason
    if (reason === 'notLinked') throw new SignInError('notAMember', "this phone is not linked to the persona's agent")
    throw signInFailureFromAgent(error)
  }
  return vtaAgent
    .withAgentSession(agent, identity.vtaDid, async (client) => {
      const deps = signInAgentDeps(agent, client, { platform: Platform.OS })
      const { did, contextId } = identity
      // The key as the persona's DID document names it: the form the live entry was proven with (findings G-section).
      const entryId =
        identity.entryId ??
        (await ensureSignInVaultEntry(vtcDid, { did, contextId, signingKeyId: `${did}#key-0` }, deps))
      return use(deps, { did, entryId })
    })
    .catch(asMember)
}

/** The production steps, over the Credo agent and the phone's linked agent. */
export function agentSignInSteps(agent: Agent): SignInSteps {
  // Found once per community and kept for the rest of the sign-in: the gate, the picker, identify and approve.
  const identities = new Map<string, Promise<SignInIdentity[]>>()
  const identitiesFor = (vtcDid: string) => {
    if (!identities.has(vtcDid)) identities.set(vtcDid, findIdentities(agent, vtcDid))
    return identities.get(vtcDid) as Promise<SignInIdentity[]>
  }
  const community = async (vtcDid: string) => {
    const [recorded, found] = await Promise.all([recordedCommunity(agent, vtcDid), identitiesFor(vtcDid)])
    return { ...recorded, member: recorded.member || found.length > 0, identities: found }
  }
  const claimDeps: SignInDeps = {
    resolveDid: agentDidResolver(agent),
    post: httpsPost,
    isKnownCommunity: async (vtcDid) => (await community(vtcDid)).member,
  }
  const chosenFor = async (vtcDid: string, identity?: SignInIdentity) => {
    const chosen = identity ?? (await identitiesFor(vtcDid))[0]
    if (!chosen) throw new SignInError('notAMember', 'no linked agent holds a persona for the community')
    return chosen
  }
  let member: { vtcDid: string; identity: SignInIdentity } | undefined
  return {
    community,
    claim: (link) => claimSignIn(link, claimDeps),
    identifyAndProve: async (claimed, enteredNumber, identity) => {
      const chosen = await chosenFor(claimed.vtcDid, identity)
      member = { vtcDid: claimed.vtcDid, identity: chosen }
      return withMember(agent, claimed.vtcDid, chosen, (deps, persona) =>
        identifyAndProve(claimed, enteredNumber, { ...deps, persona })
      )
    },
    approve: async (proved) => {
      const vtcDid = proved.claimed.vtcDid
      const chosen = member?.vtcDid === vtcDid ? member.identity : await chosenFor(vtcDid)
      // The persona's own entry, as identify found or made it.
      return withMember(agent, vtcDid, { ...chosen, entryId: proved.persona.entryId }, async (deps) => {
        await enrolUvKey(deps)
        return approveSignIn(proved, deps)
      })
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
