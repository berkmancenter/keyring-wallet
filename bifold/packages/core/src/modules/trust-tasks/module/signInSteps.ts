/**
 * signInSteps — what the sign-in screen calls, behind one object, so the
 * screen is tested with fakes and the protocol stays in `oobSignIn`.
 *
 * `community` reads Keyring's own records: whether this phone holds a
 * current membership of the community, and the name it knows it by. For a
 * community the person belongs to (on this phone or on a linked agent) whose
 * name on record is missing or over a day old, it reads the name the community
 * publishes again; for any other community nothing goes out before Continue. It also
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
  approveSignInWithUvKey,
  ensureSignInVaultEntry,
  identifyAndProve,
  KEYRING_SIGN_IN_LABEL,
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

/** How long a community's name on record is taken as it is, before a sign-in reads it again (IN-340). */
export const COMMUNITY_NAME_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Whether this phone holds a current membership of `vtcDid`, and the name to
 * show for it.
 *
 * A community the person belongs to (this phone's own membership, or an
 * identity a linked agent holds there, `heldOnAgent`) has its published name
 * read again when the one on record is missing or over a day old, and kept:
 * a community that published a name after the person joined, or renamed
 * itself, read as unnamed, or by its old name, for good (IN-340). The same
 * allowance as IN-249's: before the person continues, nothing is resolved for
 * a community they do not belong to (VTI-LNK-050, 051). A read that fails
 * keeps the name on record.
 */
async function recordedCommunity(
  agent: Agent,
  vtcDid: string,
  heldOnAgent = false
): Promise<{ member: boolean; name?: string }> {
  const store = new GenericRecordsCommunityStore(agent)
  const memberships = await store.listMemberships()
  const member = memberships.some((m) => m.communityDid === vtcDid && isCurrentMembership(m))
  const kept = (await store.listCommunityNames().catch(() => [])).find((n) => n.communityDid === vtcDid)
  const keptAt = kept?.at ? Date.parse(kept.at) : NaN
  const stale = !kept || !(Date.now() - keptAt < COMMUNITY_NAME_TTL_MS)
  const fresh = (member || heldOnAgent) && stale ? await publishedName(agent, vtcDid) : undefined
  if (fresh) {
    communityTarget.publishedName(vtcDid, fresh)
    await store.saveCommunityName(vtcDid, fresh).catch(() => undefined)
  }
  const name = fresh ?? communityTarget.publishedNameOf(vtcDid) ?? kept?.name
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

/** An entry Keyring made itself when a phone signed in (its label says so). */
const keyringMade = (e: VtaVaultEntry) =>
  typeof e.label === 'string' && e.label.startsWith(`${KEYRING_SIGN_IN_LABEL} · `)

/** Why each agent's entries were or were not offered, for the device log. */
export type SignInIdentityCounts = Record<string, { listed: number; matched: number; keyringMadeDropped: number }>

/**
 * Every identity for `vtcDid` among what the phone and its agents hold, the
 * current agent's first and the phone's own before the agent's: the personas
 * this phone joined with (on any linked agent), and each agent's active
 * self-issued vault entries whose targets name the community, matched here as
 * the browser plugin matches them (VTI-LNK-073). `entries` is undefined for an
 * agent that could not be asked: its personas on this phone still count.
 *
 * One identity per persona: a persona this phone joined with and its own
 * sign-in entry are the same one. An entry Keyring made for a persona this
 * phone did not join with is not offered (IN-296, gate 1019-1815): on an agent
 * several phones have signed in through, those are other phones' — most often
 * members long gone, which only the community could tell apart, and it is not
 * asked before Continue. Entries made elsewhere (the browser plugin) are. An
 * entry's label is shown only when it names the persona, never the community.
 */
export function signInIdentitiesFrom(
  vtcDid: string,
  agents: { vtaDid: string; name: string; current: boolean }[],
  personas: Pick<VtiPersona, 'communityDid' | 'vtaDid' | 'did' | 'contextId' | 'label'>[],
  entries: Record<string, VtaVaultEntry[] | undefined>,
  counts?: SignInIdentityCounts
): SignInIdentity[] {
  const found: SignInIdentity[] = []
  for (const a of agents) {
    const listed = entries[a.vtaDid] ?? []
    const forCommunity = listed.filter(
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
    let dropped = 0
    for (const e of forCommunity) {
      if (found.some((f) => f.vtaDid === a.vtaDid && f.did === e.principalDid)) continue
      if (keyringMade(e)) {
        dropped++
        continue
      }
      found.push({
        ...held,
        did: e.principalDid as string,
        contextId: e.contextId as string,
        entryId: e.id,
        label: e.label?.includes(vtcDid) ? undefined : e.label,
        source: 'agent',
      })
    }
    if (counts)
      counts[a.vtaDid] = {
        listed: listed.length,
        matched: forCommunity.length,
        keyringMadeDropped: dropped,
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
  const counts: SignInIdentityCounts = {}
  const found = signInIdentitiesFrom(vtcDid, agents, personas, Object.fromEntries(listed), counts)
  for (const [vtaDid, c] of Object.entries(counts))
    agent.config?.logger?.info?.(
      `[SignIn] ${vtaDid.slice(0, 32)}…: ${c.listed} vault entries, ${c.matched} for the community, ${c.keyringMadeDropped} Keyring-made for personas not on this phone (not offered)`
    )
  agent.config?.logger?.info?.(`[SignIn] ${found.length} identit${found.length === 1 ? 'y' : 'ies'} to sign in as`)
  return found
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
    // The identities first: one on a linked agent makes the community one the person belongs to, whose name is read.
    const found = await identitiesFor(vtcDid)
    const recorded = await recordedCommunity(agent, vtcDid, found.length > 0)
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
        return approveSignInWithUvKey(proved, deps)
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
