/**
 * Community cards in the Wallet (226, option (a) on keyring-bifold#167): a
 * W3C copy of each card the store holds and that still stands, made and
 * removed by one reconcile, so the two cannot drift.
 */
import { W3cCredentialRecord } from '@credo-ts/core'

import { cardStandingOf, recordCardRevocation, resetCardStanding } from '../module/vtiCardStanding'
import { syncCardsToWallet } from '../module/vtiWalletCards'

import {
  COMMUNITY,
  fakeAgent,
  fakeCommunityStore,
  membership,
  membershipCard,
  PERSONA_DID,
  roleCard,
  vetterGrantProofSet,
} from '../../../../__tests__/helpers/cardVault'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const NOW = Date.parse('2026-09-27T09:00:00Z')
const grantHeld = {
  kind: 'vetter-grant' as const,
  communityDid: COMMUNITY,
  subjectDid: PERSONA_DID,
  credential: vetterGrantProofSet,
  receivedAt: '2026-09-26T09:05:00Z',
}

/** An agent whose W3C records (real W3cCredentialRecords) live in memory beside its generic records. */
function walletAgent(seed: Record<string, unknown>[] = []) {
  const { agent } = fakeAgent()
  const records: W3cCredentialRecord[] = seed.map(
    (vc) => new W3cCredentialRecord({ credentialInstances: [{ credential: vc as never }] })
  )
  ;(agent as unknown as Record<string, unknown>).w3cCredentials = {
    getAll: async () => [...records],
    store: async ({ record }: { record: W3cCredentialRecord }) => {
      // Yield first, as a real store does, so two reconciles can interleave if unlocked.
      await new Promise((resolve) => setTimeout(resolve, 0))
      records.push(record)
    },
    deleteById: async (id: string) => {
      const at = records.findIndex((r) => r.id === id)
      if (at >= 0) records.splice(at, 1)
    },
  }
  const raw = (r: W3cCredentialRecord) => r.credentialInstances[0].credential as unknown as Record<string, unknown>
  const ids = () => records.map((r) => raw(r).id as string).sort()
  return { agent, records, ids, raw }
}

const peerVrc = {
  id: 'urn:uuid:peer-vrc',
  type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
  issuer: 'did:peer:someone',
  credentialSubject: { id: PERSONA_DID },
}
const openIdCard = { id: 'urn:uuid:openid', type: ['VerifiableCredential', 'UniversityDegree'], issuer: 'https://u' }

beforeEach(() => resetCardStanding())

describe('the Wallet shows the community cards the store holds', () => {
  it('adds a copy of each held card, and leaves every other credential alone', async () => {
    const { agent, ids } = walletAgent([peerVrc, openIdCard])
    const { store } = fakeCommunityStore({ memberships: [membership] })
    const done = await syncCardsToWallet(agent, store, { now: NOW })
    expect(done.added.sort()).toEqual([membershipCard.id, roleCard.id].sort())
    expect(ids()).toEqual([membershipCard.id, 'urn:uuid:openid', 'urn:uuid:peer-vrc', roleCard.id].sort())
  })

  it('removes the copy when the card leaves the store (left, forgotten, removed)', async () => {
    const { agent, ids } = walletAgent()
    const held = fakeCommunityStore({ memberships: [membership] })
    await syncCardsToWallet(agent, held.store, { now: NOW })
    held.memberships.delete(COMMUNITY)
    await syncCardsToWallet(agent, held.store, { now: NOW })
    expect(ids()).toEqual([])
    // A removal notice keeps the membership, marked; its cards leave the Wallet.
    const removed = fakeCommunityStore({ memberships: [{ ...membership, removal: { code: 'adminRemoved' } } as never] })
    await syncCardsToWallet(agent, removed.store, { now: NOW })
    expect(ids()).toEqual([])
  })

  it('heals a crash between the two writes: a missing copy is added, an orphan removed', async () => {
    const orphan = { ...membershipCard, id: 'urn:uuid:orphan' }
    const { agent, ids } = walletAgent([orphan])
    const { store } = fakeCommunityStore({ memberships: [{ ...membership, roleVec: undefined }] })
    const done = await syncCardsToWallet(agent, store, { now: NOW })
    expect(done).toMatchObject({ added: [membershipCard.id], removed: ['urn:uuid:orphan'] })
    expect(ids()).toEqual([membershipCard.id])
  })

  it('keeps one copy per card when a delivery and a recovery reconcile at once, and drops duplicates', async () => {
    const { agent, ids } = walletAgent([membershipCard, membershipCard])
    const { store } = fakeCommunityStore({ memberships: [membership] })
    await Promise.all([syncCardsToWallet(agent, store, { now: NOW }), syncCardsToWallet(agent, store, { now: NOW })])
    expect(ids()).toEqual([membershipCard.id, roleCard.id].sort())
  })

  it('replaces a copy whose card the store renewed', async () => {
    const { agent, records } = walletAgent([membershipCard])
    const renewed = { ...membershipCard, validUntil: '2026-11-26T09:00:00Z' }
    const { store } = fakeCommunityStore({ memberships: [{ ...membership, vmc: renewed, roleVec: undefined }] })
    const done = await syncCardsToWallet(agent, store, { now: NOW })
    expect(done.replaced).toEqual([membershipCard.id])
    expect(
      records.map((r) => (r.credentialInstances[0].credential as unknown as { validUntil: string }).validUntil)
    ).toEqual(['2026-11-26T09:00:00Z'])
  })
})

describe('what the Wallet itself reads', () => {
  it("stores copies the Wallet's JSON-LD reader accepts, a proof set among them", async () => {
    const { agent, records } = walletAgent()
    const { store } = fakeCommunityStore({ memberships: [membership], held: [grantHeld] })
    await syncCardsToWallet(agent, store, { now: NOW })
    expect(records).toHaveLength(3)
    // What the Wallet's list does with every record (W3cJsonLdVerifiableCredential validation).
    for (const r of records) expect(() => r.firstCredential).not.toThrow()
  })

  it('does not copy a card the Wallet could not read, and does not try again and again', async () => {
    const { agent, ids } = walletAgent()
    const unreadable = { ...membershipCard, proof: { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022' } }
    const { store } = fakeCommunityStore({ memberships: [{ ...membership, vmc: unreadable, roleVec: undefined }] })
    await syncCardsToWallet(agent, store, { now: NOW })
    await syncCardsToWallet(agent, store, { now: NOW })
    expect(ids()).toEqual([])
  })
})

describe('only while the card still stands', () => {
  it('gives the same object for the same answer, so a screen can use it as a snapshot', async () => {
    const expired = { ...membershipCard, validUntil: '2026-09-27T08:00:00Z' }
    expect(cardStandingOf(membershipCard, NOW)).toBe(cardStandingOf(membershipCard, NOW))
    expect(cardStandingOf(expired, NOW)).toBe(cardStandingOf(expired, NOW))
    const { agent } = walletAgent()
    await recordCardRevocation(agent, membershipCard.id, true, '2026-09-27T08:30:00Z')
    const revoked = cardStandingOf(membershipCard, NOW)
    expect(cardStandingOf(membershipCard, NOW)).toBe(revoked)
  })

  it('an expired card leaves the Wallet, and a renewed one comes back', async () => {
    const { agent, ids } = walletAgent()
    const expired = { ...membershipCard, validUntil: '2026-09-27T08:00:00Z' }
    const held = fakeCommunityStore({ memberships: [{ ...membership, vmc: expired, roleVec: undefined }] })
    await syncCardsToWallet(agent, held.store, { now: NOW })
    expect(ids()).toEqual([])
    expect(cardStandingOf(expired, NOW)).toEqual({ state: 'expired', at: '2026-09-27T08:00:00Z' })
    held.memberships.set(COMMUNITY, { ...membership, roleVec: undefined })
    await syncCardsToWallet(agent, held.store, { now: NOW })
    expect(ids()).toEqual([membershipCard.id])
  })

  it('a card its community withdrew leaves the Wallet, and comes back when its status clears', async () => {
    const { agent, ids } = walletAgent()
    const { store } = fakeCommunityStore({ memberships: [{ ...membership, roleVec: undefined }] })
    await syncCardsToWallet(agent, store, { now: NOW })
    expect(ids()).toEqual([membershipCard.id])
    await recordCardRevocation(agent, membershipCard.id, true, '2026-09-27T08:30:00Z')
    expect(cardStandingOf(membershipCard, NOW)).toEqual({ state: 'revoked', at: '2026-09-27T08:30:00Z' })
    await syncCardsToWallet(agent, store, { now: NOW })
    expect(ids()).toEqual([])
    await recordCardRevocation(agent, membershipCard.id, false)
    await syncCardsToWallet(agent, store, { now: NOW })
    expect(ids()).toEqual([membershipCard.id])
  })
})
