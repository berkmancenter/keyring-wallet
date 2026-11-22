/**
 * 241 gate (run 1014-2239, waiting leg): after a real admission the Wallet's
 * membership card never said "Role: member" (#399). A community issues the
 * membership card and the role card in two messages a few milliseconds apart,
 * and the phone keeps each as it arrives. A role card that came first, with no
 * membership yet, was held on its own and the membership saved after it never
 * took it; two arriving together each read the membership before the other
 * wrote it, and the membership card's write lost the role card. The tests
 * before fed a membership with its role card already on it.
 */
import { membershipCard, PERSONA_DID, roleCard } from '../../../../__tests__/helpers/cardVault'
import type { VtiCommunityStore, VtiHeldCredential, VtiMembership } from '../module/VtiCommunityStore'
import { CREDENTIAL_EXCHANGE_ISSUE, receiveIssue } from '../module/vtiInbox'
import { roleShownWithMembershipCard } from '../module/vtiWalletCards'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const COMMUNITY = membershipCard.issuer as string
const tick = () => new Promise((resolve) => setImmediate(resolve))

/** The community store, as the wallet's: every read and write takes a turn of the event loop. */
function slowStore() {
  const memberships = new Map<string, VtiMembership>()
  const held: VtiHeldCredential[] = []
  const store = {
    getMembership: async (did: string) => {
      await tick()
      const found = memberships.get(did)
      return found ? { ...found } : undefined
    },
    saveMembership: async (m: VtiMembership) => {
      await tick()
      memberships.set(m.communityDid, { ...m })
    },
    listMemberships: async () => [...memberships.values()],
    saveHeldCredential: async (h: VtiHeldCredential) => {
      await tick()
      held.push(h)
    },
    listHeldCredentials: async (kind?: string, communityDid?: string) =>
      held.filter((h) => (!kind || h.kind === kind) && (!communityDid || h.communityDid === communityDid)),
  }
  return { store: store as unknown as VtiCommunityStore, memberships, held }
}

const issue = (credential: Record<string, unknown>) => ({
  id: `urn:uuid:${String(credential.id).slice(-12)}`,
  type: CREDENTIAL_EXCHANGE_ISSUE,
  from: COMMUNITY,
  body: { credential_response: { credential } },
})

const deliver = (store: VtiCommunityStore, credential: Record<string, unknown>) =>
  receiveIssue(store, PERSONA_DID, issue(credential) as never, { via: 'vetting', checkCard: async () => undefined })

describe('the membership card and the role card, as a live join delivers them', () => {
  it('the role card first, then the membership card: the membership keeps the role card', async () => {
    const { store, memberships } = slowStore()
    await deliver(store, roleCard)
    await deliver(store, membershipCard)
    expect(memberships.get(COMMUNITY)?.roleVec).toEqual(roleCard)
    expect(await roleShownWithMembershipCard(store, membershipCard)).toBe('member')
  })

  it('both at once, either way round: the role card is not lost', async () => {
    for (const order of [
      [membershipCard, roleCard],
      [roleCard, membershipCard],
    ]) {
      const { store, memberships } = slowStore()
      await Promise.all(order.map((credential) => deliver(store, credential)))
      expect(memberships.get(COMMUNITY)?.vmc).toEqual(membershipCard)
      expect(memberships.get(COMMUNITY)?.roleVec).toEqual(roleCard)
      expect(await roleShownWithMembershipCard(store, membershipCard)).toBe('member')
    }
  })

  it('the membership card first, then the role card: as before', async () => {
    const { store, memberships } = slowStore()
    await deliver(store, membershipCard)
    await deliver(store, roleCard)
    expect(memberships.get(COMMUNITY)?.roleVec).toEqual(roleCard)
  })

  it('a phone that already kept the role card on its own still says the role on the membership card', async () => {
    const { store, memberships, held } = slowStore()
    memberships.set(COMMUNITY, {
      communityDid: COMMUNITY,
      personaDid: PERSONA_DID,
      role: 'member',
      vmc: membershipCard,
      grantedAt: '2026-09-26T09:00:00Z',
      via: 'vetting',
    })
    held.push({
      kind: 'role',
      communityDid: COMMUNITY,
      subjectDid: PERSONA_DID,
      credential: roleCard,
      receivedAt: '2026-09-26T09:00:00Z',
    } as VtiHeldCredential)
    expect(await roleShownWithMembershipCard(store, membershipCard)).toBe('member')
  })
})
