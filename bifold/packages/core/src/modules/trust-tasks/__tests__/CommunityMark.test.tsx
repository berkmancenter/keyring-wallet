/**
 * The tile at the top of a community's screen: its logo where it has one, the people icon where it has none, and
 * nothing while that is not settled, so the icon is never shown first and the logo a moment later.
 */
import { act, render } from '@testing-library/react-native'
import React from 'react'
import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { memoryGenericRecords } from '../../../../__tests__/modules/vrc/fixtures/memoryGenericRecords'
import { testIdWithKey } from '../../../utils/testable'
import { resetCommunityBrands } from '../module/useCommunityBrand'
import { GenericRecordsCommunityStore } from '../module/VtiCommunityStore'
import { CommunityMark, LOOK_WAIT_MS } from '../screens/CommunityMark'

jest.mock('@bifold/react-hooks')
const mockLogo = jest.fn<Promise<string | undefined>, [string, string | undefined]>()
jest.mock('../module/communityLogo', () => ({
  cachedCommunityLogo: (did: string, url: string | undefined) => mockLogo(did, url),
}))

const mockUseAgent = useAgent as jest.MockedFunction<typeof useAgent>
const DID = 'did:webvh:Qm:dids.example.org:harbor'
const LOGO_URL = 'https://vtc.example.org/logo.png'
const LOGO_FILE = 'file:///caches/community-logos/harbor'

let agent: { genericRecords: ReturnType<typeof memoryGenericRecords> }
const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
/** Keep a look as a read does, and let the event it sends land. */
const keep = async (brand: { logoUrl?: string }) => {
  await act(async () => {
    await new GenericRecordsCommunityStore(agent as never).saveCommunityBrand(DID, brand)
  })
  await flush()
  await flush()
}
const mark = (reading: boolean) => (
  <BasicAppContext>
    <CommunityMark communityDid={DID} reading={reading} />
  </BasicAppContext>
)
type Tree = ReturnType<typeof render>
const logo = (tree: Tree) => tree.queryByTestId(testIdWithKey('CommunityLogo'))
const icon = (tree: Tree) => tree.queryByTestId(testIdWithKey('CommunityMarkIcon'))

beforeEach(() => {
  resetCommunityBrands()
  agent = { genericRecords: memoryGenericRecords() }
  mockUseAgent.mockReturnValue({ agent } as any)
  mockLogo.mockReset().mockResolvedValue(LOGO_FILE)
})

describe("a community's mark", () => {
  it('a community that said it has no logo: the icon', async () => {
    await keep({})
    const tree = render(mark(true))
    await flush()
    expect(icon(tree)).toBeTruthy()
    expect(logo(tree)).toBeNull()
  })

  it('a kept logo not on the phone yet: nothing, then the logo, never the icon', async () => {
    let arrive: (file: string) => void = () => undefined
    mockLogo.mockReturnValue(new Promise((resolve) => (arrive = resolve)))
    await keep({ logoUrl: LOGO_URL })
    const tree = render(mark(false))
    await flush()
    expect(icon(tree)).toBeNull()
    expect(logo(tree)).toBeNull()
    await act(async () => arrive(LOGO_FILE))
    await flush()
    expect(logo(tree)?.props.source).toEqual({ uri: LOGO_FILE })
    expect(icon(tree)).toBeNull()
  })

  it('a logo that cannot be had: the icon, not an empty tile', async () => {
    mockLogo.mockResolvedValue(undefined)
    await keep({ logoUrl: LOGO_URL })
    const tree = render(mark(false))
    await flush()
    expect(icon(tree)).toBeTruthy()
    expect(logo(tree)).toBeNull()
  })

  it('first time on the phone: nothing while it is read, then the logo it gives, never the icon', async () => {
    const tree = render(mark(true))
    await flush()
    expect(icon(tree)).toBeNull()
    expect(logo(tree)).toBeNull()
    await keep({ logoUrl: LOGO_URL })
    expect(logo(tree)).toBeTruthy()
    expect(icon(tree)).toBeNull()
  })

  it('first time on the phone, and the read ends before the look lands: still nothing, then the logo', async () => {
    const tree = render(mark(true))
    await flush()
    tree.rerender(mark(false))
    await flush()
    expect(icon(tree)).toBeNull()
    await keep({ logoUrl: LOGO_URL })
    expect(logo(tree)).toBeTruthy()
    expect(icon(tree)).toBeNull()
  })

  it('first time on the phone, and it says it has none: the icon as soon as it says so, with no wait', async () => {
    const tree = render(mark(true))
    await flush()
    tree.rerender(mark(false))
    await flush()
    expect(icon(tree)).toBeNull()
    await keep({})
    expect(icon(tree)).toBeTruthy()
  })

  it('first time on the phone, and the look never lands: the icon after the wait, not an empty tile', async () => {
    const tree = render(mark(true))
    await flush()
    jest.useFakeTimers()
    try {
      tree.rerender(mark(false))
      act(() => jest.advanceTimersByTime(LOOK_WAIT_MS - 1))
      expect(icon(tree)).toBeNull()
      act(() => jest.advanceTimersByTime(1))
      expect(icon(tree)).toBeTruthy()
    } finally {
      jest.useRealTimers()
    }
  })

  it('a read that takes longer than the wait: still nothing, since the wait starts when the read ends', async () => {
    jest.useFakeTimers()
    try {
      const tree = render(mark(true))
      await act(async () => void jest.advanceTimersByTime(2 * LOOK_WAIT_MS))
      await act(async () => undefined)
      expect(icon(tree)).toBeNull()
      // Positive control: the look was read by now, so the wait is what kept the icon back.
      tree.rerender(mark(false))
      await act(async () => void jest.advanceTimersByTime(LOOK_WAIT_MS))
      expect(icon(tree)).toBeTruthy()
    } finally {
      jest.useRealTimers()
    }
  })

  it('a community that takes its logo away: the icon', async () => {
    await keep({ logoUrl: LOGO_URL })
    const tree = render(mark(true))
    await flush()
    expect(logo(tree)).toBeTruthy()
    await keep({})
    expect(logo(tree)).toBeNull()
    expect(icon(tree)).toBeTruthy()
  })

  it('a logo that changes: the new one', async () => {
    await keep({ logoUrl: LOGO_URL })
    const tree = render(mark(false))
    await flush()
    mockLogo.mockResolvedValue('file:///caches/community-logos/new')
    await keep({ logoUrl: 'https://vtc.example.org/new.png' })
    await flush()
    expect(logo(tree)?.props.source).toEqual({ uri: 'file:///caches/community-logos/new' })
  })
})
