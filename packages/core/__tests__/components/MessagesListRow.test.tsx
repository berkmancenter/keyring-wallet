/**
 * A Messages row as drawn (the Messages list redesign, L2), read through the real locale files: their initials on a
 * muted tone, "You: …", a photo as "📷 Photo", a reaction as "Lena reacted 💜 to “Congrats!”", a timer by the name in
 * a disappearing chat, and, while unread, a count (99+ past 99) said to a screen reader too.
 */
import { act, render } from '@testing-library/react-native'
import React from 'react'

import ContactListItem from '../../src/components/listItems/ContactListItem'
import { ChatEventRecord } from '../../src/modules/chat/records/ChatEventRecord'
import { Role } from '../../src/types/chat'
import { testIdWithKey } from '../../src/utils/testable'
import { speak } from '../helpers/appLanguage'
import { BasicAppContext } from '../helpers/app'

jest.mock('react-i18next', () => {
  const shared = jest.requireActual('../../__mocks__/react-i18next')
  const actual = jest.requireActual('i18next')
  const real = actual.default ?? actual
  return { ...shared, useTranslation: () => ({ t: real.t.bind(real), i18n: real }) }
})
let mockTimeline: object[] = []
jest.mock('../../src/hooks/chat-messages', () => ({
  ...jest.requireActual('../../src/hooks/chat-messages'),
  useChatMessagesByConnection: () => mockTimeline,
}))
let mockChatEvents: ChatEventRecord[] | undefined = []
jest.mock('../../src/modules/chat/chatEventsStore', () => ({ useChatEvents: () => mockChatEvents }))
let mockUnread: Record<string, number> = {}
jest.mock('../../src/hooks/useUnreadMessages', () => ({
  useUnreadMessages: () => ({ unreadByConnection: mockUnread, totalUnread: 0 }),
}))
// Their card has no photo (read, and none): the row falls back to their initials.
jest.mock('../../src/modules/vrc/contacts/useContactFacts', () => ({
  ...jest.requireActual('../../src/modules/vrc/contacts/useContactFacts'),
  useConnectionFacts: () => ({ photo: { known: true, value: undefined } }),
}))
jest.mock('../../src/hooks/connections', () => ({
  ...jest.requireActual('../../src/hooks/connections'),
  useConnectionDisplayName: () => 'Lena Park',
}))

// Everything here happens today (the row's "now" is a real new Date(), not jestSetup's pinned Date.now), so the
// row's time is a time of day.
const today = new Date()
const at = (hour: number, minute = 0) => new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour, minute)
const connected = { _id: 'connected', text: '', createdAt: at(8), user: { _id: Role.them }, renderEvent: () => null }
const said = (text: string, from: Role, more: object = {}) => ({
  _id: text,
  text,
  createdAt: at(9, 30),
  user: { _id: from },
  renderEvent: () => null,
  ...more,
})
const CONGRATS = '01JB3XKX6F8Q2W4E5R6T7Y8ZAA'
const record = (over: object) =>
  new ChatEventRecord({ connectionId: 'conn-1', role: 'received', sentTime: at(9), ...over } as never)

const row = async () => {
  const tree = render(
    <BasicAppContext>
      <ContactListItem
        contact={{ id: 'conn-1', theirLabel: 'Lena Park' } as never}
        navigation={{ navigate: jest.fn() } as never}
      />
    </BasicAppContext>
  )
  await act(async () => undefined)
  return tree
}

beforeEach(async () => {
  await speak('en')
  mockTimeline = [said('Congrats!', Role.them), connected]
  mockChatEvents = []
  mockUnread = {}
})

test('their words, the time, and their initials on a muted tone, not one bold letter', async () => {
  const tree = await row()
  expect(tree.getByText('Lena Park')).toBeTruthy()
  expect(tree.getByText('Congrats!')).toBeTruthy()
  // The localize mock's phone uses the 24-hour clock.
  expect(tree.getByText('09:30')).toBeTruthy()
  expect(tree.getByTestId(testIdWithKey('ContactPhotoInitial'))).toHaveTextContent('LP')
})

test('your own message: "You: …"', async () => {
  mockTimeline = [said('See you Thursday', Role.me), connected]
  expect((await row()).getByText('You: See you Thursday')).toBeTruthy()
})

test('a photo: "📷 Photo"', async () => {
  mockTimeline = [said('Photo', Role.them, { image: 'file:///p.jpg', textIsLabel: true }), connected]
  expect((await row()).getByText('📷 Photo')).toBeTruthy()
})

test('a reaction newer than the last message: who reacted, with what, to which words', async () => {
  mockChatEvents = [
    record({
      eventId: CONGRATS,
      eventType: 'message',
      content: { format: 'text/plain', text: 'Congrats!' },
      sentTime: at(9, 30),
    }),
    record({
      eventId: '01JB3XKX6F8Q2W4E5R6T7Y8ZBB',
      eventType: 'reaction',
      target: CONGRATS,
      emoji: '💜',
      sentTime: at(10),
    }),
  ]
  const tree = await row()
  expect(tree.getByText('Lena reacted 💜 to “Congrats!”')).toBeTruthy()
  expect(tree.getByText('10:00')).toBeTruthy()
})

test('a disappearing chat: a timer by the name, and no words of the message', async () => {
  mockChatEvents = [
    record({ eventId: '01JB3XKX6F8Q2W4E5R6T7Y8ZCC', eventType: 'timer', timer: { expiresIn: 3600, version: 1 } }),
  ]
  const tree = await row()
  expect(tree.getByTestId(testIdWithKey('MessagesListTimer'))).toBeTruthy()
  expect(tree.queryByText('Congrats!')).toBeNull()
  expect(tree.getByText('Message')).toBeTruthy()
})

test('unread: a count, 99+ past 99, and the row says so to a screen reader', async () => {
  mockUnread = { 'conn-1': 3 }
  let tree = await row()
  expect(tree.getByTestId(testIdWithKey('MessagesListUnread'))).toHaveTextContent('3')
  expect(tree.getByTestId(testIdWithKey('Contact')).props.accessibilityLabel).toBe(
    'Lena Park, Congrats!, 09:30, 3 unread messages'
  )
  tree.unmount()

  mockUnread = { 'conn-1': 120 }
  tree = await row()
  expect(tree.getByTestId(testIdWithKey('MessagesListUnread'))).toHaveTextContent('99+')
})

test('read: no count', async () => {
  expect((await row()).queryByTestId(testIdWithKey('MessagesListUnread'))).toBeNull()
})

test('in French: "Vous : …" and a reaction in French, with French quotes', async () => {
  await speak('fr')
  mockTimeline = [said('À jeudi', Role.me), connected]
  let tree = await row()
  expect(tree.getByText('Vous : À jeudi')).toBeTruthy()
  tree.unmount()

  mockChatEvents = [
    record({
      eventId: CONGRATS,
      eventType: 'message',
      content: { format: 'text/plain', text: 'Bravo !' },
      sentTime: at(9, 30),
    }),
    record({
      eventId: '01JB3XKX6F8Q2W4E5R6T7Y8ZBB',
      eventType: 'reaction',
      target: CONGRATS,
      emoji: '💜',
      sentTime: at(10),
    }),
  ]
  tree = await row()
  expect(tree.getByText('Lena a réagi 💜 à « Bravo ! »')).toBeTruthy()
})
