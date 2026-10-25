/**
 * The chat list's preview is the newest thing said, never a line about the chat itself (rich-messaging-plan.md §5:
 * a timer set is a system line, and the timeline puts it first when it is the newest). In a chat with disappearing
 * messages on, or of a message that will disappear, it shows that there is a message, never its text.
 */
import { render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../helpers/app'
import ContactListItem from '../../src/components/listItems/ContactListItem'
import { ChatEventRecord } from '../../src/modules/chat/records/ChatEventRecord'

const at = (minute: number) => new Date(Date.UTC(2026, 9, 25, 12, minute))
let mockTimeline: object[] = []
const baseTimeline = [
  { _id: 'timer', text: '', kind: 'system', createdAt: at(3), user: { _id: 'me' }, renderEvent: () => null },
  { _id: 'said', text: 'see you tomorrow', createdAt: at(2), user: { _id: 'them' }, renderEvent: () => null },
  { _id: 'connected', text: '', createdAt: at(1), user: { _id: 'them' }, renderEvent: () => null },
]
jest.mock('../../src/hooks/chat-messages', () => ({
  ...jest.requireActual('../../src/hooks/chat-messages'),
  useChatMessagesByConnection: () => mockTimeline,
}))
let mockChatEvents: ChatEventRecord[] | undefined
jest.mock('../../src/modules/chat/chatEventsStore', () => ({ useChatEvents: () => mockChatEvents }))
jest.mock('../../src/hooks/useUnreadMessages', () => ({
  useUnreadMessages: () => ({ unreadByConnection: {}, totalUnread: 0 }),
}))

const timerOf = (expiresIn: number) =>
  new ChatEventRecord({
    connectionId: 'conn-1',
    eventId: '01JB3XKX6F8Q2W4E5R6T7Y8Z9A',
    eventType: 'timer',
    role: 'received',
    sentTime: at(3),
    timer: { expiresIn, version: 1 },
  })
const row = () =>
  render(
    <BasicAppContext>
      <ContactListItem
        contact={{ id: 'conn-1', theirLabel: 'Ada' } as never}
        navigation={{ navigate: jest.fn() } as never}
      />
    </BasicAppContext>
  )

beforeEach(() => {
  mockTimeline = baseTimeline
  mockChatEvents = []
})

// A positive control for the ones below: with nothing disappearing, the text shows.
test('a timer set after the last message: the preview is still the last message', () => {
  expect(row().getByText('see you tomorrow')).toBeTruthy()
})

test('with disappearing messages on, the preview says there is a message, not what it says', () => {
  mockChatEvents = [timerOf(3600)]
  const tree = row()
  expect(tree.getByText('Chat.PreviewHidden')).toBeTruthy()
  expect(tree.queryByText('see you tomorrow')).toBeNull()
})

test('turned off again: the text shows again', () => {
  mockChatEvents = [timerOf(0)]
  expect(row().getByText('see you tomorrow')).toBeTruthy()
})

test('a message that will disappear is never previewed, even once the timer is off', () => {
  mockTimeline = [{ ...baseTimeline[1], expiresIn: 3600 }, baseTimeline[2]]
  mockChatEvents = [timerOf(0)]
  const tree = row()
  expect(tree.getByText('Chat.PreviewHidden')).toBeTruthy()
  expect(tree.queryByText('see you tomorrow')).toBeNull()
})
