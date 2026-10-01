/**
 * Agent-kept cards (226): a persona's community cards are kept by its own
 * agent, as openvtc keeps its memberships (credential_sync.rs), a bit further,
 * and a new phone gets them back (rebuild.rs).
 */
import { DeviceEventEmitter } from 'react-native'

import {
  cardVaultStateOf,
  keepCardsInAgent,
  loadCardVault,
  recoverCardsFromAgent,
  resetCardVaultCache,
  subscribeCardVault,
  VAULT_QUERY,
  VAULT_RECEIVE,
} from '../module/vtiCardVault'

import {
  COMMUNITY,
  fakeAgent,
  fakeCommunityStore,
  fakeVault,
  membership,
  membershipCard,
  persona,
  PERSONA_DID,
  roleCard,
  seedCardVaultState,
  vetterGrantProofSet,
} from '../../../../__tests__/helpers/cardVault'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const grantHeld = {
  kind: 'vetter-grant' as const,
  communityDid: COMMUNITY,
  subjectDid: PERSONA_DID,
  credential: vetterGrantProofSet,
  receivedAt: '2026-09-26T09:05:00Z',
}

beforeEach(() => resetCardVaultCache())
afterEach(() => jest.restoreAllMocks())

describe("keeping a persona's cards in its agent", () => {
  it("sends the membership and role cards to the agent, filed under the persona's own context", async () => {
    const { agent } = fakeAgent()
    const { store } = fakeCommunityStore({ memberships: [membership] })
    const vault = fakeVault()
    const result = await keepCardsInAgent(agent, store, persona, vault.task)
    expect(result.kept.sort()).toEqual([membershipCard.id, roleCard.id].sort())
    expect(vault.calls.filter((c) => c.type === VAULT_RECEIVE)).toHaveLength(2)
    for (const c of vault.calls) expect(c.payload.contextId).toBe(persona.contextId)
    expect(cardVaultStateOf(membershipCard.id)).toMatchObject({ state: 'kept' })
  })

  it('sends a kept card once', async () => {
    const { agent } = fakeAgent()
    const { store } = fakeCommunityStore({ memberships: [membership] })
    const vault = fakeVault()
    await keepCardsInAgent(agent, store, persona, vault.task)
    await keepCardsInAgent(agent, store, persona, vault.task)
    expect(vault.calls.filter((c) => c.type === VAULT_RECEIVE)).toHaveLength(2)
  })

  it("marks a card the agent cannot hold, a proof set's, and keeps it on the phone", async () => {
    const { agent } = fakeAgent()
    const { store, held } = fakeCommunityStore({ held: [grantHeld] })
    const vault = fakeVault()
    const result = await keepCardsInAgent(agent, store, persona, vault.task)
    expect(result.cannotKeep).toEqual([vetterGrantProofSet.id])
    expect(cardVaultStateOf(vetterGrantProofSet.id)).toEqual({ state: 'cannotKeep', reason: 'proofSet' })
    expect(held).toHaveLength(1)
    // Not retried: the agent would refuse it again.
    await keepCardsInAgent(agent, store, persona, vault.task)
    expect(vault.calls.filter((c) => c.type === VAULT_RECEIVE)).toHaveLength(1)
  })

  it('leaves a card pending when the agent does not answer, and sends it when it does', async () => {
    const { agent } = fakeAgent()
    const { store } = fakeCommunityStore({ memberships: [{ ...membership, roleVec: undefined }] })
    const offline = fakeVault({ offline: true })
    expect((await keepCardsInAgent(agent, store, persona, offline.task)).pending).toEqual([membershipCard.id])
    expect(cardVaultStateOf(membershipCard.id)).toEqual({ state: 'pending' })
    const online = fakeVault()
    expect((await keepCardsInAgent(agent, store, persona, online.task)).kept).toEqual([membershipCard.id])
  })

  // VTI #1868 (VTI-44): a VTA's vault keeps a proof-set card. A card refused
  // for its proof set is offered again once per connect, so a phone whose agent
  // has been upgraded keeps it there without anyone doing anything.
  it('offers a card refused for its proof set again when asked (a reconnect), and keeps it once the agent can', async () => {
    const { agent } = fakeAgent()
    const { store } = fakeCommunityStore({ held: [grantHeld] })
    await keepCardsInAgent(agent, store, persona, fakeVault().task)
    expect(cardVaultStateOf(vetterGrantProofSet.id)).toEqual({ state: 'cannotKeep', reason: 'proofSet' })
    const upgraded = fakeVault({ acceptsProofSets: true })
    const result = await keepCardsInAgent(agent, store, persona, upgraded.task, { offerProofSetsAgain: true })
    expect(result.kept).toEqual([vetterGrantProofSet.id])
    expect(upgraded.calls.filter((c) => c.type === VAULT_RECEIVE)).toHaveLength(1)
    expect(cardVaultStateOf(vetterGrantProofSet.id)).toMatchObject({ state: 'kept' })
  })

  it('does not offer it again between connects (a new delivery is not a reconnect)', async () => {
    const { agent } = fakeAgent()
    const { store } = fakeCommunityStore({ held: [grantHeld] })
    await keepCardsInAgent(agent, store, persona, fakeVault().task)
    const upgraded = fakeVault({ acceptsProofSets: true })
    await keepCardsInAgent(agent, store, persona, upgraded.task)
    expect(upgraded.calls).toHaveLength(0)
  })

  it('an agent that still refuses it: one send per reconnect, and the card stays marked', async () => {
    const { agent } = fakeAgent()
    const { store } = fakeCommunityStore({ held: [grantHeld] })
    const old = fakeVault()
    await keepCardsInAgent(agent, store, persona, old.task)
    const result = await keepCardsInAgent(agent, store, persona, old.task, { offerProofSetsAgain: true })
    expect(result.cannotKeep).toEqual([vetterGrantProofSet.id])
    expect(old.calls.filter((c) => c.type === VAULT_RECEIVE)).toHaveLength(2)
    expect(cardVaultStateOf(vetterGrantProofSet.id)).toEqual({ state: 'cannotKeep', reason: 'proofSet' })
  })

  it('an unanswered second offer leaves the card as it was, not pending', async () => {
    const { agent } = fakeAgent()
    const { store } = fakeCommunityStore({ held: [grantHeld] })
    await keepCardsInAgent(agent, store, persona, fakeVault().task)
    const result = await keepCardsInAgent(agent, store, persona, fakeVault({ offline: true }).task, {
      offerProofSetsAgain: true,
    })
    expect(result.pending).toEqual([])
    expect(cardVaultStateOf(vetterGrantProofSet.id)).toEqual({ state: 'cannotKeep', reason: 'proofSet' })
  })

  it('never offers again a card the agent refused for another reason', async () => {
    const { agent } = fakeAgent()
    const { store } = fakeCommunityStore({ memberships: [{ ...membership, roleVec: undefined }] })
    const refusing = fakeVault({ refuses: [membershipCard.id] })
    await keepCardsInAgent(agent, store, persona, refusing.task)
    expect(cardVaultStateOf(membershipCard.id)).toEqual({ state: 'cannotKeep', reason: 'refusedByAgent' })
    const upgraded = fakeVault({ acceptsProofSets: true })
    await keepCardsInAgent(agent, store, persona, upgraded.task, { offerProofSetsAgain: true })
    expect(upgraded.calls).toHaveLength(0)
    expect(cardVaultStateOf(membershipCard.id)).toEqual({ state: 'cannotKeep', reason: 'refusedByAgent' })
  })

  it("leaves another persona's cards alone", async () => {
    const { agent } = fakeAgent()
    const { store } = fakeCommunityStore({ memberships: [{ ...membership, personaDid: 'did:webvh:QmOther:p' }] })
    const vault = fakeVault()
    expect((await keepCardsInAgent(agent, store, persona, vault.task)).kept).toEqual([])
  })
})

describe('what the screens read', () => {
  it('reads a state at once, and hears when it changes', async () => {
    const { agent } = fakeAgent()
    const { store } = fakeCommunityStore({ memberships: [{ ...membership, roleVec: undefined }] })
    expect(cardVaultStateOf(membershipCard.id)).toEqual({ state: 'notYetKept' })
    const heard = jest.fn()
    const stop = subscribeCardVault(heard)
    await keepCardsInAgent(agent, store, persona, fakeVault().task)
    expect(heard).toHaveBeenCalled()
    stop()
    expect(cardVaultStateOf(membershipCard.id)).toMatchObject({ state: 'kept' })
  })

  it('returns the same object until the state changes, so it can be a snapshot as it is', async () => {
    expect(cardVaultStateOf('urn:uuid:never-sent')).toBe(cardVaultStateOf('urn:uuid:never-sent'))
    const { agent } = fakeAgent()
    const { store } = fakeCommunityStore({ memberships: [{ ...membership, roleVec: undefined }] })
    await keepCardsInAgent(agent, store, persona, fakeVault().task)
    expect(cardVaultStateOf(membershipCard.id)).toBe(cardVaultStateOf(membershipCard.id))
  })

  it('can be put in any state for a screen test, and says so to subscribers', () => {
    const heard = jest.fn()
    const stop = subscribeCardVault(heard)
    seedCardVaultState(vetterGrantProofSet.id, { state: 'cannotKeep', reason: 'proofSet' })
    stop()
    expect(heard).toHaveBeenCalledTimes(1)
    expect(cardVaultStateOf(vetterGrantProofSet.id)).toEqual({ state: 'cannotKeep', reason: 'proofSet' })
  })

  it('remembers across a relaunch', async () => {
    const { agent } = fakeAgent()
    const { store } = fakeCommunityStore({ memberships: [{ ...membership, roleVec: undefined }] })
    await keepCardsInAgent(agent, store, persona, fakeVault().task)
    resetCardVaultCache()
    expect(cardVaultStateOf(membershipCard.id)).toEqual({ state: 'notYetKept' })
    const emit = jest.spyOn(DeviceEventEmitter, 'emit')
    await loadCardVault(agent)
    expect(cardVaultStateOf(membershipCard.id)).toMatchObject({ state: 'kept' })
    expect(emit).toHaveBeenCalledWith('vti:card-vault', {})
  })
})

describe('getting the cards back on a new phone', () => {
  async function agentThatKept() {
    const old = fakeAgent()
    const vault = fakeVault()
    await keepCardsInAgent(old.agent, fakeCommunityStore({ memberships: [membership] }).store, persona, vault.task)
    return vault
  }

  it('asks the vault by purpose, fetches each card, checks it, and keeps it on this phone', async () => {
    const vault = await agentThatKept()
    resetCardVaultCache()
    const fresh = fakeAgent()
    const { store, memberships } = fakeCommunityStore()
    const progress: { found: number; restored: number }[] = []
    const check = jest.fn(async () => undefined)
    const result = await recoverCardsFromAgent(fresh.agent, store, persona, vault.task, {
      check,
      onProgress: (p) => progress.push(p),
    })
    expect(vault.calls.filter((c) => c.type === VAULT_QUERY).map((c) => c.payload)).toEqual([
      { purpose: 'membership' },
      { purpose: 'role' },
      { purpose: 'endorsement' },
    ])
    expect(result.found).toBe(2)
    expect(result.restored.sort()).toEqual([membershipCard.id, roleCard.id].sort())
    expect(check).toHaveBeenCalledWith(membershipCard, COMMUNITY)
    expect(memberships.get(COMMUNITY)).toMatchObject({
      vmc: membershipCard,
      roleVec: roleCard,
      personaDid: PERSONA_DID,
    })
    expect(progress[0]).toEqual({ found: 2, restored: 0 })
    expect(progress.at(-1)).toEqual({ found: 2, restored: 2 })
    expect(cardVaultStateOf(membershipCard.id)).toMatchObject({ state: 'kept' })
  })

  it('does not keep a card that fails its check, or one about someone else', async () => {
    const vault = await agentThatKept()
    const other = { ...persona, did: 'did:webvh:QmOther:dids.example:other' }
    const notOurs = await recoverCardsFromAgent(fakeAgent().agent, fakeCommunityStore().store, other, vault.task, {
      check: async () => undefined,
    })
    expect(notOurs.restored).toEqual([])
    expect(notOurs.refused.map((r) => r.reason)).toEqual(['notOurs', 'notOurs'])
    const failing = await recoverCardsFromAgent(fakeAgent().agent, fakeCommunityStore().store, persona, vault.task, {
      check: async () => 'proof',
    })
    expect(failing.restored).toEqual([])
    expect(failing.refused.map((r) => r.reason)).toEqual(['failedCheck', 'failedCheck'])
  })
})
