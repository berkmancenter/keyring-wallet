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
  signInEndLine,
  SignInError,
  type ClaimedSignIn,
  type SignInDeps,
  type SignInFailure,
} from './oobSignIn'
import {
  farmApprove,
  farmIdentitiesFrom,
  farmIdentifyAndProve,
  sendToFarm,
  type FarmProvedSignIn,
  type FarmSignInDeps,
  type FarmSignInIdentity,
} from './farmSignIn'
import { signDocumentProof } from '../documentProof'
import { confirmOwner } from './ownerConfirm'
import {
  approveSignInWithUvKey,
  ensureSignInVaultEntry,
  identifyAndProve,
  KEYRING_SIGN_IN_LABEL,
  signInAgentDeps,
  signInFailureFromAgent,
  type ProvedSignIn as AgentProvedSignIn,
  type SignInAgentDeps,
} from './oobSignInAgent'
import { classifyDid } from './classifyDid'
import { communityNameIsStale, refreshPublishedName } from './communityNameRefresh'
import { releaseWarn } from './releaseLog'
import { readTrigger, triggerAction } from './triggerLink'
import type { VtaVaultEntry } from './VtaClient'
import { vtaAgent } from './vtaAgent'
import { GenericRecordsCommunityStore, isCurrentMembership } from './VtiCommunityStore'
import { GenericRecordsIdentityStore, type VtiPersona } from './VtiIdentityStore'
import { communityTarget } from './vtiCommunityLink'

export type { SignInRequester } from './oobSignInAgent'
export type { FarmProvedSignIn, FarmRequester, FarmSignInIdentity } from './farmSignIn'

/** A proved sign-in, to a community through the member's agent or to a Farm by its claim key (IN-388). */
export type ProvedSignIn = AgentProvedSignIn | FarmProvedSignIn

/** Every reason a sign-in can end without being approved, as the screen words them. */
export type SignInEndReason = SignInFailure

/**
 * An identity this phone can sign in to a community as (IN-296): a persona one
 * of its linked agents holds there, and which agent holds it.
 */
export type PersonaSignInIdentity = {
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

/** Who a sign-in can be as: a persona, for a community; an agent claimed from it, for a Farm (`source: 'farm'`). */
export type SignInIdentity = PersonaSignInIdentity | FarmSignInIdentity

export type SignInSteps = {
  /**
   * Membership and the recorded name; the published name only for a member with none on record. `identities`:
   * every identity the phone could sign in as, the current agent's first. A community where it holds any is one
   * it is a member of.
   *
   * A code from a Farm this phone claimed an agent from (`farm: true`) is a member's too: its identities are those
   * agents, and no community is looked up. Read locally, as membership is: an unknown sender reaches nobody.
   * `olderAgents`: for a sender that is neither, whether this phone holds an agent that kept no Farm sign-in key
   * (linked another way, or claimed before the key was kept), which cannot sign in to its Farm from here.
   */
  community: (vtcDid: string) => Promise<{
    member: boolean
    name?: string
    identities?: SignInIdentity[]
    farm?: boolean
    olderAgents?: boolean
  }>
  claim: (link: string) => Promise<ClaimedSignIn>
  /** `identity`: the one the person chose; the first found when none was chosen. */
  identifyAndProve: (claimed: ClaimedSignIn, enteredNumber: string, identity?: SignInIdentity) => Promise<ProvedSignIn>
  approve: (proved: ProvedSignIn) => Promise<{ status: 'approved' }>
  cancel: (claimed: ClaimedSignIn) => Promise<{ cancelled: boolean }>
  /**
   * Whether the sender of a code from a community this phone has not joined is a community it can join (IN-406: a
   * community's join page shows the same sign-in code). Asked only when the person taps "Check and join", never
   * before: until they continue, nothing is resolved for an unknown sender (VTI-LNK-050). Undefined when it could
   * not be checked (its DID host did not answer in time, or the phone is offline), which is not a "no".
   */
  joinable?: (vtcDid: string) => Promise<boolean | undefined>
}

/** How long "Check and join" waits on the sender's DID host before saying the code can't be joined here. */
export const JOINABLE_WAIT_MS = 15000

// The rule is shared with My Agent's community list (communityNameRefresh); kept exported from here as before.
export { COMMUNITY_NAME_TTL_MS } from './communityNameRefresh'

/**
 * Whether this phone holds a current membership of `vtcDid`, and the name to
 * show for it.
 *
 * A community the person belongs to (this phone's own membership, or an
 * identity a linked agent holds there, asked of `heldOnAgent` only when it decides) has its published name
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
  heldOnAgent: () => Promise<boolean> = async () => false
): Promise<{ member: boolean; name?: string }> {
  const store = new GenericRecordsCommunityStore(agent)
  const memberships = await store.listMemberships()
  const member = memberships.some((m) => m.communityDid === vtcDid && isCurrentMembership(m))
  const kept = (await store.listCommunityNames().catch(() => [])).find((n) => n.communityDid === vtcDid)
  const stale = communityNameIsStale(kept)
  // The agents are waited on only when they decide it: a name to read again, and no membership on this phone.
  const belongs = member || (stale && (await heldOnAgent()))
  const fresh = belongs && stale ? await refreshPublishedName(agent, vtcDid) : undefined
  const name = fresh ?? communityTarget.publishedNameOf(vtcDid) ?? kept?.name
  return { member, name }
}

/** Whether this phone itself holds a current membership of `vtcDid`: its own records, nothing asked. */
async function memberOnThisPhone(agent: Agent, vtcDid: string): Promise<boolean> {
  const memberships = await new GenericRecordsCommunityStore(agent).listMemberships().catch(() => [])
  return memberships.some((m) => m.communityDid === vtcDid && isCurrentMembership(m))
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
 *
 * Keyring's own entries are told by their label alone, the one signal there is
 * locally: `Keyring sign-in · <community DID>`, which every entry this app makes
 * carries (ensureSignInVaultEntry's one caller passes no persona label). An
 * entry another client made under a persona's own label cannot be told from a
 * plugin entry, and is offered.
 */
export function signInIdentitiesFrom(
  vtcDid: string,
  agents: { vtaDid: string; name: string; current: boolean }[],
  personas: Pick<VtiPersona, 'communityDid' | 'vtaDid' | 'did' | 'contextId' | 'label'>[],
  entries: Record<string, VtaVaultEntry[] | undefined>,
  counts?: SignInIdentityCounts
): PersonaSignInIdentity[] {
  const found: PersonaSignInIdentity[] = []
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
async function findIdentities(agent: Agent, vtcDid: string): Promise<PersonaSignInIdentity[]> {
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
  identity: PersonaSignInIdentity,
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
  const identities = new Map<string, Promise<PersonaSignInIdentity[]>>()
  const identitiesFor = (vtcDid: string) => {
    if (!identities.has(vtcDid)) identities.set(vtcDid, findIdentities(agent, vtcDid))
    return identities.get(vtcDid) as Promise<PersonaSignInIdentity[]>
  }
  // This phone's links, read once: which Farm each agent was claimed from, and the key it signs in by (IN-388).
  // Undefined when they could not be read: not known, which is not the same as none.
  type Linked = Awaited<ReturnType<typeof vtaAgent.linkedAgents>>
  let linked: Promise<Linked | undefined> | undefined
  const linkedAgents = () =>
    (linked ??= vtaAgent.linkedAgents(agent).catch((e) => {
      releaseWarn(`[SignIn] linked agents not read: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`)
      return undefined
    }))
  const farmFor = async (farmDid: string) => farmIdentitiesFrom(farmDid, (await linkedAgents()) ?? [])
  /**
   * For a sender this phone has not joined: may it hold an agent that kept no Farm sign-in key? From the links when
   * they name one; when they name none or could not be read, from the agent's own state, unless that says the link was
   * read and no agent is linked. IN-388 step D on 276.10 got no line on a phone whose only agent was linked by owner
   * code. The line's words are conditional ("If this code is from the service that hosts one of your agents"), so
   * saying it when unsure costs little, where leaving it out leaves the person no way forward.
   */
  const mayHoldOlderAgent = async (vtcDid: string): Promise<boolean> => {
    const agents = await linkedAgents()
    const state = vtaAgent.getState()
    const phoneLinked = !(state.linkRestored && state.link.kind !== 'linked')
    // What decided it, for the next report: counts only, no DIDs.
    releaseWarn(
      `[SignIn] not joined: ${agents ? `${agents.length} linked agent(s) read` : 'links not read'}, ` +
        `${agents?.filter((a) => a.farmLogin).length ?? 0} with a Farm key, ` +
        `${agents?.filter((a) => a.farmLogin?.farmDid === vtcDid).length ?? 0} for this sender; ` +
        `link ${state.link.kind}${state.linkRestored ? '' : ' (not read yet)'}`
    )
    if (agents?.some((a) => !a.farmLogin)) return true
    return !agents?.length && phoneLinked
  }
  const community = async (vtcDid: string) => {
    // A Farm this phone claimed an agent from: its agents are who can sign in, and no community is looked up. Asked
    // after this phone's own memberships, which never wait on the agents (a Farm is never one of them).
    if (!(await memberOnThisPhone(agent, vtcDid))) {
      const farm = await farmFor(vtcDid)
      if (farm.length) return { member: true, identities: farm, farm: true }
    }
    // Side by side: the name waits on the identities only when one on a linked agent decides whether it is read
    // (no membership on this phone, and the name on record missing or old); a slow agent never holds up a known name.
    const identities = identitiesFor(vtcDid)
    const recorded = await recordedCommunity(agent, vtcDid, async () => (await identities).length > 0)
    const found = await identities
    const member = recorded.member || found.length > 0
    const olderAgents = !member && (await mayHoldOlderAgent(vtcDid))
    return { ...recorded, member, identities: found, ...(olderAgents ? { olderAgents } : {}) }
  }
  const claimDeps: SignInDeps = {
    resolveDid: agentDidResolver(agent),
    post: httpsPost,
    isKnownCommunity: async (vtcDid) => (await community(vtcDid)).member,
  }
  // A Farm's claim is sent with its retries; a community's once, as before.
  const farmClaimDeps: SignInDeps = {
    ...claimDeps,
    send: (base, make) => sendToFarm({ post: httpsPost }, base, make),
  }
  const farmDeps = (identity: FarmSignInIdentity): FarmSignInDeps => ({
    post: httpsPost,
    resolveDid: agentDidResolver(agent),
    // The claim key, in the wallet's own store since the claim: kept as a did:key the agent's handover named.
    login: {
      did: identity.did,
      sign: (document, proofPurpose) => signDocumentProof(agent, document, identity.did, { proofPurpose }),
    },
  })
  const chosenFor = async (vtcDid: string, identity?: SignInIdentity) => {
    const persona = identity && identity.source !== 'farm' ? identity : undefined
    const chosen = persona ?? (await identitiesFor(vtcDid))[0]
    if (!chosen) throw new SignInError('notAMember', 'no linked agent holds a persona for the community')
    return chosen
  }
  let member: { vtcDid: string; identity: PersonaSignInIdentity } | undefined
  return {
    community,
    claim: async (link) => {
      const from = signInCommunityOf(link)
      const isFarm = 'vtcDid' in from && (await farmFor(from.vtcDid)).length > 0
      return claimSignIn(link, isFarm ? farmClaimDeps : claimDeps)
    },
    identifyAndProve: async (claimed, enteredNumber, identity) => {
      const farm = await farmFor(claimed.vtcDid)
      if (farm.length) {
        // Only an agent this phone holds a key for, from this Farm; the first when none was chosen.
        const chosen =
          farm.find((f) => identity?.source === 'farm' && f.vtaDid === identity.vtaDid && f.did === identity.did) ??
          farm[0]
        return farmIdentifyAndProve(claimed, enteredNumber, chosen, farmDeps(chosen))
      }
      const chosen = await chosenFor(claimed.vtcDid, identity)
      member = { vtcDid: claimed.vtcDid, identity: chosen }
      return withMember(agent, claimed.vtcDid, chosen, (deps, persona) =>
        identifyAndProve(claimed, enteredNumber, { ...deps, persona })
      )
    },
    approve: async (proved) => {
      const vtcDid = proved.claimed.vtcDid
      if ('farm' in proved) {
        // The agent identify was sent as, and no other: the Farm holds the grant to the key it identified.
        const chosen = (await farmFor(vtcDid)).find(
          (f) => f.vtaDid === proved.farm.vtaDid && f.did === proved.identifiedAs
        )
        if (!chosen) throw new SignInError('farmKeyMissing', 'the agent identified is no longer linked')
        return farmApprove(proved, chosen, { ...farmDeps(chosen), confirmOwner })
      }
      const chosen = member?.vtcDid === vtcDid ? member.identity : await chosenFor(vtcDid)
      // The persona's own entry, as identify found or made it.
      return withMember(agent, vtcDid, { ...chosen, entryId: proved.persona.entryId }, async (deps) => {
        return approveSignInWithUvKey(proved, deps)
      })
    },
    cancel: (claimed) => cancelSignIn(claimed, claimDeps),
    // The one network touch for an unknown sender, and only once the person has tapped: its DID document, from its
    // DID host. Nothing goes to the community itself, and the scanned request is never claimed; joining (VtiJoin)
    // is what first asks the community anything. A host that answered decides it (a community, or not one: none
    // found, not a DID); one that did not answer in time leaves it unchecked, so the person can try again.
    joinable: async (vtcDid) => {
      const kind = await classifyDid(agent, vtcDid, { timeoutMs: JOINABLE_WAIT_MS }).catch(() => undefined)
      if (!kind || (kind.kind === 'unresolvable' && kind.reason === 'offline')) return undefined
      return kind.kind === 'community'
    },
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

/**
 * How a sign-in that ended in an error is said: its reason for the screen, and one Release line saying which check
 * ended it, with the versions asked (IN-390). The line names no link, key or document (signInEndLine).
 */
export function signInEndedBy(error: unknown): SignInEndReason | undefined {
  releaseWarn(signInEndLine(error))
  return signInReasonOf(error)
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
