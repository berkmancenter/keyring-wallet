import { useConnectionById, useBasicMessagesByConnectionId } from '@bifold/react-hooks'
import { DidCommConnectionRecord, DidCommDidExchangeRole, DidCommDidExchangeState } from '@credo-ts/didcomm'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { Text } from 'react-native'
import Toast from 'react-native-toast-message'

import type { ExtendedChatMessage } from '../../src/components/chat/ChatMessage'
import * as network from '../../src/contexts/network'
import { useChatMessagesByConnection } from '../../src/hooks/chat-messages'
import { emojiCodePoints } from '../../src/modules/chat/emoji/EmojiPicker.ids'
import { removeReaction, sendReaction } from '../../src/modules/chat/send'
import Chat from '../../src/screens/Chat'
import { Role } from '../../src/types/chat'
import { otaApplyBlockerReasons } from '../../src/utils/otaApply'
import { testIdWithKey } from '../../src/utils/testable'
import navigationContext from '../contexts/navigation'
import { BasicAppContext } from '../helpers/app'

jest.mock('@react-navigation/elements', () => ({ useHeaderHeight: jest.fn(() => 100) }))
jest.mock('../../src/hooks/chat-messages', () => ({
  ...jest.requireActual('../../src/hooks/chat-messages'),
  useChatMessagesByConnection: jest.fn(),
}))
jest.mock('../../src/modules/chat/send', () => ({
  sendChatText: jest.fn(async () => ({ carriedAs: 'chat' })),
  sendReaction: jest.fn(async () => ({ carriedAs: 'chat' })),
  removeReaction: jest.fn(async () => ({ carriedAs: 'chat' })),
}))
jest.mock('../../src/modules/chat/history', () => ({ deleteChatMessages: jest.fn(async () => undefined) }))
jest.mock('../../src/modules/chat/shown', () => ({ chatEventsShown: jest.fn(async () => undefined) }))
jest.mock('../../src/modules/chat/emoji/recent', () => ({
  ...jest.requireActual('../../src/modules/chat/emoji/recent'),
  loadRecent: jest.fn(async () => []),
  saveRecent: jest.fn(async () => undefined),
}))

const RECEIVED = '01JB3XKX6F8Q2W4E5R6T7Y8Z9A'
const MY_REACTION = '01JB3XKX6F8Q2W4E5R6T7Y8Z9C'

const connection = new DidCommConnectionRecord({
  id: '1',
  createdAt: new Date(2024, 1, 1),
  state: DidCommDidExchangeState.Completed,
  role: DidCommDidExchangeRole.Requester,
  theirDid: 'did:example:123',
  theirLabel: 'Alice',
})

const item = (overrides: Partial<ExtendedChatMessage> & { text: string }): ExtendedChatMessage => ({
  _id: overrides.text,
  createdAt: new Date(Date.UTC(2026, 9, 25, 10, 3)),
  user: { _id: Role.them },
  renderEvent: () => <Text>{overrides.text}</Text>,
  ...overrides,
})

const received = item({ text: 'see you at noon', chatEventId: RECEIVED })

const id = (key: string) => testIdWithKey(key)
const emojiId = (emoji: string) => id(`EmojiPickerEmoji_${emojiCodePoints(emoji)}`)

const renderChat = () => {
  const tree = render(
    <BasicAppContext>
      <Chat navigation={navigationContext} route={{ params: { connectionId: '1' } } as any} />
    </BasicAppContext>
  )
  fireEvent(tree.getByTestId('GC_WRAPPER'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } },
  })
  return tree
}

beforeEach(() => {
  jest.clearAllMocks()
  // @ts-expect-error useConnectionById will be replaced with a mock which will have this method
  useConnectionById.mockReturnValue(connection)
  // @ts-expect-error useBasicMessagesByConnectionId will be replaced with a mock which will have this method
  useBasicMessagesByConnectionId.mockReturnValue([])
  jest.spyOn(network, 'useNetwork').mockImplementation(() => ({
    silentAssertConnectedNetwork: () => true,
    assertNetworkConnected: () => true,
    assertInternetReachable: jest.fn(),
    assertMediatorReachable: jest.fn(),
    displayNetInfoModal: jest.fn(),
    hideNetInfoModal: jest.fn(),
  }))
  jest.spyOn(Toast, 'show').mockImplementation(() => undefined)
  ;(useChatMessagesByConnection as jest.Mock).mockReturnValue([received])
})

describe('the reaction bar’s "+"', () => {
  it('closes the actions, opens the picker, and sends the chosen emoji to that message', async () => {
    const tree = renderChat()
    fireEvent(tree.getByText('see you at noon'), 'longPress')
    fireEvent.press(tree.getByTestId(id('ChatReactionBarMore')))
    expect(tree.queryByTestId(id('ChatMessageActions'))).toBeNull()
    expect(tree.getByTestId(id('EmojiPickerSheet'))).toBeTruthy()

    fireEvent.changeText(tree.getByTestId(id('EmojiPickerSearch')), 'cat')
    await act(async () => fireEvent.press(tree.getByTestId(emojiId('🐱'))))
    await waitFor(() => expect(sendReaction).toHaveBeenCalledWith(expect.anything(), '1', RECEIVED, '🐱'))
    expect(tree.queryByTestId(id('EmojiPickerSheet'))).toBeNull()
  })

  it('removes this phone’s reaction when the picker chooses the same emoji', async () => {
    ;(useChatMessagesByConnection as jest.Mock).mockReturnValue([
      item({
        text: 'see you at noon',
        chatEventId: RECEIVED,
        reactions: [{ author: 'sent', emoji: '🐱', eventId: MY_REACTION }],
      }),
    ])
    const tree = renderChat()
    fireEvent(tree.getByText('see you at noon'), 'longPress')
    fireEvent.press(tree.getByTestId(id('ChatReactionBarMore')))
    fireEvent.changeText(tree.getByTestId(id('EmojiPickerSearch')), 'cat')
    await act(async () => fireEvent.press(tree.getByTestId(emojiId('🐱'))))
    await waitFor(() => expect(removeReaction).toHaveBeenCalledWith(expect.anything(), '1', MY_REACTION))
    expect(sendReaction).not.toHaveBeenCalled()
  })

  it('sends nothing when the picker is closed without a choice', () => {
    const tree = renderChat()
    fireEvent(tree.getByText('see you at noon'), 'longPress')
    fireEvent.press(tree.getByTestId(id('ChatReactionBarMore')))
    fireEvent.press(tree.getByTestId(id('EmojiPickerSheetClose')))
    expect(tree.queryByTestId(id('EmojiPickerSheet'))).toBeNull()
    expect(sendReaction).not.toHaveBeenCalled()
  })
})

describe('the composer’s emoji button', () => {
  it('opens the picker, types each chosen emoji into the composer, and stays open', async () => {
    const tree = renderChat()
    // Not already there, so the wait below proves the choice made the draft.
    expect(otaApplyBlockerReasons()).not.toContain('chat-draft')
    fireEvent.press(tree.getByTestId(id('ChatComposerEmojiButton')))
    expect(tree.getByTestId(id('EmojiPickerSheet'))).toBeTruthy()

    await act(async () => fireEvent.press(tree.getByTestId(emojiId('😀'))))
    // The composer now holds a draft, which blocks an over-the-air reload (Chat's 'chat-draft' blocker).
    await waitFor(() => expect(otaApplyBlockerReasons()).toContain('chat-draft'))
    expect(tree.getByTestId(id('EmojiPickerSheet'))).toBeTruthy()
    expect(sendReaction).not.toHaveBeenCalled()

    fireEvent.press(tree.getByTestId(id('EmojiPickerSheetClose')))
    expect(tree.queryByTestId(id('EmojiPickerSheet'))).toBeNull()
  })

  it('is disabled while the chat cannot send', () => {
    jest.spyOn(network, 'useNetwork').mockImplementation(() => ({
      silentAssertConnectedNetwork: () => false,
      assertNetworkConnected: () => false,
      assertInternetReachable: jest.fn(),
      assertMediatorReachable: jest.fn(),
      displayNetInfoModal: jest.fn(),
      hideNetInfoModal: jest.fn(),
    }))
    const tree = renderChat()
    fireEvent.press(tree.getByTestId(id('ChatComposerEmojiButton')))
    expect(tree.queryByTestId(id('EmojiPickerSheet'))).toBeNull()
  })
})
