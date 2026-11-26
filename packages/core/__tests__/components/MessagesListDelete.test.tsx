/**
 * Deleting a chat from the Messages list (L4), from the row: a long press or a screen reader's Delete asks first, as
 * drawn; confirming shows Undo and deletes nothing yet; when the window ends, every connection of the contact is
 * deleted with deleteChatMessages and no ids (the whole chat, its draft included, #612); Undo deletes nothing; a
 * failure says so.
 */
import { useAgent } from '@bifold/react-hooks'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import Toast from 'react-native-toast-message'

import ContactListItem from '../../src/components/listItems/ContactListItem'
import { deleteChatMessages } from '../../src/modules/chat/history'
import {
  SETTLE_MS,
  UNDO_WINDOW_MS,
  pendingChatDeletes,
  resetPendingChatDeletes,
} from '../../src/modules/chat/pendingChatDeletes'
import { testIdWithKey } from '../../src/utils/testable'
import { BasicAppContext } from '../helpers/app'

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn(), hide: jest.fn() } }))
jest.mock('../../src/modules/chat/history', () => ({
  ...jest.requireActual('../../src/modules/chat/history'),
  deleteChatMessages: jest.fn(async () => undefined),
}))
jest.mock('../../src/hooks/chat-messages', () => ({
  ...jest.requireActual('../../src/hooks/chat-messages'),
  useChatMessagesByConnection: () => [
    {
      _id: 'm',
      text: 'hi',
      createdAt: new Date(),
      user: { _id: jest.requireActual('../../src/types/chat').Role.them },
      renderEvent: () => null,
    },
    {
      _id: 'c',
      text: '',
      createdAt: new Date(),
      user: { _id: jest.requireActual('../../src/types/chat').Role.them },
      renderEvent: () => null,
    },
  ],
}))
jest.mock('../../src/modules/chat/chatEventsStore', () => ({
  ...jest.requireActual('../../src/modules/chat/chatEventsStore'),
  useChatEvents: () => [],
  useAllChatEvents: () => [],
}))
jest.mock('../../src/hooks/connections', () => ({
  ...jest.requireActual('../../src/hooks/connections'),
  useConnectionDisplayName: () => 'Ana Ribeiro',
}))

const show = Toast.show as jest.Mock
const remove = deleteChatMessages as jest.Mock
const id = testIdWithKey

const row = (connectionIds?: string[]) =>
  render(
    <BasicAppContext>
      <ContactListItem
        contact={{ id: 'conn-1', theirLabel: 'Ana Ribeiro' } as never}
        connectionIds={connectionIds}
        navigation={{ navigate: jest.fn(), getParent: () => ({ navigate: jest.fn() }) } as never}
      />
    </BasicAppContext>
  )
const undoOf = () => show.mock.calls.find(([params]) => params.type === 'undo')?.[0].props.onUndo as () => void
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.clearAllMocks()
  resetPendingChatDeletes()
  remove.mockImplementation(async () => undefined)
})
afterEach(() => {
  resetPendingChatDeletes()
  jest.useRealTimers()
})

test('a long press asks first, as drawn; Cancel deletes nothing', () => {
  const tree = row()
  fireEvent(tree.getByTestId(id('Contact')), 'longPress')
  expect(tree.getByTestId(id('DeleteChatSheet'))).toBeTruthy()
  expect(tree.getByText('MessagesList.DeleteTitle')).toBeTruthy()
  expect(tree.getByText('MessagesList.DeleteTheyKeep')).toBeTruthy()
  expect(tree.getByText('MessagesList.DeleteContactStays')).toBeTruthy()
  fireEvent.press(tree.getByTestId(id('DeleteChatCancel')))
  expect(tree.queryByTestId(id('DeleteChatSheet'))).toBeNull()
  expect(pendingChatDeletes.get().size).toBe(0)
  expect(show).not.toHaveBeenCalled()
})

test('a screen reader’s Delete action asks the same question', () => {
  const tree = row()
  const item = tree.getByTestId(id('Contact'))
  expect(item.props.accessibilityActions).toEqual([{ name: 'delete', label: 'MessagesList.Delete' }])
  fireEvent(item, 'accessibilityAction', { nativeEvent: { actionName: 'delete' } })
  expect(tree.getByTestId(id('DeleteChatSheet'))).toBeTruthy()
})

test('confirmed: the row goes and Undo shows; the chat is deleted, whole, only when the window ends', async () => {
  const tree = row()
  fireEvent(tree.getByTestId(id('Contact')), 'longPress')
  fireEvent.press(tree.getByTestId(id('DeleteChatConfirm')))
  expect([...pendingChatDeletes.get()]).toEqual(['conn-1'])
  expect(show).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'undo', text1: 'MessagesList.Deleted', visibilityTime: UNDO_WINDOW_MS })
  )
  // During the window nothing is deleted: the chat and its draft are still there to Undo back to.
  act(() => jest.advanceTimersByTime(UNDO_WINDOW_MS - 1))
  expect(remove).not.toHaveBeenCalled()

  act(() => jest.advanceTimersByTime(1))
  await flush()
  const { agent } = (useAgent as jest.Mock)()
  expect(remove).toHaveBeenCalledTimes(1)
  // No ids: the whole chat, which clears its draft too (#612).
  expect(remove.mock.calls[0]).toEqual([agent, 'conn-1'])
})

test('a merged contact: every one of its connections is deleted', async () => {
  const tree = row(['conn-1', 'conn-2'])
  fireEvent(tree.getByTestId(id('Contact')), 'longPress')
  fireEvent.press(tree.getByTestId(id('DeleteChatConfirm')))
  act(() => jest.advanceTimersByTime(UNDO_WINDOW_MS))
  await flush()
  expect(remove.mock.calls.map((call) => call[1])).toEqual(['conn-1', 'conn-2'])
})

test('the list left during the window: the chat is still deleted when the window ends', async () => {
  const tree = row()
  fireEvent(tree.getByTestId(id('Contact')), 'longPress')
  fireEvent.press(tree.getByTestId(id('DeleteChatConfirm')))
  tree.unmount()
  act(() => jest.advanceTimersByTime(UNDO_WINDOW_MS))
  await flush()
  expect(remove).toHaveBeenCalledTimes(1)
})

test('Undo: nothing is deleted, and the row comes back', async () => {
  const tree = row()
  fireEvent(tree.getByTestId(id('Contact')), 'longPress')
  fireEvent.press(tree.getByTestId(id('DeleteChatConfirm')))
  act(() => undoOf()())
  expect(pendingChatDeletes.get().size).toBe(0)
  act(() => jest.advanceTimersByTime(UNDO_WINDOW_MS + SETTLE_MS))
  await flush()
  expect(remove).not.toHaveBeenCalled()
})

test('a failed delete: the row comes back, and Clear chat’s failure is said', async () => {
  remove.mockImplementation(async () => {
    throw new Error('storage busy')
  })
  const tree = row()
  fireEvent(tree.getByTestId(id('Contact')), 'longPress')
  fireEvent.press(tree.getByTestId(id('DeleteChatConfirm')))
  act(() => jest.advanceTimersByTime(UNDO_WINDOW_MS))
  await flush()
  expect(pendingChatDeletes.get().size).toBe(0)
  expect(show).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', text1: 'Chat.ClearChatFailed' }))
})

test('asked twice for the same chat (two quick confirms): one delete, one Undo', async () => {
  const tree = row()
  fireEvent(tree.getByTestId(id('Contact')), 'longPress')
  fireEvent.press(tree.getByTestId(id('DeleteChatConfirm')))
  fireEvent(tree.getByTestId(id('Contact')), 'longPress')
  fireEvent.press(tree.getByTestId(id('DeleteChatConfirm')))
  expect(show.mock.calls.filter(([params]) => params.type === 'undo')).toHaveLength(1)
  act(() => jest.advanceTimersByTime(UNDO_WINDOW_MS))
  await flush()
  expect(remove).toHaveBeenCalledTimes(1)
})
