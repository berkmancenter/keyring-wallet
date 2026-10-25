/**
 * The chat list's preview is the newest thing said, never a line about the chat itself (rich-messaging-plan.md §5:
 * a timer set is a system line, and the timeline puts it first when it is the newest).
 */
import { render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../helpers/app'
import ContactListItem from '../../src/components/listItems/ContactListItem'

const at = (minute: number) => new Date(Date.UTC(2026, 9, 25, 12, minute))
const mockTimeline = [
  { _id: 'timer', text: '', kind: 'system', createdAt: at(3), user: { _id: 'me' }, renderEvent: () => null },
  { _id: 'said', text: 'see you tomorrow', createdAt: at(2), user: { _id: 'them' }, renderEvent: () => null },
  { _id: 'connected', text: '', createdAt: at(1), user: { _id: 'them' }, renderEvent: () => null },
]
jest.mock('../../src/hooks/chat-messages', () => ({
  ...jest.requireActual('../../src/hooks/chat-messages'),
  useChatMessagesByConnection: () => mockTimeline,
}))
jest.mock('../../src/hooks/useUnreadMessages', () => ({
  useUnreadMessages: () => ({ unreadByConnection: {}, totalUnread: 0 }),
}))

test('a timer set after the last message: the preview is still the last message', () => {
  const tree = render(
    <BasicAppContext>
      <ContactListItem
        contact={{ id: 'conn-1', theirLabel: 'Ada' } as never}
        navigation={{ navigate: jest.fn() } as never}
      />
    </BasicAppContext>
  )
  expect(tree.getByText('see you tomorrow')).toBeTruthy()
})
