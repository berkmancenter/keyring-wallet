/**
 * The Messages list: one row per contact, as the Contacts list groups them, and never the mediator or a connection
 * not yet completed, developer mode or not. Before, each of a merged contact's connections was its own
 * conversation, and developer mode listed every connection, the mediator among them.
 */
import { useBasicMessages, useConnections } from '@bifold/react-hooks'
import {
  DidCommConnectionRecord,
  DidCommConnectionType,
  DidCommDidExchangeRole,
  DidCommDidExchangeState,
} from '@credo-ts/didcomm'
import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { StoreContext } from '../../src'
import Messages from '../../src/screens/Messages'
import { testIdWithKey } from '../../src/utils/testable'
import { testDefaultState } from '../contexts/store'
import { BasicAppContext } from '../helpers/app'

let mockLinks: Map<string, string> = new Map()
jest.mock('../../src/modules/vrc/contacts/useContactLinks', () => ({ useContactLinks: () => mockLinks }))
const mockRelationships = new Map([
  ['conn-a', 'did:bob:1'],
  ['conn-b', 'did:bob:2'],
  ['conn-c', 'did:bob:3'],
  ['conn-ada', 'did:ada:1'],
])
jest.mock('../../src/modules/vrc/contacts/useContactFacts', () => ({
  ...jest.requireActual('../../src/modules/vrc/contacts/useContactFacts'),
  useConnectionRelationships: () => mockRelationships,
}))
jest.mock('../../src/hooks/chat-messages', () => ({
  ...jest.requireActual('../../src/hooks/chat-messages'),
  useChatMessagesByConnection: () => [],
}))
let mockUnread: Record<string, number> = {}
jest.mock('../../src/hooks/useUnreadMessages', () => ({
  useUnreadMessages: () => ({ unreadByConnection: mockUnread, totalUnread: 0 }),
}))

const connection = (
  id: string,
  label: string,
  opts: { state?: DidCommDidExchangeState; mediator?: boolean; createdAt?: Date } = {}
) =>
  new DidCommConnectionRecord({
    id,
    createdAt: opts.createdAt ?? new Date(Date.UTC(2026, 9, 15, 10)),
    state: opts.state ?? DidCommDidExchangeState.Completed,
    role: DidCommDidExchangeRole.Requester,
    theirLabel: label,
    connectionTypes: opts.mediator ? [DidCommConnectionType.Mediator] : [],
  })

// Bob Backer's three exchanges, Ada, the mediator, and a connection still being made.
const records = [
  connection('conn-a', 'Bob Backer', { createdAt: new Date(Date.UTC(2026, 9, 15, 9)) }),
  connection('conn-b', 'Bob Backer', { createdAt: new Date(Date.UTC(2026, 9, 25, 19, 47)) }),
  connection('conn-c', 'Bob Backer', { createdAt: new Date(Date.UTC(2026, 9, 25, 19, 49)) }),
  connection('conn-ada', 'Ada'),
  connection('conn-mediator', 'My Mediator', { mediator: true }),
  connection('conn-pending', 'Someone', { state: DidCommDidExchangeState.RequestSent }),
]
const bobMerged = new Map([
  ['did:bob:2', 'did:bob:1'],
  ['did:bob:3', 'did:bob:1'],
])

// The screen's navigation: a row opens its chat through the parent navigator.
const navigate = jest.fn()
const navigation = { setOptions: jest.fn(), navigate: jest.fn(), getParent: () => ({ navigate }) }

const list = (developerModeEnabled: boolean) => {
  const state = { ...testDefaultState, preferences: { ...testDefaultState.preferences, developerModeEnabled } }
  return render(
    <StoreContext.Provider value={[state, () => undefined]}>
      <BasicAppContext>
        <Messages navigation={navigation as never} />
      </BasicAppContext>
    </StoreContext.Provider>
  )
}
const rows = (tree: ReturnType<typeof render>) => tree.queryAllByTestId(testIdWithKey('Contact'))
// The connection each row opens, pressed in turn: names are not read in this test (the label is empty until they are).
const opened = (tree: ReturnType<typeof render>) => {
  return rows(tree).map((row) => {
    navigate.mockClear()
    fireEvent.press(row)
    return navigate.mock.calls[0]?.[1]?.params?.connectionId
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockLinks = new Map()
  mockUnread = {}
  ;(useConnections as jest.Mock).mockReturnValue({ records, loading: false })
  ;(useBasicMessages as jest.Mock).mockReturnValue({ records: [] })
})

describe('never infrastructure', () => {
  test.each([false, true])('no mediator and no unfinished connection (developer mode %s)', (developerMode) => {
    // Six connections, four of them people: nothing linked, so a row each.
    expect(opened(list(developerMode))).toEqual(['conn-a', 'conn-b', 'conn-c', 'conn-ada'])
  })
})

describe('one row per contact', () => {
  test('a merged contact is one row; separated, a row per exchange', () => {
    mockLinks = bobMerged
    expect(opened(list(false))).toEqual(['conn-c', 'conn-ada'])

    mockLinks = new Map()
    expect(opened(list(false))).toEqual(['conn-a', 'conn-b', 'conn-c', 'conn-ada'])
  })

  // A chat shows, and marks seen, only its own connection's messages: a row whose badge counts messages on an older
  // connection must open that one, or they could never be read.
  test("unread on an older connection: the row opens that one, where its badge's messages are", () => {
    mockLinks = bobMerged
    mockUnread = { 'conn-a': 2 }
    const tree = list(false)
    expect(tree.getAllByText('2')).toHaveLength(1)
    expect(opened(tree)[0]).toBe('conn-a')
  })

  test('once those are read, the row opens the newest conversation again', () => {
    mockLinks = bobMerged
    mockUnread = {}
    expect(opened(list(false))[0]).toBe('conn-c')
  })

  test('unread on two connections: the row opens the newer of them', () => {
    mockLinks = bobMerged
    mockUnread = { 'conn-a': 2, 'conn-b': 1 }
    expect(opened(list(false))[0]).toBe('conn-b')
  })

  test("unread on several of a contact's connections is summed on its row", () => {
    mockLinks = bobMerged
    mockUnread = { 'conn-a': 2, 'conn-b': 1, 'conn-ada': 4 }
    const tree = list(false)
    expect(tree.getByText('3')).toBeTruthy()
    expect(tree.getByText('4')).toBeTruthy()
  })
})
