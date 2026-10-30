import { act, renderHook, waitFor } from '@testing-library/react-native'

import { createFakeDirectoryService } from '../testing/fakeDirectoryService'
import { DirectoryConflict } from '../types'
import { MEMBERS_PAGE_SPACING_MS, useCommunityMembers, useMyCommunityCard } from '../useDirectory'

const COMMUNITY = 'did:webvh:community:a'

let mockMyName: { name?: string; profileId?: string } = {}
jest.mock('../../rooms/useMyName', () => ({ useMyName: () => mockMyName }))
jest.mock('@bifold/react-hooks', () => ({ useAgent: () => ({ agent: undefined }) }))

beforeEach(() => {
  mockMyName = { name: 'Ana Lopez', profileId: 'profile-work' }
})

describe('the members list', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('reads the first page at once, and the next no sooner than the spacing allows', async () => {
    const service = createFakeDirectoryService({ members: 30 })
    const { result } = renderHook(() => useCommunityMembers(service, COMMUNITY))
    await waitFor(() => expect(result.current.rows).toHaveLength(25))
    expect(result.current.more).toBe(true)

    act(() => result.current.loadMore())
    expect(service.calls).toEqual(['listMembers first'])
    await act(async () => {
      jest.advanceTimersByTime(MEMBERS_PAGE_SPACING_MS)
    })
    await waitFor(() => expect(result.current.rows).toHaveLength(30))
    expect(service.calls).toEqual(['listMembers first', 'listMembers 25'])
    expect(result.current.more).toBe(false)
  })

  it('shows why when the first page fails', async () => {
    const refused = createFakeDirectoryService({ refuse: { listMembers: 'unsupportedType' } })
    const { result } = renderHook(() => useCommunityMembers(refused, COMMUNITY))
    await waitFor(() => expect(result.current.status).toMatchObject({ reason: 'communityDoesNotServe' }))
    expect(result.current.rows).toEqual([])
  })
})

describe('your card', () => {
  it('offers the name of the profile you joined as, and says who sees it', async () => {
    const service = createFakeDirectoryService()
    const { result } = renderHook(() => useMyCommunityCard(service, COMMUNITY))
    await waitFor(() => expect(result.current.card).toBeDefined())
    expect(result.current.proposal).toEqual({ name: 'Ana Lopez', profileId: 'profile-work' })
    expect(result.current.nameAudience).toBe('members')
    expect(result.current.differs).toBe(false)
    // Read only: nothing is written until the member says yes.
    expect(service.calls).toEqual(['showMyCard', 'cardFields'])

    await act(async () => {
      await result.current.save()
    })
    expect(service.calls).toContain('setMyName Ana Lopez @0')
    expect(result.current.card).toMatchObject({ name: 'Ana Lopez', revision: 1 })
  })

  it('notices a card name that is no longer the profile’s, and only asks', async () => {
    const service = createFakeDirectoryService({ cardName: 'Ana' })
    const { result } = renderHook(() => useMyCommunityCard(service, COMMUNITY))
    await waitFor(() => expect(result.current.card).toBeDefined())
    expect(result.current.differs).toBe(true)
    expect(service.calls.some((c) => c.startsWith('setMyName'))).toBe(false)
  })

  it('a card changed elsewhere since it was read is a conflict, and a reload reads the new revision', async () => {
    const service = createFakeDirectoryService()
    const { result } = renderHook(() => useMyCommunityCard(service, COMMUNITY))
    await waitFor(() => expect(result.current.card).toBeDefined())
    service.changeElsewhere('Set in the portal')

    await expect(result.current.save()).rejects.toBeInstanceOf(DirectoryConflict)
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.card).toMatchObject({ revision: 1, name: 'Set in the portal' }))
  })

  it('offers nothing without a profile name', async () => {
    mockMyName = {}
    const service = createFakeDirectoryService()
    const { result } = renderHook(() => useMyCommunityCard(service, COMMUNITY))
    await waitFor(() => expect(result.current.card).toBeDefined())
    expect(result.current.proposal).toBeUndefined()
  })
})
