/**
 * With disappearing messages on, a contact whose Keyring cannot honour them would get a plain message that never
 * disappears (sendChatText falls back by itself). So the person is asked first, and keeps their text if they would
 * rather not send it.
 */
import { useBasicMessagesByConnectionId, useConnectionById } from '@bifold/react-hooks'
import { DidCommConnectionRecord, DidCommDidExchangeRole, DidCommDidExchangeState } from '@credo-ts/didcomm'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { Alert, AlertButton } from 'react-native'

import * as network from '../../src/contexts/network'
import { useChatMessagesByConnection } from '../../src/hooks/chat-messages'
import { counterpartySpeaksChat } from '../../src/modules/chat/capability'
import { useChatEvents } from '../../src/modules/chat/chatEventsStore'
import { ChatEventRecord } from '../../src/modules/chat/records/ChatEventRecord'
import { sendChatText } from '../../src/modules/chat/send'
import Chat from '../../src/screens/Chat'
import navigationContext from '../contexts/navigation'
import { BasicAppContext } from '../helpers/app'

jest.mock('@react-navigation/elements', () => ({ useHeaderHeight: jest.fn(() => 100) }))
jest.mock('../../src/hooks/chat-messages', () => ({
  ...jest.requireActual('../../src/hooks/chat-messages'),
  useChatMessagesByConnection: jest.fn(),
}))
jest.mock('../../src/modules/chat/send', () => ({
  sendChatText: jest.fn(async () => ({ carriedAs: 'basic' })),
  sendReaction: jest.fn(),
  removeReaction: jest.fn(),
}))
jest.mock('../../src/modules/chat/capability', () => ({ counterpartySpeaksChat: jest.fn() }))
jest.mock('../../src/modules/chat/chatEventsStore', () => ({
  ...jest.requireActual('../../src/modules/chat/chatEventsStore'),
  useChatEvents: jest.fn(),
}))
jest.mock('../../src/modules/chat/notice', () => ({ sendCapabilityNoticeIfNeeded: jest.fn(async () => undefined) }))

const connection = new DidCommConnectionRecord({
  id: '1',
  createdAt: new Date(2024, 1, 1),
  state: DidCommDidExchangeState.Completed,
  role: DidCommDidExchangeRole.Requester,
  theirDid: 'did:example:123',
  theirLabel: 'Alice',
})

const timer = (expiresIn: number) =>
  new ChatEventRecord({
    connectionId: '1',
    eventId: '01JB3XKX6F8Q2W4E5R6T7Y8Z9A',
    eventType: 'timer',
    role: 'received',
    sentTime: new Date(Date.UTC(2026, 9, 25, 12)),
    timer: { expiresIn, version: 1 },
  })

// gifted-chat renders its composer only after its first layout with a height.
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
const typeAndSend = async (tree: ReturnType<typeof render>, text: string) => {
  fireEvent.changeText(tree.getByPlaceholderText('Chat.MessagePlaceholder'), text)
  await act(async () => fireEvent.press(tree.getByTestId('GC_SEND_TOUCHABLE')))
}

let alert: jest.SpyInstance
beforeEach(() => {
  jest.clearAllMocks()
  ;(useConnectionById as jest.Mock).mockReturnValue(connection)
  ;(useBasicMessagesByConnectionId as jest.Mock).mockReturnValue([])
  ;(useChatMessagesByConnection as jest.Mock).mockReturnValue([])
  jest.spyOn(network, 'useNetwork').mockImplementation(() => ({
    silentAssertConnectedNetwork: () => true,
    assertNetworkConnected: () => true,
    assertInternetReachable: jest.fn(),
    assertMediatorReachable: jest.fn(),
    displayNetInfoModal: jest.fn(),
    hideNetInfoModal: jest.fn(),
  }))
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
})

describe('disappearing messages on, and a contact whose Keyring cannot honour them', () => {
  beforeEach(() => {
    ;(useChatEvents as jest.Mock).mockReturnValue([timer(3600)])
    ;(counterpartySpeaksChat as jest.Mock).mockResolvedValue(false)
  })

  test('asks first; sends only once the person says so', async () => {
    const tree = renderChat()
    await typeAndSend(tree, 'the door code is 4512')
    expect(alert).toHaveBeenCalledWith(
      'Chat.PlainSendTitle',
      'Chat.PlainSendBody',
      expect.anything(),
      expect.anything()
    )
    expect(sendChatText).not.toHaveBeenCalled()

    const buttons = alert.mock.calls[0][2] as AlertButton[]
    await act(async () => buttons.find((b) => b.text === 'Chat.PlainSendConfirm')!.onPress!())
    expect(sendChatText).toHaveBeenCalledWith(expect.anything(), '1', 'the door code is 4512', {})
  })

  test('not sent: nothing goes, and the text is back in the composer', async () => {
    const tree = renderChat()
    await typeAndSend(tree, 'the door code is 4512')
    const buttons = alert.mock.calls[0][2] as AlertButton[]
    await act(async () => buttons.find((b) => b.style === 'cancel')!.onPress!())
    expect(sendChatText).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(tree.getByPlaceholderText('Chat.MessagePlaceholder').props.value).toBe('the door code is 4512')
    )
  })
})

// Positive controls: with nothing to warn of, a message goes at once.
describe('nothing to ask', () => {
  test('disappearing messages on, and a contact whose Keyring honours them', async () => {
    ;(useChatEvents as jest.Mock).mockReturnValue([timer(3600)])
    ;(counterpartySpeaksChat as jest.Mock).mockResolvedValue(true)
    await typeAndSend(renderChat(), 'see you at noon')
    expect(alert).not.toHaveBeenCalled()
    expect(sendChatText).toHaveBeenCalledWith(expect.anything(), '1', 'see you at noon', {})
  })

  // With the timer off there is nothing to ask, so sending never waits on whether their Keyring speaks chat: that
  // answer never comes here, and the message still goes.
  test('disappearing messages off', async () => {
    ;(useChatEvents as jest.Mock).mockReturnValue([timer(0)])
    ;(counterpartySpeaksChat as jest.Mock).mockReturnValue(new Promise(() => undefined))
    await typeAndSend(renderChat(), 'see you at noon')
    expect(alert).not.toHaveBeenCalled()
    expect(sendChatText).toHaveBeenCalledWith(expect.anything(), '1', 'see you at noon', {})
  })
})
