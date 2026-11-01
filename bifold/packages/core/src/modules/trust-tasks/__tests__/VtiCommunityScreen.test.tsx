/**
 * The community screen led with the community's DID, because a DID is what
 * the app keys a community by. A person reads the top of a screen as what the
 * thing is called ("not everyone is a power user", tester report #12), so the
 * name leads and the DID — still the only checkable thing here — sits one tap
 * away under Details, where every other detail already is.
 */
import { useNavigation, useRoute } from '@react-navigation/native'
import { act, fireEvent, render } from '@testing-library/react-native'
import React, { Profiler } from 'react'
import { StyleSheet } from 'react-native'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { TAB_BAR_CLEARANCE } from '../screens/aboveTabBar'
import { resetCommunityBrands } from '../module/useCommunityBrand'
import { vtaAgent } from '../module/vtaAgent'
import { communityTarget } from '../module/vtiCommunityLink'
import VtiCommunity from '../screens/VtiCommunity'
import { unnamedRef } from '../screens/communityName'
import { registerHiddenVetter, type HiddenVetterSeam } from '../screens/hiddenVetterSeam'

import { readDirectoryDisclosure } from '../module/directoryDisclosure'
import { statement } from './fixtures/directoryStatement'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('../module/vtiAgent', () => ({
  vtiAgent: { fetchManifest: jest.fn(async () => ({ criteria: [] })) },
  VtiRefusal: class extends Error {},
  selfRemoveRefusal: (e: unknown) => ((e as { code?: string })?.code === 'lastAdmin' ? 'lastAdmin' : undefined),
}))
const mockLeave = jest.fn()
jest.mock('../module/vtiJoin', () => ({ leaveCommunity: (...a: unknown[]) => mockLeave(...a) }))
jest.mock('../module/vtiVetting', () => ({ GenericRecordsVettingStore: class {} }))
jest.mock('../module/communityLogo', () => ({
  cachedCommunityLogo: async (did: string) => `file:///community-logos/${did}`,
}))
const mockToast = jest.fn()
jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: { show: (...a: unknown[]) => mockToast(...a), hide: jest.fn() },
}))
let mockPersona: unknown = undefined
// Every identity on the phone, any agent's (the holders hook reads them all).
let mockPersonas: unknown[] = []
// When set, the identities are read only once it settles.
let mockPersonasRead: Promise<void> | undefined
// When set, the next read of the identities fails (and clears it).
let mockPersonasFailOnce = false
const mockForgetCommunity = jest.fn(async () => undefined)
const mockForgetPersona = jest.fn(async () => undefined)
// What the phone keeps of how communities look, set by the tests of the community's mark.
let mockBrands: unknown[] = []
jest.mock('../module/VtiCommunityStore', () => ({
  GenericRecordsCommunityStore: class {
    getMembership = async () => undefined
    listHeldCredentials = async () => []
    listCommunityBrands = async () => mockBrands
    forgetCommunity = (...a: unknown[]) => mockForgetCommunity(...(a as []))
  },
}))
jest.mock('../module/VtiIdentityStore', () => ({
  GenericRecordsIdentityStore: class {
    getPersona = async () => mockPersona
    listPersonas = async () => {
      if (mockPersonasRead) await mockPersonasRead
      if (mockPersonasFailOnce) {
        mockPersonasFailOnce = false
        throw new Error('store unavailable')
      }
      return mockPersonas
    }
    forgetPersona = (...a: unknown[]) => mockForgetPersona(...(a as []))
  },
}))

// Where the phone stands with the community (the journey), set per test.
let mockJourney: unknown = undefined
const mockRefresh = jest.fn(async () => undefined)
jest.mock('../module/communityJourney', () => ({
  // The real helpers (joinKnown, vetterGrantKnown, readFailed); only the hook is faked.
  ...jest.requireActual('../module/communityJourney'),
  useCommunityJourney: () => ({ journey: mockJourney, refresh: mockRefresh }),
}))
/** Read, and not a member. */
const notMember = { join: { kind: 'none' }, vetterGrant: { state: 'none' } }

// The rooms service, set by the rooms tests (undefined: the rooms flag is off, as in every other test).
let mockRoomsService: unknown = undefined
jest.mock('../../rooms/useRoomsService', () => ({ useRoomsService: () => mockRoomsService }))

// What the persona inbox says of this community's agent, set per test (IN-350).
let mockAgentState: unknown = undefined
jest.mock('../module/vtiPersonaInbox', () => ({
  ...jest.requireActual('../module/vtiPersonaInbox'),
  usePersonaAgentState: () => mockAgentState,
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

  it('a community that cannot be read is said in words, not the raw error', async () => {
    const { vtiAgent: mocked } = jest.requireMock('../module/vtiAgent') as { vtiAgent: { fetchManifest: jest.Mock } }
    mocked.fetchManifest.mockRejectedValueOnce(new Error('vtiAgent: GET /manifest 503 no available server'))
    const tree = show()
    await act(async () => undefined)
    expect(tree.getByTestId(testIdWithKey('CommunityError'))).not.toHaveTextContent(/vtiAgent|503/)
  })

  it('says a community published no name rather than showing its host as one: its handle, and a pill saying so', () => {
    const tree = show()
    expect(tree.getByTestId(testIdWithKey('CommunityName'))).toHaveTextContent(unnamedRef(communityDid))
    expect(tree.getByText('Community.PassNoName')).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('CommunityNameClaimed'))).toBeNull()
  })

  it('a published name has no pill (control)', () => {
    communityTarget.set({ communityDid, name: 'Keyring Lab', published: true })
    const tree = show()
    expect(tree.getByTestId(testIdWithKey('CommunityName'))).toHaveTextContent('Keyring Lab')
    expect(tree.queryByText('Community.PassNoName')).toBeNull()
  })

  it('a name only a link claimed says where it came from', () => {
    communityTarget.set({ communityDid, name: 'Totally The Real One' })
    const tree = show()
    expect(tree.getByTestId(testIdWithKey('CommunityName'))).toHaveTextContent('Totally The Real One')
    expect(tree.getByTestId(testIdWithKey('CommunityNameClaimed'))).toHaveTextContent('Join.NameFromLink')
  })
})

// IN-350: an app-wide toast covered a contact's chat; the community says it.
describe('the community screen, when its identity cannot sign in because of its agent', () => {
  beforeEach(() => communityTarget.clear())
  afterEach(() => {
    mockAgentState = undefined
  })

  it('says so first, by what the agent did, with the way to My Agent', () => {
    mockAgentState = { kind: 'refused' }
    communityTarget.publishedName(communityDid, 'Keyring Lab Community')
    const tree = show()
    expect(tree.getByTestId(testIdWithKey('CommunityName'))).toHaveTextContent('Keyring Lab Community')
    expect(tree.getByTestId(testIdWithKey('PersonaAgentNotice'))).toHaveTextContent(/VtaLink\.PersonaAgentRefusedBody/)
    const navigation = useNavigation() as unknown as { navigate: jest.Mock }
    navigation.navigate.mockClear()
    fireEvent.press(tree.getByTestId(testIdWithKey('PersonaAgentNoticeOpen')))
    expect(navigation.navigate).toHaveBeenCalledTimes(1)
    expect([Screens.VtaAgent, Screens.MyAgent]).toContain(navigation.navigate.mock.calls[0][0])
  })

  it('says nothing while it signs in', () => {
    communityTarget.publishedName(communityDid, 'Keyring Lab Community')
    const tree = show()
    expect(tree.getByTestId(testIdWithKey('CommunityName'))).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('PersonaAgentNotice'))).toBeNull()
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
    ;(useRoute as jest.Mock).mockReturnValue({ params: { communityDid } })
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

  // Farm, 2026-09-26: the self-remove's answer never came, and the screen
  // showed "vtiAgent: sent vtc/members/self-remove; …" in red, with no way on.
  const noAnswer = () =>
    Object.assign(new Error('vtiAgent: sent vtc/members/self-remove; the community has not answered yet'), {
      name: 'VtiSentNoAnswer',
    })

  it('a leave that goes unanswered says so in words, and offers Try again, which leaves', async () => {
    mockLeave.mockRejectedValueOnce(noAnswer()).mockResolvedValueOnce({ disposition: 'purge', alreadyGone: false })
    const tree = await openLeave()
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('LeaveCommunityConfirm'))))
    expect(tree.getByTestId(testIdWithKey('CommunityError'))).toHaveTextContent('Community.LeaveNoAnswer')
    expect(tree.queryByText(/vtiAgent/)).toBeNull()
    expect(mockToast).not.toHaveBeenCalled()
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('LeaveCommunityRetry'))))
    expect(mockLeave).toHaveBeenLastCalledWith(expect.anything(), communityDid, { disposition: 'purge' })
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ text1: 'Community.LeftPurge' }))
  })

  it('no raw error text reaches the screen; it stays behind Details', async () => {
    mockLeave.mockRejectedValue(new Error('vtiAgent: something nobody planned for'))
    const tree = await openLeave()
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('LeaveCommunityConfirm'))))
    expect(tree.getByTestId(testIdWithKey('CommunityError'))).toHaveTextContent('Errors.Unknown')
    expect(tree.queryByText(/vtiAgent/)).toBeNull()
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('CommunityRefusalDetails'))))
    expect(tree.getByTestId(testIdWithKey('CommunityRefusalCode'))).toHaveTextContent(/something nobody planned for/)
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
describe('the community screen, before joining: its directory statement (manifest/0.4)', () => {
  beforeEach(() => {
    communityTarget.clear()
    mockJourney = notMember
  })
  afterEach(() => {
    mockJourney = undefined
  })
  const mocked = () =>
    (jest.requireMock('../module/vtiAgent') as { vtiAgent: { fetchManifest: jest.Mock } }).vtiAgent.fetchManifest

  it('shows what its member directory would show, to someone not yet a member', async () => {
    mocked().mockResolvedValueOnce({ criteria: [], directoryDisclosure: readDirectoryDisclosure(statement()) })
    const tree = show()
    await act(async () => undefined)
    expect(tree.getByTestId(testIdWithKey('DirectoryDisclosure'))).toBeTruthy()
  })

  it('says nothing about a directory when the community carries no statement', async () => {
    mocked().mockResolvedValueOnce({ criteria: [] })
    const tree = show()
    await act(async () => undefined)
    expect(tree.queryByTestId(testIdWithKey('DirectoryDisclosure'))).toBeNull()
  })

  it('does not show it to a member', async () => {
    mockJourney = {
      join: { kind: 'member', membership: { communityDid, role: 'member', grantedAt: '2026-09-23T20:04:44Z' } },
      vetterGrant: { state: 'none' },
    }
    mocked().mockResolvedValueOnce({ criteria: [], directoryDisclosure: readDirectoryDisclosure(statement()) })
    const tree = show()
    await act(async () => undefined)
    expect(tree.queryByTestId(testIdWithKey('DirectoryDisclosure'))).toBeNull()
  })
})

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
    // One line under the name: "✓ Member since …"; a screen reader hears that they are a member, and since when.
    expect(tree.getByTestId(testIdWithKey('CommunityMember'))).toHaveTextContent(/MyAgent\.MemberSince/)
    expect(tree.getByTestId(testIdWithKey('CommunityMember')).props.accessibilityLabel).toMatch(
      /^Join\.StandingMember MyAgent\.MemberSince$/
    )
    expect(tree.getByTestId(testIdWithKey('CommunityMemberSince'))).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('CommunityCriteria'))).toBeNull()
    expect(tree.queryByTestId(testIdWithKey('ApplyToCommunityButton'))).toBeNull()
    expect(tree.queryByTestId(testIdWithKey('CommunityOpenDesk'))).toBeNull()
  })

  // 276.10, option A: who the community is first, then Rooms and Directory, and About last with Leave out of the way.
  it('reads top to bottom: the name, Rooms, Directory, then About with Details and Leave', async () => {
    mockJourney = { join: { kind: 'member', membership }, vetterGrant: { state: 'none' } }
    mockPersona = { did: 'did:webvh:QmPersona:p', communityDid }
    mockRoomsService = {
      isSample: false,
      capabilities: async () => jest.requireActual('../../rooms/capabilities').sampleCapabilities(),
      listMyRooms: async () => [],
      listOffers: async () => [],
    }
    try {
      // With an agent, as the leave tests: the phone holds an identity here, so Leave is offered.
      ;(useRoute as jest.Mock).mockReturnValue({ params: { communityDid } })
      ;(useAgent as jest.Mock).mockReturnValue({ agent: {} })
      const tree = render(
        <BasicAppContext>
          <VtiCommunity />
        </BasicAppContext>
      )
      await act(async () => undefined)
      const order = tree.UNSAFE_root.findAll((n) => typeof n.props.testID === 'string' && typeof n.type === 'string')
        .map((n) => n.props.testID as string)
        .filter((testID, i, all) => all.indexOf(testID) === i)
      const at = (key: string) => order.indexOf(testIdWithKey(key))
      const keys = [
        'CommunityName',
        'CommunityRooms',
        'CommunityDirectory',
        'CommunityDetailsToggle',
        'LeaveCommunityButton',
      ]
      keys.forEach((key) => expect(at(key)).toBeGreaterThanOrEqual(0))
      expect(keys.map(at)).toEqual([...keys.map(at)].sort((a, b) => a - b))
      // Leave is plain words in About, not a bordered button, with the way back said under it.
      const leave = StyleSheet.flatten(tree.getByTestId(testIdWithKey('LeaveCommunityButton')).props.style)
      expect(leave.borderWidth ?? 0).toBe(0)
      expect(tree.getByText('Join.StandingAgain')).toBeTruthy()
      expect(tree.getByText('Community.AboutSection')).toBeTruthy()
    } finally {
      mockRoomsService = undefined
      mockPersona = undefined
    }
  })

  it('Details, under About, shows the community ID on a tap', async () => {
    mockJourney = { join: { kind: 'member', membership }, vetterGrant: { state: 'none' } }
    const tree = show()
    await act(async () => undefined)
    expect(tree.queryByTestId(testIdWithKey('CommunityDid'))).toBeNull()
    fireEvent.press(tree.getByTestId(testIdWithKey('CommunityDetailsToggle')))
    expect(tree.getByTestId(testIdWithKey('CommunityDid'))).toHaveTextContent(communityDid)
  })

  it('Rooms: rows in the shape of rooms while they are read, then counted in the label', async () => {
    mockJourney = { join: { kind: 'member', membership }, vetterGrant: { state: 'none' } }
    let answer: (rooms: unknown[]) => void = () => undefined
    mockRoomsService = {
      isSample: false,
      capabilities: async () => jest.requireActual('../../rooms/capabilities').sampleCapabilities(),
      listMyRooms: () => new Promise((resolve) => (answer = resolve)),
      listOffers: async () => [],
    }
    try {
      const tree = show()
      await act(async () => undefined)
      const reading = tree.getByTestId(testIdWithKey('RoomsReading'))
      expect(reading.props.accessibilityLabel).toBe('Rooms.Reading')
      expect(tree.UNSAFE_queryAllByType(jest.requireActual('react-native').ActivityIndicator)).toHaveLength(0)
      expect(tree.getByText('Rooms.Rooms')).toBeTruthy()

      await act(async () =>
        answer([
          {
            roomId: 'did:webvh:r:here',
            name: 'Planning',
            nameFrom: 'community',
            source: 'community',
            communityDid,
            tier: 'open',
            verbs: ['read'],
            standing: 'member',
          },
        ])
      )
      expect(tree.queryByTestId(testIdWithKey('RoomsReading'))).toBeNull()
      expect(tree.getByText('Rooms.Rooms · 1')).toBeTruthy()
    } finally {
      mockRoomsService = undefined
    }
  })

  it("rooms flag on: this community's offers and rooms, each opening its screen; off, no section (on is the control)", async () => {
    mockJourney = { join: { kind: 'member', membership }, vetterGrant: { state: 'none' } }
    const room = (roomId: string, name: string, did: string) => ({
      roomId,
      name,
      nameFrom: 'community',
      source: 'community',
      communityDid: did,
      tier: 'open',
      verbs: ['read'],
      standing: 'member',
    })
    const offer = (offerId: string, roomName: string, did: string) => ({
      offerId,
      roomId: `did:webvh:r:${offerId}`,
      roomName,
      communityDid: did,
      tier: 'open',
      verbs: ['read'],
    })
    mockRoomsService = {
      isSample: false,
      capabilities: async () => jest.requireActual('../../rooms/capabilities').sampleCapabilities(),
      listMyRooms: async () => [
        room('did:webvh:r:here', 'Planning', communityDid),
        room('did:webvh:r:else', 'Elsewhere', 'did:webvh:other'),
      ],
      listOffers: async () => [
        offer('o-here', 'Kernel notes', communityDid),
        offer('o-else', 'Far', 'did:webvh:other'),
      ],
    }
    const navigate = useNavigation().navigate as jest.Mock
    navigate.mockClear()
    try {
      const on = show()
      await act(async () => undefined)
      expect(on.getByTestId(testIdWithKey('CommunityRooms'))).toBeTruthy()
      expect(on.getByText('Planning')).toBeTruthy()
      expect(on.getByText('Kernel notes')).toBeTruthy()
      expect(on.queryByText('Elsewhere')).toBeNull()
      expect(on.queryByText('Far')).toBeNull()

      fireEvent.press(on.getByText('Planning'))
      expect(navigate).toHaveBeenCalledWith(Screens.Room, { roomId: 'did:webvh:r:here' })
      fireEvent.press(on.getByTestId(testIdWithKey('RoomOfferRow_ohere')))
      expect(navigate).toHaveBeenCalledWith(Screens.RoomOffer, { offerRef: 'o-here' })
      on.unmount()

      mockRoomsService = undefined
      const off = show()
      await act(async () => undefined)
      expect(off.getByTestId(testIdWithKey('CommunityMember'))).toBeTruthy()
      expect(off.queryByTestId(testIdWithKey('CommunityRooms'))).toBeNull()
    } finally {
      mockRoomsService = undefined
    }
  })

  it('not a member: no Rooms section, even with the rooms flag on', async () => {
    mockJourney = notMember
    mockRoomsService = {
      isSample: false,
      capabilities: async () => jest.requireActual('../../rooms/capabilities').sampleCapabilities(),
      listMyRooms: async () => [],
      listOffers: async () => [],
    }
    try {
      const tree = show()
      await act(async () => undefined)
      expect(tree.queryByTestId(testIdWithKey('CommunityRooms'))).toBeNull()
    } finally {
      mockRoomsService = undefined
    }
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

  // One flow (Alberto, 2026-10-15): a vetter vouches privately from the
  // ordinary desk, so there is no separate "Vouch privately" entry here.
  it('a vetter where a way runs private vetting: only the ordinary desk, no separate entry', async () => {
    mockJourney = {
      join: { kind: 'member', membership },
      vetterGrant: { state: 'active', statusChecked: true },
    }
    const { vtiAgent: mocked } = jest.requireMock('../module/vtiAgent') as { vtiAgent: { fetchManifest: jest.Mock } }
    mocked.fetchManifest.mockResolvedValue({
      criteria: [
        { id: 'vetted-member', vetting: { ext: { 'org.openvtc.hidden-vetting': { suite: 'ps-ddh-bls12381' } } } },
      ],
    })
    registerHiddenVetter({ standing: jest.fn() } as unknown as HiddenVetterSeam)
    try {
      const tree = show()
      await act(async () => undefined)
      expect(tree.getByTestId(testIdWithKey('CommunityOpenDesk'))).toBeTruthy()
      expect(tree.queryByTestId(testIdWithKey('CommunityVouchPrivately'))).toBeNull()
    } finally {
      registerHiddenVetter(undefined)
      mocked.fetchManifest.mockResolvedValue({ criteria: [] })
    }
  })

  // The result is marked as the steps were.
  it('a membership won by private vetting says so', async () => {
    mockJourney = {
      join: { kind: 'member', membership: { ...membership, privateVetting: true } },
      vetterGrant: { state: 'none' },
    }
    const tree = show()
    await act(async () => undefined)
    expect(tree.getByTestId(testIdWithKey('CommunityJoinedPrivately'))).toHaveTextContent(/Vetting\.Private\.Joined/)
  })

  it('someone not yet a member still sees what is asked, and Apply', async () => {
    mockJourney = { join: { kind: 'none' }, vetterGrant: { state: 'none' } }
    const tree = show()
    await act(async () => undefined)
    expect(tree.queryByTestId(testIdWithKey('CommunityMember'))).toBeNull()
    expect(tree.getByTestId(testIdWithKey('CommunityCriteria'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('ApplyToCommunityButton'))).toBeTruthy()
  })

  // IN-127, 10-06: this button sent a plain request at once, and the vetting that
  // followed could not be added to it. Now it opens Join, where the person chooses.
  it('"Choose how to join" opens Join on this community, and sends nothing', async () => {
    mockJourney = { join: { kind: 'none' }, vetterGrant: { state: 'none' } }
    const navigate = useNavigation().navigate as jest.Mock
    navigate.mockClear()
    const tree = show()
    await act(async () => undefined)
    expect(tree.getByTestId(testIdWithKey('ApplyToCommunityButton'))).toHaveTextContent('Community.HowToJoin')
    fireEvent.press(tree.getByTestId(testIdWithKey('ApplyToCommunityButton')))
    expect(navigate).toHaveBeenCalledWith(Screens.VtiJoin)
    expect(communityTarget.get()?.communityDid).toBe(communityDid)
  })
})

// Alberto's iPhone, 10-06: joined with al-phone, unlinked it, linked al-signer.
// The screen said "You're a member" and offered Leave, which failed.
describe("a community known only through another agent's identity", () => {
  const AL_PHONE = 'did:webvh:QmA:dids.example.org:al-phone-vta'
  const AL_SIGNER = 'did:webvh:QmB:dids.example.org:al-signer-vta'
  const setVta = (next: Record<string, unknown>) => (vtaAgent as unknown as { set(n: object): void }).set(next)
  const member = {
    join: {
      kind: 'member',
      membership: { communityDid, personaDid: 'did:webvh:QmP:p', grantedAt: '2026-10-05T00:00:00Z' },
    },
    vetterGrant: { state: 'none' },
  }
  beforeEach(() => {
    mockPersona = undefined
    mockPersonas = [{ did: 'did:webvh:QmP:p', communityDid, vtaDid: AL_PHONE }]
    mockJourney = member
    mockForgetCommunity.mockClear()
    mockForgetPersona.mockClear()
    setVta({
      link: {
        kind: 'linked',
        vtaDid: AL_SIGNER,
        label: 'al-signer',
        linkedAt: '2026-10-06T00:00:00Z',
        connection: { kind: 'online', since: 0 },
      },
      agents: [{ vtaDid: AL_SIGNER, label: 'al-signer' }],
    })
  })
  afterAll(() => {
    mockPersonas = []
    mockJourney = undefined
    setVta({ agents: undefined })
  })

  const open = async () => {
    ;(useRoute as jest.Mock).mockReturnValue({ params: { communityDid } })
    ;(useAgent as jest.Mock).mockReturnValue({ agent: {} })
    const tree = render(
      <BasicAppContext>
        <VtiCommunity />
      </BasicAppContext>
    )
    await act(async () => undefined)
    return tree
  }

  it('leaves room at its foot for the tab bar, so the last button scrolls clear of it', async () => {
    const tree = await open()
    expect(
      StyleSheet.flatten(tree.getByTestId(testIdWithKey('CommunityScroll')).props.contentContainerStyle).paddingBottom
    ).toBeGreaterThanOrEqual(TAB_BAR_CLEARANCE)
  })

  // Whose identity it is is read from this phone, after the journey: shown before, another agent's membership read
  // as this agent's ("member", Leave) and then turned into "another agent's" (UI-smoothness plan, Phase 5).
  it("never shows another agent's membership as this agent's, not even while whose it is is read", async () => {
    let release: () => void = () => undefined
    mockPersonasRead = new Promise<void>((resolve) => (release = resolve))
    ;(useRoute as jest.Mock).mockReturnValue({ params: { communityDid } })
    ;(useAgent as jest.Mock).mockReturnValue({ agent: {} })
    const frames: string[] = []
    const tree = render(<BasicAppContext>{null}</BasicAppContext>)
    const look = () =>
      frames.push(
        ['CommunityMember', 'LeaveCommunityButton', 'ApplyToCommunityButton', 'CommunityHeldElsewhereText']
          .filter((key) => tree.queryByTestId(testIdWithKey(key)) !== null)
          .join(',') || 'none'
      )
    tree.rerender(
      <BasicAppContext>
        <Profiler id="community" onRender={look}>
          <VtiCommunity />
        </Profiler>
      </BasicAppContext>
    )
    await act(async () => undefined)
    await act(async () => release())
    mockPersonasRead = undefined
    expect(frames.filter((f) => f !== 'none' && f !== 'CommunityHeldElsewhereText')).toEqual([])
    expect(frames[frames.length - 1]).toBe('CommunityHeldElsewhereText')
  })

  // A failed read of whose identity it is was a wait on nothing, for good: the standing stayed "not known" with no
  // way to read it again. It is said, as a failed journey read is, and reading again reads it.
  it('a failed read of whose identity it is offers a way to read it again, and reading again reads it', async () => {
    mockPersonasFailOnce = true
    const tree = await open()
    expect(tree.getByTestId(testIdWithKey('CommunityReadAgain'))).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('CommunityMember'))).toBeNull()
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('CommunityReadAgain')))
    })
    expect(tree.getByTestId(testIdWithKey('CommunityHeldElsewhereText'))).toHaveTextContent(/Community\.HeldElsewhere/)
  })

  it('says whose identity it is, with no "member", no Leave and no Apply', async () => {
    const tree = await open()
    expect(tree.getByTestId(testIdWithKey('CommunityHeldElsewhereText'))).toHaveTextContent(/Community\.HeldElsewhere/)
    expect(tree.queryByTestId(testIdWithKey('CommunityMember'))).toBeNull()
    expect(tree.queryByTestId(testIdWithKey('LeaveCommunityButton'))).toBeNull()
    expect(tree.queryByTestId(testIdWithKey('ApplyToCommunityButton'))).toBeNull()
  })

  it('an agent no longer linked: "Add it again" leads to adding an agent', async () => {
    const navigate = useNavigation().navigate as jest.Mock
    navigate.mockClear()
    const start = jest.spyOn(vtaAgent, 'startAddingAgent').mockResolvedValue(undefined)
    const tree = await open()
    expect(tree.getByTestId(testIdWithKey('CommunityHeldElsewhere'))).toHaveTextContent(
      /Community\.HeldElsewhereUnlinked/
    )
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('CommunityAddHolderAgent'))))
    expect(start).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith(Screens.VtaLink)
    start.mockRestore()
  })

  it('an agent still linked: switch to it', async () => {
    setVta({
      agents: [
        { vtaDid: AL_SIGNER, label: 'al-signer' },
        { vtaDid: AL_PHONE, label: 'al-phone' },
      ],
    })
    const use = jest.spyOn(vtaAgent, 'useAgent').mockResolvedValue(undefined)
    const tree = await open()
    expect(tree.getByTestId(testIdWithKey('CommunityHeldElsewhere'))).toHaveTextContent(
      /Community\.HeldElsewhereLinked/
    )
    fireEvent.press(tree.getByTestId(testIdWithKey('CommunityUseHolderAgent')))
    expect(use).toHaveBeenCalledWith(expect.anything(), AL_PHONE)
    use.mockRestore()
  })

  it('"Remove from this phone" says it does not leave, then forgets only that agent\'s records', async () => {
    const tree = await open()
    fireEvent.press(tree.getByTestId(testIdWithKey('CommunityRemoveHere')))
    expect(tree.getByTestId(testIdWithKey('CommunityRemoveHereCard'))).toHaveTextContent(/Community\.RemoveHereWarning/)
    expect(mockForgetCommunity).not.toHaveBeenCalled()
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('CommunityRemoveHereConfirm'))))
    expect(mockForgetCommunity).toHaveBeenCalledWith(communityDid, 'did:webvh:QmP:p')
    expect(mockForgetPersona).toHaveBeenCalledWith(communityDid, AL_PHONE)
  })

  it("the current agent's own identity: a member as before, with Leave", async () => {
    mockPersona = { did: 'did:webvh:QmP:mine', communityDid, vtaDid: AL_SIGNER }
    mockPersonas = [mockPersona]
    const tree = await open()
    expect(tree.queryByTestId(testIdWithKey('CommunityHeldElsewhere'))).toBeNull()
    expect(tree.getByTestId(testIdWithKey('CommunityMember'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('LeaveCommunityButton'))).toBeTruthy()
  })
})

// Phase 2b: a member saw the criteria and "How to join" until the journey read came back.
describe('the community screen, before it knows whether this phone is a member', () => {
  beforeEach(() => communityTarget.clear())
  afterEach(() => {
    mockJourney = undefined
  })
  const mocked = () =>
    (jest.requireMock('../module/vtiAgent') as { vtiAgent: { fetchManifest: jest.Mock } }).vtiAgent.fetchManifest
  const asks = () => ({
    criteria: [{ id: 'c1', description: 'Be kind' }],
    directoryDisclosure: readDirectoryDisclosure(statement()),
  })
  const shown = (tree: ReturnType<typeof show>) =>
    ['CommunityCriteria', 'ApplyToCommunityButton', 'DirectoryDisclosure'].filter((id) =>
      tree.queryByTestId(testIdWithKey(id))
    )

  it('shows neither the criteria nor the way to apply, only that it is reading', async () => {
    mockJourney = undefined
    mocked().mockResolvedValueOnce(asks())
    const tree = show()
    await act(async () => undefined)
    expect(shown(tree)).toEqual([])
    expect(tree.queryByText('MyAgent.WhatIsAsked')).toBeNull()
    expect(tree.getByTestId(testIdWithKey('CommunityReading'))).toBeTruthy()
  })

  it('once read, and not a member: the criteria and the way to apply', async () => {
    mockJourney = notMember
    mocked().mockResolvedValueOnce(asks())
    const tree = show()
    await act(async () => undefined)
    expect(shown(tree)).toEqual(['CommunityCriteria', 'ApplyToCommunityButton', 'DirectoryDisclosure'])
    expect(tree.queryByTestId(testIdWithKey('CommunityReading'))).toBeNull()
  })

  it('one that could not be read: said, with Check again, which reads it again', async () => {
    mockJourney = { ...notMember, unread: ['join', 'application', 'vetterGrant'], failed: ['join'] }
    mocked().mockResolvedValueOnce(asks())
    mockRefresh.mockClear()
    const tree = show()
    await act(async () => undefined)
    expect(shown(tree)).toEqual([])
    expect(tree.queryByTestId(testIdWithKey('CommunityReading'))).toBeNull()
    expect(tree.getByTestId(testIdWithKey('CommunityReadFailed'))).toHaveTextContent(/Join\.StandingUnread/)
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('CommunityReadAgain'))))
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })
})

// A community's Wallet card showed its logo, and this screen the generic people icon.
describe("the community's mark at the top of its screen", () => {
  const otherDid = 'did:webvh:QmOther:keyring-vti-vtc.ngrok.app'
  const logoOf = (did: string) => ({ communityDid: did, logoUrl: 'https://vtc.example.org/logo.png' })
  const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
  const screen = () => (
    <BasicAppContext>
      <VtiCommunity />
    </BasicAppContext>
  )
  const showOn = (did: string) => {
    ;(useRoute as jest.Mock).mockReturnValue({ params: { communityDid: did } })
    ;(useAgent as jest.Mock).mockReturnValue({ agent: {} })
    return render(screen())
  }
  const logo = (tree: ReturnType<typeof render>) => tree.queryByTestId(testIdWithKey('CommunityLogo'))
  const icon = (tree: ReturnType<typeof render>) => tree.queryByTestId(testIdWithKey('CommunityMarkIcon'))

  beforeEach(() => {
    communityTarget.clear()
    resetCommunityBrands()
    mockJourney = notMember
  })
  afterEach(() => {
    mockBrands = []
    mockJourney = undefined
  })

  it('shows the logo the Wallet card shows, not the people icon', async () => {
    mockBrands = [logoOf(communityDid)]
    const tree = showOn(communityDid)
    await flush()
    expect(logo(tree)?.props.source).toEqual({ uri: `file:///community-logos/${communityDid}` })
    expect(icon(tree)).toBeNull()
  })

  it('keeps the people icon for a community that has no logo (control)', async () => {
    mockBrands = [{ communityDid }]
    const tree = showOn(communityDid)
    await flush()
    expect(icon(tree)).toBeTruthy()
    expect(logo(tree)).toBeNull()
  })

  it("opened on another community, never shows the last one's logo", async () => {
    mockBrands = [logoOf(communityDid), { communityDid: otherDid }]
    const tree = showOn(communityDid)
    await flush()
    expect(logo(tree)).toBeTruthy()
    ;(useRoute as jest.Mock).mockReturnValue({ params: { communityDid: otherDid } })
    tree.rerender(screen())
    await flush()
    expect(logo(tree)).toBeNull()
    expect(icon(tree)).toBeTruthy()
  })
})
