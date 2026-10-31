/**
 * Posting to a room (R5): Send writes a keyring.chat/1 message through the service's two steps and the post shows
 * at once as sending, then as the member's own; one that fails stays, marked, and a tap sends the same event again;
 * a preview gone stale between the steps is prepared once more. Where the member may not post, the composer gives
 * the reason instead of a field.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { FlatList } from 'react-native'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { chatMessageText } from '../roomPosts'
import { createSampleRoomsService } from '../sample/sampleRooms'
import { RoomsPreviewExpired, type RoomsService, type WriteDraft } from '../types'

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
const WELCOME_DESK = 'did:webvh:sample:welcome-desk'
const CUSTODY = 'did:webvh:sample:3f9a7c21e0'
const KERNEL_NOTES = 'did:webvh:sample:kernel-notes'
const id = (key: string) => testIdWithKey(key)

const show = (roomId: string) => {
  mockParams = { roomId }
  return render(
    <BasicAppContext>
      <Room />
    </BasicAppContext>
  )
}

const type = async (tree: ReturnType<typeof show>, text: string) => {
  const input = await waitFor(() => tree.getByTestId(id('RoomComposerInput')))
  fireEvent.changeText(input, text)
}

const send = async (tree: ReturnType<typeof show>) => {
  await act(async () => {
    fireEvent.press(tree.getByTestId(id('RoomComposerSend')))
  })
}

beforeEach(() => {
  mockService = createSampleRoomsService()
})

// The post being written is kept per room (useRoomDraft), in the agent's generic records, as a chat's draft is.
describe('a kept draft', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const records = require('@bifold/react-hooks').useAgent().agent.genericRecords
  const draftId = `room-draft:${PLANNING}`
  beforeEach(() => {
    jest.clearAllMocks()
    records.findById.mockImplementation(async (recordId: string) =>
      recordId === draftId ? { id: draftId, content: { text: 'Half a post' } } : null
    )
  })
  afterEach(() => records.findById.mockImplementation(async () => null))

  test('comes back in the field as the room opens, is saved as it changes, and is cleared at once by a send', async () => {
    const tree = show(PLANNING)
    await waitFor(() => expect(tree.getByTestId(id('RoomComposerInput')).props.value).toBe('Half a post'))

    await type(tree, 'Half a post, finished')
    await waitFor(() =>
      expect(records.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: draftId, content: { text: 'Half a post, finished' } })
      )
    )

    await send(tree)
    await waitFor(() => expect(records.delete).toHaveBeenCalledWith(expect.objectContaining({ id: draftId })))
    expect(tree.getByTestId(id('RoomComposerInput')).props.value).toBe('')
  })

  // Navigating to a room already in the stack updates the screen's params rather than mounting it afresh.
  test("a screen reused for another room drops the last room's words", async () => {
    const tree = show(PLANNING)
    await waitFor(() => expect(tree.getByTestId(id('RoomComposerInput')).props.value).toBe('Half a post'))
    await type(tree, 'Half a post, finished')

    mockParams = { roomId: KERNEL_NOTES }
    tree.rerender(
      <BasicAppContext>
        <Room />
      </BasicAppContext>
    )
    await waitFor(() => expect(records.findById).toHaveBeenCalledWith(`room-draft:${KERNEL_NOTES}`))
    await waitFor(() => tree.getByTestId(id('RoomComposerInput')))
    await act(async () => undefined)
    expect(tree.getByTestId(id('RoomComposerInput')).props.value).toBe('')
  })

  test("another room's draft is not this room's", async () => {
    records.findById.mockImplementation(async (recordId: string) =>
      recordId === `room-draft:${WELCOME_DESK}` ? { id: recordId, content: { text: 'Welcome desk words' } } : null
    )
    const tree = show(PLANNING)
    await waitFor(() => expect(records.findById).toHaveBeenCalledWith(draftId))
    await act(async () => undefined)
    expect(tree.getByTestId(id('RoomComposerInput')).props.value).toBe('')
  })
})

describe('posting to a room', () => {
  test('Send goes to the newest post, at the bottom, as the person-to-person chat does; nothing to send, no move', async () => {
    const scroll = jest.spyOn(FlatList.prototype, 'scrollToOffset')
    try {
      const tree = show(PLANNING)
      await waitFor(() => expect(tree.getAllByTestId(/RoomPost_/).length).toBeGreaterThan(0))
      await type(tree, '   ')
      await send(tree)
      expect(scroll).not.toHaveBeenCalled()
      await type(tree, 'On my way.')
      await send(tree)
      expect(scroll).toHaveBeenCalledTimes(1)
      expect(scroll).toHaveBeenCalledWith({ offset: 0, animated: true })
      await waitFor(() => expect(tree.getByText('On my way.')).toBeTruthy())
    } finally {
      scroll.mockRestore()
    }
  })

  test("Send writes the text as a chat message, and the post becomes the member's own", async () => {
    const service = mockService as RoomsService
    const prepareWrite = jest.spyOn(service, 'prepareWrite')
    const confirmWrite = jest.spyOn(service, 'confirmWrite')
    const tree = show(PLANNING)
    await type(tree, '  See you Thursday.  ')
    await send(tree)

    expect(prepareWrite).toHaveBeenCalledTimes(1)
    const [roomId, draft] = prepareWrite.mock.calls[0] as [string, WriteDraft]
    expect(roomId).toBe(PLANNING)
    expect(chatMessageText(draft.body)).toBe('See you Thursday.')
    expect(confirmWrite).toHaveBeenCalledTimes(1)
    expect(tree.getByTestId(id('RoomComposerInput')).props.value).toBe('')
    // Who the member posts as is said at the composer. No profile name in this store: the line says so.
    expect(tree.getByTestId(id('RoomComposerPostingAs'))).toHaveTextContent('Rooms.PostingAsAddName')

    // The room's list carries it, as the member's own, and nothing is left sending.
    await waitFor(() => expect(tree.getByText('See you Thursday.')).toBeTruthy())
    expect(tree.queryByTestId(id('RoomPostSending'))).toBeNull()
    expect(tree.queryByTestId(id('RoomPostNotSent'))).toBeNull()
    expect(tree.getAllByText('See you Thursday.')).toHaveLength(1)
  })

  test('shows the post as sending until it is written', async () => {
    const service = mockService as RoomsService
    let release: () => void = () => undefined
    const real = service.confirmWrite.bind(service)
    jest
      .spyOn(service, 'confirmWrite')
      .mockImplementation((token) => new Promise((resolve) => (release = () => resolve(real(token)))))
    const tree = show(PLANNING)
    await type(tree, 'On its way')
    await send(tree)
    expect(tree.getByTestId(id('RoomPostSending'))).toBeTruthy()
    expect(tree.getByText('On its way')).toBeTruthy()
    await act(async () => release())
    await waitFor(() => expect(tree.queryByTestId(id('RoomPostSending'))).toBeNull())
  })

  test('a post that fails stays, marked; a tap sends the same event again', async () => {
    const service = mockService as RoomsService
    const prepareWrite = jest.spyOn(service, 'prepareWrite')
    jest.spyOn(service, 'confirmWrite').mockRejectedValueOnce(new Error('agent unreachable'))
    const tree = show(PLANNING)
    await type(tree, 'Second try')
    await send(tree)
    await waitFor(() => expect(tree.getByTestId(id('RoomPostNotSent'))).toBeTruthy())
    expect(tree.getByText('Second try')).toBeTruthy()

    await act(async () => {
      fireEvent.press(tree.getByTestId(id('RoomPostRetry')))
    })
    await waitFor(() => expect(tree.queryByTestId(id('RoomPostNotSent'))).toBeNull())
    expect(prepareWrite).toHaveBeenCalledTimes(2)
    const bodies = prepareWrite.mock.calls.map(([, draft]) => (draft as WriteDraft).body)
    expect(bodies[1]).toBe(bodies[0])
    await waitFor(() => expect(tree.getAllByText('Second try')).toHaveLength(1))
  })

  test('a preview gone stale between the two steps is prepared once more', async () => {
    const service = mockService as RoomsService
    const prepareWrite = jest.spyOn(service, 'prepareWrite')
    jest.spyOn(service, 'confirmWrite').mockRejectedValueOnce(new RoomsPreviewExpired('w1'))
    const tree = show(PLANNING)
    await type(tree, 'After a pause')
    await send(tree)
    await waitFor(() => expect(tree.getByText('After a pause')).toBeTruthy())
    expect(prepareWrite).toHaveBeenCalledTimes(2)
    expect(tree.queryByTestId(id('RoomPostNotSent'))).toBeNull()
  })

  test('nothing to send: Send stays off and nothing is written', async () => {
    const prepareWrite = jest.spyOn(mockService as RoomsService, 'prepareWrite')
    const tree = show(PLANNING)
    await type(tree, '   ')
    expect(tree.getByTestId(id('RoomComposerSend'))).toBeDisabled()
    await send(tree)
    expect(prepareWrite).not.toHaveBeenCalled()
  })

  test('posting not built yet: the "on its way" strip in the composer\'s place, and no field', async () => {
    const service = mockService as RoomsService
    const real = service.roomCapabilities.bind(service)
    jest.spyOn(service, 'roomCapabilities').mockImplementation(async (roomId) => ({
      ...(await real(roomId)),
      write: { status: 'comingSoon', reason: 'clientNotBuilt', detail: 'not built' },
    }))
    const tree = show(PLANNING)
    await waitFor(() => expect(tree.getByTestId(id('RoomFeatureCard_write'))).toBeTruthy())
    expect(tree.queryByTestId(id('RoomComposerInput'))).toBeNull()
    expect(tree.queryByTestId(id('RoomComposerUnavailable'))).toBeNull()
  })

  test('a room the member can only read: the reason, and no field', async () => {
    const tree = show(WELCOME_DESK)
    await waitFor(() => expect(tree.getByTestId(id('RoomComposerUnavailable'))).toHaveTextContent('Rooms.NoRightWrite'))
    expect(tree.queryByTestId(id('RoomComposerInput'))).toBeNull()
    expect(tree.queryByTestId(id('RoomComposerPostingAs'))).toBeNull()
    // A missing right is not on its way: no card.
    expect(tree.queryByTestId(id('RoomFeatureCard_write'))).toBeNull()
  })

  test("a room known only from the agent's keys: details not loaded, and no field", async () => {
    const tree = show(CUSTODY)
    await waitFor(() => expect(tree.getByTestId(id('RoomScreen'))).toBeTruthy())
    await waitFor(() => expect(tree.queryByTestId(id('RoomReading'))).toBeNull())
    expect(tree.queryByTestId(id('RoomComposerInput'))).toBeNull()
  })

  // Narrows one status of the sample's, as the real service reports it for this build.
  const withStatus = (op: 'write' | 'openFile', reason: 'tierNotYet' | 'clientNotBuilt') => {
    const sample = createSampleRoomsService()
    mockService = {
      ...sample,
      roomCapabilities: async (roomId: string) => ({
        ...(await sample.roomCapabilities(roomId)),
        [op]: { status: 'comingSoon', reason, detail: '' },
      }),
    } as RoomsService
  }

  test('a room whose tier this build does not write to: posting is on its way, so the strip, and no field', async () => {
    withStatus('write', 'tierNotYet')
    const tree = show(PLANNING)
    await waitFor(() => expect(tree.getByTestId(id('RoomFeatureCard_write'))).toBeTruthy())
    expect(tree.queryByTestId(id('RoomComposerUnavailable'))).toBeNull()
    expect(tree.queryByTestId(id('RoomComposerInput'))).toBeNull()
  })

  // Posting a file seals it with the cipher that opens one: a room whose files are only listed offers no "+".
  test('no "+" where the room\'s files can\'t be opened; the sample room, where they can, has it', async () => {
    const sample = show(PLANNING)
    await waitFor(() => expect(sample.getByTestId(id('RoomComposerAttach'))).toBeTruthy())
    sample.unmount()

    withStatus('openFile', 'clientNotBuilt')
    const tree = show(PLANNING)
    await waitFor(() => expect(tree.getByTestId(id('RoomComposerInput'))).toBeTruthy())
    expect(tree.queryByTestId(id('RoomComposerAttach'))).toBeNull()
  })
})
