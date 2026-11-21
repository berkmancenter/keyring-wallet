/**
 * One identity in two communities.
 *
 * A community can admit an identity this phone made for another community: the
 * person joined it with that identity from other tooling, or gave its admin
 * that identity's code. Its cards then reach the phone addressed to an identity
 * kept for the first community, and were filed there. Nothing was kept for the
 * second community, and everything that asks "which identity is mine here?"
 * found none: Leave failed ("this phone holds no identity for that community"),
 * the directory said the community "didn't answer", its rooms and polls were
 * never read (IN-517, 277.12).
 *
 * The identity is kept for the second community too: the same DID and key ids,
 * under the same agent, in the second community's own record. Every reader
 * keyed by community then finds it, and leaving the second community forgets
 * only that record, never the first community's. Nothing secret is copied: a
 * persona record holds key ids, never keys (VtiIdentityStore).
 *
 * Never for the agent's own DID, which is not one of this phone's identities
 * (agentOwnIdentity). And never over an identity the phone already keeps for
 * that community: a card for it naming another identity is kept on its own.
 *
 * Key copies. The new record names the first record's key copies only when
 * both are held in memory: those are named the same every session
 * (VtaClient.borrowKey), so two records may name them. A copy kept in the
 * wallet's store (an install from before memory-only custody, until its keys
 * move: vtaKeyMigration) belongs to the first record, whose migration deletes
 * it, so it is never named here; and a record naming only one of the two would
 * open a session it cannot sign on. Then the new record names no copies at
 * all, as an identity brought back from the agent does, and the agent's
 * session-open sweep borrows both into memory and records them on it
 * (vtaAgent.holdPersonaKeys → VtaClient.borrowAdoptedKeys). Until then it
 * cannot sign: `canSignAs` says so, and Leave waits for it.
 *
 * @module trust-tasks/module/sharedIdentity
 */
import { isAgentsOwnPersona } from './agentOwnIdentity'
import { sameIdentity } from './didScid'
import { isInMemoryKeyId } from './vtaKeys'
import { isCurrentMembership, type VtiCommunityStore } from './VtiCommunityStore'
import type { VtiIdentityStore, VtiPersona } from './VtiIdentityStore'

/**
 * A community the phone holds a membership in, with no identity it can sign in
 * as there: nothing can be asked of the community for it. Read by its name.
 */
export class VtiNoIdentity extends Error {
  public constructor(message = 'this phone holds no identity for that community') {
    super(message)
    this.name = 'VtiNoIdentity'
  }
}

export const isNoIdentity = (e: unknown): boolean => e instanceof Error && e.name === 'VtiNoIdentity'

/**
 * What keeping `persona` for `communityDid` did:
 * - `own`: it is that community's identity already;
 * - `shared`: kept for it now;
 * - `already`: kept for it before;
 * - `conflict`: the phone keeps another identity for that community, left as it is;
 * - `agentItself`: the agent's own DID, never kept.
 */
export type ShareOutcome = 'own' | 'shared' | 'already' | 'conflict' | 'agentItself'

/** Keep `persona`, made for another community, as `communityDid`'s identity too. */
export async function shareIdentityWith(
  identities: Pick<VtiIdentityStore, 'getPersona' | 'setPersona'>,
  persona: VtiPersona,
  communityDid: string,
  now: () => Date = () => new Date()
): Promise<ShareOutcome> {
  if (persona.communityDid === communityDid) return 'own'
  if (isAgentsOwnPersona(persona)) return 'agentItself'
  const there = await identities.getPersona(communityDid, persona.vtaDid)
  if (there) return sameIdentity(there.did, persona.did) ? 'already' : 'conflict'
  // Both copies in memory, or none named (see the module comment): never one, never a stored copy.
  const signing = persona.kmsKeyIds?.signing
  const keyAgreement = persona.kmsKeyIds?.keyAgreement
  const bothInMemory = Boolean(signing && keyAgreement && isInMemoryKeyId(signing) && isInMemoryKeyId(keyAgreement))
  await identities.setPersona({
    communityDid,
    vtaDid: persona.vtaDid,
    did: persona.did,
    contextId: persona.contextId,
    vtaKeyIds: { ...persona.vtaKeyIds },
    ...(bothInMemory ? { kmsKeyIds: { signing, keyAgreement } } : {}),
    ...(persona.label ? { label: persona.label } : {}),
    createdAt: now().toISOString(),
  })
  return 'shared'
}

/**
 * Keep each current membership's identity for its community when the phone
 * kept it only for another: what a card filed under another community's
 * identity left behind before this module existed. Runs over every linked
 * agent's identities, each under its own agent. Answers how many it kept.
 */
export async function healSharedIdentities(
  identities: Pick<VtiIdentityStore, 'getPersona' | 'setPersona' | 'listPersonas'>,
  communities: Pick<VtiCommunityStore, 'listMemberships'>
): Promise<number> {
  const personas = await identities.listPersonas()
  let kept = 0
  for (const membership of await communities.listMemberships()) {
    if (!membership.personaDid || !isCurrentMembership(membership)) continue
    // A record kept for the membership's own community already: nothing to do. Otherwise the first other community's
    // record of the same identity that may be kept (the agent's own DID may not, and the next is tried).
    const holders = personas.filter((p) => p.vtaDid && sameIdentity(p.did, membership.personaDid as string))
    if (holders.length === 0 || holders.some((p) => p.communityDid === membership.communityDid)) continue
    for (const from of holders) {
      const outcome = await shareIdentityWith(identities, from, membership.communityDid)
      if (outcome === 'shared') kept += 1
      if (outcome !== 'agentItself') break
    }
  }
  return kept
}

/**
 * The identity to act as in `communityDid` under the current agent: the one
 * kept for it, or, when the phone holds a membership there under an identity
 * kept for another community, that one, kept for this community first.
 * Undefined when there is none the phone can sign in as.
 */
export async function personaForCommunity(
  identities: Pick<VtiIdentityStore, 'getPersona' | 'setPersona' | 'listPersonas'>,
  communities: Pick<VtiCommunityStore, 'listMemberships'>,
  communityDid: string,
  now: () => number = Date.now
): Promise<VtiPersona | undefined> {
  const found = await identities.getPersona(communityDid)
  if (found) return found
  if ((await healThrottled(identities, communities, now)) === 0) return undefined
  return identities.getPersona(communityDid)
}

/**
 * A reader that finds no identity for a community runs the heal, which reads every identity and membership. A
 * community that truly has none would pay that on every read (the directory and rooms poll): one heal per store at a
 * time, and none again within `HEAL_AGAIN_MS` of the last. A membership that becomes current inside that window is not
 * healed here until it passes; it needs nothing from here, as its card is shared as it is filed (`fileUnder`).
 */
export const HEAL_AGAIN_MS = 30_000
const healing = new WeakMap<object, { at: number; run: Promise<number> }>()

function healThrottled(
  identities: Pick<VtiIdentityStore, 'getPersona' | 'setPersona' | 'listPersonas'>,
  communities: Pick<VtiCommunityStore, 'listMemberships'>,
  now: () => number
): Promise<number> {
  const last = healing.get(identities)
  if (last && now() - last.at < HEAL_AGAIN_MS) return last.run
  const run = healSharedIdentities(identities, communities).catch(() => 0)
  healing.set(identities, { at: now(), run })
  return run
}

/**
 * Whether the phone can sign as this identity now: both of its key copies are recorded. One brought back from the
 * agent, or kept for a second community while the first held its copies in the wallet's store, has none until the
 * agent's session-open sweep borrows them (see the module comment); one with only a key-agreement copy would open a
 * session and send unsigned.
 */
export const canSignAs = (persona: Pick<VtiPersona, 'kmsKeyIds'> | undefined): boolean =>
  Boolean(persona?.kmsKeyIds?.keyAgreement && persona.kmsKeyIds.signing)

/**
 * Whether the phone can open a session as this identity now: its key-agreement copy is recorded, which is what the
 * session's sign-in needs (vtiAgent.connect). Without a signing copy it still reads over DIDComm, unsigned, as it did
 * before; what must be signed (Leave) asks `canSignAs`.
 */
export const canConnectAs = (persona: Pick<VtiPersona, 'kmsKeyIds'> | undefined): boolean =>
  Boolean(persona?.kmsKeyIds?.keyAgreement)

/** A leave asked of an identity whose key copies this phone does not hold yet: nothing was sent. Read by its name. */
export class VtiKeysNotHeld extends Error {
  public constructor(message = "this identity's keys are not on this phone yet") {
    super(message)
    this.name = 'VtiKeysNotHeld'
  }
}

/**
 * The other communities this identity is kept for under the same agent: what
 * they share, so the person can be told both communities see the same identity.
 */
export function communitiesSharing(
  personas: VtiPersona[],
  persona: Pick<VtiPersona, 'did' | 'vtaDid' | 'communityDid'>
) {
  return personas
    .filter(
      (p) => p.vtaDid === persona.vtaDid && p.communityDid !== persona.communityDid && sameIdentity(p.did, persona.did)
    )
    .map((p) => p.communityDid)
}
