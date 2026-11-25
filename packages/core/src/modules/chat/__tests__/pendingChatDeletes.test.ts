/**
 * Deleting a chat from the Messages list with Undo (L4): the row goes at once; the chat is deleted when the window
 * ends, even with nobody looking at the list; Undo before then deletes nothing; a chat is deleted once; a failure
 * brings the row back and says so.
 */
import {
  SETTLE_MS,
  UNDO_WINDOW_MS,
  cancelChatDelete,
  pendingChatDeletes,
  resetPendingChatDeletes,
  scheduleChatDelete,
} from '../pendingChatDeletes'

const hidden = () => [...pendingChatDeletes.get()].sort()
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

beforeEach(() => {
  jest.useFakeTimers()
  resetPendingChatDeletes()
})
afterEach(() => {
  resetPendingChatDeletes()
  jest.useRealTimers()
})

test('the row goes at once; the chat is deleted only when the Undo window ends, each connection in turn', async () => {
  const deleteChat = jest.fn(async () => undefined)
  expect(scheduleChatDelete({ key: 'bob', connectionIds: ['b1', 'b2'], deleteChat })).toBe(true)
  expect(hidden()).toEqual(['b1', 'b2'])
  jest.advanceTimersByTime(UNDO_WINDOW_MS - 1)
  expect(deleteChat).not.toHaveBeenCalled()

  jest.advanceTimersByTime(1)
  await flush()
  expect(deleteChat.mock.calls).toEqual([['b1'], ['b2']])
  // Still out of the list while the message stores catch up, then left to the conversations rule.
  expect(hidden()).toEqual(['b1', 'b2'])
  jest.advanceTimersByTime(SETTLE_MS)
  expect(hidden()).toEqual([])
})

test('Undo before the window ends: nothing is deleted, and the row comes back', async () => {
  const deleteChat = jest.fn(async () => undefined)
  scheduleChatDelete({ key: 'ada', connectionIds: ['a1'], deleteChat })
  jest.advanceTimersByTime(UNDO_WINDOW_MS - 100)
  expect(cancelChatDelete('ada')).toBe(true)
  expect(hidden()).toEqual([])
  jest.advanceTimersByTime(UNDO_WINDOW_MS)
  await flush()
  expect(deleteChat).not.toHaveBeenCalled()
})

test('a chat is deleted once: a second request while one waits does nothing', async () => {
  const deleteChat = jest.fn(async () => undefined)
  expect(scheduleChatDelete({ key: 'ada', connectionIds: ['a1'], deleteChat })).toBe(true)
  expect(scheduleChatDelete({ key: 'ada', connectionIds: ['a1'], deleteChat })).toBe(false)
  jest.advanceTimersByTime(UNDO_WINDOW_MS)
  await flush()
  expect(deleteChat).toHaveBeenCalledTimes(1)
})

test('once the delete has started, Undo cannot stop it', async () => {
  let finish: () => void = () => undefined
  const deleteChat = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)))
  scheduleChatDelete({ key: 'ada', connectionIds: ['a1'], deleteChat })
  jest.advanceTimersByTime(UNDO_WINDOW_MS)
  await flush()
  expect(deleteChat).toHaveBeenCalledTimes(1)
  expect(cancelChatDelete('ada')).toBe(false)
  expect(hidden()).toEqual(['a1'])
  finish()
  await flush()
  // Still deleted once, never again.
  jest.advanceTimersByTime(UNDO_WINDOW_MS + SETTLE_MS)
  await flush()
  expect(deleteChat).toHaveBeenCalledTimes(1)
})

test('a failed delete: the row comes back, and the failure is said', async () => {
  const onFailed = jest.fn()
  const deleteChat = jest.fn(async () => {
    throw new Error('storage busy')
  })
  scheduleChatDelete({ key: 'ada', connectionIds: ['a1'], deleteChat, onFailed })
  jest.advanceTimersByTime(UNDO_WINDOW_MS)
  await flush()
  expect(hidden()).toEqual([])
  expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ message: 'storage busy' }))
})

test('with nobody looking at the list (no subscriber), the delete still runs when the window ends', async () => {
  const deleteChat = jest.fn(async () => undefined)
  const listener = jest.fn()
  const unsubscribe = pendingChatDeletes.subscribe(listener)
  scheduleChatDelete({ key: 'ada', connectionIds: ['a1'], deleteChat })
  unsubscribe() // the list unmounts: the person has left it
  jest.advanceTimersByTime(UNDO_WINDOW_MS)
  await flush()
  expect(deleteChat).toHaveBeenCalledWith('a1')
  expect(listener).toHaveBeenCalledTimes(1) // only the schedule, while it was still listening
})
