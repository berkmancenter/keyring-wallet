/**
 * Sending a file to a room (R6b): "+" picks one file, refused at once over the limit; it shows above the field until
 * sent or removed; Send writes it with or without words; while it uploads the post shows how far it has come, and
 * Cancel stops it with nothing written. The picked file's copy is the file in the clear, so it goes on every way out.
 */
const mockUnlink = jest.fn(async (_path: string) => undefined)
const mockMoveFile = jest.fn(async (_from: string, _to: string, _options?: unknown) => undefined)
jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    CachesDirectoryPath: '/caches',
    unlink: (path: string) => mockUnlink(path),
    mkdir: async () => undefined,
    writeFile: async () => undefined,
    moveFile: (from: string, to: string, options?: unknown) => mockMoveFile(from, to, options),
    copyFile: async () => undefined,
  },
}))

import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { DeviceEventEmitter } from 'react-native'
import { pick } from 'react-native-document-picker'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { WALLET_LOCKED_EVENT } from '../../../utils/walletLocked'
import { MAX_FILE_BYTES, pickRoomFile } from '../pickRoomFile'
import { chatMessageText } from '../roomPosts'
import { createSampleRoomsService } from '../sample/sampleRooms'
import type { RoomsService, WriteDraft } from '../types'

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
const picked = (over: Partial<Record<string, unknown>> = {}) => ({
  uri: 'content://picked/minutes.pdf',
  fileCopyUri: 'file:///caches/minutes.pdf',
  name: 'Minutes.pdf',
  type: 'application/pdf',
  size: 120_000,
  ...over,
})
const pickMock = pick as jest.Mock
const COPY = /^\/caches\/keyring-room-files\/[0-9a-f]{32}\/file$/
const copyDir = /^\/caches\/keyring-room-files\/[0-9a-f]{32}$/
const removedCopies = () => mockUnlink.mock.calls.filter(([path]) => copyDir.test(path))

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

const attach = async (tree: ReturnType<typeof show>) => {
  await waitFor(() => tree.getByTestId(id('RoomComposerAttach')))
  await press(tree, 'RoomComposerAttach')
}

beforeEach(() => {
  mockService = createSampleRoomsService()
  pickMock.mockReset()
  pickMock.mockResolvedValue([picked()])
  mockUnlink.mockClear()
  mockMoveFile.mockClear()
})

describe('pickRoomFile', () => {
  test('one file, its copy moved under the rule at once, and its name only in memory', async () => {
    await expect(pickRoomFile()).resolves.toEqual({
      ok: true,
      file: { uri: expect.stringMatching(COPY), name: 'Minutes.pdf', mimeType: 'application/pdf', size: 120_000 },
    })
    expect(mockMoveFile.mock.calls[0][0]).toBe('/caches/minutes.pdf')
  })

  test('up to the limit exactly; one byte over is refused, and its copy goes with the refusal', async () => {
    pickMock.mockResolvedValueOnce([picked({ size: MAX_FILE_BYTES })])
    await expect(pickRoomFile()).resolves.toMatchObject({ ok: true })
    expect(removedCopies()).toHaveLength(0)
    pickMock.mockResolvedValueOnce([picked({ size: MAX_FILE_BYTES + 1 })])
    await expect(pickRoomFile()).resolves.toEqual({ ok: false, reason: 'tooLarge' })
    expect(removedCopies()).toHaveLength(1)
  })

  test('a copy that cannot be taken in is unreadable, and is not left in the caches', async () => {
    mockMoveFile.mockRejectedValueOnce(new Error('disk full'))
    await expect(pickRoomFile()).resolves.toEqual({ ok: false, reason: 'unreadable' })
    expect(mockUnlink).toHaveBeenCalledWith('/caches/minutes.pdf')
  })

  test('closing the picker is nothing; a copy that failed is unreadable', async () => {
    pickMock.mockRejectedValueOnce(Object.assign(new Error('cancelled'), { code: 'DOCUMENT_PICKER_CANCELED' }))
    await expect(pickRoomFile()).resolves.toBeUndefined()
    pickMock.mockResolvedValueOnce([picked({ fileCopyUri: null, copyError: 'no space' })])
    await expect(pickRoomFile()).resolves.toEqual({ ok: false, reason: 'unreadable' })
  })
})

describe('sending a file', () => {
  test('a file alone: Send writes it, and the room has it, ready to open', async () => {
    const service = mockService as RoomsService
    const prepareWrite = jest.spyOn(service, 'prepareWrite')
    const tree = show()
    await attach(tree)
    expect(tree.getByTestId(id('RoomComposerFile'))).toHaveTextContent(/Minutes\.pdf/)
    expect(tree.getByTestId(id('RoomComposerSend'))).not.toBeDisabled()

    await press(tree, 'RoomComposerSend')
    const [, draft] = prepareWrite.mock.calls[0] as [string, WriteDraft]
    expect(draft.attachment).toEqual({
      uri: expect.stringMatching(COPY),
      name: 'Minutes.pdf',
      mimeType: 'application/pdf',
      size: 120_000,
    })
    expect(draft.body).toBe('')
    expect(tree.queryByTestId(id('RoomComposerFile'))).toBeNull()

    // Written: the room's list carries the post with its file, which now opens the sheet. The sample keys a write
    // by its version, one past the room's 8.
    const chip = await waitFor(() => tree.getByTestId(id('RoomFileChip_fn9')))
    expect(chip).toHaveTextContent(/Minutes\.pdf/)
    expect(tree.queryByTestId(id('RoomPostSending'))).toBeNull()
    fireEvent.press(chip)
    expect(tree.getByTestId(id('RoomFileSheet'))).toBeTruthy()
    expect(removedCopies()).toHaveLength(1)
  })

  test('words and a file: the words are a chat message, sent with the file', async () => {
    const prepareWrite = jest.spyOn(mockService as RoomsService, 'prepareWrite')
    const tree = show()
    await attach(tree)
    fireEvent.changeText(tree.getByTestId(id('RoomComposerInput')), 'Minutes attached')
    await press(tree, 'RoomComposerSend')
    const [, draft] = prepareWrite.mock.calls[0] as [string, WriteDraft]
    expect(chatMessageText(draft.body)).toBe('Minutes attached')
    expect(draft.attachment?.name).toBe('Minutes.pdf')
    await waitFor(() => expect(tree.getByText('Minutes attached')).toBeTruthy())
  })

  test('while it uploads: how far it has come; Cancel stops it and nothing is written', async () => {
    const service = mockService as RoomsService
    const listBefore = (await service.listNotes(PLANNING)).notes.length
    let signal: AbortSignal | undefined
    jest.spyOn(service, 'confirmWrite').mockImplementation(
      (_token, options) =>
        new Promise((_resolve, reject) => {
          signal = options?.signal
          options?.onProgress?.({ sent: 30_000, total: 120_000 })
          options?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
          )
        })
    )
    const tree = show()
    await attach(tree)
    await press(tree, 'RoomComposerSend')
    await waitFor(() => expect(tree.getByTestId(id('RoomPostSending'))).toHaveTextContent('Rooms.PostSendingPercent'))
    expect(tree.getByText('Minutes.pdf')).toBeTruthy()

    expect(signal?.aborted).toBe(false)
    await press(tree, 'RoomPostCancel')
    // The upload itself is stopped, not only taken off the screen.
    expect(signal?.aborted).toBe(true)
    expect(tree.queryByTestId(id('RoomPostSending'))).toBeNull()
    expect(tree.queryByText('Minutes.pdf')).toBeNull()
    expect(tree.queryByTestId(id('RoomPostNotSent'))).toBeNull()
    expect((await service.listNotes(PLANNING)).notes).toHaveLength(listBefore)
    await waitFor(() => expect(removedCopies()).toHaveLength(1))
  })

  test('locked while it uploads: the upload stops, the post says it was not sent, and every copy goes', async () => {
    const service = mockService as RoomsService
    let signal: AbortSignal | undefined
    jest.spyOn(service, 'confirmWrite').mockImplementation(
      (_token, options) =>
        new Promise((_resolve, reject) => {
          signal = options?.signal
          options?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
          )
        })
    )
    const tree = show()
    await attach(tree)
    await press(tree, 'RoomComposerSend')
    await waitFor(() => expect(tree.getByTestId(id('RoomPostSending'))).toBeTruthy())

    await act(async () => {
      DeviceEventEmitter.emit(WALLET_LOCKED_EVENT, 'test')
    })
    expect(signal?.aborted).toBe(true)
    await waitFor(() => expect(tree.getByTestId(id('RoomPostNotSent'))).toHaveTextContent('Rooms.PostFileNotSent'))
    expect(mockUnlink).toHaveBeenCalledWith('/caches/keyring-room-files')
  })

  test('locked with a file waiting in the composer: its chip goes, and the copy with the lock', async () => {
    const tree = show()
    await attach(tree)
    expect(tree.getByTestId(id('RoomComposerFile'))).toBeTruthy()
    await act(async () => {
      DeviceEventEmitter.emit(WALLET_LOCKED_EVENT, 'test')
    })
    expect(tree.queryByTestId(id('RoomComposerFile'))).toBeNull()
    expect(mockUnlink).toHaveBeenCalledWith('/caches/keyring-room-files')
  })

  test('leaving with a file waiting in the composer removes its copy', async () => {
    const tree = show()
    await attach(tree)
    tree.unmount()
    await waitFor(() => expect(removedCopies()).toHaveLength(1))
  })

  test('a post that fails: its copy goes, so it is not sent again; a tap clears it to add the file again', async () => {
    const service = mockService as RoomsService
    const prepareWrite = jest.spyOn(service, 'prepareWrite')
    jest.spyOn(service, 'confirmWrite').mockRejectedValueOnce(new Error('connection lost'))
    const tree = show()
    await attach(tree)
    await press(tree, 'RoomComposerSend')
    await waitFor(() => expect(tree.getByTestId(id('RoomPostNotSent'))).toHaveTextContent('Rooms.PostFileNotSent'))
    await waitFor(() => expect(removedCopies()).toHaveLength(1))

    await press(tree, 'RoomPostRetry')
    await waitFor(() => expect(tree.queryByTestId(id('RoomPostNotSent'))).toBeNull())
    expect(prepareWrite).toHaveBeenCalledTimes(1)
    expect((await service.listNotes(PLANNING)).notes.some((n) => n.files?.length && n.version > 8)).toBe(false)
  })

  test('a file over the limit is refused at once, and nothing is attached', async () => {
    pickMock.mockResolvedValueOnce([picked({ size: MAX_FILE_BYTES + 1 })])
    const tree = show()
    await attach(tree)
    expect(tree.getByTestId(id('RoomComposerFileRefused'))).toHaveTextContent('Rooms.FileTooLarge')
    expect(tree.queryByTestId(id('RoomComposerFile'))).toBeNull()
    expect(tree.getByTestId(id('RoomComposerSend'))).toBeDisabled()
  })

  test('a room whose host takes less says so at once; a file within it attaches (control)', async () => {
    Object.assign(mockService as RoomsService, { fileLimit: async () => 2_000_000 })
    pickMock.mockResolvedValueOnce([picked({ size: 2_000_001 })])
    const tree = show()
    await waitFor(() => tree.getByTestId(id('RoomComposerAttach')))
    await act(async () => undefined)
    await press(tree, 'RoomComposerAttach')
    expect(tree.getByTestId(id('RoomComposerFileRefused'))).toHaveTextContent('Rooms.FileTooLargeHere')
    expect(tree.queryByTestId(id('RoomComposerFile'))).toBeNull()
    expect(removedCopies()).toHaveLength(1)

    pickMock.mockResolvedValueOnce([picked({ size: 2_000_000 })])
    await press(tree, 'RoomComposerAttach')
    expect(tree.queryByTestId(id('RoomComposerFileRefused'))).toBeNull()
    expect(tree.getByTestId(id('RoomComposerFile'))).toBeTruthy()
  })

  test('a file taken off before sending is not sent', async () => {
    const prepareWrite = jest.spyOn(mockService as RoomsService, 'prepareWrite')
    const tree = show()
    await attach(tree)
    await press(tree, 'RoomComposerFileRemove')
    expect(tree.queryByTestId(id('RoomComposerFile'))).toBeNull()
    expect(tree.getByTestId(id('RoomComposerSend'))).toBeDisabled()
    await press(tree, 'RoomComposerSend')
    expect(prepareWrite).not.toHaveBeenCalled()
    expect(removedCopies()).toHaveLength(1)
  })
})
