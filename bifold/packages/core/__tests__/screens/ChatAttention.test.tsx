/**
 * A chat marks its messages seen, and reports a received message's first display, only while someone is looking
 * at it: its screen in front and the app in the foreground. A chat stays mounted under a screen pushed over it and
 * while the app is in the background, and messages keep arriving there (rich-messaging-plan.md §4.6, D4).
 *
 * Nobody looking is set the way it happens, through navigation's focus and the app's state, not through the hook
 * that reads them, so these fail on a chat that marks whatever arrives while it is mounted.
 */
import { useAgent, useBasicMessages, useBasicMessagesByConnectionId, useConnectionById } from '@bifold/react-hooks'
import {
  DidCommBasicMessageRecord,
  DidCommBasicMessageRole,
  DidCommConnectionRecord,
  DidCommDidExchangeRole,
  DidCommDidExchangeState,
} from '@credo-ts/didcomm'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { AppState, AppStateStatus, Text, View } from 'react-native'

import type { ExtendedChatMessage } from '../../src/components/chat/ChatMessage'
import * as network from '../../src/contexts/network'
import { useChatMessagesByConnection } from '../../src/hooks/chat-messages'
import { useUnreadMessages } from '../../src/hooks/useUnreadMessages'
import { markChatEventsSeen } from '../../src/modules/chat/seen'
import { chatEventsShown } from '../../src/modules/chat/shown'
import Chat from '../../src/screens/Chat'
import { Role } from '../../src/types/chat'
import { getActiveChatConnectionId, setActiveChatConnectionId } from '../../src/utils/activeChatTracker'
import navigationContext from '../contexts/navigation'
import { BasicAppContext } from '../helpers/app'

let mockFocused = true
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../__mocks__/@react-navigation/native'),
  useIsFocused: () => mockFocused,
}))
jest.mock('@react-navigation/elements', () => ({ useHeaderHeight: jest.fn(() => 100) }))
jest.mock('../../src/hooks/chat-messages', () => ({
  ...jest.requireActual('../../src/hooks/chat-messages'),
  useChatMessagesByConnection: jest.fn(),
}))
jest.mock('../../src/modules/chat/seen', () => ({
  ...jest.requireActual('../../src/modules/chat/seen'),
  markChatEventsSeen: jest.fn(async () => undefined),
}))
jest.mock('../../src/modules/chat/shown', () => ({ chatEventsShown: jest.fn(async () => undefined) }))

// jestSetup.js maps 'react-native' to the actual module, so the app's state is set on the real AppState.
let mockAppState: AppStateStatus = 'active'
let appStateListeners: ((next: AppStateStatus) => void)[] = []
Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => mockAppState })
AppState.addEventListener = ((_type: string, listener: (next: AppStateStatus) => void) => {
  appStateListeners.push(listener)
  return { remove: () => (appStateListeners = appStateListeners.filter((l) => l !== listener)) }
}) as unknown as typeof AppState.addEventListener
const appGoes = (next: AppStateStatus) =>
  act(() => {
    mockAppState = next
    appStateListeners.forEach((listener) => listener(next))
  })

const connection = new DidCommConnectionRecord({
  id: '1',
  createdAt: new Date(2024, 1, 1),
  state: DidCommDidExchangeState.Completed,
  role: DidCommDidExchangeRole.Requester,
  theirDid: 'did:example:123',
  theirLabel: 'Alice',
})

const received = (id: string, content: string) =>
  new DidCommBasicMessageRecord({
    id,
    threadId: id,
    connectionId: '1',
    role: DidCommBasicMessageRole.Receiver,
    content,
    sentTime: '20261025',
  })

const RECEIVED_CHAT = '01JB3XKX6F8Q2W4E5R6T7Y8Z9A'
const receivedChat: ExtendedChatMessage = {
  _id: 'see you at noon',
  text: 'see you at noon',
  chatEventId: RECEIVED_CHAT,
  createdAt: new Date(Date.UTC(2026, 9, 25, 10, 3)),
  user: { _id: Role.them },
  renderEvent: () => <Text>see you at noon</Text>,
}

// The Messages badge's count, beside the chat as the tab bar is.
const Unread: React.FC = () => <Text testID="unread">{String(useUnreadMessages().totalUnread)}</Text>

let messages: DidCommBasicMessageRecord[] = []
const chatScreen = () => (
  <BasicAppContext>
    <View>
      <Chat navigation={navigationContext} route={{ params: { connectionId: '1' } } as any} />
      <Unread />
    </View>
  </BasicAppContext>
)
const arrives = (message: DidCommBasicMessageRecord) => {
  messages = [...messages, message]
  ;(useBasicMessagesByConnectionId as jest.Mock).mockReturnValue(messages)
  ;(useBasicMessages as jest.Mock).mockReturnValue({ records: messages })
}
// What the screens read after a write: the record hooks hand over a new list once storage reports an update (the
// mocked repository reports none), so the count is read from what was written, never from a list read before it.
const settles = (tree: ReturnType<typeof render>) => {
  messages = [...messages]
  ;(useBasicMessagesByConnectionId as jest.Mock).mockReturnValue(messages)
  ;(useBasicMessages as jest.Mock).mockReturnValue({ records: messages })
  tree.rerender(chatScreen())
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFocused = true
  mockAppState = 'active'
  appStateListeners = []
  messages = []
  ;(useConnectionById as jest.Mock).mockReturnValue(connection)
  ;(useBasicMessagesByConnectionId as jest.Mock).mockReturnValue(messages)
  ;(useBasicMessages as jest.Mock).mockReturnValue({ records: messages })
  ;(useChatMessagesByConnection as jest.Mock).mockReturnValue([receivedChat])
  jest.spyOn(network, 'useNetwork').mockImplementation(() => ({
    silentAssertConnectedNetwork: () => true,
    assertNetworkConnected: () => true,
    assertInternetReachable: jest.fn(),
    assertMediatorReachable: jest.fn(),
    displayNetInfoModal: jest.fn(),
    hideNetInfoModal: jest.fn(),
  }))
})

describe('seen, and the unread count', () => {
  test('a message that arrives under another screen stays unread until the chat is back in front', () => {
    const tree = render(chatScreen())
    jest.clearAllMocks()

    mockFocused = false
    arrives(received('m1', 'are you there?'))
    tree.rerender(chatScreen())
    settles(tree)
    expect(tree.getByTestId('unread').props.children).toBe('1')
    expect(markChatEventsSeen).not.toHaveBeenCalled()

    mockFocused = true
    tree.rerender(chatScreen())
    settles(tree)
    expect(tree.getByTestId('unread').props.children).toBe('0')
    expect(markChatEventsSeen).toHaveBeenCalledWith((useAgent as jest.Mock)().agent, '1')
  })

  test('a message that arrives with the app in the background stays unread until it is back in the foreground', () => {
    const tree = render(chatScreen())
    jest.clearAllMocks()

    appGoes('background')
    arrives(received('m1', 'are you there?'))
    tree.rerender(chatScreen())
    settles(tree)
    expect(tree.getByTestId('unread').props.children).toBe('1')
    expect(markChatEventsSeen).not.toHaveBeenCalled()

    appGoes('active')
    settles(tree)
    expect(tree.getByTestId('unread').props.children).toBe('0')
    expect(markChatEventsSeen).toHaveBeenCalledWith((useAgent as jest.Mock)().agent, '1')
  })

  // A positive control: in front and in the foreground, an arrival is seen at once.
  test('a message that arrives while the chat is in front is seen at once', () => {
    const tree = render(chatScreen())
    arrives(received('m1', 'are you there?'))
    tree.rerender(chatScreen())
    settles(tree)
    expect(tree.getByTestId('unread').props.children).toBe('0')
  })
})

// The chat someone is looking at raises no toast for its messages; one under another screen, or with the app in the
// background, is not being looked at, so its messages do.
describe('the chat someone is looking at', () => {
  test('in front and in the foreground: it is', () => {
    render(chatScreen())
    expect(getActiveChatConnectionId()).toBe('1')
  })

  test('under another screen: it is not, until it is back in front', () => {
    const tree = render(chatScreen())
    mockFocused = false
    tree.rerender(chatScreen())
    expect(getActiveChatConnectionId()).toBeUndefined()
    mockFocused = true
    tree.rerender(chatScreen())
    expect(getActiveChatConnectionId()).toBe('1')
  })

  test('with the app in the background: it is not, until it is back', () => {
    render(chatScreen())
    appGoes('background')
    expect(getActiveChatConnectionId()).toBeUndefined()
    appGoes('active')
    expect(getActiveChatConnectionId()).toBe('1')
  })

  test('closing one chat leaves another chat that has since set itself', () => {
    const tree = render(chatScreen())
    setActiveChatConnectionId('2')
    tree.unmount()
    expect(getActiveChatConnectionId()).toBe('2')
    setActiveChatConnectionId(undefined)
  })

  test('closed: it is not', () => {
    const tree = render(chatScreen())
    tree.unmount()
    expect(getActiveChatConnectionId()).toBeUndefined()
  })
})

describe("a received message's first display", () => {
  const scrollsIntoView = (tree: ReturnType<typeof render>) => {
    // gifted-chat renders its list only after its first layout with a height.
    fireEvent(tree.getByTestId('GC_WRAPPER'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } },
    })
    const list = tree.UNSAFE_root.findAll((node) => typeof node.props.onViewableItemsChanged === 'function')[0]
    const tokens = [{ item: receivedChat, isViewable: true }]
    act(() => list.props.onViewableItemsChanged({ viewableItems: tokens, changed: tokens }))
  }

  test('in view under another screen: reported only once the chat is back in front', () => {
    mockFocused = false
    const tree = render(chatScreen())
    scrollsIntoView(tree)
    expect(chatEventsShown).not.toHaveBeenCalled()

    mockFocused = true
    tree.rerender(chatScreen())
    expect(chatEventsShown).toHaveBeenCalledTimes(1)
    expect(chatEventsShown).toHaveBeenCalledWith(expect.anything(), '1', [RECEIVED_CHAT])
  })

  test('in view with the app in the background: reported only once it is back in the foreground', () => {
    const tree = render(chatScreen())
    appGoes('background')
    scrollsIntoView(tree)
    expect(chatEventsShown).not.toHaveBeenCalled()

    appGoes('active')
    expect(chatEventsShown).toHaveBeenCalledTimes(1)
    expect(chatEventsShown).toHaveBeenCalledWith(expect.anything(), '1', [RECEIVED_CHAT])
  })

  test('in view before the agent is ready: reported once it is', () => {
    const ready = (useAgent as jest.Mock)()
    ;(useAgent as jest.Mock).mockReturnValue({ ...ready, agent: undefined })
    try {
      const tree = render(chatScreen())
      scrollsIntoView(tree)
      expect(chatEventsShown).not.toHaveBeenCalled()
      ;(useAgent as jest.Mock).mockReturnValue(ready)
      tree.rerender(chatScreen())
      expect(chatEventsShown).toHaveBeenCalledTimes(1)
      expect(chatEventsShown).toHaveBeenCalledWith(ready.agent, '1', [RECEIVED_CHAT])
    } finally {
      ;(useAgent as jest.Mock).mockReturnValue(ready)
    }
  })

  // iOS's app switcher and incoming-call screen leave the app 'inactive': the chat is behind them, not looked at.
  test('in view while the app is inactive: not reported', () => {
    const tree = render(chatScreen())
    appGoes('inactive')
    scrollsIntoView(tree)
    expect(chatEventsShown).not.toHaveBeenCalled()
  })
})
