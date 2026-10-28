/**
 * A post's files (R6a): a chip under the post; a tap opens the attachment sheet with the type and size the sharer
 * gave; Download shows progress and can be cancelled (nothing kept); a finished copy is shared through the system
 * sheet and released when the sheet closes; a failed download says so and can be tried again. Where files can't be
 * opened, the chip still names the file, but is not a button.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import * as Sharing from 'expo-sharing'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { deriveRoomCapabilities, sampleCapabilities } from '../capabilities'
import { createSampleRoomsService } from '../sample/sampleRooms'
import type { RoomsService } from '../types'

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

const show = () => {
  mockParams = { roomId: PLANNING }
  return render(
    <BasicAppContext>
      <Room />
    </BasicAppContext>
  )
}

const openSheet = async (tree: ReturnType<typeof show>) => {
  const chip = await waitFor(() => tree.getByTestId(id('RoomFileChip_f1')))
  fireEvent.press(chip)
  return tree.getByTestId(id('RoomFileSheet'))
}

const press = async (tree: ReturnType<typeof show>, key: string) => {
  await act(async () => {
    fireEvent.press(tree.getByTestId(id(key)))
  })
}

const shareAsync = Sharing.shareAsync as jest.Mock
const isAvailableAsync = Sharing.isAvailableAsync as jest.Mock

beforeEach(() => {
  mockService = createSampleRoomsService()
  shareAsync.mockClear()
  isAvailableAsync.mockResolvedValue(true)
})

describe("a post's files", () => {
  test('a chip under the post; the sheet gives the type and size as shared, before any download', async () => {
    const openFile = jest.spyOn(mockService as RoomsService, 'openFile')
    const tree = show()
    const chip = await waitFor(() => tree.getByTestId(id('RoomFileChip_f1')))
    expect(chip).toHaveTextContent(/Agenda, Oct 30\.pdf/)
    expect(chip).toHaveTextContent(/PDF · Rooms\.SizeKB/)
    await openSheet(tree)
    expect(tree.getByTestId(id('RoomFileName'))).toHaveTextContent('Agenda, Oct 30.pdf')
    expect(tree.getByTestId(id('RoomFileFacts'))).toHaveTextContent(/Rooms\.FileTypeAsShared/)
    expect(tree.getByText('Rooms.FileCaution')).toBeTruthy()
    expect(openFile).not.toHaveBeenCalled()
  })

  test('Download shows progress, then Share hands the copy to the system; closing releases it', async () => {
    const service = mockService as RoomsService
    const releaseFile = jest.spyOn(service, 'releaseFile')
    let release: () => void = () => undefined
    const real = service.openFile.bind(service)
    jest.spyOn(service, 'openFile').mockImplementation(async (roomId, fileId, options) => {
      options?.onProgress?.({ sent: 42_000, total: 84_000 })
      await new Promise<void>((resolve) => (release = resolve))
      return real(roomId, fileId, options)
    })
    const tree = show()
    await openSheet(tree)
    await press(tree, 'RoomFileDownload')
    expect(tree.getByTestId(id('RoomFileProgress')).props.accessibilityValue).toMatchObject({ now: 50 })
    await act(async () => release())
    const shareButton = await waitFor(() => tree.getByTestId(id('RoomFileShare')))
    await act(async () => {
      fireEvent.press(shareButton)
    })
    expect(shareAsync).toHaveBeenCalledWith('sample://f1', expect.objectContaining({ mimeType: 'application/pdf' }))
    expect(releaseFile).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.press(tree.getByLabelText('Global.Close'))
    })
    expect(releaseFile).toHaveBeenCalledWith('sample://f1')
  })

  test('Cancel stops the download and keeps nothing; Download can start again', async () => {
    const service = mockService as RoomsService
    const releaseFile = jest.spyOn(service, 'releaseFile')
    jest
      .spyOn(service, 'openFile')
      .mockImplementation(
        (_roomId, _fileId, options) =>
          new Promise((_resolve, reject) =>
            options?.signal?.addEventListener('abort', () =>
              reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
            )
          )
      )
    const tree = show()
    await openSheet(tree)
    await press(tree, 'RoomFileDownload')
    expect(tree.getByTestId(id('RoomFileProgress'))).toBeTruthy()
    await press(tree, 'RoomFileCancel')
    expect(tree.queryByTestId(id('RoomFileProgress'))).toBeNull()
    expect(tree.queryByTestId(id('RoomFileFailed'))).toBeNull()
    expect(tree.getByTestId(id('RoomFileDownload'))).toBeTruthy()
    expect(releaseFile).not.toHaveBeenCalled()
  })

  test('a download that fails says so, and Try again downloads it', async () => {
    const service = mockService as RoomsService
    const openFile = jest.spyOn(service, 'openFile').mockRejectedValueOnce(new Error('host unreachable'))
    const tree = show()
    await openSheet(tree)
    await press(tree, 'RoomFileDownload')
    await waitFor(() => expect(tree.getByTestId(id('RoomFileFailed'))).toBeTruthy())
    await press(tree, 'RoomFileDownload')
    await waitFor(() => expect(tree.getByTestId(id('RoomFileShare'))).toBeTruthy())
    expect(openFile).toHaveBeenCalledTimes(2)
  })

  test("a device that can't share files says so, and offers no Share (control: Share above)", async () => {
    isAvailableAsync.mockResolvedValue(false)
    const tree = show()
    await openSheet(tree)
    await press(tree, 'RoomFileDownload')
    await waitFor(() => expect(tree.getByTestId(id('RoomFileShareUnavailable'))).toBeTruthy())
    expect(tree.queryByTestId(id('RoomFileShare'))).toBeNull()
  })

  test('where files cannot be opened, the chip names the file but is not a button (control: the tests above)', async () => {
    const service = mockService as RoomsService
    jest.spyOn(service, 'roomCapabilities').mockImplementation(async () => ({
      ...deriveRoomCapabilities(sampleCapabilities(), { source: 'community', verbs: ['read', 'write'] }),
      openFile: { status: 'comingSoon', reason: 'clientNotBuilt', detail: 'not built' },
    }))
    const tree = show()
    await waitFor(() =>
      expect(tree.getByText('Draft agenda is in Files. Can everyone look before Thursday?')).toBeTruthy()
    )
    const chip = tree.getByTestId(id('RoomFileChip_f1'))
    expect(chip).toHaveTextContent(/Agenda, Oct 30\.pdf/)
    expect(chip.props.accessibilityRole).toBeUndefined()
    fireEvent.press(chip)
    expect(tree.queryByTestId(id('RoomFileSheet'))).toBeNull()
  })
})
