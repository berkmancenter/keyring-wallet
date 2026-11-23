/**
 * A membership the community removed (its signed removal notice, #166) is
 * ended: nothing that reads memberships treats it as current. Found in the
 * lab run of #166 (09-29): the removal was stored, and My Agent still said
 * "You are a member".
 */
import { isCurrentMembership } from '../module/VtiCommunityStore'
import { keepCardsInAgent, resetCardVaultCache, VAULT_RECEIVE } from '../module/vtiCardVault'
import { CREDENTIAL_EXCHANGE_ISSUE, receiveIssue } from '../module/vtiInbox'
import { fakeAgent, fakeCommunityStore, fakeVault, membership, persona } from '../../../../__tests__/helpers/cardVault'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const removal = {
  code: 'adminRemoved' as const,
  reason: 'Left the project',
  decidedBy: 'did:webvh:QmAdmin:vtc.example:admin',
  decidedAt: '2026-09-29T18:20:00Z',
  disposition: 'tombstone' as const,
  noticeId: 'urn:uuid:removal-notice-1',
}

describe('a removed membership is not current', () => {
  it('is ended once the community removed it', () => {
    expect(isCurrentMembership(membership)).toBe(true)
    expect(isCurrentMembership({ ...membership, removal })).toBe(false)
  })
})

describe("the agent does not keep a removed membership's cards", () => {
  beforeEach(() => resetCardVaultCache())

  it('sends nothing for it', async () => {
    const { agent } = fakeAgent()
    const { store } = fakeCommunityStore({ memberships: [{ ...membership, removal }] })
    const vault = fakeVault()
    const result = await keepCardsInAgent(agent, store, persona, vault.task)
    expect(result.kept).toEqual([])
    expect(vault.calls.filter((c) => c.type === VAULT_RECEIVE)).toHaveLength(0)
  })
})

describe('joining again after a removal', () => {
  const COMMUNITY = membership.communityDid
  const card = {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    id: 'urn:uuid:new-membership-after-removal',
    type: ['VerifiableCredential', 'MembershipCredential'],
    issuer: COMMUNITY,
    validFrom: '2026-09-29T19:00:00Z',
    credentialSubject: { id: membership.personaDid },
  }
  const message = {
    id: 'urn:uuid:issue-1',
    type: CREDENTIAL_EXCHANGE_ISSUE,
    from: COMMUNITY,
    body: { credential_response: { credential: card } },
  }
  const deliver = async (existing: object) => {
    const stored: Record<string, unknown>[] = []
    const store = {
      getMembership: async () => existing,
      saveMembership: async (m: Record<string, unknown>) => void stored.push(m),
      saveHeldCredential: async () => undefined,
    }
    await receiveIssue(
      store as never,
      membership.personaDid,
      message as never,
      { checkCard: async () => undefined } as never
    )
    return stored[0]
  }

  it("starts afresh: no removal, and nothing carried over from the ended membership's role", async () => {
    const saved = await deliver({ ...membership, role: 'admin', via: 'invitation', removal })
    expect(saved).toMatchObject({ communityDid: COMMUNITY, role: 'member', vmc: card })
    expect(saved).not.toHaveProperty('removal')
    expect(saved.roleVec).toBeUndefined()
    expect(saved.via).toBe('unknown')
  })

  it('the very card the community ended, delivered again, does not bring the membership back', async () => {
    const saved = await deliver({ ...membership, vmc: card, removal })
    expect(saved).toBeUndefined()
  })

  it('a current membership keeps its role when its card is renewed, as before', async () => {
    const saved = await deliver({ ...membership, role: 'admin', via: 'invitation' })
    expect(saved).toMatchObject({ role: 'admin', via: 'invitation', roleVec: membership.roleVec })
  })
})
