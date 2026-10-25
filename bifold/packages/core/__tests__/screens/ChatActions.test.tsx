import { useConnectionById, useBasicMessagesByConnectionId } from '@bifold/react-hooks'
import Clipboard from '@react-native-clipboard/clipboard'
import { DidCommConnectionRecord, DidCommDidExchangeRole, DidCommDidExchangeState } from '@credo-ts/didcomm'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { Alert, Text } from 'react-native'
import Toast from 'react-native-toast-message'

import type { ExtendedChatMessage } from '../../src/components/chat/ChatMessage'
import { MessageIconType } from '../../src/components/chat/ChatMessage'
import * as network from '../../src/contexts/network'
import { useChatMessagesByConnection } from '../../src/hooks/chat-messages'
import { deleteChatMessages } from '../../src/modules/chat/history'
import { removeReaction, sendChatText, sendReaction } from '../../src/modules/chat/send'
import { chatEventsShown } from '../../src/modules/chat/shown'
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

const RECEIVED = '01JB3XKX6F8Q2W4E5R6T7Y8Z9A'
const SENT = '01JB3XKX6F8Q2W4E5R6T7Y8Z9B'
const MY_REACTION = '01JB3XKX6F8Q2W4E5R6T7Y8Z9C'

const connection = new DidCommConnectionRecord({
  id: '1',
  createdAt: new Date(2024, 1, 1),
  state: DidCommDidExchangeState.Completed,
  role: DidCommDidExchangeRole.Requester,
  theirDid: 'did:example:123',
  theirLabel: 'Alice',
})

const at = (minute: number) => new Date(Date.UTC(2026, 9, 25, 10, minute))
const item = (overrides: Partial<ExtendedChatMessage> & { text: string }): ExtendedChatMessage => ({
  _id: overrides.text,
  createdAt: at(0),
  user: { _id: Role.them },
  renderEvent: () => <Text>{overrides.text}</Text>,
  ...overrides,
})

const received = item({ text: 'see you at noon', chatEventId: RECEIVED, createdAt: at(3) })
const receivedWithMyReaction = item({
  text: 'see you at noon',
  chatEventId: RECEIVED,
  createdAt: at(3),
  reactions: [
    { author: 'sent', emoji: '👍', eventId: MY_REACTION },
    { author: 'received', emoji: '👍', eventId: '01JB3XKX6F8Q2W4E5R6T7Y8Z9D' },
  ],
})
const sentChat = item({ text: 'on my way', chatEventId: SENT, user: { _id: Role.me }, createdAt: at(2) })
const plain = item({ text: 'old plain message', basicMessageId: 'basic-record-1', createdAt: at(1) })
const card = item({ text: 'Credential received', iconType: MessageIconType.Credential, createdAt: at(0) })

const timeline = (items: ExtendedChatMessage[]) =>
  (useChatMessagesByConnection as jest.Mock).mockReturnValue(
    [...items].sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())
  )

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

const id = (key: string) => testIdWithKey(key)

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
  timeline([received, sentChat, plain, card])
})

describe('long press on a message', () => {
  it('offers reactions, Reply, Copy and Delete for me on a chat message', () => {
    const tree = renderChat()
    fireEvent(tree.getByText('see you at noon'), 'longPress')
    expect(tree.getByTestId(id('ChatReactionBar'))).toBeTruthy()
    expect(tree.getByTestId(id('ChatActionReply'))).toBeTruthy()
    expect(tree.getByTestId(id('ChatActionCopy'))).toBeTruthy()
    expect(tree.getByTestId(id('ChatActionDeleteForMe'))).toBeTruthy()
    // "+" opens the full emoji picker (ChatEmojiPicker.test.tsx).
    expect(tree.getByTestId(id('ChatReactionBarMore'))).toBeTruthy()
  })

  it('offers only Copy and Delete for me on a plain message, which cannot be reacted or replied to', () => {
    const tree = renderChat()
    fireEvent(tree.getByText('old plain message'), 'longPress')
    expect(tree.queryByTestId(id('ChatReactionBar'))).toBeNull()
    expect(tree.queryByTestId(id('ChatActionReply'))).toBeNull()
    expect(tree.getByTestId(id('ChatActionCopy'))).toBeTruthy()
    expect(tree.getByTestId(id('ChatActionDeleteForMe'))).toBeTruthy()
  })
})

// iOS treats an accessible element as one: anything inside it is out of VoiceOver's reach and the e2e driver's. The
// two-phone run (2026-10-25) found the sheet's entries unreachable while the backdrop wrapped them.
describe('the actions sheet and accessibility', () => {
  type Node = { parent: Node | null; props: Record<string, unknown> }
  // Above the entry itself: a touchable is several nodes (host View, Animated View, the touchable), all carrying its
  // testID or its own accessible flag, so the walk starts above the outermost node that still carries the testID.
  const insideAnAccessibleElement = (node: Node) => {
    let top = node
    while (top.parent && top.parent.props?.testID === node.props.testID) top = top.parent
    for (let at = top.parent; at; at = at.parent) {
      if (at.props?.accessible === true) return true
    }
    return false
  }

  it('leaves every entry reachable: none sits inside an accessible element', () => {
    const tree = renderChat()
    fireEvent(tree.getByText('see you at noon'), 'longPress')
    for (const key of ['ChatActionReply', 'ChatActionCopy', 'ChatActionDeleteForMe', 'ChatReaction-0']) {
      expect(insideAnAccessibleElement(tree.getByTestId(id(key)) as never)).toBe(false)
    }
  })

  it('still closes when the backdrop is tapped', () => {
    const tree = renderChat()
    fireEvent(tree.getByText('see you at noon'), 'longPress')
    fireEvent.press(tree.getByTestId(id('ChatMessageActionsBackdrop')))
    expect(tree.queryByTestId(id('ChatMessageActions'))).toBeNull()
  })
})

describe('who a quote is by', () => {
  it('names the contact above the reply preview when answering their message', () => {
    const tree = renderChat()
    fireEvent(tree.getByText('see you at noon'), 'longPress')
    fireEvent.press(tree.getByTestId(id('ChatActionReply')))
    expect(tree.getByText('Replying to Alice')).toBeTruthy()
    expect(tree.queryByText('Replying to Unknown')).toBeNull()
  })

  it('says "You" above the reply preview when answering this phone’s own message', () => {
    const tree = renderChat()
    fireEvent(tree.getByText('on my way'), 'longPress')
    fireEvent.press(tree.getByTestId(id('ChatActionReply')))
    expect(tree.getByText('Replying to Chat.UserYou')).toBeTruthy()
    expect(tree.queryByText('Replying to Unknown')).toBeNull()
  })

  it('names the original’s author inside a reply’s bubble, and says why when the original is gone', () => {
    timeline([
      item({
        text: 'great',
        chatEventId: '01JB3XKX6F8Q2W4E5R6T7Y8Z9E',
        inReplyTo: RECEIVED,
        replyTo: { text: 'see you at noon', author: 'Alice' },
      }),
      item({
        text: 'what was that?',
        chatEventId: '01JB3XKX6F8Q2W4E5R6T7Y8Z9F',
        inReplyTo: '01JB3XKX6F8Q2W4E5R6T7Y8Z9G',
        replyTo: { unavailable: true },
        createdAt: at(5),
      }),
    ])
    const tree = renderChat()
    expect(tree.getByText('Alice')).toBeTruthy()
    expect(tree.getByText('Chat.ReplyUnavailable')).toBeTruthy()
    expect(tree.queryByText('Unknown')).toBeNull()
  })

  it('says the original expired, and shows no quote while the original is still being read', () => {
    timeline([
      item({
        text: 'about that',
        chatEventId: '01JB3XKX6F8Q2W4E5R6T7Y8Z9H',
        inReplyTo: '01JB3XKX6F8Q2W4E5R6T7Y8Z9J',
        replyTo: { expired: true },
      }),
      item({
        text: 'still reading',
        chatEventId: '01JB3XKX6F8Q2W4E5R6T7Y8Z9K',
        inReplyTo: '01JB3XKX6F8Q2W4E5R6T7Y8Z9M',
        replyTo: { unread: true },
        createdAt: at(5),
      }),
    ])
    const tree = renderChat()
    expect(tree.getByText('Chat.ReplyExpired')).toBeTruthy()
    expect(tree.getByText('still reading')).toBeTruthy()
    expect(tree.queryByText('Unknown')).toBeNull()
  })
})

describe('reactions', () => {
  it('sends the chosen reaction to the message', async () => {
    const tree = renderChat()
    fireEvent(tree.getByText('see you at noon'), 'longPress')
    fireEvent.press(tree.getByTestId(id('ChatReaction-0')))
    await waitFor(() => expect(sendReaction).toHaveBeenCalledWith(expect.anything(), '1', RECEIVED, '👍'))
    expect(tree.queryByTestId(id('ChatMessageActions'))).toBeNull()
  })

  it('removes this phone’s reaction when the same one is chosen again', async () => {
    timeline([receivedWithMyReaction])
    const tree = renderChat()
    fireEvent(tree.getByText('see you at noon'), 'longPress')
    fireEvent.press(tree.getByTestId(id('ChatReaction-0')))
    await waitFor(() => expect(removeReaction).toHaveBeenCalledWith(expect.anything(), '1', MY_REACTION))
    expect(sendReaction).not.toHaveBeenCalled()
  })

  it('says so when the contact cannot receive reactions, instead of showing one', async () => {
    ;(sendReaction as jest.Mock).mockResolvedValueOnce({ carriedAs: 'not-sent' })
    const tree = renderChat()
    fireEvent(tree.getByText('see you at noon'), 'longPress')
    fireEvent.press(tree.getByTestId(id('ChatReaction-1')))
    await waitFor(() =>
      expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ text1: 'Chat.ReactionNeedsUpdate' }))
    )
  })

  it('shows stored reactions under the message, each emoji once with its count', () => {
    timeline([receivedWithMyReaction])
    const tree = renderChat()
    const row = tree.getByTestId(id('ChatMessageReactions'))
    expect(row).toBeTruthy()
    expect(tree.getByText('2')).toBeTruthy()
  })
})

describe('reply', () => {
  it('shows what is being answered, blocks an update while it does, and sends the reply to that message', async () => {
    const tree = renderChat()
    fireEvent(tree.getByText('see you at noon'), 'longPress')
    fireEvent.press(tree.getByTestId(id('ChatActionReply')))
    expect(otaApplyBlockerReasons()).toContain('chat-reply')

    fireEvent.changeText(tree.getByPlaceholderText('Contacts.TypeHere'), 'great')
    await act(async () => {
      fireEvent.press(tree.getByTestId('GC_SEND_TOUCHABLE'))
    })
    expect(sendChatText).toHaveBeenCalledWith(expect.anything(), '1', 'great', { inReplyTo: RECEIVED })
    expect(otaApplyBlockerReasons()).not.toContain('chat-reply')
  })

  it('sends a message with no reply target as a plain chat text', async () => {
    const tree = renderChat()
    fireEvent.changeText(tree.getByPlaceholderText('Contacts.TypeHere'), 'hello')
    await act(async () => {
      fireEvent.press(tree.getByTestId('GC_SEND_TOUCHABLE'))
    })
    expect(sendChatText).toHaveBeenCalledWith(expect.anything(), '1', 'hello', {})
  })
})

describe('copy and delete for me', () => {
  it('copies the message text', () => {
    const tree = renderChat()
    fireEvent(tree.getByText('on my way'), 'longPress')
    fireEvent.press(tree.getByTestId(id('ChatActionCopy')))
    expect(Clipboard.setString).toHaveBeenCalledWith('on my way')
  })

  it('asks first, then deletes a chat message by its event id', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    const tree = renderChat()
    fireEvent(tree.getByText('see you at noon'), 'longPress')
    fireEvent.press(tree.getByTestId(id('ChatActionDeleteForMe')))
    expect(deleteChatMessages).not.toHaveBeenCalled()

    const buttons = alert.mock.calls[0][2] as { style?: string; onPress?: () => void }[]
    act(() => buttons.find((b) => b.style === 'destructive')!.onPress!())
    await waitFor(() =>
      expect(deleteChatMessages).toHaveBeenCalledWith(expect.anything(), '1', {
        events: [{ role: 'received', eventId: RECEIVED }],
      })
    )
  })

  it('deletes a plain message by its record id', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    const tree = renderChat()
    fireEvent(tree.getByText('old plain message'), 'longPress')
    fireEvent.press(tree.getByTestId(id('ChatActionDeleteForMe')))
    const buttons = alert.mock.calls[0][2] as { style?: string; onPress?: () => void }[]
    act(() => buttons.find((b) => b.style === 'destructive')!.onPress!())
    await waitFor(() =>
      expect(deleteChatMessages).toHaveBeenCalledWith(expect.anything(), '1', { basicMessageIds: ['basic-record-1'] })
    )
  })
})

describe('first display of received chat messages', () => {
  it('reports a message again on the next scroll when reporting it failed', async () => {
    ;(chatEventsShown as jest.Mock).mockRejectedValueOnce(new Error('store unavailable'))
    const tree = renderChat()
    const list = tree.UNSAFE_root.findAll((node) => typeof node.props.onViewableItemsChanged === 'function')[0]
    const tokens = [{ item: received, isViewable: true }]
    await act(async () => list.props.onViewableItemsChanged({ viewableItems: tokens, changed: tokens }))
    await act(async () => list.props.onViewableItemsChanged({ viewableItems: tokens, changed: tokens }))
    expect(chatEventsShown).toHaveBeenCalledTimes(2)
  })

  it('reports received chat messages as they become visible, each once, and nothing else', () => {
    const tree = renderChat()
    const list = tree.UNSAFE_root.findAll((node) => typeof node.props.onViewableItemsChanged === 'function')[0]
    const tokens = [received, sentChat, plain, card].map((message) => ({ item: message, isViewable: true }))
    act(() => list.props.onViewableItemsChanged({ viewableItems: tokens, changed: tokens }))
    act(() => list.props.onViewableItemsChanged({ viewableItems: tokens, changed: tokens }))
    expect(chatEventsShown).toHaveBeenCalledTimes(1)
    expect(chatEventsShown).toHaveBeenCalledWith(expect.anything(), '1', [RECEIVED])
  })
})
