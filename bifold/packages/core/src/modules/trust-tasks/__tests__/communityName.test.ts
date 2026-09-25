/**
 * What a community is called, and how much the app claims for that name.
 * A tester was offered "Join keyring-vti-vtc.ngrok.app" by a community that
 * had published no name at all (report #14, 2026-09-22): a hostname in the
 * place of a name reads as a name.
 */
import { communityLabelAnsweredOf, communityLabelOf, communityName, shortDid } from '../screens/communityName'
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

/**
 * `communityTarget.get`, `getViewing` and `getChosen` are useSyncExternalStore
 * snapshots: React calls them on every render and re-renders whenever the
 * result is not `Object.is` to the previous one. Composing the published name
 * on the way out returned a new object every call, so every screen reading a
 * community that had published a name re-rendered forever — "Maximum update
 * depth exceeded" on a shipped build, at the last step of a maintainer's first
 * run (report #19, 2026-09-23).
 *
 * It escaped every gate because the lab community published no name at the
 * time: the nameless path returns the stored object unchanged and is stable.
 * These tests hold the invariant directly — reading twice without writing must
 * return the very same object.
 */
describe("the store's snapshots are stable to read", () => {
  beforeEach(() => communityTarget.clear())

  it('returns the same object when nothing has changed, named or not', () => {
    communityTarget.set({ communityDid: did })
    expect(communityTarget.get()).toBe(communityTarget.get())
    communityTarget.publishedName(did, 'Keyring Lab Community')
    expect(communityTarget.get()).toBe(communityTarget.get())
    expect(communityTarget.getViewing()).toBe(communityTarget.getViewing())
  })

  it('holds for the chosen community too, which outlives the join screens', () => {
    communityTarget.set({ communityDid: did })
    communityTarget.choose(did)
    communityTarget.publishedName(did, 'Keyring Lab Community')
    expect(communityTarget.getChosen()).toBe(communityTarget.getChosen())
    expect(communityTarget.getChosen()?.name).toBe('Keyring Lab Community')
  })

  it('still changes identity when something actually changed', () => {
    communityTarget.set({ communityDid: did })
    const before = communityTarget.get()
    communityTarget.publishedName(did, 'Keyring Lab Community')
    expect(communityTarget.get()).not.toBe(before)
  })

  it('a name learned before the link is applied when the link arrives', () => {
    communityTarget.publishedName(did, 'Keyring Lab Community')
    communityTarget.set({ communityDid: did, name: 'What The Link Said' })
    expect(communityTarget.get()).toMatchObject({ name: 'Keyring Lab Community', published: true })
    expect(communityTarget.get()).toBe(communityTarget.get())
  })
})

describe('naming a community that has just answered (the Leave toast)', () => {
  beforeEach(() => communityTarget.clear())
  // The keys are the text: what matters is which name goes in, and whether it
  // carries "(not confirmed by the community)".
  const t = ((key: string, opts?: { name?: string; host?: string }) =>
    key === 'Community.ClaimedName'
      ? `${opts?.name} (not confirmed by the community)`
      : `${key}:${opts?.host ?? ''}`) as never
  const did = 'did:webvh:QmExample:keyring-vti-vtc.ngrok.app'

  test('its published name, as everywhere', () => {
    communityTarget.set({ communityDid: did, name: 'What The Link Said' })
    communityTarget.publishedName(did, 'Keyring Lab Community')
    expect(communityLabelAnsweredOf(did, t)).toBe('Keyring Lab Community')
  })

  test("the link's name without the qualifier, which stays everywhere else", () => {
    communityTarget.set({ communityDid: did, name: 'keyring-lab' })
    expect(communityLabelAnsweredOf(did, t)).toBe('keyring-lab')
    expect(communityLabelOf(did, t)).toBe('keyring-lab (not confirmed by the community)')
  })

  test('unnamed, it is still said to be unnamed', () => {
    communityTarget.set({ communityDid: did })
    expect(communityLabelAnsweredOf(did, t)).toBe(communityLabelOf(did, t))
  })
})
