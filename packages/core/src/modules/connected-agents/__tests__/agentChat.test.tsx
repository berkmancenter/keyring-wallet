/**
 * The agent chat (plan §7.9; backlog 2 R3): the view's header, bubbles, states and composer (frames 27 and 28); its
 * route's container over `useAgentChat`; its registration in MessageStack behind the switch; and the agent rows in
 * Messages (frames 26 and 29), merged by time with the people and rooms, under All and People only.
 */
import { useBasicMessages, useConnections } from '@bifold/react-hooks'
import {
  DidCommConnectionRecord,
  DidCommConnectionType,
  DidCommDidExchangeRole,
  DidCommDidExchangeState,
} from '@credo-ts/didcomm'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testDefaultState } from '../../../../__tests__/contexts/store'
import { StoreContext } from '../../../contexts/store'
import MessageStack from '../../../navigators/MessageStack'
import AgentChatScreen from '../../../screens/agents/AgentChatScreen'
import Messages from '../../../screens/Messages'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { setAgentConnectEnabled } from '../agentConnectFlag'
import type { AgentMessageRow } from '../chat/messageRows'
import type { UseAgentChat } from '../chat/useAgentChat'
import AgentChatView, { type AgentChatViewProps } from '../screens/AgentChatView'

// The hooks fb-C4 gives, stood in for: the chat service, one agent's chat, and the Messages rows.
let mockService: object | undefined
let mockChat: UseAgentChat
const mockUseAgentChat = jest.fn((agentId: string) => {
  void agentId
  return mockChat
})
jest.mock('../chat/useAgentChat', () => ({
  ...jest.requireActual('../chat/useAgentChat'),
  useAgentChatService: () => mockService,
  useAgentChat: (agentId: string) => mockUseAgentChat(agentId),
}))
let mockAgentRows: AgentMessageRow[] = []
// The stack's navigator, as a plain list of its screens: what is under test is which routes it registers.
jest.mock('@react-navigation/stack', () => {
  const { createElement, Fragment } = jest.requireActual('react')
  return {
    ...jest.requireActual('@react-navigation/stack'),
    createStackNavigator: () => ({
      Navigator: ({ children }: { children: React.ReactNode }) => createElement(Fragment, null, children),
      Screen: () => null,
    }),
  }
})
jest.mock('../chat/messageRows', () => ({
  ...jest.requireActual('../chat/messageRows'),
  useAgentMessageRows: () => mockAgentRows,
}))

// What Messages reads besides the agent rows, as MessagesRows.test.tsx stands them in.
jest.mock('../../vrc/contacts/useContactLinks', () => ({ useContactLinks: () => new Map() }))
jest.mock('../../vrc/contacts/useContactFacts', () => ({
  ...jest.requireActual('../../vrc/contacts/useContactFacts'),
  useConnectionRelationships: () =>
    new Map([
      ['conn-ada', 'did:ada:1'],
      ['conn-bob', 'did:bob:1'],
    ]),
}))
jest.mock('../../../hooks/chat-messages', () => ({
  ...jest.requireActual('../../../hooks/chat-messages'),
  useChatMessagesByConnection: () => [],
}))
jest.mock('../../../hooks/useUnreadMessages', () => ({
  useUnreadMessages: () => ({ unreadByConnection: {}, totalUnread: 0 }),
}))
let mockRoomRows: Record<string, unknown>[] = []
jest.mock('../../rooms/useRoomRows', () => ({
  useRoomRows: () => ({ rows: mockRoomRows, reload: jest.fn(), failed: false }),
  useHiddenRoomCount: () => 0,
}))
jest.mock('../../../components/messages/WaitingForYou', () => ({ __esModule: true, default: () => null }))
jest.mock('../../rooms/components/RoomMessageRow', () => {
  const { createElement } = jest.requireActual('react')
  const { View } = jest.requireActual('react-native')
  return {
    __esModule: true,
    default: ({ row }: { row: { roomId: string } }) => createElement(View, { testID: `room:${row.roomId}` }),
  }
})

const none = () => undefined
const formatTime = (iso: string) => iso.slice(11, 16)
const id = (key: string) => testIdWithKey(key)

const view = (props: Partial<AgentChatViewProps> = {}) => {
  const onSend = jest.fn()
  const tree = render(
    <BasicAppContext>
      <AgentChatView
        name="Notes helper"
        ownerName="Ada"
        messages={[
          { id: 'm1', mine: true, text: 'Summarise my notes.', at: '2026-11-27T10:38:00.000Z' },
          { id: 'm2', mine: false, text: 'Here is a summary.', at: '2026-11-27T10:39:00.000Z' },
        ]}
        state="connected"
        stopped={false}
        onSend={onSend}
        formatTime={formatTime}
        onBack={none}
        {...props}
      />
    </BasicAppContext>
  )
  return { tree, onSend }
}
/** The words of each state line on screen, in order. */
type Node = { children: Array<Node | string> }
const textOf = (node: Node | string): string =>
  typeof node === 'string' ? node : node.children.map((child) => textOf(child)).join('')
const stateLines = (tree: ReturnType<typeof render>) =>
  tree
    .queryAllByTestId(id('AgentChatState'))
    .map((node) => (textOf(node as unknown as Node).match(/ConnectedAgents\.\w+/g) ?? []).join(' '))

afterEach(() => {
  setAgentConnectEnabled(false)
  jest.clearAllMocks()
})

describe('AgentChatView', () => {
  test('the header: the name, "AI agent", and who it belongs to (frame 27)', () => {
    const { tree } = view()
    const header = tree.getByTestId(id('AgentChatHeader'))
    expect(header).toHaveTextContent(/Notes helper/)
    expect(header).toHaveTextContent(/Rooms\.AgentBadge/)
    expect(header).toHaveTextContent(/ConnectedAgents\.BelongsTo/)
  })

  test('with no owner name, "Belongs to" is left out rather than drawn with no name', () => {
    const { tree } = view({ ownerName: undefined })
    expect(tree.queryByText('ConnectedAgents.BelongsTo')).toBeNull()
    // control: the name and the tag are still there
    expect(tree.getByTestId(id('AgentChatHeader'))).toHaveTextContent(/Notes helper/)
  })

  test('the bubbles, mine and the agent’s, each with its time', () => {
    const { tree } = view()
    expect(tree.getAllByTestId(id('AgentChatBubble'))).toHaveLength(2)
    expect(tree.getByText('Summarise my notes.')).toBeTruthy()
    expect(tree.getByText('Here is a summary.')).toBeTruthy()
    expect(tree.getByText('10:38')).toBeTruthy()
    expect(tree.getByText('10:39')).toBeTruthy()
  })

  test('connected and waiting: no state line, and the composer takes text', () => {
    for (const state of ['connected', 'waiting'] as const) {
      const { tree } = view({ state })
      expect(tree.queryAllByTestId(id('AgentChatState'))).toEqual([])
      expect(tree.getByTestId(id('AgentChatInput')).props.editable).toBe(true)
    }
  })

  test('notConnected: "Not connected right now" under the header; the composer stays (frame 28)', () => {
    const { tree } = view({ state: 'notConnected' })
    expect(stateLines(tree)).toEqual(['ConnectedAgents.StatusUnreachable'])
    expect(tree.getByTestId(id('AgentChatInput')).props.editable).toBe(true)
  })

  test('stopped at 20: "Waiting for your session" above the composer, and the composer disabled (frame 28)', () => {
    const { tree, onSend } = view({ state: 'waiting', stopped: true })
    expect(stateLines(tree)).toEqual(['ConnectedAgents.ChatWaiting'])
    expect(tree.getByTestId(id('AgentChatInput')).props.editable).toBe(false)
    fireEvent.changeText(tree.getByTestId(id('AgentChatInput')), 'Hello?')
    fireEvent.press(tree.getByTestId(id('AgentChatSend')))
    expect(onSend).not.toHaveBeenCalled()
  })

  test('stopped and not connected: both lines, as frame 28 draws them', () => {
    const { tree } = view({ state: 'notConnected', stopped: true })
    expect(stateLines(tree)).toEqual(['ConnectedAgents.StatusUnreachable', 'ConnectedAgents.ChatWaiting'])
  })

  test('versionMismatch: its line in place of the composer', () => {
    const { tree } = view({ state: 'versionMismatch' })
    expect(stateLines(tree)).toEqual(['ConnectedAgents.VersionMismatch'])
    expect(tree.queryByTestId(id('AgentChatInput'))).toBeNull()
    expect(tree.queryByTestId(id('AgentChatSend'))).toBeNull()
  })

  test('send calls onSend with the text, trimmed, and clears the field', () => {
    const { tree, onSend } = view()
    fireEvent.changeText(tree.getByTestId(id('AgentChatInput')), '  Thanks.  ')
    fireEvent.press(tree.getByTestId(id('AgentChatSend')))
    expect(onSend).toHaveBeenCalledWith('Thanks.')
    expect(tree.getByTestId(id('AgentChatInput')).props.value).toBe('')
  })

  // control: a disabled send (nothing typed) sends nothing
  test('control: with nothing typed, send is disabled and sends nothing', () => {
    const { tree, onSend } = view()
    expect(tree.getByTestId(id('AgentChatSend')).props.accessibilityState).toEqual({ disabled: true })
    fireEvent.press(tree.getByTestId(id('AgentChatSend')))
    fireEvent.changeText(tree.getByTestId(id('AgentChatInput')), '   ')
    fireEvent.press(tree.getByTestId(id('AgentChatSend')))
    expect(onSend).not.toHaveBeenCalled()
  })

  test('Back is the view’s own', () => {
    const onBack = jest.fn()
    const { tree } = view({ onBack })
    fireEvent.press(tree.getByTestId(id('AgentChatBack')))
    expect(onBack).toHaveBeenCalled()
  })
})

describe('AgentChatScreen', () => {
  const screen = () => {
    const navigation = { goBack: jest.fn() }
    const tree = render(
      <BasicAppContext>
        <AgentChatScreen navigation={navigation} route={{ params: { agentId: 'did:key:z6MkNotes', name: 'Notes' } }} />
      </BasicAppContext>
    )
    return { tree, navigation }
  }
  beforeEach(() => {
    mockService = {}
    mockChat = {
      messages: [
        {
          eventId: 'e1',
          role: 'sent',
          text: 'Hello',
          at: '2026-11-27T10:38:00.000Z',
          reactions: [],
          unsupportedAttachment: false,
        },
        { eventId: 'e2', role: 'received', at: '2026-11-27T10:39:00.000Z', reactions: [], unsupportedAttachment: true },
      ],
      send: jest.fn(async () => ({ result: 'sent' as const, eventId: 'e3' })),
      state: 'notConnected',
      unanswered: 1,
      stopped: false,
      react: jest.fn(),
      removeReaction: jest.fn(),
      retry: jest.fn(),
    }
  })

  test('draws the view over useAgentChat: its messages, its state, its send', async () => {
    const { tree } = screen()
    expect(mockUseAgentChat).toHaveBeenCalledWith('did:key:z6MkNotes')
    expect(tree.getByText('Hello')).toBeTruthy()
    // A photo the agent sent, not carried in P0: said as a person's chat says it.
    expect(tree.getByText('Chat.UnsupportedAttachment')).toBeTruthy()
    expect(stateLines(tree)).toEqual(['ConnectedAgents.StatusUnreachable'])
    fireEvent.changeText(tree.getByTestId(id('AgentChatInput')), 'Are you there?')
    await act(async () => fireEvent.press(tree.getByTestId(id('AgentChatSend'))))
    expect(mockChat.send).toHaveBeenCalledWith('Are you there?')
  })

  test('with no chat service mounted, it goes back and draws nothing', () => {
    mockService = undefined
    const { tree, navigation } = screen()
    expect(tree.queryByTestId(id('AgentChat'))).toBeNull()
    expect(navigation.goBack).toHaveBeenCalled()
    expect(mockUseAgentChat).not.toHaveBeenCalled()
  })
})

describe('MessageStack registers the agent chat with the switch on only', () => {
  // The stack's screens, as it hands them to the navigator.
  const registered = () => {
    const tree = render(
      <BasicAppContext>
        <MessageStack />
      </BasicAppContext>
    )
    const routes: string[] = []
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return
      const props = (node as { props?: Record<string, unknown> }).props
      if (props && typeof props.name === 'string') routes.push(props.name)
      for (const child of (node as { children?: unknown[] }).children ?? []) walk(child)
    }
    walk(tree.UNSAFE_root)
    tree.unmount()
    return routes
  }

  // control: with the switch off, no agent route
  test('control: off, no AgentChat route', () => {
    expect(registered()).not.toContain(Screens.AgentChat)
  })

  test('on, the AgentChat route is there', () => {
    setAgentConnectEnabled(true)
    expect(registered()).toContain(Screens.AgentChat)
  })
})

describe('Messages: the agent rows (frames 26 and 29)', () => {
  const connection = (connectionId: string, label: string) =>
    new DidCommConnectionRecord({
      id: connectionId,
      createdAt: new Date(Date.UTC(2026, 10, 20, 10)),
      state: DidCommDidExchangeState.Completed,
      role: DidCommDidExchangeRole.Requester,
      theirLabel: label,
      connectionTypes: [] as DidCommConnectionType[],
    })
  const records = [connection('conn-ada', 'Ada'), connection('conn-bob', 'Bob')]
  // Ada wrote at 10:00, Bob at 08:00 on the 27th; the agents' last messages fall around them.
  const said = [
    { connectionId: 'conn-ada', createdAt: new Date('2026-11-27T10:00:00.000Z') },
    { connectionId: 'conn-bob', createdAt: new Date('2026-11-27T08:00:00.000Z') },
  ]
  const AGENTS: AgentMessageRow[] = [
    {
      agentId: 'did:key:z6MkNotes',
      name: 'Notes helper',
      lastText: 'Saved to Education.',
      lastAt: '2026-11-27T09:00:00.000Z',
    },
    { agentId: 'did:key:z6MkPlan', name: 'Planner', lastText: 'Done.', lastAt: '2026-11-27T11:00:00.000Z' },
    { agentId: 'did:key:z6MkNew', name: 'New agent' },
  ]

  const navigation = { setOptions: jest.fn(), navigate: jest.fn(), getParent: () => ({ navigate: jest.fn() }) }
  const list = () =>
    render(
      <StoreContext.Provider value={[testDefaultState, () => undefined]}>
        <BasicAppContext>
          <Messages navigation={navigation as never} />
        </BasicAppContext>
      </StoreContext.Provider>
    )
  /** The list's rows in order, people and agents: each row's kind. */
  const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  const ROWS = new RegExp(`^(${escaped(id('Contact'))}|${escaped(id('AgentContactCard'))})$`)
  const rowKinds = (tree: ReturnType<typeof render>) =>
    tree.queryAllByTestId(ROWS).map((row) => (row.props.testID === id('Contact') ? 'person' : 'agent'))

  beforeEach(() => {
    mockRoomRows = []
    mockAgentRows = AGENTS
    ;(useConnections as jest.Mock).mockReturnValue({ records, loading: false })
    ;(useBasicMessages as jest.Mock).mockImplementation(() => ({ records: said }))
  })

  // control: with the switch off, no agent row, whatever the hook would give
  test('control: off, no agent row, and the people as before', () => {
    const tree = list()
    expect(rowKinds(tree)).toEqual(['person', 'person'])
  })

  test('on, the agents are merged by time with the people; one with no message yet comes last', () => {
    setAgentConnectEnabled(true)
    const tree = list()
    // Planner (11:00), Ada (10:00), Notes helper (09:00), Bob (08:00), New agent (no message yet).
    expect(rowKinds(tree)).toEqual(['agent', 'person', 'agent', 'person', 'agent'])
    const cards = tree.getAllByTestId(id('AgentContactCard'))
    expect(cards[0]).toHaveTextContent(/Planner.*Done\./)
    expect(cards[1]).toHaveTextContent(/Notes helper.*Saved to Education\./)
    expect(cards[2]).toHaveTextContent(/New agent/)
  })

  test('an agent’s row opens its chat', () => {
    setAgentConnectEnabled(true)
    const tree = list()
    fireEvent.press(tree.getAllByTestId(id('AgentContactCard'))[0])
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.AgentChat, {
      agentId: 'did:key:z6MkPlan',
      name: 'Planner',
    })
  })

  test('a person’s row renders as before, with agents beside it', () => {
    const off = list()
    const before = off.getAllByTestId(id('Contact')).map((row) => JSON.stringify(row.props.accessibilityLabel))
    off.unmount()
    setAgentConnectEnabled(true)
    const on = list()
    expect(on.getAllByTestId(id('Contact')).map((row) => JSON.stringify(row.props.accessibilityLabel))).toEqual(before)
  })

  test('the agents show under People, and not under a community chip (frame 29)', () => {
    mockRoomRows = [{ key: 'r1', roomId: 'r1', roomName: 'Campus notes', communityDid: 'did:web:campus' }]
    setAgentConnectEnabled(true)
    const tree = list()
    fireEvent.press(tree.getByTestId(id('MessagesChipPeople')))
    expect(tree.queryAllByTestId(id('AgentContactCard'))).toHaveLength(3)
    fireEvent.press(tree.getByTestId(id('MessagesChipCommunity')))
    expect(tree.queryAllByTestId(id('AgentContactCard'))).toEqual([])
    expect(tree.getByTestId('room:r1')).toBeTruthy()
  })
})
