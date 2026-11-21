/**
 * Which agents hold an identity in a community, as known for that community only (UI-smoothness plan, Phase 5).
 */
import { act, renderHook } from '@testing-library/react-native'

import { useAgent } from '@bifold/react-hooks'

import { useAgentsHoldingIdentity } from '../screens/agentsHoldingIdentity'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const A = 'did:webvh:example:community-a'
const B = 'did:webvh:example:community-b'
const persona = (communityDid: string) => ({
  tags: { recordType: 'keyring/vti-identity', kind: 'persona', key: communityDid },
  content: { did: `did:webvh:me@${communityDid}`, communityDid, vtaDid: 'did:webvh:example:vta' },
})

test('a community whose read failed before is not said to have failed while it is read again', async () => {
  let failA = true
  const hold: { a?: Promise<void> } = {}
  ;(useAgent as jest.Mock).mockReturnValue({
    agent: {
      genericRecords: {
        findAllByQuery: async () => {
          if (current === A && hold.a) await hold.a
          if (current === A && failA) throw new Error('store unavailable')
          return [persona(A), persona(B)]
        },
      },
    },
  })
  let current = A
  const hook = renderHook(({ community }: { community: string }) => useAgentsHoldingIdentity(community), {
    initialProps: { community: A },
  })
  await act(async () => undefined)
  expect(hook.result.current).toMatchObject({ known: false, failed: true })

  current = B
  hook.rerender({ community: B })
  await act(async () => undefined)
  expect(hook.result.current).toMatchObject({ known: true, failed: false })

  // Back to A, whose read now succeeds, but slowly: while it runs, A is not known, and not "failed" either.
  failA = false
  let release: () => void = () => undefined
  hold.a = new Promise<void>((resolve) => (release = resolve))
  current = A
  hook.rerender({ community: A })
  await act(async () => undefined)
  expect(hook.result.current).toMatchObject({ known: false, failed: false })
  await act(async () => release())
  expect(hook.result.current).toMatchObject({ known: true, failed: false })
})
