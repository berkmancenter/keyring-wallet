/**
 * A person's community cards kept by their own agent, so a new phone can get
 * them back (226, "agent-kept cards").
 *
 * The phone receives a community's cards at the persona's DID and keeps them
 * locally; the agent never sees them (VTI-Q35: a VTA does not receive what is
 * addressed to the personas it holds). openvtc closes that gap client-side:
 * on every connect it pushes each membership card it holds into its VTA's
 * credential vault (`vault/credentials/receive/0.1`), and a new install gets
 * them back by querying the vault by purpose and fetching each
 * (openvtc-core credential_sync.rs:84-161, rebuild.rs:311-354). Keyring does
 * the same, a bit further: membership, role and vetter-grant cards, each
 * checked first (vtiDeliveredCheck), and each filed under the persona's own
 * context (`contextId`) rather than whichever context the caller happens to
 * have.
 *
 * What the agent could not keep stays on the phone, marked: a card from a
 * community that signs with two keys carries a proof set, which a vault before
 * VTI #1868 refuses (VTI-44 (e)). Such a card is offered again once per
 * connect, so it moves to the agent on its own once the agent is upgraded; a
 * card refused for any other reason is not offered again.
 *
 * Each card's state is persisted, keyed by the credential's own `id` (the same
 * on every phone, so recovery can match), and read synchronously from a cache
 * for the screens (`cardVaultStateOf`, `subscribeCardVault`).
 *
 * @module trust-tasks/module/vtiCardVault
 */
import { TypedArrayEncoder, type Agent } from '@credo-ts/core'
import { useEffect } from 'react'
import { DeviceEventEmitter } from 'react-native'

import { WALLET_LOCKED_EVENT } from '../../../utils/walletLocked'

import { VTI_PERSONA_DELIVERIES_EVENT } from './communityChanged'
import { sameIdentity } from './didScid'
import { listKeyed, putKeyed } from './keyedRecords'
import { versionsFor } from './taskVersions'
import { vtaAgent } from './vtaAgent'
import {
  GenericRecordsCommunityStore,
  heldCredentialKey,
  isCurrentMembership,
  type VtiCommunityStore,
} from './VtiCommunityStore'
import { GenericRecordsIdentityStore, type VtiPersona } from './VtiIdentityStore'
import { checkDeliveredCard, VtiCardStatusUnreadable } from './vtiDeliveredCheck'
import { withoutRoomCards } from './roomCards'
import { classifyCredential, roleNameOf } from './vtiInbox'

export const VAULT_RECEIVE = 'https://trusttasks.org/spec/vault/credentials/receive/0.1'
export const VAULT_QUERY = 'https://trusttasks.org/spec/vault/credentials/query/0.1'
export const VAULT_GET = 'https://trusttasks.org/spec/vault/credentials/get/0.1'
/**
 * 0.2, asked first: from 0d3f268e (vta-service #2309) the agent serves only vault/credentials/get/0.2, while
 * v0.60.0 to v0.66.0 serve only 0.1. The request is the same; 0.2's answer names a `format` and carries the card
 * as `credential` or, for a format that is not JSON, `credentialBase64`.
 */
export const VAULT_GET_02 = 'https://trusttasks.org/spec/vault/credentials/get/0.2'

type VaultGetAnswer = { credential?: unknown; credentialBase64?: unknown; format?: unknown }

/** The card in a vault/credentials/get answer (0.1 or 0.2), when it is a JSON object. */
export function credentialOfGet(answer: VaultGetAnswer | undefined): Record<string, unknown> | undefined {
  const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  if (isObject(answer?.credential)) return answer.credential
  if (typeof answer?.credentialBase64 !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(
      TypedArrayEncoder.toUtf8String(TypedArrayEncoder.fromBase64(answer.credentialBase64))
    )
    return isObject(parsed) ? parsed : undefined
  } catch {
    // A format that is not JSON (a JWT, say): not a card this phone keeps.
    return undefined
  }
}

/** A card's vault state changed: `{ credentialId }`. */
export const VTI_CARD_VAULT_EVENT = 'vti:card-vault'

export type CardVaultState =
  /** The agent holds it, under the persona's context. */
  | { state: 'kept'; at: string }
  /** Sent, or to be sent, when the agent next answers. */
  | { state: 'pending' }
  /** Never sent yet. */
  | { state: 'notYetKept' }
  /** The agent will not hold it; the card stays on this phone. */
  | { state: 'cannotKeep'; reason: 'proofSet' | 'refusedByAgent' }

export type CardKind = 'membership' | 'role' | 'vetter-grant'

interface CardVaultRecord {
  credentialId: string
  communityDid: string
  kind: CardKind
  vault: CardVaultState
}

const RECORD_TYPE = 'keyring/vti-card-vault'
const KIND = 'card'

// ---------------------------------------------------------------------------
// State, read synchronously by the screens
// ---------------------------------------------------------------------------

const cache = new Map<string, CardVaultState>()

/** One object for every card never sent, so a snapshot of it is stable (useSyncExternalStore). */
const NOT_YET_KEPT: CardVaultState = Object.freeze({ state: 'notYetKept' })

/**
 * A card's vault state; `notYetKept` for one never sent. The same object is
 * returned until the state changes, so it can be a useSyncExternalStore
 * snapshot as it is.
 */
export function cardVaultStateOf(credentialId: string): CardVaultState {
  return cache.get(credentialId) ?? NOT_YET_KEPT
}

/** Called whenever a card's vault state changes. Returns the unsubscribe. */
export function subscribeCardVault(onChange: () => void): () => void {
  const sub = DeviceEventEmitter.addListener(VTI_CARD_VAULT_EVENT, onChange)
  return () => sub.remove()
}

/** Fill the cache from what this phone recorded (call once the agent exists). */
export async function loadCardVault(agent: Agent): Promise<void> {
  for (const r of await listKeyed<CardVaultRecord>(agent, RECORD_TYPE, KIND)) cache.set(r.credentialId, r.vault)
  DeviceEventEmitter.emit(VTI_CARD_VAULT_EVENT, {})
}

async function setState(agent: Agent, record: CardVaultRecord): Promise<void> {
  cache.set(record.credentialId, record.vault)
  await putKeyed(agent, RECORD_TYPE, KIND, record.credentialId, record as unknown as Record<string, unknown>)
  DeviceEventEmitter.emit(VTI_CARD_VAULT_EVENT, { credentialId: record.credentialId })
}

/** For tests: forget the cache, and the cards read this session, as a relaunch does. */
export function resetCardVaultCache(): void {
  cache.clear()
  forgetCardReads()
}

/** For tests: set one card's state in the cache only (nothing is stored), and announce it. */
export function seedCardVaultStateForTests(credentialId: string, state: CardVaultState): void {
  cache.set(credentialId, state)
  DeviceEventEmitter.emit(VTI_CARD_VAULT_EVENT, { credentialId })
}

// ---------------------------------------------------------------------------
// Sending cards to the agent
// ---------------------------------------------------------------------------

/** How a Trust Task reaches the persona's agent: `VtaClient.task` by default. */
export type VaultTask = <T>(type: string, payload: Record<string, unknown>) => Promise<T>

interface Card {
  credentialId: string
  communityDid: string
  kind: CardKind
  credential: Record<string, unknown>
}

async function cardsOf(store: VtiCommunityStore, persona: VtiPersona): Promise<Card[]> {
  const cards: Card[] = []
  const add = (credential: Record<string, unknown> | undefined, kind: CardKind, communityDid: string) => {
    const id = credential?.id
    if (typeof id === 'string' && id) cards.push({ credentialId: id, communityDid, kind, credential: credential! })
  }
  for (const m of await store.listMemberships()) {
    if (m.personaDid !== persona.did) continue
    // Ended by the community: not a card to keep, nor one a new phone gets back.
    if (!isCurrentMembership(m)) continue
    add(m.vmc, 'membership', m.communityDid)
    add(m.roleVec, 'role', m.communityDid)
  }
  for (const h of await store.listHeldCredentials()) {
    if (h.subjectDid !== persona.did) continue
    if (h.kind === 'vetter-grant' || h.kind === 'role') add(h.credential, h.kind, h.communityDid)
  }
  return cards
}

/** Did the agent answer at all? A refusal has a code; silence or a dropped link does not. */
const answered = (e: unknown) => typeof (e as { code?: unknown })?.code === 'string'

/**
 * Send this persona's cards to its agent, each once: a card already kept is
 * not sent again, and a card the agent refused is not retried (it would refuse
 * it again). A card whose send got no answer stays `pending` and goes on the
 * next call. Returns what happened this time.
 *
 * `offerProofSetsAgain` (the caller sets it once per connect) also sends the
 * cards refused for their proof set: an agent upgraded since (VTI #1868) keeps
 * them. An agent that still refuses costs one send per card per connect, and
 * an unanswered offer leaves the card as it was.
 */
export async function keepCardsInAgent(
  agent: Agent,
  store: VtiCommunityStore,
  persona: VtiPersona,
  task: VaultTask,
  options: { offerProofSetsAgain?: boolean } = {}
): Promise<{ kept: string[]; cannotKeep: string[]; pending: string[] }> {
  const result = { kept: [] as string[], cannotKeep: [] as string[], pending: [] as string[] }
  for (const card of await cardsOf(store, persona)) {
    const now = cardVaultStateOf(card.credentialId)
    const offeredAgain = now.state === 'cannotKeep' && now.reason === 'proofSet' && options.offerProofSetsAgain === true
    if (now.state === 'kept' || (now.state === 'cannotKeep' && !offeredAgain)) continue
    const base = { credentialId: card.credentialId, communityDid: card.communityDid, kind: card.kind }
    try {
      await task(VAULT_RECEIVE, { credential: card.credential, id: card.credentialId, contextId: persona.contextId })
      await setState(agent, { ...base, vault: { state: 'kept', at: new Date().toISOString() } })
      result.kept.push(card.credentialId)
    } catch (e) {
      if (answered(e)) {
        const reason = Array.isArray(card.credential.proof) ? 'proofSet' : 'refusedByAgent'
        await setState(agent, { ...base, vault: { state: 'cannotKeep', reason } })
        result.cannotKeep.push(card.credentialId)
      } else if (!offeredAgain) {
        await setState(agent, { ...base, vault: { state: 'pending' } })
        result.pending.push(card.credentialId)
      }
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Getting cards back on a new phone
// ---------------------------------------------------------------------------

export type RecoveredRefusal = {
  credentialId?: string
  communityDid?: string
  reason: 'failedCheck' | 'notOurs' | 'unreadable'
}

/** A card the agent keeps, as fetched: no `credential` when the vault did not give it back. */
export interface AgentCard {
  id: string
  credential?: Record<string, unknown>
}

/**
 * The queries that find every community card the agent keeps. The vault
 * answers only a filtered query, never a list of everything. It is asked by
 * purpose, which the vault's receive infers from the card's type names
 * (vta-vault receive.rs `infer_purpose`: invitation, membership, role,
 * endorsement, personhood), and by type for what that leaves out: a DTG
 * Credentials v1 role card is an `AuthorityCredential`, which no purpose
 * matches, so it was never asked for and never came back on a new phone.
 */
export const AGENT_CARD_QUERIES: Record<string, string>[] = [
  { purpose: 'membership' },
  { purpose: 'role' },
  { purpose: 'endorsement' },
  { type: 'AuthorityCredential' },
]

/**
 * The agent's cards read this app session, by id, so a second tap asks the
 * vault only for what it has not read yet. The reads are one at a time
 * (VtaClient serialises its tasks; the vault has no batch read) and are most
 * of a run's time. In memory only, and dropped when the wallet locks or the
 * person logs out, so a locked phone holds no card it was only shown. A card
 * read before is still checked on every run (vtiDeliveredCheck reads its
 * status then), so one revoked since is refused as before.
 */
const cardReads = new Map<string, Record<string, unknown>>()

/** Drop the cards read this session: on lock and log out, and between tests. */
export function forgetCardReads(): void {
  cardReads.clear()
}
// Registered when this module loads and never removed, unlike this file's other listeners, and on purpose. A
// release build inlines requires, so it runs only once something first uses this module, but cardReads lives
// here too: before then there is nothing to forget. Keep it here rather than in RootStack. A test that resets
// modules around this file would add a listener per load.
DeviceEventEmitter.addListener(WALLET_LOCKED_EVENT, forgetCardReads)

/**
 * Every community card the agent keeps, each fetched once, whichever query
 * found it. The vault cannot be asked for one identity's cards (its query has
 * no subject filter, and what it answers names no subject), so a run that
 * reads it for several identities reads it once and sorts the cards by
 * subject: read per identity, every card was fetched once per identity (#401
 * Farm run, 4 identities on an agent keeping 88 cards: 352 fetches, 164 s).
 * A query the agent does not answer throws; a card it does not give back is
 * returned without its credential. `onRead` hears how many cards there are as
 * soon as the queries answer, then each one read: the reads are most of a
 * run's time (#401 re-time: 88 cards, ~40 s), and a count that sat at 0 for
 * all of it read as stuck. A card on the phone already (`onPhone`, by id) or
 * read earlier this session is not fetched again.
 *
 * @versionLadder vault/credentials/get
 */
export async function fetchAgentCards(
  task: VaultTask,
  onRead?: (read: number, of: number) => void,
  onPhone?: ReadonlyMap<string, Record<string, unknown>>
): Promise<AgentCard[]> {
  const ids = new Set<string>()
  for (const query of AGENT_CARD_QUERIES) {
    const answer = await task<{ credentials?: { id?: string }[] }>(VAULT_QUERY, query)
    for (const d of answer?.credentials ?? []) if (typeof d.id === 'string' && d.id) ids.add(d.id)
  }
  const cards: AgentCard[] = []
  onRead?.(0, ids.size)
  for (const id of ids) {
    let credential = onPhone?.get(id) ?? cardReads.get(id)
    if (!credential) {
      const got = await versionsFor(task)
        .ask('vaultCredentialsGet', [VAULT_GET_02, VAULT_GET], (uri) => task<VaultGetAnswer>(uri, { id }))
        .then(({ answer }) => answer)
        .catch(() => undefined)
      credential = credentialOfGet(got)
      if (credential) cardReads.set(id, credential)
    }
    cards.push({ id, credential })
    onRead?.(cards.length, ids.size)
  }
  return cards
}

/** The cards this phone holds, by id: the agent's vault need not be asked for them. */
export async function cardsOnPhone(store: VtiCommunityStore): Promise<Map<string, Record<string, unknown>>> {
  const held = new Map<string, Record<string, unknown>>()
  const add = (credential?: Record<string, unknown>) => {
    if (typeof credential?.id === 'string' && credential.id) held.set(credential.id, credential)
  }
  for (const m of await store.listMemberships()) {
    add(m.vmc)
    add(m.roleVec)
  }
  for (const h of await store.listHeldCredentials()) add(h.credential)
  return held
}

/** The same card: its id, or its content when it has none (as held credentials are keyed). */
const sameCard = (held: Record<string, unknown> | undefined, card: Record<string, unknown>) =>
  !!held &&
  heldCredentialKey({ kind: 'other', communityDid: '', credential: held }) ===
    heldCredentialKey({ kind: 'other', communityDid: '', credential: card })

/**
 * Keep, on this phone, each card the agent keeps that is about this persona
 * and still holds up (vtiDeliveredCheck). `cards` are the agent's cards
 * already fetched (`fetchAgentCards`); without them the vault is read here.
 * A card this phone already holds is not saved again: it is `already`, not
 * `restored`, so a tap that brings nothing new says so.
 */
export async function recoverCardsFromAgent(
  agent: Agent,
  store: VtiCommunityStore,
  persona: VtiPersona,
  task: VaultTask,
  options: {
    onProgress?: (p: { found: number; restored: number }) => void
    check?: (credential: Record<string, unknown>, issuer: string) => Promise<string | undefined>
    cards?: AgentCard[]
  } = {}
): Promise<{ found: number; restored: string[]; already: string[]; refused: RecoveredRefusal[] }> {
  const check = options.check ?? ((c, issuer) => checkDeliveredCard(agent, c, issuer))
  // A data room's cards are the room's, not a community's: they are neither kept here nor refused (roomCards).
  const cards = withoutRoomCards(options.cards ?? (await fetchAgentCards(task)))
  const restored: string[] = []
  const already: string[] = []
  const refused: RecoveredRefusal[] = []
  options.onProgress?.({ found: cards.length, restored: 0 })
  for (const { id, credential } of cards) {
    if (!credential) {
      refused.push({ credentialId: id, reason: 'unreadable' })
      continue
    }
    const item = classifyCredential(credential)
    if (!item.subjectDid || !sameIdentity(item.subjectDid, persona.did) || !item.communityDid) {
      refused.push({ credentialId: id, communityDid: item.communityDid || undefined, reason: 'notOurs' })
      continue
    }
    // A status list that cannot be read now does not stop the recovery: the
    // agent's vault checked the card when it took it (vta-vault receive), and
    // the card's standing is read again wherever it is next presented.
    const failed = await check(credential, item.communityDid).catch((e) =>
      e instanceof VtiCardStatusUnreadable ? undefined : 'unreadable'
    )
    if (failed) {
      refused.push({ credentialId: id, communityDid: item.communityDid, reason: 'failedCheck' })
      continue
    }
    let held = false
    if (item.kind === 'membership') {
      const found = await store.getMembership(item.communityDid, persona.did)
      // The very card the community ended does not bring the membership back.
      if (found && !isCurrentMembership(found) && found.vmc?.id === credential.id) continue
      // A membership the community ended lends nothing to a new one.
      const existing = found && isCurrentMembership(found) ? found : undefined
      held = sameCard(existing?.vmc, credential)
      if (!held)
        await store.saveMembership({
          communityDid: item.communityDid,
          personaDid: persona.did,
          role: existing?.role ?? 'member',
          vmc: credential,
          roleVec: existing?.roleVec,
          grantedAt: typeof credential.validFrom === 'string' ? credential.validFrom : new Date().toISOString(),
          validUntil: typeof credential.validUntil === 'string' ? credential.validUntil : undefined,
          via: existing?.via ?? 'unknown',
        })
    } else if (item.kind === 'role') {
      const existing = await store.getMembership(item.communityDid, persona.did)
      const role = String(roleNameOf(credential) ?? 'member')
      held = existing
        ? sameCard(existing.roleVec, credential)
        : (await store.listHeldCredentials('role', item.communityDid)).some((c) => sameCard(c.credential, credential))
      if (!held) {
        if (existing) await store.saveMembership({ ...existing, role, roleVec: credential })
        else await store.saveHeldCredential({ ...item, subjectDid: persona.did, kind: 'role' })
      }
    } else if (item.kind === 'vetter-grant') {
      held = (await store.listHeldCredentials('vetter-grant', item.communityDid)).some((c) =>
        sameCard(c.credential, credential)
      )
      if (!held) await store.saveHeldCredential({ ...item, subjectDid: persona.did, kind: 'vetter-grant' })
    } else {
      refused.push({ credentialId: id, communityDid: item.communityDid, reason: 'notOurs' })
      continue
    }
    const kind: CardKind = item.kind === 'membership' ? 'membership' : item.kind === 'role' ? 'role' : 'vetter-grant'
    await setState(agent, {
      credentialId: id,
      communityDid: item.communityDid,
      kind,
      vault: { state: 'kept', at: new Date().toISOString() },
    })
    if (held) {
      already.push(id)
      continue
    }
    restored.push(id)
    options.onProgress?.({ found: cards.length, restored: restored.length })
  }
  return { found: cards.length, restored, already, refused }
}

// ---------------------------------------------------------------------------
// Keeping them there, while the app runs
// ---------------------------------------------------------------------------

/**
 * Keep every persona's cards in its agent: once the agent is connected, again
 * whenever it reconnects, and whenever a new card arrives. One run at a time;
 * a card already kept, or one the agent refused, is not sent again — except
 * that each connect offers the proof-set refusals once more (see
 * `keepCardsInAgent`), and a new card arriving does not.
 */
export function useVtiCardVault(agent: Agent | undefined): void {
  useEffect(() => {
    if (!agent) return
    let running = false
    let again = false
    let stopped = false
    // Set by a connect, taken by the next run: at most one second offer per connect.
    let offerProofSetsAgain = true
    const run = async () => {
      if (running) {
        again = true
        return
      }
      running = true
      try {
        do {
          again = false
          const { status, vtaDid } = vtaAgent.getState()
          if (status !== 'connected' || !vtaDid) break
          const client = vtaAgent.client(agent, vtaDid)
          const task: VaultTask = <T>(type: string, payload: Record<string, unknown>) => client.task<T>(type, payload)
          const store = new GenericRecordsCommunityStore(agent)
          const personas = await new GenericRecordsIdentityStore(agent).listPersonas()
          const offer = offerProofSetsAgain
          offerProofSetsAgain = false
          for (const persona of personas.filter((p) => p.vtaDid === vtaDid))
            await keepCardsInAgent(agent, store, persona, task, { offerProofSetsAgain: offer })
        } while (again && !stopped)
      } catch (e) {
        agent.config?.logger?.warn?.(`[VTI] keeping cards in the agent: ${(e as Error)?.message ?? e}`)
      } finally {
        running = false
      }
    }
    let wasConnected = vtaAgent.getState().status === 'connected'
    const unsubscribe = vtaAgent.subscribe(() => {
      const connected = vtaAgent.getState().status === 'connected'
      if (connected && !wasConnected) {
        offerProofSetsAgain = true
        void run()
      }
      wasConnected = connected
    })
    const sub = DeviceEventEmitter.addListener(VTI_PERSONA_DELIVERIES_EVENT, () => void run())
    void loadCardVault(agent).then(run, run)
    return () => {
      stopped = true
      unsubscribe()
      sub.remove()
    }
  }, [agent])
}
