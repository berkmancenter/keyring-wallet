/**
 * A room's members (data rooms mock, Members): the member's own access first (what they can do, until when, as
 * which identity); then the community's list of who it admitted, read only when the tab is shown and only where the
 * service allows it, each with a role, the member marked as themselves; then the way out, which opens the
 * community's screen, where leaving is done. Where the list may not be seen, can't be read, or the room's community
 * isn't known, the tab says so.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import i18next from 'i18next'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import en from '../../../localization/en/en.json'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { deriveRoomCapabilities, sampleCapabilities } from '../capabilities'
import { roleText } from '../components/RoomMembersTab'
import { roomHandle } from '../components/RoomRow'
import { createSampleRoomsService } from '../sample/sampleRooms'
import type { CommunityRoomMember, OperationStatus, RoomsService } from '../types'

let mockService: RoomsService | undefined
let mockParams: Record<string, string> | undefined
jest.mock('../useRoomsService', () => ({ useRoomsService: () => mockService }))
jest.mock('@react-navigation/elements', () => ({ useHeaderHeight: () => 100 }))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useRoute: () => ({ params: mockParams }),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Room = require('../screens/Room').default
// The mock's one navigation object, the same one the screen gets.
const navigation = jest.requireMock('@react-navigation/native').useNavigation() as { navigate: jest.Mock }

const PLANNING = 'did:webvh:sample:planning'
const CUSTODY = 'did:webvh:sample:3f9a7c21e0'
const ME = { identityWords: '…negative-weird', did: 'did:peer:2.sample-me' }
const RIVER = { identityWords: '…river-stone', did: 'did:peer:2.sample-river' }
const id = (key: string) => testIdWithKey(key)

const show = (roomId = PLANNING) => {
  mockParams = { roomId }
  return render(
    <BasicAppContext>
      <Room />
    </BasicAppContext>
  )
}

const openMembers = async (tree: ReturnType<typeof show>) => {
  await waitFor(() => tree.getByTestId(id('RoomTabMembers')))
  await act(async () => {
    fireEvent.press(tree.getByTestId(id('RoomTabMembers')))
  })
}

const listed: CommunityRoomMember[] = [
  { identity: RIVER, verbs: ['read', 'write', 'curate'] },
  { identity: ME, verbs: ['read', 'write'] },
]

// An administrator's view: the service lets them read the community's list (the sample's member may not).
const listAllowed = (service: RoomsService) =>
  jest.spyOn(service, 'roomCapabilities').mockImplementation(async (roomId) => ({
    ...(await createSampleRoomsService().roomCapabilities(roomId)),
    listCommunityMembers: { status: 'available', reason: 'ok', detail: 'administrator' },
  }))

beforeEach(() => {
  mockService = createSampleRoomsService()
  navigation.navigate.mockClear()
})

describe('roleText', () => {
  test('the most a member may do names the role', async () => {
    const t = (await i18next.createInstance().init({ lng: 'en', resources: { en: { translation: en } } })) as never
    expect(roleText(t, ['read', 'write', 'curate', 'admin'])).toBe('Admin')
    expect(roleText(t, ['read', 'curate'])).toBe('Curator')
    expect(roleText(t, ['read', 'write'])).toBe('Member')
    expect(roleText(t, ['read'])).toBe('Reader')
  })
})

describe("a room's Members tab", () => {
  test('your access first: what you can do, until when, and as whom', async () => {
    const tree = show()
    await openMembers(tree)
    expect(tree.getByTestId(id('RoomMembersYouCan'))).toHaveTextContent('Rooms.AccessWrite')
    expect(tree.getByTestId(id('RoomMembersUntil'))).toHaveTextContent(/2027/)
    expect(tree.getByTestId(id('RoomMembersAs'))).toHaveTextContent('…negative-weird')
    expect(tree.getByTestId(id('RoomMembersCaption'))).toBeTruthy()
  })

  test("the community's list, read only once the tab is shown, with roles and you marked", async () => {
    const service = mockService as RoomsService
    listAllowed(service)
    const list = jest.spyOn(service, 'listCommunityMembers').mockResolvedValue(listed)
    const tree = show()
    await waitFor(() => tree.getByTestId(id('RoomTabMembers')))
    expect(list).not.toHaveBeenCalled()

    await openMembers(tree)
    await waitFor(() => expect(tree.getByTestId(id('RoomMembersList'))).toBeTruthy())
    expect(list).toHaveBeenCalledWith('did:webvh:sample:test-vtc', PLANNING)
    const river = tree.getByTestId(id(`RoomMember_${roomHandle(RIVER.did)}`))
    expect(river).toHaveTextContent(/…river-stone/)
    expect(river).toHaveTextContent(/Rooms\.RoleCurator/)
    expect(river).not.toHaveTextContent(/Rooms\.You/)
    expect(tree.getByTestId(id(`RoomMember_${roomHandle(ME.did)}`))).toHaveTextContent(/Rooms\.You/)
  })

  test('only administrators may see the list: the tab says so (the sample community refuses it)', async () => {
    const tree = show()
    await openMembers(tree)
    await waitFor(() => expect(tree.getByTestId(id('RoomMembersUnavailable'))).toHaveTextContent('Rooms.AdminOnly'))
    expect(tree.queryByTestId(id('RoomMembersList'))).toBeNull()
    expect(tree.queryByTestId(id('RoomMembersFailed'))).toBeNull()
  })

  test("a list that couldn't be read says so", async () => {
    listAllowed(mockService as RoomsService)
    jest.spyOn(mockService as RoomsService, 'listCommunityMembers').mockRejectedValue(new Error('no answer'))
    const tree = show()
    await openMembers(tree)
    await waitFor(() => expect(tree.getByTestId(id('RoomMembersFailed'))).toBeTruthy())
  })

  test('where the service says the list is not available, it is not asked for (control: the list above)', async () => {
    const service = mockService as RoomsService
    const list = jest.spyOn(service, 'listCommunityMembers')
    const notBuilt: OperationStatus = { status: 'comingSoon', reason: 'clientNotBuilt', detail: 'not built' }
    jest.spyOn(service, 'roomCapabilities').mockImplementation(async () => ({
      ...deriveRoomCapabilities(sampleCapabilities(), { source: 'community', verbs: ['read', 'write'] }),
      listCommunityMembers: notBuilt,
    }))
    const tree = show()
    await openMembers(tree)
    expect(tree.getByTestId(id('RoomMembersUnavailable'))).toHaveTextContent('Rooms.ComingSoon')
    expect(list).not.toHaveBeenCalled()
  })

  test("leaving opens the community's screen, where it is done", async () => {
    const tree = show()
    await openMembers(tree)
    expect(tree.getByTestId(id('RoomMembersLeave'))).toHaveTextContent(/Rooms\.MembersLeave/)
    fireEvent.press(tree.getByTestId(id('RoomMembersLeave')))
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.VtiCommunity, {
      communityDid: 'did:webvh:sample:test-vtc',
    })
  })

  test("a room whose community isn't known: details not loaded, no list asked for, and no way to leave from here", async () => {
    listAllowed(mockService as RoomsService)
    const list = jest.spyOn(mockService as RoomsService, 'listCommunityMembers')
    const tree = show(CUSTODY)
    await openMembers(tree)
    expect(tree.getByTestId(id('RoomMembersYouCan'))).toHaveTextContent('Rooms.DetailsNotLoaded')
    expect(tree.getByTestId(id('RoomMembersUnavailable'))).toHaveTextContent('Rooms.DetailsNotLoaded')
    expect(tree.queryByTestId(id('RoomMembersLeave'))).toBeNull()
    expect(list).not.toHaveBeenCalled()
  })
})
