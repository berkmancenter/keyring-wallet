/**
 * A room's library (data rooms mock, Files), a screen of its own since R2 (RoomPart, from the room's details): every
 * file in the room, newest first, with its type, size and who shared it, read again each time it is opened; a row
 * opens the attachment sheet; "Add a file" goes back to the chat, whose composer opens the picker. Where files can't
 * be listed, opened or posted, the screen says so or offers nothing that would fail. The chat lists no files itself.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { pick } from 'react-native-document-picker'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { deriveRoomCapabilities, sampleCapabilities } from '../capabilities'
import { newestFirst } from '../components/RoomFilesTab'
import { toInertText } from '../inertText'
import { createSampleRoomsService } from '../sample/sampleRooms'
import type { OperationStatus, RoomFile, RoomsService } from '../types'

let mockService: RoomsService | undefined
let mockParams: Record<string, string | number> | undefined
jest.mock('../useRoomsService', () => ({ useRoomsService: () => mockService }))
jest.mock('@react-navigation/elements', () => ({ useHeaderHeight: () => 100 }))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useRoute: () => ({ params: mockParams }),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Room = require('../screens/Room').default
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RoomPart = require('../screens/RoomPart').default
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useNavigation } = require('@react-navigation/native')

const PLANNING = 'did:webvh:sample:planning'
const id = (key: string) => testIdWithKey(key)
const pickMock = pick as jest.Mock
const NOT_BUILT: OperationStatus = { status: 'comingSoon', reason: 'clientNotBuilt', detail: 'not built' }

const show = () => {
  mockParams = { roomId: PLANNING, part: 'files' }
  return render(
    <BasicAppContext>
      <RoomPart />
    </BasicAppContext>
  )
}

const showChat = (params: Record<string, string | number> = { roomId: PLANNING }) => {
  mockParams = params
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

const openFiles = async () => {
  const tree = show()
  await waitFor(() => tree.getByTestId(id('RoomFiles')))
  return tree
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
  useNavigation().navigate.mockClear()
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

describe("a room's files", () => {
  test('the library, with type, size and who shared it; a row opens the attachment sheet', async () => {
    const tree = await openFiles()
    const row = await waitFor(() => tree.getByTestId(id('RoomFileRow_f1')))
    expect(row).toHaveTextContent(/Agenda, Oct 30\.pdf/)
    expect(row).toHaveTextContent(/PDF · /)
    expect(row).toHaveTextContent(/Rooms\.FileSharedBy/)
    expect(tree.getByTestId(id('RoomFilesCaution'))).toBeTruthy()

    fireEvent.press(row)
    expect(tree.getByTestId(id('RoomFileSheet'))).toBeTruthy()
  })

  test('the library is listed newest first, and read again each time it is opened', async () => {
    const listFiles = jest
      .spyOn(mockService as RoomsService, 'listFiles')
      .mockResolvedValue([file('older', '2026-10-01T10:00:00Z'), file('newer', '2026-10-24T10:00:00Z')])
    const tree = await openFiles()
    await waitFor(() => tree.getByTestId(id('RoomFileRow_newer')))
    const rows = tree.getAllByTestId(/RoomFileRow_/).map((r) => r.props.testID)
    expect(rows).toEqual([id('RoomFileRow_newer'), id('RoomFileRow_older')])

    const shown = listFiles.mock.calls.length
    tree.unmount()
    await openFiles()
    await waitFor(() => expect(listFiles).toHaveBeenCalledTimes(shown + 1))
  })

  test('the files list no notes, and the chat lists no files (control: each lists its own)', async () => {
    const listFiles = jest.spyOn(mockService as RoomsService, 'listFiles')
    const listNotes = jest.spyOn(mockService as RoomsService, 'listNotes')
    const files = await openFiles()
    await waitFor(() => files.getByTestId(id('RoomFileRow_f1')))
    expect(listNotes).not.toHaveBeenCalled()
    expect(listFiles).toHaveBeenCalledTimes(1)
    files.unmount()

    const chat = showChat()
    await waitFor(() =>
      expect(chat.getByText('Draft agenda is in Files. Can everyone look before Thursday?')).toBeTruthy()
    )
    expect(listNotes).toHaveBeenCalled()
    expect(listFiles).toHaveBeenCalledTimes(1)
  })

  test('"Add a file" goes back to the chat with a new number, for its composer to open the picker', async () => {
    const tree = await openFiles()
    await waitFor(() => tree.getByTestId(id('RoomFilesAdd')))
    await press(tree, 'RoomFilesAdd')
    expect(useNavigation().navigate).toHaveBeenCalledWith(Screens.Room, {
      roomId: PLANNING,
      attach: expect.any(Number),
    })
    expect(pickMock).not.toHaveBeenCalled()
  })

  test('the chat opens the picker once for each new number, and the file is attached there (control: none, no picker)', async () => {
    const tree = showChat()
    await waitFor(() => tree.getByTestId(id('RoomComposerInput')))
    expect(pickMock).not.toHaveBeenCalled()

    mockParams = { roomId: PLANNING, attach: 1 }
    tree.rerender(
      <BasicAppContext>
        <Room />
      </BasicAppContext>
    )
    await waitFor(() => expect(tree.getByTestId(id('RoomComposerFile'))).toHaveTextContent(/Minutes\.pdf/))
    expect(pickMock).toHaveBeenCalledTimes(1)

    // The same number again (the chat drawn again for another reason) opens nothing.
    tree.rerender(
      <BasicAppContext>
        <Room />
      </BasicAppContext>
    )
    await act(async () => undefined)
    expect(pickMock).toHaveBeenCalledTimes(1)
  })

  test('pull to refresh reads the library again', async () => {
    const listFiles = jest.spyOn(mockService as RoomsService, 'listFiles')
    const tree = await openFiles()
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
    const tree = await openFiles()
    await waitFor(() => expect(tree.getByTestId(id('RoomFilesFailed'))).toBeTruthy())
    expect(tree.queryByTestId(id('RoomFilesNone'))).toBeNull()
  })

  test('files not built yet: the "on its way" card, and none listed (control: the library above)', async () => {
    const listFiles = jest.spyOn(mockService as RoomsService, 'listFiles')
    withStatuses({ listFiles: NOT_BUILT })
    const tree = await openFiles()
    const card = await waitFor(() => tree.getByTestId(id('RoomFeatureCard_files')))
    expect(card.props.accessibilityLabel).toBe('Rooms.SoonFilesTitle. Rooms.SoonFilesLine. Rooms.ComingSoon')
    expect(tree.queryByTestId(id('RoomFilesUnavailable'))).toBeNull()
    expect(tree.queryByTestId(id('RoomFileRow_f1'))).toBeNull()
    expect(listFiles).not.toHaveBeenCalled()
  })

  test('files the agent is too old for: the plain reason, no card, since nothing is on its way', async () => {
    withStatuses({ listFiles: { status: 'unavailable', reason: 'agentDoesNotServe', detail: 'old agent' } })
    const tree = await openFiles()
    await waitFor(() =>
      expect(tree.getByTestId(id('RoomFilesUnavailable'))).toHaveTextContent('Rooms.AgentNeedsUpdate')
    )
    expect(tree.queryByTestId(id('RoomFeatureCard_files'))).toBeNull()
  })

  test('where files cannot be opened, a row names the file but opens nothing', async () => {
    withStatuses({ openFile: NOT_BUILT })
    const tree = await openFiles()
    const row = await waitFor(() => tree.getByTestId(id('RoomFileRow_f1')))
    expect(row.props.accessibilityRole).toBeUndefined()
    fireEvent.press(row)
    expect(tree.queryByTestId(id('RoomFileSheet'))).toBeNull()
  })

  test('where the member cannot post, there is no "Add a file" (control: "Add a file" above)', async () => {
    withStatuses({ write: NOT_BUILT })
    const tree = await openFiles()
    await waitFor(() => tree.getByTestId(id('RoomFileRow_f1')))
    expect(tree.queryByTestId(id('RoomFilesAdd'))).toBeNull()
  })

  test('files not built yet, in a room the member can post to: no "Add a file" (control: "Add a file" above)', async () => {
    withStatuses({ listFiles: NOT_BUILT })
    const tree = await openFiles()
    await waitFor(() => tree.getByTestId(id('RoomFeatureCard_files')))
    expect(tree.queryByTestId(id('RoomFilesAdd'))).toBeNull()
  })
})
