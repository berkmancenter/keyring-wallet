/**
 * A community revoking this person's vetter grant is said once, when the phone first records the revoke, as the grant
 * itself was (vetterNotice). Only when it ends the role: the card is one of this phone's vetter grants, it is now
 * revoked, and no other grant held there for the same identity still stands.
 */
import { renderHook } from '@testing-library/react-native'
import { DeviceEventEmitter } from 'react-native'
import Toast from 'react-native-toast-message'

import { VTI_CARD_STANDING_EVENT } from '../module/vtiCardStanding'
import { useVtiVetterEndedNotice, vetterRoleEndedBy } from '../screens/vetterNotice'

const COMMUNITY = 'did:webvh:QmCommunity:vtc.example.org:first-vtc'
const ME = 'did:webvh:QmMe:ids.example:me'
const OTHER_ME = 'did:webvh:QmOtherMe:ids.example:other'

const grant = (id: string, subjectDid = ME, communityDid = COMMUNITY) => ({
  kind: 'vetter-grant' as const,
  communityDid,
  subjectDid,
  credential: { id, type: ['VerifiableCredential'], validFrom: '2024-01-01T00:00:00Z' } as Record<string, unknown>,
  receivedAt: '2024-01-01T00:00:00Z',
})

let mockGrants: ReturnType<typeof grant>[] = []
const mockRevoked = new Set<string>()
jest.mock('../module/VtiCommunityStore', () => ({
  ...jest.requireActual('../module/VtiCommunityStore'),
  GenericRecordsCommunityStore: class {
    async listHeldCredentials(kind?: string) {
      return mockGrants.filter((g) => !kind || g.kind === kind)
    }
  },
}))
jest.mock('../module/vtiCardStanding', () => ({
  ...jest.requireActual('../module/vtiCardStanding'),
  cardStandingOf: (card: { id?: string }) =>
    mockRevoked.has(card.id ?? '') ? { state: 'revoked', at: '2024-01-01T00:00:00Z' } : { state: 'held' },
}))
const mockAgent = {}
jest.mock('@bifold/react-hooks', () => ({ useAgent: () => ({ agent: mockAgent }) }))

beforeEach(() => {
  mockGrants = []
  mockRevoked.clear()
  jest.spyOn(Toast, 'show').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe('which revoke ends the vetter role', () => {
  test('the only grant there, now revoked: the role ended in that community', async () => {
    mockGrants = [grant('g1')]
    mockRevoked.add('g1')
    expect(await vetterRoleEndedBy(mockAgent as never, 'g1')).toBe(COMMUNITY)
  })

  test('another grant there for the same identity still stands: nothing to say (control)', async () => {
    mockGrants = [grant('g1'), grant('g2')]
    mockRevoked.add('g1')
    expect(await vetterRoleEndedBy(mockAgent as never, 'g1')).toBeUndefined()
  })

  test('a live grant held as another identity does not keep this one a vetter', async () => {
    mockGrants = [grant('g1'), grant('g2', OTHER_ME)]
    mockRevoked.add('g1')
    expect(await vetterRoleEndedBy(mockAgent as never, 'g1')).toBe(COMMUNITY)
  })

  test('a card that is not a vetter grant, or a grant read as not revoked, says nothing', async () => {
    mockGrants = [grant('g1')]
    expect(await vetterRoleEndedBy(mockAgent as never, 'membership-card')).toBeUndefined()
    expect(await vetterRoleEndedBy(mockAgent as never, 'g1')).toBeUndefined()
    expect(await vetterRoleEndedBy(mockAgent as never, '')).toBeUndefined()
  })
})

test('an expired grant read as NOT revoked says nothing: only a revoke ends the role here, not its dates', async () => {
  mockGrants = [{ ...grant('g1'), credential: { ...grant('g1').credential, validUntil: '2020-01-01T00:00:00Z' } }]
  expect(await vetterRoleEndedBy(mockAgent as never, 'g1')).toBeUndefined()
})

describe('the notice', () => {
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }

  test('a recorded revoke that ends the role shows the words, as the grant did', async () => {
    mockGrants = [grant('g1')]
    mockRevoked.add('g1')
    const { unmount } = renderHook(() => useVtiVetterEndedNotice())
    DeviceEventEmitter.emit(VTI_CARD_STANDING_EVENT, { credentialId: 'g1' })
    await flush()
    expect(Toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ text1: 'VtaLink.VetterEndedToast', text2: 'VtaLink.VetterEndedToastHint' })
    )
    unmount()
  })

  test('a revoke that leaves a live grant shows nothing (control)', async () => {
    mockGrants = [grant('g1'), grant('g2')]
    mockRevoked.add('g1')
    const { unmount } = renderHook(() => useVtiVetterEndedNotice())
    DeviceEventEmitter.emit(VTI_CARD_STANDING_EVENT, { credentialId: 'g1' })
    await flush()
    expect(Toast.show).not.toHaveBeenCalled()
    unmount()
  })
})
