/**
 * A persona's community cards, shown in the Wallet (226, option (a) on
 * keyring-bifold#167).
 *
 * The Wallet lists W3cCredentialRecords; a community's cards live in
 * VtiCommunityStore, which stays the source of truth. Each held card
 * (membership, role, vetter grant) gets a W3C copy so the Wallet's list,
 * search and Details work on it, and the copy never drifts from the store:
 *
 * - one writer: `syncCardsToWallet` is the only code that creates, replaces or
 *   deletes a copy, and it reconciles the whole set under one lock;
 * - a copy exists exactly while the store holds the card, the membership is
 *   not marked removed (a removal notice), and the card still stands
 *   (`cardStandingOf`): past its `validUntil`, or withdrawn as its status list
 *   last said, it leaves the Wallet and stays in the store, as history on the
 *   community card; renewed, or its status cleared, it comes back;
 * - it runs at start and after every change to the store
 *   (`COMMUNITY_CHANGED_EVENT`, which every store write announces), so a crash
 *   between a store write and its copy heals at the next run;
 * - a card the Wallet cannot store (Credo expands JSON-LD on store; a context
 *   the device cannot load fails there) is logged and retried at the next run,
 *   and never stops the other cards;
 * - orphans go: a W3C record whose credential is a DTG membership, role or
 *   vetter grant whose `id` no store record holds. Everything is matched by
 *   the credential's own `id`. Peer relationship cards and every other
 *   credential are left alone.
 *
 * @module trust-tasks/module/vtiWalletCards
 */
import { communityRoleCard, isCommunityIdentityCheck } from '@bifold/trust-tasks'
import { JsonTransformer, W3cCredentialRecord, type Agent } from '@credo-ts/core'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { useEffect } from 'react'
import { DeviceEventEmitter } from 'react-native'

import { COMMUNITY_CHANGED_EVENT, VTI_PERSONA_DELIVERIES_EVENT } from './communityChanged'
import { withKeyLock } from './keyedRecords'
import { roleNameOf } from './vtiInbox'
import { cardStandingOf, loadCardStanding, VTI_CARD_STANDING_EVENT } from './vtiCardStanding'
import { GenericRecordsCommunityStore, type VtiCommunityStore } from './VtiCommunityStore'

const LOCK = 'keyring/vti-wallet-cards'

type Json = Record<string, unknown>

const typesOf = (vc: Json): string[] =>
  Array.isArray(vc.type) ? vc.type.map(String) : vc.type ? [String(vc.type)] : []

/**
 * A community card this module mirrors: a DTG membership, or a role or vetter
 * grant — a `CommunityRole` endorsement, or a DTG Credentials v1 VAC
 * conferring `role:<name>` at the community (`communityRoleCard`).
 */
export function isCommunityCard(vc: Json): boolean {
  const t = typesOf(vc)
  if (!t.includes('DTGCredential')) return false
  if (t.includes('MembershipCredential')) return true
  const endorsement = (vc.credentialSubject as Json | undefined)?.endorsement as Json | undefined
  if (t.includes('EndorsementCredential') && endorsement?.type === 'CommunityRole') return true
  if (isCommunityIdentityCheck(vc)) return true
  return communityRoleCard(vc)?.shape === 'vac'
}

/**
 * The key the Wallet files a card under: the credential's own `id`, or, for a
 * card without one, a digest of its proof. A community's identity check may
 * have no `id` (the registry's example has none); keyed on its proof it is
 * still shown, and the same card read back in any member order is matched,
 * not added again. Undefined for a credential with neither.
 */
export function walletCardKey(vc: Json): string | undefined {
  if (typeof vc.id === 'string' && vc.id) return vc.id
  if (vc.proof === undefined || vc.proof === null) return undefined
  return `urn:keyring:card:${bytesToHex(sha256(utf8ToBytes(JSON.stringify(sortKeys(vc.proof)))))}`
}

/**
 * A role card that says only "member" beside the membership card it goes
 * with: the community issues both on admission (VTI vtc-service
 * ceremony/execute.rs AdmitOutcome), and side by side they read as the same
 * card twice, "Member of X" and "Member in X" (IN-109). The Wallet shows the
 * membership card alone. The role card stays in the store and in the agent's
 * vault, for proofs; a real role (admin, vetter, the community's own) keeps
 * its own card.
 */
const isPlainMemberRole = (vc: Json) => roleNameOf(vc)?.replace(/^custom:/, '') === 'member'

/** The cards the store holds that the Wallet shows, by `walletCardKey`. */
async function heldCards(store: VtiCommunityStore, now: number): Promise<Map<string, Json>> {
  const held = new Map<string, Json>()
  const add = (vc: Json | undefined) => {
    const key = vc ? walletCardKey(vc) : undefined
    if (vc && key && isCommunityCard(vc) && cardStandingOf(vc, now).state === 'held') {
      held.set(key, vc)
      return true
    }
    return false
  }
  const roleCards: { vc: Json; communityDid: string }[] = []
  const withMembershipCard = new Set<string>()
  for (const m of await store.listMemberships()) {
    // A membership the community removed is not a card the person holds.
    if ((m as { removal?: unknown }).removal) continue
    if (add(m.vmc)) withMembershipCard.add(m.communityDid)
    if (m.roleVec) roleCards.push({ vc: m.roleVec, communityDid: m.communityDid })
  }
  for (const h of await store.listHeldCredentials()) {
    if (h.kind === 'role') roleCards.push({ vc: h.credential, communityDid: h.communityDid })
    else if (h.kind === 'vetter-grant' || h.kind === 'identity-check') add(h.credential)
  }
  for (const { vc, communityDid } of roleCards) {
    if (withMembershipCard.has(communityDid) && isPlainMemberRole(vc)) continue
    add(vc)
  }
  return held
}

/**
 * A record's credential as it was stored. Read raw rather than through
 * `firstCredential`, which validates it as a JSON-LD credential and throws on
 * one it does not accept: a copy that could not be read back would be taken
 * for missing and stored again on every run.
 */
const jsonOf = (record: W3cCredentialRecord): Json | undefined => {
  const raw = record.credentialInstances?.[0]?.credential as unknown
  if (raw && typeof raw === 'object') return raw as Json
  try {
    return JsonTransformer.toJSON(record.firstCredential) as Json
  } catch {
    return undefined
  }
}

/**
 * Whether the Wallet can show a card: it reads each record's `firstCredential`
 * (W3cJsonLdVerifiableCredential validation), which refuses, for instance, a
 * proof with no `verificationMethod`. A card it cannot read is not copied, so
 * it can never break the Wallet; it stays on the community card.
 */
function walletCanRead(vc: Json): boolean {
  try {
    return Boolean(new W3cCredentialRecord({ credentialInstances: [{ credential: vc as never }] }).firstCredential)
  } catch {
    return false
  }
}

/** Same credential, member for member (key order aside). */
const sameCard = (a: Json, b: Json) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b))
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v as Json)
        .sort()
        .map((k) => [k, sortKeys((v as Json)[k])])
    )
  return v
}

/**
 * Store a copy. Reading (`walletCanRead`) is not the whole test: Credo expands
 * the credential's JSON-LD when it stores it, and a context the device cannot
 * load fails there and only there. So the store itself is the last check, and
 * its failure is reported for this card instead of ending the reconcile.
 */
async function storeCopy(agent: Agent, vc: Json): Promise<boolean> {
  try {
    await agent.w3cCredentials.store({
      record: new W3cCredentialRecord({ credentialInstances: [{ credential: vc as never }] }),
    })
    return true
  } catch (e) {
    agent.config?.logger?.warn?.(
      `[VTI] a community card could not be stored in the Wallet (${walletCardKey(vc) ?? 'no key'}): ${(e as Error)?.message ?? e}`
    )
    return false
  }
}

/**
 * Make the Wallet's copies match the store: add what is missing, replace what
 * changed, delete what the store no longer holds (and duplicates). One card
 * that cannot be stored does not stop the others; it is reported in `failed`
 * and tried again at the next reconcile. Returns what it did, for the log and
 * the tests.
 */
export function syncCardsToWallet(
  agent: Agent,
  store: VtiCommunityStore = new GenericRecordsCommunityStore(agent),
  options: { now?: number } = {}
): Promise<{ added: string[]; replaced: string[]; removed: string[]; failed: string[] }> {
  return withKeyLock(LOCK, async () => {
    const held = await heldCards(store, options.now ?? Date.now())
    const done = { added: [] as string[], replaced: [] as string[], removed: [] as string[], failed: [] as string[] }
    const seen = new Set<string>()
    // A copy that already matches the store is met first, so it is the one kept
    // when a replace was interrupted between storing the new copy and deleting
    // the old: the old is then a duplicate, and nothing is stored again.
    const current = (r: W3cCredentialRecord) => {
      const vc = jsonOf(r)
      const key = vc ? walletCardKey(vc) : undefined
      const want = key ? held.get(key) : undefined
      return vc && want && sameCard(vc, want) ? 0 : 1
    }
    const records = (await agent.w3cCredentials.getAll()).sort((a, b) => current(a) - current(b))
    for (const record of records) {
      const vc = jsonOf(record)
      if (!vc || !isCommunityCard(vc)) continue
      const id = walletCardKey(vc) ?? ''
      const want = held.get(id)
      if (!want || seen.has(id)) {
        await agent.w3cCredentials.deleteById(record.id)
        done.removed.push(id)
        continue
      }
      seen.add(id)
      if (sameCard(vc, want)) continue
      if (!walletCanRead(want)) {
        await agent.w3cCredentials.deleteById(record.id)
        done.removed.push(id)
      } else if (await storeCopy(agent, want)) {
        // The new copy first: a renewal that cannot be stored leaves the old one shown.
        await agent.w3cCredentials.deleteById(record.id)
        done.replaced.push(id)
      } else done.failed.push(id)
    }
    for (const [id, vc] of held) {
      if (seen.has(id)) continue
      if (!walletCanRead(vc)) {
        agent.config?.logger?.warn?.(`[VTI] a community card the Wallet cannot read is not shown there (${id})`)
        continue
      }
      if (await storeCopy(agent, vc)) done.added.push(id)
      else done.failed.push(id)
    }
    return done
  })
}

/** Keep the Wallet's copies in step with the store while the app runs. */
export function useVtiWalletCards(agent: Agent | undefined): void {
  useEffect(() => {
    if (!agent) return
    const run = () =>
      void syncCardsToWallet(agent).catch((e) =>
        agent.config?.logger?.warn?.(`[VTI] showing community cards in the Wallet: ${(e as Error)?.message ?? e}`)
      )
    const subs = [COMMUNITY_CHANGED_EVENT, VTI_PERSONA_DELIVERIES_EVENT, VTI_CARD_STANDING_EVENT].map((name) =>
      DeviceEventEmitter.addListener(name, run)
    )
    void loadCardStanding(agent).then(run, run)
    return () => subs.forEach((s) => s.remove())
  }, [agent])
}
