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
 * - orphans go: a W3C record whose credential is a DTG membership, role or
 *   vetter grant whose `id` no store record holds. Everything is matched by
 *   the credential's own `id`. Peer relationship cards and every other
 *   credential are left alone.
 *
 * @module trust-tasks/module/vtiWalletCards
 */
import { JsonTransformer, W3cCredentialRecord, type Agent } from '@credo-ts/core'
import { useEffect } from 'react'
import { DeviceEventEmitter } from 'react-native'

import { COMMUNITY_CHANGED_EVENT, VTI_PERSONA_DELIVERIES_EVENT } from './communityChanged'
import { withKeyLock } from './keyedRecords'
import { cardStandingOf, loadCardStanding, VTI_CARD_STANDING_EVENT } from './vtiCardStanding'
import { GenericRecordsCommunityStore, type VtiCommunityStore } from './VtiCommunityStore'

const LOCK = 'keyring/vti-wallet-cards'

type Json = Record<string, unknown>

const typesOf = (vc: Json): string[] =>
  Array.isArray(vc.type) ? vc.type.map(String) : vc.type ? [String(vc.type)] : []

/** A community card this module mirrors: a DTG membership, or a role or vetter grant (`CommunityRole`). */
export function isCommunityCard(vc: Json): boolean {
  const t = typesOf(vc)
  if (!t.includes('DTGCredential')) return false
  if (t.includes('MembershipCredential')) return true
  const endorsement = (vc.credentialSubject as Json | undefined)?.endorsement as Json | undefined
  return t.includes('EndorsementCredential') && endorsement?.type === 'CommunityRole'
}

/** The cards the store holds that the Wallet shows, by the credential's own id. */
async function heldCards(store: VtiCommunityStore, now: number): Promise<Map<string, Json>> {
  const held = new Map<string, Json>()
  const add = (vc: Json | undefined) => {
    if (vc && typeof vc.id === 'string' && vc.id && isCommunityCard(vc) && cardStandingOf(vc, now).state === 'held')
      held.set(vc.id, vc)
  }
  for (const m of await store.listMemberships()) {
    // A membership the community removed is not a card the person holds.
    if ((m as { removal?: unknown }).removal) continue
    add(m.vmc)
    add(m.roleVec)
  }
  for (const h of await store.listHeldCredentials())
    if (h.kind === 'role' || h.kind === 'vetter-grant') add(h.credential)
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
 * Make the Wallet's copies match the store: add what is missing, replace what
 * changed, delete what the store no longer holds (and duplicates). Returns
 * what it did, for the log and the tests.
 */
export function syncCardsToWallet(
  agent: Agent,
  store: VtiCommunityStore = new GenericRecordsCommunityStore(agent),
  options: { now?: number } = {}
): Promise<{ added: string[]; replaced: string[]; removed: string[] }> {
  return withKeyLock(LOCK, async () => {
    const held = await heldCards(store, options.now ?? Date.now())
    const done = { added: [] as string[], replaced: [] as string[], removed: [] as string[] }
    const seen = new Set<string>()
    for (const record of await agent.w3cCredentials.getAll()) {
      const vc = jsonOf(record)
      if (!vc || !isCommunityCard(vc)) continue
      const id = typeof vc.id === 'string' ? vc.id : ''
      const want = held.get(id)
      if (!want || seen.has(id)) {
        await agent.w3cCredentials.deleteById(record.id)
        done.removed.push(id)
        continue
      }
      seen.add(id)
      if (!sameCard(vc, want)) {
        await agent.w3cCredentials.deleteById(record.id)
        if (walletCanRead(want)) {
          await agent.w3cCredentials.store({
            record: new W3cCredentialRecord({ credentialInstances: [{ credential: want as never }] }),
          })
          done.replaced.push(id)
        } else done.removed.push(id)
      }
    }
    for (const [id, vc] of held) {
      if (seen.has(id)) continue
      if (!walletCanRead(vc)) {
        agent.config?.logger?.warn?.(`[VTI] a community card the Wallet cannot read is not shown there (${id})`)
        continue
      }
      await agent.w3cCredentials.store({
        record: new W3cCredentialRecord({ credentialInstances: [{ credential: vc as never }] }),
      })
      done.added.push(id)
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
