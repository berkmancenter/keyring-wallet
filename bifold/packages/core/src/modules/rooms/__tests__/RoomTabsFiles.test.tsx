/**
 * A room's tabs and its library (data rooms mock, Files): Chat first; Files lists every file in the room, newest
 * first, with its type, size and who shared it, read again each time it is shown; a row opens the attachment sheet;
 * "Add a file" goes to the chat with the picker open. Switching tabs keeps the chat's draft. Where files can't be
 * listed, opened or posted, the tab says so or offers nothing that would fail.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { pick } from 'react-native-document-picker'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { deriveRoomCapabilities, sampleCapabilities } from '../capabilities'
import { newestFirst } from '../components/RoomFilesTab'
import { toInertText } from '../inertText'
import { createSampleRoomsService } from '../sample/sampleRooms'
import type { OperationStatus, RoomFile, RoomsService } from '../types'

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

const PLANNING = 'did:webvh:sample:planning'
const id = (key: string) => testIdWithKey(key)
const pickMock = pick as jest.Mock
const NOT_BUILT: OperationStatus = { status: 'comingSoon', reason: 'clientNotBuilt', detail: 'not built' }

const show = () => {
  mockParams = { roomId: PLANNING }
  return render(
    <BasicAppContext>
      <Room />
    </BasicAppContext>
  )
}

const press = async (tree: ReturnType<typeof show>, key: string) => {
  await act(async () => {
    fireEvent.press(tree.getByTestId(id(key)))
  })
}

const openFiles = async (tree: ReturnType<typeof show>) => {
  await waitFor(() => tree.getByTestId(id('RoomTabFiles')))
  await press(tree, 'RoomTabFiles')
}

const withStatuses = (over: Partial<Record<string, OperationStatus>>) =>
  jest.spyOn(mockService as RoomsService, 'roomCapabilities').mockImplementation(async () => ({
    ...deriveRoomCapabilities(sampleCapabilities(), { source: 'community', verbs: ['read', 'write'] }),
    ...over,
  }))

const file = (fileId: string, sharedAt?: string): RoomFile => ({ fileId, name: toInertText(fileId), sharedAt })

beforeEach(() => {
  mockService = createSampleRoomsService()
  pickMock.mockReset()
  pickMock.mockResolvedValue([
    {
      uri: 'content://picked/minutes.pdf',
      fileCopyUri: 'file:///caches/minutes.pdf',
      name: 'Minutes.pdf',
      type: 'application/pdf',
      size: 120_000,
    },
  ])
})

describe('newestFirst', () => {
  test('newest first; files with no time last, in the order given', () => {
    const files = [
      file('a', '2026-10-20T10:00:00Z'),
      file('b'),
      file('c', '2026-10-22T10:00:00Z'),
      file('d'),
      file('e', 'not a date'),
    ]
    expect(newestFirst(files).map((f) => f.fileId)).toEqual(['c', 'a', 'b', 'd', 'e'])
  })
})

describe("a room's tabs", () => {
  test('Chat is shown first; Files shows the library, with type, size and who shared it', async () => {
    const tree = show()
    await waitFor(() =>
      expect(tree.getByText('Draft agenda is in Files. Can everyone look before Thursday?')).toBeTruthy()
    )
    expect(tree.getByTestId(id('RoomTabChat')).props.accessibilityState).toEqual({ selected: true })
    expect(tree.queryByTestId(id('RoomFiles'))).toBeNull()

    await openFiles(tree)
    expect(tree.getByTestId(id('RoomTabFiles')).props.accessibilityState).toEqual({ selected: true })
    const row = await waitFor(() => tree.getByTestId(id('RoomFileRow_f1')))
    expect(row).toHaveTextContent(/Agenda, Oct 30\.pdf/)
    expect(row).toHaveTextContent(/PDF · /)
    expect(row).toHaveTextContent(/Rooms\.FileSharedBy/)
    expect(tree.getByTestId(id('RoomFilesCaution'))).toBeTruthy()

    fireEvent.press(row)
    expect(tree.getByTestId(id('RoomFileSheet'))).toBeTruthy()
  })

  test('the library is listed newest first, and read again each time it is shown', async () => {
    const listFiles = jest
      .spyOn(mockService as RoomsService, 'listFiles')
      .mockResolvedValue([file('older', '2026-10-01T10:00:00Z'), file('newer', '2026-10-24T10:00:00Z')])
    const tree = show()
    await openFiles(tree)
    await waitFor(() => tree.getByTestId(id('RoomFileRow_newer')))
    const rows = tree.getAllByTestId(/RoomFileRow_/).map((r) => r.props.testID)
    expect(rows).toEqual([id('RoomFileRow_newer'), id('RoomFileRow_older')])

    const shown = listFiles.mock.calls.length
    await press(tree, 'RoomTabChat')
    await openFiles(tree)
    await waitFor(() => expect(listFiles).toHaveBeenCalledTimes(shown + 1))
  })

  test("the chat's draft is kept across a switch to Files and back", async () => {
    const tree = show()
    await waitFor(() => tree.getByTestId(id('RoomComposerInput')))
    fireEvent.changeText(tree.getByTestId(id('RoomComposerInput')), 'half a thought')
    await openFiles(tree)
    await press(tree, 'RoomTabChat')
    expect(tree.getByTestId(id('RoomComposerInput')).props.value).toBe('half a thought')
  })

  test('"Add a file" goes to the chat with the picker open, and the file is attached there', async () => {
    const tree = show()
    await openFiles(tree)
    await waitFor(() => tree.getByTestId(id('RoomFilesAdd')))
    expect(pickMock).not.toHaveBeenCalled()
    await press(tree, 'RoomFilesAdd')
    await waitFor(() => expect(tree.getByTestId(id('RoomComposerFile'))).toHaveTextContent(/Minutes\.pdf/))
    expect(pickMock).toHaveBeenCalledTimes(1)
    expect(tree.getByTestId(id('RoomTabChat')).props.accessibilityState).toEqual({ selected: true })
    expect(tree.queryByTestId(id('RoomFiles'))).toBeNull()
  })

  test('pull to refresh reads the library again', async () => {
    const listFiles = jest.spyOn(mockService as RoomsService, 'listFiles')
    const tree = show()
    await openFiles(tree)
    await waitFor(() => tree.getByTestId(id('RoomFileRow_f1')))
    const before = listFiles.mock.calls.length
    await act(async () => {
      tree.getByTestId(id('RoomFiles')).props.refreshControl.props.onRefresh()
    })
    await waitFor(() => expect(listFiles).toHaveBeenCalledTimes(before + 1))
    await waitFor(() => expect(tree.getByTestId(id('RoomFiles')).props.refreshControl.props.refreshing).toBe(false))
  })

  test("a library the host wouldn't give says so", async () => {
    jest.spyOn(mockService as RoomsService, 'listFiles').mockRejectedValue(new Error('host unreachable'))
    const tree = show()
    await openFiles(tree)
    await waitFor(() => expect(tree.getByTestId(id('RoomFilesFailed'))).toBeTruthy())
    expect(tree.queryByTestId(id('RoomFilesNone'))).toBeNull()
  })

  test('files not built yet: the "on its way" card, and none listed (control: the library above)', async () => {
    const listFiles = jest.spyOn(mockService as RoomsService, 'listFiles')
    withStatuses({ listFiles: NOT_BUILT })
    const tree = show()
    await openFiles(tree)
    const card = await waitFor(() => tree.getByTestId(id('RoomFeatureCard_files')))
    expect(card.props.accessibilityLabel).toBe('Rooms.SoonFilesTitle. Rooms.SoonFilesLine. Rooms.ComingSoon')
    expect(tree.queryByTestId(id('RoomFilesUnavailable'))).toBeNull()
    expect(tree.queryByTestId(id('RoomFileRow_f1'))).toBeNull()
    expect(listFiles).not.toHaveBeenCalled()
  })

  test('files the agent is too old for: the plain reason, no card, since nothing is on its way', async () => {
    withStatuses({ listFiles: { status: 'unavailable', reason: 'agentDoesNotServe', detail: 'old agent' } })
    const tree = show()
    await openFiles(tree)
    await waitFor(() =>
      expect(tree.getByTestId(id('RoomFilesUnavailable'))).toHaveTextContent('Rooms.AgentNeedsUpdate')
    )
    expect(tree.queryByTestId(id('RoomFeatureCard_files'))).toBeNull()
  })

  test('where files cannot be opened, a row names the file but opens nothing', async () => {
    withStatuses({ openFile: NOT_BUILT })
    const tree = show()
    await openFiles(tree)
    const row = await waitFor(() => tree.getByTestId(id('RoomFileRow_f1')))
    expect(row.props.accessibilityRole).toBeUndefined()
    fireEvent.press(row)
    expect(tree.queryByTestId(id('RoomFileSheet'))).toBeNull()
  })

  test('where the member cannot post, there is no "Add a file" (control: "Add a file" above)', async () => {
    withStatuses({ write: NOT_BUILT })
    const tree = show()
    await openFiles(tree)
    await waitFor(() => tree.getByTestId(id('RoomFileRow_f1')))
    expect(tree.queryByTestId(id('RoomFilesAdd'))).toBeNull()
  })

  test('files not built yet, in a room the member can post to: no "Add a file" (control: "Add a file" above)', async () => {
    withStatuses({ listFiles: NOT_BUILT })
    const tree = show()
    await openFiles(tree)
    await waitFor(() => tree.getByTestId(id('RoomFeatureCard_files')))
    expect(tree.queryByTestId(id('RoomFilesAdd'))).toBeNull()
    expect(tree.getByTestId(id('RoomTabFiles')).props.accessibilityState).toEqual({ selected: true })
  })
})
