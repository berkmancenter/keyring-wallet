/**
 * Deleting one chat from the Messages list (L4) deletes that chat only. Two chats on the phone, each with messages, a
 * reaction and an unsent draft; the row for one is deleted through the real deleteChatMessages (the path Clear chat
 * takes): when the Undo window ends that chat is empty and its draft gone, and the other chat is untouched. During the
 * window nothing of either has gone.
 */
import { useAgent } from '@bifold/react-hooks'
import { DidCommBasicMessageRepository } from '@credo-ts/didcomm'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import ContactListItem from '../../src/components/listItems/ContactListItem'
import { UNDO_WINDOW_MS, resetPendingChatDeletes } from '../../src/modules/chat/pendingChatDeletes'
import { ChatEventRepository } from '../../src/modules/chat/records/ChatEventRepository'
import { testIdWithKey } from '../../src/utils/testable'
import { BasicAppContext } from '../helpers/app'

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn(), hide: jest.fn() } }))
jest.mock('react-native-fs', () => ({
  LibraryDirectoryPath: '/lib',
  DocumentDirectoryPath: '/files',
  exists: jest.fn(async () => false),
  readDir: jest.fn(async () => []),
  unlink: jest.fn(async () => undefined),
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

type Rec = { id: string; connectionId: string }

/** A phone's chat store for two chats: basic messages, chat events, and each chat's unsent draft. */
function twoChats() {
  const basic: Rec[] = [
    { id: 'a-1', connectionId: 'conn-a' },
    { id: 'a-2', connectionId: 'conn-a' },
    { id: 'b-1', connectionId: 'conn-b' },
    { id: 'b-2', connectionId: 'conn-b' },
  ]
  const events: (Rec & { eventId: string; eventType: string; role: string })[] = [
    { id: 'ev-a', connectionId: 'conn-a', eventId: 'e-a', eventType: 'reaction', role: 'received' },
    { id: 'ev-b', connectionId: 'conn-b', eventId: 'e-b', eventType: 'reaction', role: 'received' },
  ]
  const drafts = new Map(
    ['conn-a', 'conn-b'].map((c) => [`chat-draft:${c}`, { id: `chat-draft:${c}`, content: { text: 'unsent' } }])
  )
  const drop = <T extends { id: string }>(list: T[], id: string) => {
    const i = list.findIndex((r) => r.id === id)
    if (i >= 0) list.splice(i, 1)
  }
  const singletons = new Map<unknown, unknown>([
    [
      ChatEventRepository,
      {
        findByConnection: async (_ctx: unknown, connectionId: string) =>
          events.filter((e) => e.connectionId === connectionId),
        delete: async (_ctx: unknown, record: Rec) => drop(events, record.id),
      },
    ],
    [
      DidCommBasicMessageRepository,
      {
        findByQuery: async (_ctx: unknown, q: { connectionId: string }) =>
          basic.filter((b) => b.connectionId === q.connectionId),
        delete: async (_ctx: unknown, record: Rec) => drop(basic, record.id),
      },
    ],
  ])
  const container = { isRegistered: (t: unknown) => singletons.has(t), resolve: (t: unknown) => singletons.get(t) }
  const agent = {
    context: {},
    config: { logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } },
    dependencyManager: { container, resolve: container.resolve },
    genericRecords: {
      findById: async (id: string) => drafts.get(id) ?? null,
      delete: async (record: { id: string }) => void drafts.delete(record.id),
    },
  }
  const of = (connectionId: string) => ({
    messages: basic.filter((b) => b.connectionId === connectionId).map((b) => b.id),
    events: events.filter((e) => e.connectionId === connectionId).map((e) => e.id),
    draft: drafts.has(`chat-draft:${connectionId}`),
  })
  return { agent, of }
}

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  })
}

let restoreAgent: (() => void) | undefined
beforeEach(() => {
  jest.useFakeTimers()
  resetPendingChatDeletes()
})
afterEach(() => {
  restoreAgent?.()
  resetPendingChatDeletes()
  jest.useRealTimers()
})

test('deleting one chat from the list leaves the other chat, its messages and its draft untouched', async () => {
  const phone = twoChats()
  const useAgentMock = useAgent as jest.Mock
  const before = useAgentMock.getMockImplementation()
  useAgentMock.mockImplementation(() => ({ agent: phone.agent }))
  restoreAgent = () => useAgentMock.mockImplementation(before)

  const tree = render(
    <BasicAppContext>
      <ContactListItem
        contact={{ id: 'conn-a', theirLabel: 'Ana Ribeiro' } as never}
        navigation={{ navigate: jest.fn(), getParent: () => ({ navigate: jest.fn() }) } as never}
      />
    </BasicAppContext>
  )
  fireEvent(tree.getByTestId(testIdWithKey('Contact')), 'longPress')
  fireEvent.press(tree.getByTestId(testIdWithKey('DeleteChatConfirm')))

  // The Undo window: nothing of either chat has gone, the swiped chat's draft included.
  act(() => jest.advanceTimersByTime(UNDO_WINDOW_MS - 1))
  await flush()
  expect(phone.of('conn-a')).toEqual({ messages: ['a-1', 'a-2'], events: ['ev-a'], draft: true })

  act(() => jest.advanceTimersByTime(1))
  await flush()
  expect(phone.of('conn-a')).toEqual({ messages: [], events: [], draft: false })
  expect(phone.of('conn-b')).toEqual({ messages: ['b-1', 'b-2'], events: ['ev-b'], draft: true })
})
