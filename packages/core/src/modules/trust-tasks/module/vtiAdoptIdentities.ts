/**
 * A phone takes on its agent's community identities, when the person asks
 * ("Bring back your communities and cards from your agent"; Alberto, 10-13,
 * for 242). Never on its own at link: the phone shows communities it did not
 * join itself only once the person has asked for them.
 *
 * A phone keeps an identity per community (`VtiPersona`). Identities it did
 * not make itself (a new install, or one made with pnm/openvtc on the same
 * agent: IN-363, IN-114) it had nothing to restore cards for, so the cards the
 * agent keeps stayed there. The agent knows its DIDs (`dids/list`, every
 * context this phone's grant covers, nested ones included), and its vault
 * keeps the cards each community issued to one of them. A card about one of
 * the agent's own DIDs names the community it is for (its issuer), so the
 * identity is recorded from the two, and nothing else is guessed.
 *
 * The key ids come from the identity's DID document: `dids/list` answers the
 * DID record, which carries none, and the agent keeps an identity's keys under
 * the verification-method ids its published document names (vta-keys
 * `save_entity_key_records_with_ids`). A DID whose document cannot be read is
 * skipped and reported, never guessed at.
 *
 * Nor is an identity taken on from a card that does not hold up: the card that
 * names the community must pass the same check a delivered card does
 * (vtiDeliveredCheck), or the person would hold an identity in a community on
 * a card the wallet then refuses to keep.
 *
 * @module trust-tasks/module/vtiAdoptIdentities
 */

import { isAgentsOwnDid } from './agentOwnIdentity'
import { sameIdentity } from './didScid'
import type { VtaMintedDid } from './VtaClient'
import type { AgentCard } from './vtiCardVault'
import type { VtiIdentityStore, VtiPersona } from './VtiIdentityStore'
import { withoutRoomCards } from './roomCards'
import { classifyCredential } from './vtiInbox'

export interface AdoptionKeyIds {
  signing: string
  keyAgreement: string
}

/** What a run found, for the screen to say why nothing came back when nothing did. */
export interface AdoptionReport {
  /** The identities taken on. */
  adopted: VtiPersona[]
  /** The agent's identities this phone does not hold, among those it showed. */
  otherIdentities: number
  /** Community cards about those identities. */
  cardsForOthers: number
  /** Community cards about the agent's own DID: never an identity of this phone (agentOwnIdentity). */
  cardsForAgent?: number
  /** Identities with a community card whose DID document could not be read: not taken on. */
  unreadable: string[]
  /** Cards that named a community for an identity but did not hold up: no identity taken on from them. */
  failedCheck: { credentialId: string; communityDid: string }[]
}

type DocumentLike = Record<string, unknown> | undefined

const idOf = (did: string, entry: unknown): string | undefined => {
  const id =
    typeof entry === 'string'
      ? entry
      : entry && typeof (entry as { id?: unknown }).id === 'string'
        ? (entry as { id: string }).id
        : undefined
  if (!id) return undefined
  return id.startsWith('#') ? `${did}${id}` : id
}

const firstOf = (did: string, list: unknown): string | undefined =>
  Array.isArray(list) ? list.map((entry) => idOf(did, entry)).find(Boolean) : undefined

/**
 * The agent's key ids for `did`, read off its DID document: the signing key is
 * the first assertion method (else authentication), the key-agreement key the
 * first keyAgreement entry. Undefined when either is missing.
 */
export function keyIdsFromDocument(did: string, document: DocumentLike): AdoptionKeyIds | undefined {
  if (!document) return undefined
  const signing = firstOf(did, document.assertionMethod) ?? firstOf(did, document.authentication)
  const keyAgreement = firstOf(did, document.keyAgreement)
  return signing && keyAgreement ? { signing, keyAgreement } : undefined
}

/**
 * Record, on this phone, each of `vtaDid`'s identities that a community card in
 * its vault is about and that this phone does not hold yet for that community.
 * `cards` are the agent's cards, already fetched (`fetchAgentCards`): the run
 * that then restores every identity's cards reads the vault once for both.
 * A membership card wins over a role or vetter grant for the same community,
 * and the newer card over the older; one that fails its check gives way to the
 * next. An agent that does not answer throws.
 */
export async function adoptAgentIdentities(options: {
  identities: VtiIdentityStore
  vtaDid: string
  cards: AgentCard[]
  listDids: () => Promise<VtaMintedDid[]>
  /** Why a card does not hold up (vtiDeliveredCheck), or undefined when it does. */
  check: (credential: Record<string, unknown>, issuer: string) => Promise<string | undefined>
  /** The identity's key ids, from its DID document; undefined when it cannot be read. */
  keyIdsOf: (did: string) => Promise<AdoptionKeyIds | undefined>
  /** The DIDs of the identities this phone already holds. */
  held?: string[]
  /**
   * Borrow an identity's key copies from its agent once it is recorded (VtaClient.holdPersonaKeys). Run one at a
   * time, after the report is made and never waited for: Bring back does not take longer for it, and a borrow
   * that fails takes nothing back. The identity stays recorded and its keys are asked for again when a session
   * with its agent next opens.
   */
  holdKeys?: (persona: VtiPersona) => Promise<unknown>
  /** Told of a borrow that failed, and why, for the log. */
  onKeysFailed?: (persona: VtiPersona, reason: string) => void
  now?: () => number
}): Promise<AdoptionReport> {
  const { identities, vtaDid, cards } = options
  const now = options.now ?? Date.now
  const held = new Set(options.held ?? [])
  // The agent's own DID is never one of this phone's identities, whatever a community issued to it (agentOwnIdentity).
  const listed = await options.listDids()
  const minted = new Map(listed.filter((d) => !isAgentsOwnDid(d.did, vtaDid)).map((d) => [d.did, d]))
  // The agent's DID a card is about: the same DID, or its did:scid:vh:1 form (didScid).
  const mintedAs = (subject: string) =>
    minted.has(subject) ? subject : [...minted.keys()].find((did) => sameIdentity(did, subject))
  const otherIdentities = [...minted.keys()].filter((did) => !held.has(did)).length
  const report: AdoptionReport = {
    adopted: [],
    otherIdentities,
    cardsForOthers: 0,
    cardsForAgent: 0,
    unreadable: [],
    failedCheck: [],
  }

  // Each community's cards about one of the agent's DIDs, best first.
  const byCommunity = new Map<
    string,
    { id: string; did: string; membership: boolean; from: string; credential: Record<string, unknown> }[]
  >()
  // A data room's cards name the room as their issuer, not a community: they take no identity on (roomCards).
  for (const { id, credential } of withoutRoomCards(cards)) {
    if (!credential) continue
    const item = classifyCredential(credential)
    // The cards a community gives an identity in it: membership, a role, a vetter grant.
    if (item.kind !== 'membership' && item.kind !== 'role' && item.kind !== 'vetter-grant') continue
    if (item.communityDid && item.subjectDid && isAgentsOwnDid(item.subjectDid, vtaDid))
      report.cardsForAgent = (report.cardsForAgent ?? 0) + 1
    const did = item.subjectDid ? mintedAs(item.subjectDid) : undefined
    if (!item.communityDid || !did) continue
    if (!held.has(did)) report.cardsForOthers += 1
    const from = typeof credential.validFrom === 'string' ? credential.validFrom : ''
    const list = byCommunity.get(item.communityDid) ?? []
    list.push({ id, did, membership: item.kind === 'membership', from, credential })
    byCommunity.set(item.communityDid, list)
  }

  for (const [communityDid, list] of byCommunity) {
    // An identity this phone already holds for the community is kept as it is.
    if (await identities.getPersona(communityDid, vtaDid)) continue
    list.sort((a, b) => Number(b.membership) - Number(a.membership) || b.from.localeCompare(a.from))
    let chosen: (typeof list)[number] | undefined
    for (const candidate of list) {
      const failed = await options.check(candidate.credential, communityDid).catch(() => 'unreadable')
      if (!failed) {
        chosen = candidate
        break
      }
      report.failedCheck.push({ credentialId: candidate.id, communityDid })
    }
    if (!chosen) continue
    const { did } = chosen
    const keyIds = await options.keyIdsOf(did).catch(() => undefined)
    if (!keyIds) {
      if (!report.unreadable.includes(did)) report.unreadable.push(did)
      continue
    }
    const at = minted.get(did) as VtaMintedDid
    const persona: VtiPersona = {
      communityDid,
      vtaDid,
      did,
      contextId: at.contextId,
      vtaKeyIds: { signing: keyIds.signing, keyAgreement: keyIds.keyAgreement },
      createdAt: new Date(now()).toISOString(),
    }
    // The card check and the DID document are network reads: a join may have recorded this community's identity
    // meanwhile. That one, which the community just admitted and whose keys are on the phone, is kept.
    if (await identities.getPersona(communityDid, vtaDid)) continue
    await identities.setPersona(persona)
    report.adopted.push(persona)
  }
  const { holdKeys, onKeysFailed } = options
  if (holdKeys)
    void report.adopted.reduce(
      (previous, persona) =>
        previous.then(() =>
          holdKeys(persona).then(undefined, (e: unknown) =>
            onKeysFailed?.(persona, e instanceof Error ? e.message : String(e))
          )
        ),
      Promise.resolve()
    )
  return report
}

/** The contexts a whoami answer's `scopes` (`ctx:<id>`) name; undefined for an unrestricted grant or none stated. */
export function visibleContextsOf(scopes: unknown): string[] | undefined {
  if (!Array.isArray(scopes) || scopes.length === 0) return undefined
  const contexts = scopes
    .filter((s): s is string => typeof s === 'string')
    .map((s) => (s.startsWith('ctx:') ? s.slice(4) : s))
    .filter(Boolean)
  return contexts.length ? contexts : undefined
}
