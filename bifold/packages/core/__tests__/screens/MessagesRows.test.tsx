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
import { fireEvent, render, within } from '@testing-library/react-native'
import React from 'react'

import { StoreContext } from '../../src'
import {
  cancelChatDelete,
  resetPendingChatDeletes,
  scheduleChatDelete,
} from '../../src/modules/chat/pendingChatDeletes'
import Messages from '../../src/screens/Messages'
import { Screens, Stacks } from '../../src/types/navigators'
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

// Rooms in Messages (R1): the room rows and the offers card are the rooms module's (#787), stood in for here.
let mockRoomRows: Record<string, unknown>[] = []
let mockRoomsFailed = false
const mockReloadRooms = jest.fn()
jest.mock('../../src/modules/rooms/useRoomRows', () => ({
  useRoomRows: () => ({ rows: mockRoomRows, reload: mockReloadRooms, failed: mockRoomsFailed }),
}))
const mockOfferCard = jest.fn()
jest.mock('../../src/modules/rooms/components/RoomOfferCard', () => ({
  __esModule: true,
  default: (props: unknown) => {
    mockOfferCard(props)
    return null
  },
}))
jest.mock('../../src/modules/rooms/components/RoomMessageRow', () => {
  const { createElement } = jest.requireActual('react')
  const { Pressable } = jest.requireActual('react-native')
  return {
    __esModule: true,
    default: ({ row, onOpen }: { row: { roomId: string }; onOpen: (roomId: string) => void }) =>
      createElement(Pressable, { testID: `room:${row.roomId}`, onPress: () => onOpen(row.roomId) }),
  }
})

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
  mockRoomRows = []
  mockRoomsFailed = false
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

describe('deleting from the list (L4)', () => {
  afterEach(() => resetPendingChatDeletes())

  test('a chat being deleted leaves the list at once; Undo brings it back', () => {
    const deleteChat = jest.fn(async () => undefined)
    scheduleChatDelete({ key: 'conn-ada', connectionIds: ['conn-ada'], deleteChat })
    expect(opened(list(false))).not.toContain('conn-ada')
    cancelChatDelete('conn-ada')
    expect(opened(list(false))).toContain('conn-ada')
    expect(deleteChat).not.toHaveBeenCalled()
  })

  test('the rows swipe inside a gesture-handler root view (the app has none above the screen)', () => {
    const tree = list(false)
    expect(rows(tree).length).toBeGreaterThan(0)
    expect(
      within(tree.getByTestId(testIdWithKey('MessagesGestureRoot'))).queryAllByTestId(testIdWithKey('Contact'))
    ).toHaveLength(rows(tree).length)
  })

  test("a merged contact's row leaves whole while any of its connections is being deleted", () => {
    mockLinks = bobMerged
    scheduleChatDelete({ key: 'bob', connectionIds: ['conn-a', 'conn-b', 'conn-c'], deleteChat: async () => undefined })
    expect(opened(list(false))).toEqual(['conn-ada'])
  })
})

describe('search by name (L5)', () => {
  const type = (tree: ReturnType<typeof list>, text: string) =>
    fireEvent.changeText(tree.getByTestId(testIdWithKey('MessagesSearch')), text)

  test('narrows the list to the names that match, ignoring case and accents', () => {
    const tree = list(false)
    type(tree, 'ADA')
    expect(opened(tree)).toEqual(['conn-ada'])
    type(tree, 'bób')
    expect(opened(tree)).toEqual(['conn-c', 'conn-b', 'conn-a'])
  })

  test('no name matches: says so, not "no chats yet"; Clear brings every row back', () => {
    const tree = list(false)
    type(tree, 'xyz')
    expect(rows(tree)).toHaveLength(0)
    expect(tree.getByTestId(testIdWithKey('MessagesNoMatch'))).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('MessagesEmpty'))).toBeNull()
    fireEvent.press(tree.getByTestId(testIdWithKey('MessagesSearchClear')))
    expect(opened(tree)).toEqual(['conn-c', 'conn-b', 'conn-ada', 'conn-a'])
  })

  test('nothing to search before the first conversation', () => {
    mockSaid = []
    expect(list(false).queryByTestId(testIdWithKey('MessagesSearch'))).toBeNull()
  })
})

describe('rooms in Messages (R1)', () => {
  const LAB = 'did:webvh:lab'
  const VTC = 'did:webvh:vtc'
  const roomRow = (roomId: string, communityDid: string, communityName: string, at?: Date) => ({
    key: roomId,
    roomId,
    roomName: `Room ${roomId}`,
    nameFrom: 'name',
    communityDid,
    communityName,
    lastActivityAt: at,
    unread: 0,
  })
  // Newest first, around the people: Bob's latest two exchanges are 25 Oct, Ada and Bob's first 15 Oct.
  const threeRooms = () => [
    roomRow('r-new', LAB, 'Keyring Lab', new Date(Date.UTC(2026, 9, 26))),
    roomRow('r-mid', VTC, 'Test VTC', new Date(Date.UTC(2026, 9, 20))),
    roomRow('r-empty', LAB, 'Keyring Lab'),
  ]
  const order = (tree: ReturnType<typeof render>) =>
    tree
      .queryAllByTestId(/^room:|^com\.ariesbifold:id\/Contact$/)
      .map((node) => (String(node.props.testID).startsWith('room:') ? node.props.testID : 'person'))
  const chip = (tree: ReturnType<typeof render>, id: string, n = 0) =>
    tree.getAllByTestId(testIdWithKey(`MessagesChip${id}`))[n]
  const lastCard = () => mockOfferCard.mock.calls[mockOfferCard.mock.calls.length - 1]?.[0]

  test('people and rooms in one list, newest first; a room with nothing in it yet last', () => {
    mockRoomRows = threeRooms()
    expect(order(list(false))).toEqual([
      'room:r-new',
      'person',
      'person',
      'room:r-mid',
      'person',
      'person',
      'room:r-empty',
    ])
  })

  test('no rooms: no chips, and the list is the conversations alone', () => {
    const tree = list(false)
    expect(tree.queryByTestId(testIdWithKey('MessagesChips'))).toBeNull()
    expect(order(tree)).toEqual(['person', 'person', 'person', 'person'])
  })

  test('chips: People shows the conversations; a community only its rooms; All everything again', () => {
    mockRoomRows = threeRooms()
    const tree = list(false)
    fireEvent.press(chip(tree, 'People'))
    expect(order(tree)).toEqual(['person', 'person', 'person', 'person'])
    // Communities A to Z: Keyring Lab, then Test VTC.
    fireEvent.press(chip(tree, 'Community', 0))
    expect(order(tree)).toEqual(['room:r-new', 'room:r-empty'])
    expect(chip(tree, 'Community', 0).props.accessibilityState).toEqual({ selected: true })
    fireEvent.press(chip(tree, 'All'))
    expect(order(tree)).toHaveLength(7)
  })

  test('the offers card: every offer under All, a community’s under its chip, none under People', () => {
    mockRoomRows = threeRooms()
    const tree = list(false)
    expect(lastCard()).toMatchObject({ communityDid: undefined })
    fireEvent.press(chip(tree, 'Community', 1))
    expect(lastCard()).toMatchObject({ communityDid: VTC })
    mockOfferCard.mockClear()
    fireEvent.press(chip(tree, 'People'))
    expect(mockOfferCard).not.toHaveBeenCalled()
  })

  test('no rooms yet: no chips, but the offers card is there, for every offer (a first room arrives as one)', () => {
    const tree = list(false)
    expect(tree.queryByTestId(testIdWithKey('MessagesChips'))).toBeNull()
    expect(mockOfferCard).toHaveBeenCalled()
    expect(lastCard()).toMatchObject({ communityDid: undefined })
  })

  test('rooms that could not be read: said once, with Try again; the people and the rooms read before stay', () => {
    mockRoomRows = threeRooms()
    mockRoomsFailed = true
    const tree = list(false)
    expect(tree.getByTestId(testIdWithKey('MessagesRoomsFailed'))).toBeTruthy()
    expect(order(tree)).toHaveLength(7)
    fireEvent.press(tree.getByTestId(testIdWithKey('MessagesRoomsTryAgain')))
    expect(mockReloadRooms).toHaveBeenCalledTimes(1)
    // People shows no room, so nothing about rooms either.
    fireEvent.press(chip(tree, 'People'))
    expect(tree.queryByTestId(testIdWithKey('MessagesRoomsFailed'))).toBeNull()
  })

  test('rooms read fine: no failure line', () => {
    mockRoomRows = threeRooms()
    expect(list(false).queryByTestId(testIdWithKey('MessagesRoomsFailed'))).toBeNull()
  })

  test('search finds a room by its community’s name, within the chip; People never finds a room', () => {
    mockRoomRows = threeRooms()
    const tree = list(false)
    fireEvent.changeText(tree.getByTestId(testIdWithKey('MessagesSearch')), 'lab')
    expect(order(tree)).toEqual(['room:r-new', 'room:r-empty'])
    fireEvent.press(chip(tree, 'People'))
    expect(order(tree)).toEqual([])
    expect(tree.getByTestId(testIdWithKey('MessagesNoMatch'))).toBeTruthy()
  })

  test('a room opens here in Messages, so Back comes back to the list; an offer opens its screen here too', () => {
    mockRoomRows = threeRooms()
    const tree = list(false)
    fireEvent.press(tree.getByTestId('room:r-mid'))
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.Room, { roomId: 'r-mid' })
    lastCard().onOpen('offer-1')
    expect(navigation.navigate).toHaveBeenLastCalledWith(Screens.RoomOffer, { offerRef: 'offer-1' })
    // Not under My Agent any more (control: R1 opened them there).
    expect(navigation.navigate).not.toHaveBeenCalledWith(Stacks.TabStack, expect.anything())
  })

  test('a community chip whose last room has gone falls back to All', () => {
    mockRoomRows = threeRooms()
    const state = { ...testDefaultState }
    const ui = () => (
      <StoreContext.Provider value={[state, () => undefined]}>
        <BasicAppContext>
          <Messages navigation={navigation as never} />
        </BasicAppContext>
      </StoreContext.Provider>
    )
    const tree = render(ui())
    fireEvent.press(chip(tree, 'Community', 1))
    expect(order(tree)).toEqual(['room:r-mid'])
    mockRoomRows = threeRooms().filter((room) => room.communityDid !== VTC)
    tree.rerender(ui())
    expect(order(tree)).toEqual(['room:r-new', 'person', 'person', 'person', 'person', 'room:r-empty'])
  })
})
