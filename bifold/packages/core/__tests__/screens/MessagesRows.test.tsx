/**
 * The Messages list: one row per contact, as the Contacts list groups them, conversations only (L3: a contact appears
 * once a message has been exchanged, newest first), and never the mediator, a witness service or a connection not
 * yet completed, developer mode or not. Before, each of a merged contact's connections was its own
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

// Bob Backer's three exchanges, Ada, the mediator, a witness service and a connection still being made.
const witness = connection('conn-witness', 'keyring-witness')
witness.metadata.set('witnessConnection', { witnessDid: 'did:example:witness' })
const records = [
  connection('conn-a', 'Bob Backer', { createdAt: new Date(Date.UTC(2026, 9, 15, 9)) }),
  connection('conn-b', 'Bob Backer', { createdAt: new Date(Date.UTC(2026, 9, 25, 19, 47)) }),
  connection('conn-c', 'Bob Backer', { createdAt: new Date(Date.UTC(2026, 9, 25, 19, 49)) }),
  connection('conn-ada', 'Ada'),
  connection('conn-mediator', 'My Mediator', { mediator: true }),
  connection('conn-pending', 'Someone', { state: DidCommDidExchangeState.RequestSent }),
  witness,
]
// A message on every connection, infrastructure included, at the time each was made: so the rows are conversations,
// newest first (Bob's latest exchange, Bob's earlier one, Ada, Bob's first), and what is left out is left out by
// rule, not for having nothing said.
const said = (connectionId: string) => ({
  connectionId,
  createdAt: records.find((r) => r.id === connectionId)?.createdAt ?? new Date(Date.UTC(2026, 9, 15, 10)),
})
let mockSaid: { connectionId: string; createdAt: Date }[] = []
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
  mockSaid = records.map((record) => said(record.id))
  ;(useBasicMessages as jest.Mock).mockImplementation(() => ({ records: mockSaid }))
})

// The tab's own name, in the app's language: no longer "Secure Connection Messaging", in English only.
test('the title is "Messages", in the app language', () => {
  list(false)
  expect(navigation.setOptions).toHaveBeenCalledWith(expect.objectContaining({ title: 'MessagesList.Title' }))
})

describe('never infrastructure', () => {
  test.each([false, true])('no mediator and no unfinished connection (developer mode %s)', (developerMode) => {
    // Seven connections, four of them people: nothing linked, so a row each, newest message first.
    expect(opened(list(developerMode))).toEqual(['conn-c', 'conn-b', 'conn-ada', 'conn-a'])
  })
})

describe('one row per contact', () => {
  test('a merged contact is one row; separated, a row per exchange', () => {
    mockLinks = bobMerged
    expect(opened(list(false))).toEqual(['conn-c', 'conn-ada'])

    mockLinks = new Map()
    expect(opened(list(false))).toEqual(['conn-c', 'conn-b', 'conn-ada', 'conn-a'])
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

describe('conversations only (L3)', () => {
  test('a contact with nothing said is not a row; once a message comes, it is, at the top', () => {
    mockSaid = [said('conn-a'), said('conn-b')]
    expect(opened(list(false))).toEqual(['conn-b', 'conn-a'])

    mockSaid = [...mockSaid, { connectionId: 'conn-ada', createdAt: new Date(Date.UTC(2026, 9, 26, 8)) }]
    expect(opened(list(false))).toEqual(['conn-ada', 'conn-b', 'conn-a'])
  })

  test('a chat cleared on this phone leaves the list until either side writes again', () => {
    mockSaid = mockSaid.filter((m) => m.connectionId !== 'conn-ada')
    expect(opened(list(false))).not.toContain('conn-ada')

    mockSaid = [...mockSaid, { connectionId: 'conn-ada', createdAt: new Date(Date.UTC(2026, 9, 27, 8)) }]
    expect(opened(list(false))[0]).toBe('conn-ada')
  })

  test('nothing said with anyone: the empty state, with New message and Add a contact', () => {
    mockSaid = []
    const tree = list(false)
    expect(rows(tree)).toHaveLength(0)
    expect(tree.getByTestId(testIdWithKey('MessagesEmpty'))).toBeTruthy()
    expect(tree.getByText('MessagesList.EmptyTitle')).toBeTruthy()
    fireEvent.press(tree.getByTestId(testIdWithKey('MessagesEmptyNewMessage')))
    expect(navigation.navigate).toHaveBeenCalledWith('New Message')
    fireEvent.press(tree.getByTestId(testIdWithKey('MessagesEmptyAddContact')))
    expect(navigate).toHaveBeenCalledWith('Connect Stack', expect.objectContaining({ screen: 'Scan' }))
  })

  test('with conversations there is no empty state', () => {
    expect(list(false).queryByTestId(testIdWithKey('MessagesEmpty'))).toBeNull()
  })

  test('New message is in the header too', () => {
    list(false)
    const options = navigation.setOptions.mock.calls.map(([o]) => o).find((o) => o.headerRight)
    const header = render(<BasicAppContext>{options.headerRight({})}</BasicAppContext>)
    fireEvent.press(header.getByTestId(testIdWithKey('MessagesNewMessage')))
    expect(navigation.navigate).toHaveBeenCalledWith('New Message')
  })
})
