/**
 * The community screen led with the community's DID, because a DID is what
 * the app keys a community by. A person reads the top of a screen as what the
 * thing is called ("not everyone is a power user", tester report #12), so the
 * name leads and the DID — still the only checkable thing here — sits one tap
 * away under Details, where every other detail already is.
 */
import { useRoute } from '@react-navigation/native'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { communityTarget } from '../module/vtiCommunityLink'
import VtiCommunity from '../screens/VtiCommunity'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('../module/vtiAgent', () => ({
  vtiAgent: { fetchManifest: jest.fn(async () => ({ criteria: [] })) },
  VtiRefusal: class extends Error {},
  selfRemoveRefusal: (e: unknown) => ((e as { code?: string })?.code === 'lastAdmin' ? 'lastAdmin' : undefined),
}))
const mockLeave = jest.fn()
jest.mock('../module/vtiJoin', () => ({ leaveCommunity: (...a: unknown[]) => mockLeave(...a) }))
jest.mock('../module/vtiVetting', () => ({ GenericRecordsVettingStore: class {} }))
const mockToast = jest.fn()
jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: { show: (...a: unknown[]) => mockToast(...a), hide: jest.fn() },
}))
let mockPersona: unknown = undefined
jest.mock('../module/VtiCommunityStore', () => ({
  GenericRecordsCommunityStore: class {
    getMembership = async () => undefined
    listHeldCredentials = async () => []
  },
}))
jest.mock('../module/VtiIdentityStore', () => ({
  GenericRecordsIdentityStore: class {
    getPersona = async () => mockPersona
  },
}))

// Where the phone stands with the community (the journey), set per test.
let mockJourney: unknown = undefined
jest.mock('../module/communityJourney', () => ({
  useCommunityJourney: () => ({ journey: mockJourney, refresh: jest.fn() }),
}))

const communityDid = 'did:webvh:QmUsH14W1foRZyP9v7LtfxwFy7qWgzNBLSzhWhbMQeMPJB:keyring-vti-vtc.ngrok.app'

const show = () => {
  const mockUseRoute = useRoute as jest.Mock
  const mockUseAgent = useAgent as jest.Mock
  mockUseRoute.mockReturnValue({ params: { communityDid } })
  mockUseAgent.mockReturnValue({ agent: undefined })
  return render(
    <BasicAppContext>
      <VtiCommunity />
    </BasicAppContext>
  )
}

describe('the community screen', () => {
  beforeEach(() => communityTarget.clear())

  it('leads with the name, not the DID, and keeps the DID under Details', () => {
    communityTarget.publishedName(communityDid, 'Keyring Lab Community')
    const tree = show()
    expect(tree.getByTestId(testIdWithKey('CommunityName'))).toHaveTextContent('Keyring Lab Community')
    // Closed by default — and reachable, in the same place as every other detail.
    expect(tree.queryByTestId(testIdWithKey('CommunityDid'))).toBeNull()
    expect(tree.getByTestId(testIdWithKey('CommunityDetailsToggle'))).toBeTruthy()
  })

  it('says a community published no name rather than showing its host as one', () => {
    const tree = show()
    expect(tree.getByTestId(testIdWithKey('CommunityName'))).toHaveTextContent('Join.Unnamed')
    expect(tree.queryByTestId(testIdWithKey('CommunityNameClaimed'))).toBeNull()
  })

  it('a name only a link claimed says where it came from', () => {
    communityTarget.set({ communityDid, name: 'Totally The Real One' })
    const tree = show()
    expect(tree.getByTestId(testIdWithKey('CommunityName'))).toHaveTextContent('Totally The Real One')
    expect(tree.getByTestId(testIdWithKey('CommunityNameClaimed'))).toHaveTextContent('Join.NameFromLink')
  })
})

describe('leaving a community (220)', () => {
  const persona = { did: 'did:webvh:QmPersona:p', communityDid }
  beforeEach(() => {
    mockPersona = persona
    mockLeave.mockReset()
    mockToast.mockReset()
  })
  afterAll(() => {
    mockPersona = undefined
  })

  const openLeave = async () => {
    (useRoute as jest.Mock).mockReturnValue({ params: { communityDid } })
    ;(useAgent as jest.Mock).mockReturnValue({ agent: {} })
    const tree = render(
      <BasicAppContext>
        <VtiCommunity />
      </BasicAppContext>
    )
    await act(async () => undefined)
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('LeaveCommunityButton'))))
    return tree
  }

  it('asks first, says what happens, and erases by default', async () => {
    mockLeave.mockResolvedValue({ disposition: 'purge', alreadyGone: false })
    const tree = await openLeave()
    expect(tree.getByTestId(testIdWithKey('LeaveCommunityConfirmCard'))).toHaveTextContent(/Community\.LeaveExplains/)
    expect(tree.getByTestId(testIdWithKey('LeaveCommunityPurge')).props.accessibilityState).toMatchObject({
      selected: true,
    })
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('LeaveCommunityConfirm'))))
    expect(mockLeave).toHaveBeenCalledWith(expect.anything(), communityDid, { disposition: 'purge' })
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ text1: 'Community.LeftPurge' }))
  })

  it('keeps only a note when the person chooses so, and says what the community applied', async () => {
    mockLeave.mockResolvedValue({ disposition: 'tombstone', alreadyGone: false })
    const tree = await openLeave()
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('LeaveCommunityTombstone'))))
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('LeaveCommunityConfirm'))))
    expect(mockLeave).toHaveBeenCalledWith(expect.anything(), communityDid, { disposition: 'tombstone' })
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ text1: 'Community.LeftTombstone' }))
  })

  it('the last admin is told what to do first, in words', async () => {
    mockLeave.mockRejectedValue(Object.assign(new Error('raw 409'), { code: 'lastAdmin' }))
    const tree = await openLeave()
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('LeaveCommunityConfirm'))))
    expect(tree.getByTestId(testIdWithKey('CommunityError'))).toHaveTextContent('Community.LeaveLastAdmin')
    expect(mockToast).not.toHaveBeenCalled()
  })
})

/** A member is not asked to apply (the journey-state audit, E). */
describe('the community screen, for a member', () => {
  const membership = { communityDid, role: 'member', grantedAt: '2026-09-23T20:04:44Z' }
  beforeEach(() => communityTarget.clear())
  afterEach(() => {
    mockJourney = undefined
  })

  it('says they are a member, since when, with no criteria and no Apply', async () => {
    mockJourney = { join: { kind: 'member', membership }, vetterGrant: { state: 'none' } }
    const tree = show()
    await act(async () => undefined)
    expect(tree.getByTestId(testIdWithKey('CommunityMember'))).toHaveTextContent(/Join\.StandingMember/)
    expect(tree.getByTestId(testIdWithKey('CommunityMemberSince'))).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('CommunityCriteria'))).toBeNull()
    expect(tree.queryByTestId(testIdWithKey('ApplyToCommunityButton'))).toBeNull()
    expect(tree.queryByTestId(testIdWithKey('CommunityOpenDesk'))).toBeNull()
  })

  it('a member who vets here is offered their desk', async () => {
    mockJourney = {
      join: { kind: 'member', membership },
      vetterGrant: { state: 'active', statusChecked: true },
    }
    const tree = show()
    await act(async () => undefined)
    expect(tree.getByTestId(testIdWithKey('CommunityOpenDesk'))).toBeTruthy()
  })

  it('someone not yet a member still sees what is asked, and Apply', async () => {
    mockJourney = { join: { kind: 'none' }, vetterGrant: { state: 'none' } }
    const tree = show()
    await act(async () => undefined)
    expect(tree.queryByTestId(testIdWithKey('CommunityMember'))).toBeNull()
    expect(tree.getByTestId(testIdWithKey('CommunityCriteria'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('ApplyToCommunityButton'))).toBeTruthy()
  })
})
