/**
 * What a community is called, and how much the app claims for that name.
 * A tester was offered "Join keyring-vti-vtc.ngrok.app" by a community that
 * had published no name at all (report #14, 2026-09-22): a hostname in the
 * place of a name reads as a name.
 */
import { communityName, shortDid } from '../screens/communityName'
import { communityTarget } from '../module/vtiCommunityLink'

const did = 'did:webvh:QmUsH14W1foRZyP9v7LtfxwFy7qWgzNBLSzhWhbMQeMPJB:keyring-vti-vtc.ngrok.app'
const other = 'did:webvh:QmSomethingElse:another.example'

describe('naming a community', () => {
  it('shows a published name plainly', () => {
    expect(communityName(did, { communityDid: did, name: 'Keyring Lab Community', published: true })).toEqual({
      name: 'Keyring Lab Community',
      claimed: false,
      technical: 'keyring-vti-vtc.ngrok.app',
    })
  })

  it("marks a link's name as claimed, because anyone can write a link", () => {
    expect(communityName(did, { communityDid: did, name: 'Totally The Real One' })).toMatchObject({
      name: 'Totally The Real One',
      claimed: true,
    })
  })

  it('offers no name when nothing has named it', () => {
    expect(communityName(did, undefined).name).toBeUndefined()
    expect(communityName(did, { communityDid: did }).name).toBeUndefined()
  })

  it('never takes a name meant for a different community', () => {
    expect(communityName(did, { communityDid: other, name: 'Elsewhere' }).name).toBeUndefined()
  })

  it('shortens a DID recognisably, keeping both ends', () => {
    expect(shortDid(did)).toBe('did:webvh:QmUsH1…grok.app')
    expect(shortDid('did:peer:2.short')).toBe('did:peer:2.short')
  })
})

describe('a name the community published itself', () => {
  beforeEach(() => communityTarget.clear())

  it('replaces the one a link claimed, and is then shown plainly', () => {
    communityTarget.set({ communityDid: did, name: 'What The Link Said' })
    communityTarget.publishedName(did, 'Keyring Lab Community')
    expect(communityName(did, communityTarget.get())).toMatchObject({
      name: 'Keyring Lab Community',
      claimed: false,
    })
  })

  it('is not overwritten by a later link claiming something else', () => {
    communityTarget.set({ communityDid: did, name: 'What The Link Said' })
    communityTarget.publishedName(did, 'Keyring Lab Community')
    communityTarget.set({ communityDid: did, name: 'A Second Link Disagrees' })
    expect(communityTarget.get()).toMatchObject({ name: 'Keyring Lab Community', published: true })
  })

  it('does nothing for a community that publishes none', () => {
    communityTarget.set({ communityDid: did, name: 'What The Link Said' })
    communityTarget.publishedName(did, undefined)
    communityTarget.publishedName(did, '   ')
    expect(communityTarget.get()).toMatchObject({ name: 'What The Link Said' })
    expect(communityTarget.get()?.published).toBeFalsy()
  })

  it('names the community it is about, not whichever is on screen', () => {
    communityTarget.set({ communityDid: did })
    communityTarget.publishedName(other, 'Somewhere Else')
    expect(communityTarget.get()).toMatchObject({ communityDid: did })
    expect(communityTarget.get()?.name).toBeUndefined()
  })
})
