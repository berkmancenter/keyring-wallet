/**
 * "Your agent", one card per community (IN-20c): each card's status line and
 * its one next step, as a table; and the communities, each once.
 */
import { communityCardModel } from '../screens/communityCardModel'
import { communitiesHeld } from '../screens/VtaAgentHome'
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
