/**
 * Sending a file to a room (R6b): "+" picks one file, refused at once over 25 MB; it shows above the field until
 * sent or removed; Send writes it with or without words; while it uploads the post shows how far it has come, and
 * Cancel stops it with nothing written.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { pick } from 'react-native-document-picker'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
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
})

describe('pickRoomFile', () => {
  test('one file, from its cached copy', async () => {
    await expect(pickRoomFile()).resolves.toEqual({
      ok: true,
      file: { uri: 'file:///caches/minutes.pdf', name: 'Minutes.pdf', mimeType: 'application/pdf', size: 120_000 },
    })
  })

  test('up to 25 MB exactly; one byte over is refused', async () => {
    pickMock.mockResolvedValueOnce([picked({ size: MAX_FILE_BYTES })])
    await expect(pickRoomFile()).resolves.toMatchObject({ ok: true })
    pickMock.mockResolvedValueOnce([picked({ size: MAX_FILE_BYTES + 1 })])
    await expect(pickRoomFile()).resolves.toEqual({ ok: false, reason: 'tooLarge' })
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
      uri: 'file:///caches/minutes.pdf',
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
  })

  test('a post whose answer was lost: the retry carries the same key, and the room has it once', async () => {
    const service = mockService as RoomsService
    const prepareWrite = jest.spyOn(service, 'prepareWrite')
    const real = service.confirmWrite.bind(service)
    // The first write lands, but its answer never reaches the phone.
    jest.spyOn(service, 'confirmWrite').mockImplementationOnce(async (token, options) => {
      await real(token, options)
      throw new Error('connection lost')
    })
    const tree = show()
    await attach(tree)
    fireEvent.changeText(tree.getByTestId(id('RoomComposerInput')), 'Minutes, again')
    await press(tree, 'RoomComposerSend')
    await waitFor(() => expect(tree.getByTestId(id('RoomPostNotSent'))).toBeTruthy())
    await press(tree, 'RoomPostRetry')
    await waitFor(() => expect(tree.queryByTestId(id('RoomPostNotSent'))).toBeNull())

    const keys = prepareWrite.mock.calls.map(([, draft]) => (draft as WriteDraft).idempotencyKey)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
    await waitFor(() => expect(tree.getAllByText('Minutes, again')).toHaveLength(1))
    const notes = (await service.listNotes(PLANNING)).notes
    expect(notes.filter((n) => n.files?.some((f) => String(f.name) === 'Minutes.pdf'))).toHaveLength(1)
  })

  test('a file over 25 MB is refused at once, and nothing is attached', async () => {
    pickMock.mockResolvedValueOnce([picked({ size: MAX_FILE_BYTES + 1 })])
    const tree = show()
    await attach(tree)
    expect(tree.getByTestId(id('RoomComposerFileRefused'))).toHaveTextContent('Rooms.FileTooLarge')
    expect(tree.queryByTestId(id('RoomComposerFile'))).toBeNull()
    expect(tree.getByTestId(id('RoomComposerSend'))).toBeDisabled()
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
  })
})
