/**
 * A room's details (rooms in Messages, R2): the chat's header opens them; they show the room, its parts (Files, Notes,
 * Members, each opening its own screen), who the member posts as (their own sheet), Hide from Messages where Messages
 * has the room as a row, and the community's screen in My Agent. Opening them asks the agent for no list.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import Toast from 'react-native-toast-message'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens, Stacks, TabStacks } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { createSampleRoomsService } from '../sample/sampleRooms'
import type { RoomsService } from '../types'

let mockService: RoomsService | undefined
let mockParams: Record<string, string> | undefined
let mockCanHide = true
const mockHideRoom = jest.fn()
const mockUndo = jest.fn()
jest.mock('../useRoomsService', () => ({ useRoomsService: () => mockService }))
jest.mock('@react-navigation/elements', () => ({ useHeaderHeight: () => 100 }))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useRoute: () => ({ params: mockParams }),
}))
jest.mock('../useRoomRows', () => ({
  ...jest.requireActual('../useRoomRows'),
  canHideRoom: () => mockCanHide,
  hideRoom: (roomId: string) => {
    mockHideRoom(roomId)
    return mockUndo
  },
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Room = require('../screens/Room').default
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RoomInfo = require('../screens/RoomInfo').default
// The mock's one navigation object, the same one the screen gets.
const navigation = jest.requireMock('@react-navigation/native').useNavigation() as { navigate: jest.Mock }

const PLANNING = 'did:webvh:sample:planning'
const id = (key: string) => testIdWithKey(key)

const show = async (Screen: React.FC, ready: string) => {
  mockParams = { roomId: PLANNING }
  const tree = render(
    <BasicAppContext>
      <Screen />
    </BasicAppContext>
  )
  await waitFor(() => tree.getByTestId(id(ready)))
  return tree
}

beforeEach(() => {
  mockService = createSampleRoomsService()
  mockCanHide = true
  mockHideRoom.mockClear()
  navigation.navigate.mockClear()
})

describe('the chat', () => {
  test('is the chat alone: its header opens the details (control: no tabs any more)', async () => {
    const tree = await show(Room, 'RoomComposerInput')
    expect(tree.queryByTestId(id('RoomTabChat'))).toBeNull()
    expect(tree.queryByTestId(id('RoomTabFiles'))).toBeNull()
    const header = tree.getByTestId(id('RoomDetailsOpen'))
    expect(header.props.accessibilityRole).toBe('button')
    expect(header.props.accessibilityHint).toBe('Rooms.DetailsHint')
    fireEvent.press(header)
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.RoomInfo, { roomId: PLANNING })
  })
})

describe("a room's details", () => {
  test('show the room, and each part opens its own screen', async () => {
    const tree = await show(RoomInfo, 'RoomTitle')
    // The details' own header opens nothing more.
    expect(tree.queryByTestId(id('RoomDetailsOpen'))).toBeNull()
    for (const [key, part] of [
      ['RoomInfoFiles', 'files'],
      ['RoomInfoNotes', 'notes'],
      ['RoomInfoMembers', 'members'],
    ]) {
      fireEvent.press(tree.getByTestId(id(key)))
      expect(navigation.navigate).toHaveBeenLastCalledWith(Screens.RoomPart, { roomId: PLANNING, part })
    }
  })

  test('ask the agent for no list: no notes, files or members (control: the chat reads its posts)', async () => {
    const service = mockService as RoomsService
    const listNotes = jest.spyOn(service, 'listNotes')
    const listFiles = jest.spyOn(service, 'listFiles')
    const listMembers = jest.spyOn(service, 'listCommunityMembers')
    const info = await show(RoomInfo, 'RoomTitle')
    await act(async () => undefined)
    expect(listNotes).not.toHaveBeenCalled()
    expect(listFiles).not.toHaveBeenCalled()
    expect(listMembers).not.toHaveBeenCalled()
    info.unmount()

    await show(Room, 'RoomComposerInput')
    await waitFor(() => expect(listNotes).toHaveBeenCalled())
  })

  test('who the member posts as opens their own sheet', async () => {
    const tree = await show(RoomInfo, 'RoomTitle')
    expect(tree.getByTestId(id('RoomInfoYou'))).toHaveTextContent(/Rooms\.PostingAs/)
    expect(tree.queryByTestId(id('RoomIdentitySheet'))).toBeNull()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('RoomInfoYou')))
    })
    expect(tree.getByTestId(id('RoomIdentitySheet'))).toBeTruthy()
  })

  test("the community's screen opens in My Agent, where leaving is done", async () => {
    const tree = await show(RoomInfo, 'RoomTitle')
    fireEvent.press(tree.getByTestId(id('RoomInfoCommunity')))
    expect(navigation.navigate).toHaveBeenCalledWith(Stacks.TabStack, {
      screen: TabStacks.MyAgentStack,
      params: { screen: Screens.VtiCommunity, params: { communityDid: 'did:webvh:sample:test-vtc' }, initial: false },
    })
    expect(tree.getByText('Rooms.MembersLeaveHint')).toBeTruthy()
  })

  test('Hide from Messages hides the room, with Undo', async () => {
    const show_ = jest.spyOn(Toast, 'show')
    const tree = await show(RoomInfo, 'RoomTitle')
    fireEvent.press(tree.getByTestId(id('RoomInfoHide')))
    expect(mockHideRoom).toHaveBeenCalledWith(PLANNING)
    expect(show_).toHaveBeenCalledWith(expect.objectContaining({ type: 'undo', props: { onUndo: mockUndo } }))
  })

  test('no Hide where Messages has no row for the room (control: Hide above)', async () => {
    mockCanHide = false
    const tree = await show(RoomInfo, 'RoomTitle')
    expect(tree.queryByTestId(id('RoomInfoHide'))).toBeNull()
  })
})
