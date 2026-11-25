/**
 * A data room's cards are told from a community's by the room's authority card: room actions, scoped to the
 * room's own DID. Bring back skips them, so a room never becomes a community on the phone.
 */
import {
  COMMUNITY,
  fakeAgent,
  fakeCommunityStore,
  fakeVault,
  membershipCard,
  persona,
  PERSONA_DID,
  ROOM,
  roleVac,
  roomAuthorityCard,
  roomMembershipCard,
} from '../../../../__tests__/helpers/cardVault'
import { forgetRoomCommunities, roomIssuersOf, withoutRoomCards } from '../module/roomCards'
import type { VtiMembership } from '../module/VtiCommunityStore'
import type { VtaMintedDid } from '../module/VtaClient'
import { adoptAgentIdentities } from '../module/vtiAdoptIdentities'
import { fetchAgentCards, forgetCardReads, recoverCardsFromAgent, resetCardVaultCache } from '../module/vtiCardVault'
import type { VtiIdentityStore, VtiPersona } from '../module/VtiIdentityStore'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

beforeEach(() => {
  forgetCardReads()
  resetCardVaultCache()
})

const card = (credential: Record<string, unknown>) => ({ id: String(credential.id), credential })

describe('which issuers are data rooms', () => {
  it("a room: its authority card grants room actions at the room's own DID", () => {
    expect([...roomIssuersOf([card(roomAuthorityCard), card(roomMembershipCard)])]).toEqual([ROOM])
  })

  it("a community is not: its authority card grants a role, at the community's DID", () => {
    expect(roomIssuersOf([card(roleVac), card(membershipCard)]).size).toBe(0)
  })

  it('an authority card scoped to another DID, or mixing a role with room actions, names no room', () => {
    const elsewhere = {
      ...roomAuthorityCard,
      credentialSubject: { id: PERSONA_DID, authority: { actions: ['read'], scope: COMMUNITY } },
    }
    const mixed = {
      ...roomAuthorityCard,
      credentialSubject: { id: PERSONA_DID, authority: { actions: ['read', 'role:member'], scope: ROOM } },
    }
    expect(roomIssuersOf([card(elsewhere), card(mixed)]).size).toBe(0)
  })

  it("leaves out both of a room's cards and keeps the community's", () => {
    const kept = withoutRoomCards([
      card(membershipCard),
      card(roomMembershipCard),
      card(roomAuthorityCard),
      card(roleVac),
    ])
    expect(kept.map((c) => c.id)).toEqual([membershipCard.id, roleVac.id])
  })
})

async function vaultWith(...cards: Record<string, unknown>[]) {
  const vault = fakeVault()
  for (const credential of cards)
    await vault.task('https://trusttasks.org/spec/vault/credentials/receive/0.1', { credential })
  return vault
}

function identities() {
  const map = new Map<string, VtiPersona>()
  const store = {
    getPersona: async (communityDid: string, vtaDid?: string) => map.get(`${vtaDid}|${communityDid}`),
    setPersona: jest.fn(async (p: VtiPersona) => void map.set(`${p.vtaDid}|${p.communityDid}`, p)),
  }
  return store as unknown as VtiIdentityStore & { setPersona: jest.Mock }
}

const listed = { did: PERSONA_DID, contextId: 'keyring', scid: 'Qm', serverId: 'serverless' } as unknown as VtaMintedDid

const adopt = async (vault: ReturnType<typeof fakeVault>, store: VtiIdentityStore) =>
  adoptAgentIdentities({
    identities: store,
    vtaDid: persona.vtaDid,
    cards: await fetchAgentCards(vault.task),
    check: async () => undefined,
    listDids: async () => [listed],
    keyIdsOf: async (did) => ({ signing: `${did}#key-0`, keyAgreement: `${did}#key-1` }),
    held: [],
  })

describe('Bring back, on an agent that holds a room', () => {
  it('takes on an identity for the community only, never for the room, and counts no room card', async () => {
    const vault = await vaultWith(membershipCard, roomMembershipCard, roomAuthorityCard)
    const store = identities()
    const report = await adopt(vault, store)
    expect(report.adopted.map((p) => p.communityDid)).toEqual([COMMUNITY])
    expect(store.setPersona).toHaveBeenCalledTimes(1)
    expect(report.cardsForOthers).toBe(1)
    expect(report.failedCheck).toEqual([])
  })

  it("a room's cards alone take nothing on, and count as no card for another identity", async () => {
    const report = await adopt(await vaultWith(roomMembershipCard, roomAuthorityCard), identities())
    expect(report.adopted).toEqual([])
    expect(report.cardsForOthers).toBe(0)
  })

  it('keeps the community membership, keeps nothing under the room, and refuses nothing', async () => {
    const vault = await vaultWith(membershipCard, roomMembershipCard, roomAuthorityCard)
    const { store, memberships } = fakeCommunityStore()
    const result = await recoverCardsFromAgent(fakeAgent().agent, store, persona, vault.task, {
      check: async () => undefined,
    })
    expect(result.restored).toEqual([membershipCard.id])
    expect(result.refused).toEqual([])
    expect(result.found).toBe(1)
    expect(memberships.has(COMMUNITY)).toBe(true)
    expect(memberships.has(ROOM)).toBe(false)
  })
})

/** A phone's community and identity records, keyed as the stores keep them: by community and identity, and by agent. */
function recorded(memberships: VtiMembership[], personas: VtiPersona[]) {
  const m = new Map(memberships.map((x) => [`${x.communityDid}|${x.personaDid}`, x]))
  const p = new Map(personas.map((x) => [`${x.vtaDid}|${x.communityDid}`, x]))
  return {
    memberships: m,
    personas: p,
    communities: {
      listMemberships: async () => [...m.values()],
      forgetCommunity: jest.fn(async (did: string, personaDid?: string) => {
        for (const [k, x] of m) if (x.communityDid === did && (!personaDid || x.personaDid === personaDid)) m.delete(k)
      }),
    },
    identities: {
      listPersonas: async () => [...p.values()],
      forgetPersona: jest.fn(async (did: string, vtaDid?: string) => {
        for (const [k, x] of p) if (x.communityDid === did && (!vtaDid || x.vtaDid === vtaDid)) p.delete(k)
      }),
    },
  }
}

const memberOf = (communityDid: string) => ({ communityDid, personaDid: PERSONA_DID }) as VtiMembership

describe('a room an earlier Bring back recorded as a community', () => {
  it('is forgotten, membership and identity record, and the community the identity belongs to is kept', async () => {
    const phone = recorded([memberOf(COMMUNITY), memberOf(ROOM)], [persona, { ...persona, communityDid: ROOM }])
    const forgotten = await forgetRoomCommunities({
      cards: [card(membershipCard), card(roleVac), card(roomMembershipCard), card(roomAuthorityCard)],
      communities: phone.communities,
      identities: phone.identities,
    })
    expect(forgotten).toEqual([ROOM])
    expect([...phone.memberships.values()].map((x) => x.communityDid)).toEqual([COMMUNITY])
    expect([...phone.personas.values()].map((x) => x.communityDid)).toEqual([COMMUNITY])
    expect(phone.communities.forgetCommunity).toHaveBeenCalledWith(ROOM, PERSONA_DID)
    expect(phone.identities.forgetPersona).toHaveBeenCalledWith(ROOM, persona.vtaDid)
  })

  it('nothing is forgotten when no card names a room', async () => {
    const phone = recorded([memberOf(COMMUNITY)], [persona])
    const forgotten = await forgetRoomCommunities({
      cards: [card(membershipCard), card(roleVac)],
      communities: phone.communities,
      identities: phone.identities,
    })
    expect(forgotten).toEqual([])
    expect(phone.communities.forgetCommunity).not.toHaveBeenCalled()
    expect(phone.identities.forgetPersona).not.toHaveBeenCalled()
  })
})
