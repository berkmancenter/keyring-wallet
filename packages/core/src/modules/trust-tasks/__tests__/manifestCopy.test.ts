/**
 * The manifest copy a screen shows before it reads again is kept per asker: a community MAY tailor its criteria to
 * the caller (vtc/join-requests/manifest/0.3), so what it told one identity is never shown as another's.
 */
import { vtiAgent } from '../module/vtiAgent'
import type { VtiManifest } from '../module/vtiAgent'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

type Internals = { state: { did?: string }; learnManifest: (c: string, a: undefined, m: VtiManifest) => VtiManifest }
const internals = vtiAgent as unknown as Internals
const community = 'did:webvh:example:copy-community'
const asIdentity = (did: string | undefined) => {
  internals.state = { ...internals.state, did }
}

test("an answer given to one identity is not shown as another's, and is kept for the one that asked", () => {
  // Named, so learning it does not go on to read the community's public profile.
  const toA = {
    wire: '0.3',
    criteria: [{ id: 'private-way' }],
    branding: { displayName: 'Copy Community' },
  } as unknown as VtiManifest
  asIdentity('did:webvh:example:persona-a')
  internals.learnManifest(community, undefined, toA)
  expect(vtiAgent.lastManifest(community)).toBe(toA)

  asIdentity('did:webvh:example:persona-b')
  expect(vtiAgent.lastManifest(community)).toBeUndefined()

  asIdentity('did:webvh:example:persona-a')
  expect(vtiAgent.lastManifest(community)).toBe(toA)
  asIdentity(undefined)
})
