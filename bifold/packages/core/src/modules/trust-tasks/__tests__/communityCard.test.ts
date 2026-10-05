/**
 * "Your agent", one card per community (IN-20c): each card's status line and
 * its one next step, as a table; and the communities, each once.
 */
import { communityCardModel } from '../screens/communityCardModel'
import { communitiesHeld, ownHoldings } from '../screens/VtaAgentHome'
import type { CommunityJoinState } from '../module/vtiJoin'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const at = (kind: string) => ({ kind }) as unknown as CommunityJoinState
const base = { hasIdentity: true, invited: false, vetter: false }

describe('a community card: where the phone stands, and one next step', () => {
  test.each([
    ['a member', { ...base, join: at('member') }, 'Join.StandingMember', undefined],
    ['a member who vets', { ...base, join: at('member'), vetter: true }, 'Join.StandingMember', 'openDesk'],
    ['invited', { ...base, invited: true, join: at('none') }, 'VtaLink.InvitationWaiting', 'acceptInvitation'],
    ['an identity, nothing sent', { ...base, join: at('none') }, 'VtaLink.IdentityFor', 'continueVetting'],
    ['sent', { ...base, join: at('sent') }, 'Join.StandingSent', undefined],
    ['pending', { ...base, join: at('pending') }, 'Join.StandingPending', undefined],
    ['asked for more', { ...base, join: at('deferred') }, 'Join.StandingDeferred', 'continueVetting'],
    ['turned down', { ...base, join: at('rejected') }, 'Join.StandingRejected', undefined],
    ['removed', { ...base, join: at('removed') }, 'Join.StandingRemoved', undefined],
    ['left', { ...base, join: at('left') }, 'Join.StandingLeft', undefined],
    // The desk is a vetter's one way in from the home (the vetter card no longer has it).
    [
      'a vetter not yet holding the membership',
      { ...base, join: at('none'), vetter: true },
      'VtaLink.IdentityFor',
      'openDesk',
    ],
    [
      'a vetter with an invitation waiting',
      { ...base, join: at('none'), vetter: true, invited: true },
      'VtaLink.InvitationWaiting',
      'acceptInvitation',
    ],
  ] as const)('%s', (_name, facts, statusKey, primary) => {
    expect(communityCardModel(facts)).toEqual(primary ? { statusKey, primary } : { statusKey })
  })

  test('a member is a member, even with an old invitation lying about', () => {
    expect(communityCardModel({ ...base, join: at('member'), invited: true }).primary).toBeUndefined()
  })
})

describe('the communities on the page', () => {
  test('each community once, whether it is known by a membership, an identity or an invitation', () => {
    const A = 'did:webvh:QmA:a.example'
    const B = 'did:webvh:QmB:b.example'
    const C = 'did:webvh:QmC:c.example'
    expect(
      communitiesHeld({
        memberships: [{ communityDid: A }],
        personas: [{ communityDid: A }, { communityDid: B }],
        invited: [B, C],
      } as never)
    ).toEqual([A, B, C])
  })
})

// The several-agents device check (R5, 10-04): B's home said "Member of" a
// community only A had joined.
describe("an agent's home holds only its own identities", () => {
  const A = 'did:webvh:home:vta-a'
  const B = 'did:webvh:home:vta-b'
  const persona = (did: string, vtaDid?: string) => ({ did, communityDid: 'did:webvh:home:c', vtaDid }) as never
  const membership = (personaDid: string) => ({ communityDid: 'did:webvh:home:c', personaDid }) as never

  it("leaves out another agent's identity and its membership", () => {
    const held = ownHoldings([persona('p-a', A), persona('p-b', B)], [membership('p-a')], B)
    expect(held.personas.map((p) => p.did)).toEqual(['p-b'])
    expect(held.memberships).toEqual([])
  })

  it('keeps identities kept before agents were told apart, and a membership of no known identity', () => {
    const held = ownHoldings([persona('p-old')], [membership('p-old'), membership('p-unknown')], A)
    expect(held.personas.map((p) => p.did)).toEqual(['p-old'])
    expect(held.memberships).toHaveLength(2)
  })
})
