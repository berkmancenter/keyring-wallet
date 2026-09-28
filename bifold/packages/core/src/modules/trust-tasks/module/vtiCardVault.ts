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
 * community that signs with two keys carries a proof set, which the vault
 * refuses today (VTI-44 (e)).
 *
 * Each card's state is persisted, keyed by the credential's own `id` (the same
 * on every phone, so recovery can match), and read synchronously from a cache
 * for the screens (`cardVaultStateOf`, `subscribeCardVault`).
 *
 * @module trust-tasks/module/vtiCardVault
 */
import type { Agent } from '@credo-ts/core'
import { useEffect } from 'react'
import { DeviceEventEmitter } from 'react-native'

import { VTI_PERSONA_DELIVERIES_EVENT } from './communityChanged'
import { listKeyed, putKeyed } from './keyedRecords'
import { vtaAgent } from './vtaAgent'
import { GenericRecordsCommunityStore, type VtiCommunityStore } from './VtiCommunityStore'
import { GenericRecordsIdentityStore, type VtiPersona } from './VtiIdentityStore'
import { checkDeliveredCard, VtiCardStatusUnreadable } from './vtiDeliveredCheck'
import { classifyCredential } from './vtiInbox'

export const VAULT_RECEIVE = 'https://trusttasks.org/spec/vault/credentials/receive/0.1'
export const VAULT_QUERY = 'https://trusttasks.org/spec/vault/credentials/query/0.1'
export const VAULT_GET = 'https://trusttasks.org/spec/vault/credentials/get/0.1'

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

/** For tests: forget the cache. */
export function resetCardVaultCache(): void {
  cache.clear()
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
 */
export async function keepCardsInAgent(
  agent: Agent,
  store: VtiCommunityStore,
  persona: VtiPersona,
  task: VaultTask
): Promise<{ kept: string[]; cannotKeep: string[]; pending: string[] }> {
  const result = { kept: [] as string[], cannotKeep: [] as string[], pending: [] as string[] }
  for (const card of await cardsOf(store, persona)) {
    const now = cardVaultStateOf(card.credentialId)
    if (now.state === 'kept' || now.state === 'cannotKeep') continue
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
      } else {
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

/**
 * Fetch what the agent keeps for this persona and keep, on this phone, each
 * card that is about the persona and still holds up (vtiDeliveredCheck). The
 * vault answers only a filtered query, so it is asked by purpose: the receive
 * derives the purpose from the card's type, and a role or a vetter grant, typed
 * `EndorsementCredential`, is filed as an endorsement (vta-vault receive.rs
 * `purpose_of`).
 */
export async function recoverCardsFromAgent(
  agent: Agent,
  store: VtiCommunityStore,
  persona: VtiPersona,
  task: VaultTask,
  options: {
    onProgress?: (p: { found: number; restored: number }) => void
    check?: (credential: Record<string, unknown>, issuer: string) => Promise<string | undefined>
  } = {}
): Promise<{ found: number; restored: string[]; refused: RecoveredRefusal[] }> {
  const check = options.check ?? ((c, issuer) => checkDeliveredCard(agent, c, issuer))
  const ids = new Set<string>()
  for (const purpose of ['membership', 'role', 'endorsement']) {
    const answer = await task<{ credentials?: { id?: string }[] }>(VAULT_QUERY, { purpose })
    for (const d of answer?.credentials ?? []) if (typeof d.id === 'string' && d.id) ids.add(d.id)
  }
  const restored: string[] = []
  const refused: RecoveredRefusal[] = []
  options.onProgress?.({ found: ids.size, restored: 0 })
  for (const id of ids) {
    const got = await task<{ credential?: Record<string, unknown> }>(VAULT_GET, { id }).catch(() => undefined)
    const credential = got?.credential
    if (!credential) {
      refused.push({ credentialId: id, reason: 'unreadable' })
      continue
    }
    const item = classifyCredential(credential)
    if (item.subjectDid !== persona.did || !item.communityDid) {
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
    if (item.kind === 'membership') {
      const existing = await store.getMembership(item.communityDid)
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
      const existing = await store.getMembership(item.communityDid)
      const role = String(
        ((credential.credentialSubject as Record<string, unknown>)?.endorsement as Record<string, unknown>)?.role ??
          'member'
      )
      if (existing) await store.saveMembership({ ...existing, role, roleVec: credential })
      else await store.saveHeldCredential({ ...item, kind: 'role' })
    } else if (item.kind === 'vetter-grant') {
      await store.saveHeldCredential({ ...item, kind: 'vetter-grant' })
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
    restored.push(id)
    options.onProgress?.({ found: ids.size, restored: restored.length })
  }
  return { found: ids.size, restored, refused }
}

// ---------------------------------------------------------------------------
// Keeping them there, while the app runs
// ---------------------------------------------------------------------------

/**
 * Keep every persona's cards in its agent: once the agent is connected, again
 * whenever it reconnects, and whenever a new card arrives. One run at a time;
 * a card already kept, or one the agent refused, is not sent again.
 */
export function useVtiCardVault(agent: Agent | undefined): void {
  useEffect(() => {
    if (!agent) return
    let running = false
    let again = false
    let stopped = false
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
          for (const persona of personas.filter((p) => p.vtaDid === vtaDid))
            await keepCardsInAgent(agent, store, persona, task)
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
      if (connected && !wasConnected) void run()
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
