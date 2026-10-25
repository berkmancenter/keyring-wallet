/**
 * A community's card look is unknown until the phone has read what it keeps (and fetched a logo it names), and only
 * then known: a card never shows the default look first and the community's own a moment later.
 */
import { act, render } from '@testing-library/react-native'
import React from 'react'
import { DeviceEventEmitter } from 'react-native'
import { useAgent } from '@bifold/react-hooks'

import { COMMUNITY_BRAND_EVENT } from '../module/communityChanged'
import { didColour, type CommunityBrand } from '../module/communityBrand'
import { resetCommunityBrands, useCommunityBrand, type Known } from '../module/useCommunityBrand'
import { GenericRecordsCommunityStore } from '../module/VtiCommunityStore'
import { memoryGenericRecords } from '../../../../__tests__/modules/vrc/fixtures/memoryGenericRecords'

jest.mock('@bifold/react-hooks')
const mockLogo = jest.fn<Promise<string | undefined>, [string, string | undefined]>()
jest.mock('../module/communityLogo', () => ({
  cachedCommunityLogo: (did: string, url: string | undefined) => mockLogo(did, url),
}))

const mockUseAgent = useAgent as jest.MockedFunction<typeof useAgent>
const DID = 'did:webvh:Qm:dids.example.org:harbor'

let agent: { genericRecords: ReturnType<typeof memoryGenericRecords> }
/** Every value the hook returned, in order. */
let seen: Known<CommunityBrand>[]
const Probe: React.FC<{ did: string }> = ({ did }) => {
  seen.push(useCommunityBrand(did, 'Harbor Tenants Union'))
  return null
}
const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const keep = (brand: { accentColor?: string; logoUrl?: string }) =>
  new GenericRecordsCommunityStore(agent as never).saveCommunityBrand(DID, brand)

beforeEach(() => {
  resetCommunityBrands()
  seen = []
  agent = { genericRecords: memoryGenericRecords() }
  mockUseAgent.mockReturnValue({ agent } as any)
  mockLogo.mockReset().mockResolvedValue(undefined)
})

describe('a community’s card look', () => {
  test('unknown until read; nothing kept means the DID’s colour and the monogram, for good', async () => {
    render(<Probe did={DID} />)
    expect(seen[0]).toEqual({ known: false })
    await flush()
    const last = seen[seen.length - 1]
    expect(last).toEqual({ known: true, value: expect.objectContaining({ color: didColour(DID), monogram: 'HU' }) })
  })

  test('a kept colour: never the DID’s colour first', async () => {
    await keep({ accentColor: '#1a4d80' })
    render(<Probe did={DID} />)
    await flush()
    const known = seen.filter((s): s is { known: true; value: CommunityBrand } => s.known)
    // Positive control: it does become known, with the community's own colour.
    expect(known.length).toBeGreaterThan(0)
    for (const value of known) expect(value.value).toMatchObject({ color: '#1a4d80', fromAccent: true })
  })

  test('a kept logo: unknown until the logo is fetched, then known with it, never the monogram first', async () => {
    await keep({ logoUrl: 'https://vtc.example.org/logo.png' })
    let deliver: (file: string) => void = () => undefined
    mockLogo.mockReturnValue(new Promise((resolve) => (deliver = resolve)))
    render(<Probe did={DID} />)
    await flush()
    expect(seen.every((s) => !s.known)).toBe(true)
    await act(async () => deliver('file:///caches/community-logos/abc'))
    await flush()
    const known = seen.filter((s): s is { known: true; value: CommunityBrand } => s.known)
    expect(known.length).toBeGreaterThan(0)
    for (const value of known) expect(value.value.logo).toBe('file:///caches/community-logos/abc')
    expect(mockLogo).toHaveBeenCalledWith(DID, 'https://vtc.example.org/logo.png')
  })

  test('a logo that cannot be fetched is the monogram, known', async () => {
    await keep({ logoUrl: 'https://vtc.example.org/logo.png' })
    render(<Probe did={DID} />)
    await flush()
    expect(seen[seen.length - 1]).toEqual({
      known: true,
      value: expect.objectContaining({ logo: undefined, monogram: 'HU' }),
    })
  })

  test('a look kept later (a manifest read) reaches a card already showing', async () => {
    render(<Probe did={DID} />)
    await flush()
    expect(seen[seen.length - 1]).toMatchObject({ known: true, value: { fromAccent: false } })
    await act(async () => {
      await keep({ accentColor: '#1a4d80' })
      DeviceEventEmitter.emit(COMMUNITY_BRAND_EVENT, { communityDid: DID })
    })
    await flush()
    expect(seen[seen.length - 1]).toMatchObject({ known: true, value: { color: '#1a4d80' } })
  })

  test('a failed read is "none kept": known, the DID’s colour, not neutral for ever', async () => {
    agent.genericRecords.findAllByQuery.mockRejectedValueOnce(new Error('store busy'))
    render(<Probe did={DID} />)
    await flush()
    expect(seen[seen.length - 1]).toMatchObject({ known: true, value: { color: didColour(DID) } })
  })
})
