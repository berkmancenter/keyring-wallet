/**
 * The crash report #19 describes, reproduced as a test.
 *
 * `communityTarget.get` is a `useSyncExternalStore` snapshot: React calls it on
 * every render and re-renders whenever the result is not `Object.is` to the
 * previous one. When the store composed the published name on the way out, a
 * screen reading a community that had published a name re-rendered until React
 * gave up — "Maximum update depth exceeded" — on a shipped build (211), at the
 * last step of a maintainer's first run.
 *
 * Both conditions have to hold, which is why it lands on the apply button and
 * not earlier: the community must be `chosen` (VtiJoin does that when the
 * persona is minted) AND a name must have been learned, which only a manifest
 * fetch does — and the first fetch in that flow is the one the apply button
 * fires. Neither screen test had the pair, so the combination that loops was
 * the one combination untested.
 */
import { render } from '@testing-library/react-native'
import React, { useSyncExternalStore } from 'react'

import AsyncStorage from '@react-native-async-storage/async-storage'

import { communityTarget } from '../module/vtiCommunityLink'

const did = 'did:webvh:QmCommunity:keyring-test-vtc'

/** What every join screen does: read the community out of the store. */
const Reader: React.FC = () => {
  useSyncExternalStore(communityTarget.subscribe, communityTarget.get)
  return null
}

describe('a screen reading the community it is working on', () => {
  beforeEach(() => communityTarget.clear())

  it('does not loop once the community has published a name', () => {
    communityTarget.set({ communityDid: did })
    communityTarget.choose(did)
    communityTarget.publishedName(did, 'Keyring Lab Community')
    expect(() => render(<Reader />)).not.toThrow()
  })

  it('does not loop for a community that has published none', () => {
    communityTarget.set({ communityDid: did })
    expect(() => render(<Reader />)).not.toThrow()
  })

  it('does not loop for a name a link merely claimed', () => {
    communityTarget.set({ communityDid: did, name: 'What The Link Said' })
    expect(() => render(<Reader />)).not.toThrow()
  })
})

/**
 * The question a stuck install asks: does updating release it, or does the
 * phone need reinstalling?
 *
 * A tester's phone was trapped by a community it had CHOSEN, not one the build
 * bakes — the choice is persisted with the name it learned, and every launch
 * restored it into the loop. Nothing was corrupt: the data was always fine and
 * only the reading of it built a new object each time. So a restored community
 * must render on the fixed code, which is what lets us say "update and it
 * recovers" rather than "reinstall and link again".
 */
describe('a phone that was already stuck', () => {
  it('renders after an update, with the community it had chosen restored', async () => {
    communityTarget.clear()
    // Exactly what the trapped build wrote: chosen, with its published name.
    await AsyncStorage.setItem(
      'keyring.vti.communityTarget',
      JSON.stringify({ communityDid: did, name: 'Keyring Lab Community', published: true })
    )
    await communityTarget.restore()
    expect(communityTarget.getChosen()).toMatchObject({ name: 'Keyring Lab Community' })
    expect(() => render(<Reader />)).not.toThrow()
    // And the restored value is stable, which is the whole of the fix.
    expect(communityTarget.getChosen()).toBe(communityTarget.getChosen())
  })
})
