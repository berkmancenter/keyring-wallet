import { encodeTicketUri } from '@bifold/trust-tasks'

import {
  buildCommunityLink,
  communityTarget,
  parseCommunityLink,
  resolveChosenCommunityDid,
  resolveCommunityDid,
} from '../module/vtiCommunityLink'
import { keyringAgentLinkKind, routeKeyringAgentLink } from '../module/vtiLinks'
import { communityLabelOf } from '../screens/communityName'

// Which community a join is about comes from a link, not the build: a
// community link, a vetter's ticket, or an invitation.

jest.mock('../module/VtiCommunityStore', () => ({
  GenericRecordsCommunityStore: jest.fn(() => ({ saveInvitation: jest.fn(async () => undefined) })),
}))

const community = 'did:webvh:QmCommunity:vtc.example.org'

describe('the community link', () => {
  beforeEach(() => communityTarget.clear())

  it('round-trips, with and without a name', () => {
    expect(parseCommunityLink(buildCommunityLink({ communityDid: community }))).toEqual({ communityDid: community })
    const named = buildCommunityLink({ communityDid: community, name: 'Keyring Lab & Friends' })
    expect(parseCommunityLink(named)).toEqual({ communityDid: community, name: 'Keyring Lab & Friends' })
    expect(keyringAgentLinkKind(named)).toBe('community')
  })

  it('refuses a link that names no community', () => {
    expect(() => parseCommunityLink('keyring://vti/community?d=not-a-did')).toThrow('names no community')
    expect(() => parseCommunityLink('keyring://vti/invitation?c=abc')).toThrow('not a community link')
  })

  it('a link chooses the community; the build only suggests one', () => {
    expect(resolveCommunityDid('did:webvh:QmBuilt:built.example')).toBe('did:webvh:QmBuilt:built.example')
    communityTarget.set({ communityDid: community })
    expect(resolveCommunityDid('did:webvh:QmBuilt:built.example')).toBe(community)
  })

  it('routes to "Join a community" with that community chosen', async () => {
    const navigate = jest.fn()
    await routeKeyringAgentLink(buildCommunityLink({ communityDid: community, name: 'Lab' }), {} as never, navigate)
    expect(navigate).toHaveBeenCalledWith('VtiJoin')
    expect(communityTarget.get()).toEqual({ communityDid: community, name: 'Lab' })
  })

  it("a vetter's ticket chooses the community it names", async () => {
    const ticket = encodeTicketUri({
      community,
      vetter: 'did:webvh:QmVetter:vtc.example.org:vetter',
      presentation: { code: { code: 'ABCD-EFGH' } },
    } as never)
    await routeKeyringAgentLink(ticket, {} as never, jest.fn())
    expect(communityTarget.get()?.communityDid).toBe(community)
  })

  it('viewing a link changes nothing kept; making an identity chooses the community, kept across launches', async () => {
    communityTarget.clear()
    communityTarget.set({ communityDid: community, name: 'Kept' })
    expect(communityTarget.get()?.communityDid).toBe(community)
    expect(resolveChosenCommunityDid('did:webvh:QmBuilt:built.example')).toBe('did:webvh:QmBuilt:built.example')
    communityTarget.choose(community)
    expect(resolveChosenCommunityDid('did:webvh:QmBuilt:built.example')).toBe(community)
    // A new launch: nothing in memory, only what was kept.
    const target = communityTarget as unknown as { viewing?: unknown; chosen?: unknown }
    target.viewing = undefined
    target.chosen = undefined
    await communityTarget.restore()
    expect(communityTarget.getChosen()).toEqual({ communityDid: community, name: 'Kept' })
  })

  it("the community's published name survives a launch, wherever the community is named by its DID", async () => {
    communityTarget.clear()
    communityTarget.set({ communityDid: community, name: 'keyring-test' })
    communityTarget.publishedName(community, 'Keyring Lab Community')
    communityTarget.choose(community)
    // A new launch: nothing in memory — not even the published names — only what was kept.
    const target = communityTarget as unknown as { viewing?: unknown; chosen?: unknown; published: Map<string, string> }
    target.viewing = undefined
    target.chosen = undefined
    target.published.clear()
    await communityTarget.restore()
    expect(communityTarget.publishedNameOf(community)).toBe('Keyring Lab Community')
    expect(communityLabelOf(community, ((key: string) => key) as never)).toBe('Keyring Lab Community')
  })

  it("a link's name, kept, is still only a claim after a launch", async () => {
    communityTarget.clear()
    communityTarget.set({ communityDid: community, name: 'Totally Official' })
    communityTarget.choose(community)
    const target = communityTarget as unknown as { viewing?: unknown; chosen?: unknown; published: Map<string, string> }
    target.viewing = undefined
    target.chosen = undefined
    target.published.clear()
    await communityTarget.restore()
    expect(communityTarget.publishedNameOf(community)).toBeUndefined()
  })
})
