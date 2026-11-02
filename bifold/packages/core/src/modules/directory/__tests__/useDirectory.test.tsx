import { act, renderHook, waitFor } from '@testing-library/react-native'

import { createFakeDirectoryService } from '../testing/fakeDirectoryService'
import { DirectoryConflict } from '../types'
import { confirmDirectoryNames, keepDirectoryName, loadDirectoryNames } from '../names'
import {
  MEMBERS_PAGE_SPACING_MS,
  NAME_LOOKUPS_PER_VISIT,
  NAME_REASK_FLOOR_MS,
  resetDirectoryNameLookups,
  useCommunityMembers,
  useDirectoryNames,
  useMyCommunityCard,
} from '../useDirectory'

const COMMUNITY = 'did:webvh:community:a'

let mockMyName: { name?: string; profileId?: string } = {}
jest.mock('../../rooms/useMyName', () => ({ useMyName: () => mockMyName }))
const mockAgent = { config: { logger: { warn: jest.fn() } } }
jest.mock('@bifold/react-hooks', () => ({ useAgent: () => ({ agent: mockAgent }) }))
// The kept names, in memory: what the encrypted store would hold.
let mockKept = new Map<string, string>()
jest.mock('../names', () => ({
  confirmDirectoryNames: jest.fn(async () => undefined),
  loadDirectoryNames: jest.fn(async () => new Map(mockKept)),
  keepDirectoryName: jest.fn(async (_agent: unknown, _community: string, did: string, name?: string) => {
    if (name) mockKept.set(did, name)
    else mockKept.delete(did)
  }),
}))

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

describe('room authors’ own names', () => {
  const ANA = 'did:key:ana'
  const BO = 'did:key:bo'
  const CY = 'did:key:cy'

  beforeEach(() => {
    mockKept = new Map()
    resetDirectoryNameLookups()
    jest.mocked(keepDirectoryName).mockClear()
    jest.mocked(loadDirectoryNames).mockClear()
    jest.mocked(confirmDirectoryNames).mockClear()
    mockAgent.config.logger.warn.mockClear()
  })
  afterEach(() => jest.restoreAllMocks())

  it('shows kept names at once, then asks about every author, those with none kept first, keeping what changed', async () => {
    mockKept = new Map([[ANA, 'Ana']])
    const service = createFakeDirectoryService({ shown: { [ANA]: 'Ana', [BO]: 'Bo' } })
    const { result } = renderHook(() => useDirectoryNames(service, COMMUNITY, [ANA, BO, BO]))
    await waitFor(() => expect(result.current.get(BO)).toBe('Bo'))
    expect(result.current.get(ANA)).toBe('Ana')
    await waitFor(() => expect(service.calls).toEqual([`lookupName ${BO}`, `lookupName ${ANA}`]))
    // Ana's name is as kept: not rewritten, but confirmed, so it doesn't expire from what a room shows offline.
    expect(keepDirectoryName).toHaveBeenCalledTimes(1)
    expect(keepDirectoryName).toHaveBeenCalledWith(mockAgent, COMMUNITY, BO, 'Bo')
    await waitFor(() => expect(confirmDirectoryNames).toHaveBeenCalledWith(mockAgent, COMMUNITY, [ANA]))
  })

  it('a rename shows the next time the room opens: the kept name first, then the new one, kept', async () => {
    mockKept = new Map([[ANA, 'Ana']])
    const service = createFakeDirectoryService({ shown: { [ANA]: 'Ana Lopez' } })
    // The community takes its time to answer, as it does: the room shows the kept name meanwhile.
    let answer: () => void = () => undefined
    const answered = new Promise<void>((resolve) => (answer = resolve))
    const lookup = service.lookupName.bind(service)
    service.lookupName = async (community, did) => {
      await answered
      return lookup(community, did)
    }
    const { result } = renderHook(() => useDirectoryNames(service, COMMUNITY, [ANA]))
    await waitFor(() => expect(result.current.get(ANA)).toBe('Ana'))
    act(() => answer())
    await waitFor(() => expect(result.current.get(ANA)).toBe('Ana Lopez'))
    expect(keepDirectoryName).toHaveBeenCalledWith(mockAgent, COMMUNITY, ANA, 'Ana Lopez')
  })

  it('a member with no name is asked again on a later open, not within a minute, and a new name shows', async () => {
    let now = Date.parse('2026-10-30T21:00:00Z')
    jest.spyOn(Date, 'now').mockImplementation(() => now)
    const shown: Record<string, string> = {}
    const service = createFakeDirectoryService({ shown })
    const first = renderHook(() => useDirectoryNames(service, COMMUNITY, [CY]))
    await waitFor(() => expect(service.calls).toEqual([`lookupName ${CY}`]))
    first.unmount()

    // Opened again at once: not asked again yet.
    now += NAME_REASK_FLOOR_MS - 1
    const soon = renderHook(() => useDirectoryNames(service, COMMUNITY, [CY]))
    await waitFor(() => expect(loadDirectoryNames).toHaveBeenCalledTimes(2))
    expect(service.calls).toHaveLength(1)
    soon.unmount()

    // Cy has since written a name on their card; the next open after the floor shows it.
    shown[CY] = 'Cy'
    now += 1
    const later = renderHook(() => useDirectoryNames(service, COMMUNITY, [CY]))
    await waitFor(() => expect(later.result.current.get(CY)).toBe('Cy'))
    expect(service.calls).toEqual([`lookupName ${CY}`, `lookupName ${CY}`])
    expect(keepDirectoryName).toHaveBeenCalledWith(mockAgent, COMMUNITY, CY, 'Cy')
  })

  it('drops a kept name the community stopped showing', async () => {
    mockKept = new Map([[CY, 'Cy']])
    const service = createFakeDirectoryService({ shown: {} })
    const { result } = renderHook(() => useDirectoryNames(service, COMMUNITY, [CY]))
    await waitFor(() => expect(keepDirectoryName).toHaveBeenCalledWith(mockAgent, COMMUNITY, CY, undefined))
    await waitFor(() => expect(result.current.size).toBe(0))
  })

  it('offline, the kept names stay shown: a failed lookup changes nothing kept', async () => {
    mockKept = new Map([[ANA, 'Ana']])
    const refusing = createFakeDirectoryService({ refuse: { lookupName: 'communityUnreachable' } })
    const { result } = renderHook(() => useDirectoryNames(refusing, COMMUNITY, [ANA]))
    await waitFor(() => expect(mockAgent.config.logger.warn).toHaveBeenCalled())
    expect(result.current.get(ANA)).toBe('Ana')
    expect(keepDirectoryName).not.toHaveBeenCalled()
    expect(confirmDirectoryNames).not.toHaveBeenCalled()
  })

  it('asks for at most NAME_LOOKUPS_PER_VISIT authors at a time, and stops at a failure', async () => {
    const many = Array.from({ length: NAME_LOOKUPS_PER_VISIT + 5 }, (_, i) => `did:key:m${i}`)
    const service = createFakeDirectoryService({ shown: {} })
    renderHook(() => useDirectoryNames(service, COMMUNITY, many))
    await waitFor(() => expect(service.calls).toHaveLength(NAME_LOOKUPS_PER_VISIT))

    const refusing = createFakeDirectoryService({ refuse: { lookupName: 'rateLimited' } })
    renderHook(() => useDirectoryNames(refusing, COMMUNITY, [ANA, BO]))
    await waitFor(() => expect(mockAgent.config.logger.warn).toHaveBeenCalled())
    expect(refusing.calls).toEqual([`lookupName ${ANA}`])
  })
})
