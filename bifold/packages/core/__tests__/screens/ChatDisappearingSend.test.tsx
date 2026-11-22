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
import Toast from 'react-native-toast-message'

import * as network from '../../src/contexts/network'
import { useChatMessagesByConnection } from '../../src/hooks/chat-messages'
import { counterpartySpeaksChat } from '../../src/modules/chat/capability'
import { useChatEvents } from '../../src/modules/chat/chatEventsStore'
import { loadChatDraft, saveChatDraft } from '../../src/modules/chat/draft'
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
jest.mock('../../src/modules/chat/draft', () => ({
  ...jest.requireActual('../../src/modules/chat/draft'),
  loadChatDraft: jest.fn(async () => undefined),
  saveChatDraft: jest.fn(async () => undefined),
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

const chat = (connectionId: string) => (
  <BasicAppContext>
    <Chat navigation={navigationContext} route={{ params: { connectionId } } as any} />
  </BasicAppContext>
)

// gifted-chat renders its composer only after its first layout with a height.
const renderChat = () => {
  const tree = render(chat('1'))
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

// A text that could not be sent: the field was emptied before the send (Chat.tsx onSend), and the phone stores nothing
// for a chat event that failed (send.ts sends, then saves). So the words go back in the field, and the person is told.
describe('a text send that fails', () => {
  const DOOR = 'the door code is 4512'
  const field = (tree: ReturnType<typeof render>) => tree.getByPlaceholderText('Chat.MessagePlaceholder').props.value
  let toast: jest.SpyInstance
  beforeEach(() => {
    toast = jest.spyOn(Toast, 'show').mockImplementation(() => undefined)
    ;(useChatEvents as jest.Mock).mockReturnValue([timer(0)])
  })
  afterEach(() => toast.mockRestore())

  const failNext = () => (sendChatText as jest.Mock).mockRejectedValueOnce(new Error('undeliverable to Alice'))
  /** A send still out, to fail when the test says. */
  const holdNext = () => {
    let fail: () => void = () => undefined
    ;(sendChatText as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = () => reject(new Error('undeliverable to Alice'))
        })
    )
    return () => act(async () => fail())
  }
  const told = () =>
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', text1: 'Chat.MessageNotSent' }))

  test('sent at once: the text is back in the field, and the person is told', async () => {
    failNext()
    const tree = renderChat()
    await typeAndSend(tree, DOOR)
    await waitFor(() => expect(field(tree)).toBe(DOOR))
    told()
  })

  test('sent after the disappearing-messages question: the same', async () => {
    ;(useChatEvents as jest.Mock).mockReturnValue([timer(3600)])
    ;(counterpartySpeaksChat as jest.Mock).mockResolvedValue(false)
    failNext()
    const tree = renderChat()
    await typeAndSend(tree, DOOR)
    const buttons = alert.mock.calls[0][2] as AlertButton[]
    await act(async () => buttons.find((b) => b.text === 'Chat.PlainSendConfirm')!.onPress!())
    await waitFor(() => expect(field(tree)).toBe(DOOR))
    told()
  })

  test('the next message, started while the send was out, is kept after it', async () => {
    const fail = holdNext()
    const tree = renderChat()
    await typeAndSend(tree, DOOR)
    fireEvent.changeText(tree.getByPlaceholderText('Chat.MessagePlaceholder'), 'and the gate is 77')
    await fail()
    await waitFor(() => expect(field(tree)).toBe(`${DOOR}\nand the gate is 77`))
  })

  const toldKept = () =>
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', text1: 'Chat.MessageNotSentKept', visibilityTime: 8000 })
    )

  test('the chat left while the send was out: kept as its draft, and the notice says where', async () => {
    const fail = holdNext()
    const tree = renderChat()
    await typeAndSend(tree, DOOR)
    tree.unmount()
    await fail()
    await waitFor(() => expect(saveChatDraft).toHaveBeenCalledWith(expect.anything(), '1', DOOR))
    await waitFor(toldKept)
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ text1: 'Chat.MessageNotSent' }))
  })

  // Send would give the words to whoever is on screen now.
  test('another chat opened under this screen while the send was out: never in that chat’s field or draft', async () => {
    const fail = holdNext()
    ;(loadChatDraft as jest.Mock).mockImplementation(async (_agent: unknown, id: string) =>
      id === '1' ? 'typed before leaving' : undefined
    )
    const tree = renderChat()
    await typeAndSend(tree, DOOR)
    tree.rerender(chat('2'))
    await fail()
    await waitFor(() =>
      expect(saveChatDraft).toHaveBeenCalledWith(expect.anything(), '1', `${DOOR}\ntyped before leaving`)
    )
    await waitFor(toldKept)
    await act(async () => new Promise((resolve) => setTimeout(resolve, 500)))
    expect(field(tree)).not.toBe(DOOR)
    expect(saveChatDraft).not.toHaveBeenCalledWith(expect.anything(), '2', expect.stringContaining(DOOR))
  })

  test('two sends failing while the chat is gone: each kept, neither over the other', async () => {
    // A store that answers late, so two keeps at once would both read it empty.
    let stored: string | undefined
    const later = () => new Promise((resolve) => setTimeout(resolve, 20))
    ;(loadChatDraft as jest.Mock).mockImplementation(async () => {
      await later()
      return stored
    })
    ;(saveChatDraft as jest.Mock).mockImplementation(async (_agent: unknown, _id: string, text: string) => {
      await later()
      stored = text
    })
    const failFirst = holdNext()
    const tree = renderChat()
    await typeAndSend(tree, 'first')
    const failSecond = holdNext()
    await typeAndSend(tree, 'second')
    tree.unmount()
    await failFirst()
    await failSecond()
    await waitFor(() => expect(stored).toContain('first'))
    await waitFor(() => expect(stored).toContain('second'))
    ;(loadChatDraft as jest.Mock).mockImplementation(async () => undefined)
    ;(saveChatDraft as jest.Mock).mockImplementation(async () => undefined)
  })

  test('the words could not be kept: the notice says so, and that they must be written again', async () => {
    const fail = holdNext()
    // Only these words: the field's own emptied draft is saved as well, as the send goes out.
    ;(saveChatDraft as jest.Mock).mockImplementation(async (_agent: unknown, _id: string, text: string) => {
      if (text.includes(DOOR)) throw new Error('store closed')
    })
    const tree = renderChat()
    await typeAndSend(tree, DOOR)
    tree.rerender(chat('2'))
    await fail()
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', text1: 'Chat.MessageNotSentLost', visibilityTime: 15_000 })
      )
    )
    expect(toast).toHaveBeenCalledTimes(1)
    ;(saveChatDraft as jest.Mock).mockImplementation(async () => undefined)
  })

  // Control: the field is read correctly, and a send that worked neither puts the text back nor says anything.
  test('a send that works: the field stays empty and nothing is said', async () => {
    const tree = renderChat()
    await typeAndSend(tree, DOOR)
    expect(sendChatText).toHaveBeenCalledWith(expect.anything(), '1', DOOR, {})
    expect(field(tree)).not.toBe(DOOR)
    expect(toast).not.toHaveBeenCalled()
  })
})
