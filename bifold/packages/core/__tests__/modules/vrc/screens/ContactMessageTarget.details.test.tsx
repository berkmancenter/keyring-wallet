/**
 * A contact's Message action opens the chat its Messages row opens: of the contact's connections holding unread
 * messages the newest, else the newest by activity (its newest message, or when it was made). Before, a merged
 * contact's Message opened the connection the screen happened to be opened from, while unread messages sat on another.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { container } from 'tsyringe'
import { useAgent, useBasicMessages, useConnections } from '@bifold/react-hooks'

import ContactDetails from '../../../../src/modules/vrc/screens/ContactDetails'
import { ContainerProvider } from '../../../../src/container-api'
import { MainContainer } from '../../../../src/container-impl'
import { useOpenIDCredentials } from '../../../../src/modules/openid/context/OpenIDCredentialRecordProvider'
import { CONTACT_LINK } from '../../../../src/modules/vrc/contacts/contactLinks'
import { testIdWithKey } from '../../../../src/utils/testable'
import { memoryGenericRecords } from '../fixtures/memoryGenericRecords'
import { ALICE_AGAIN, ALICE_FIRST, BOB, SEVERAL_RELATIONSHIPS } from '../fixtures/severalRelationships'

jest.mock('@bifold/react-hooks')
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon')
jest.mock('../../../../src/modules/openid/context/OpenIDCredentialRecordProvider')
const mockRelationships = new Map([
  ['conn-first', ALICE_FIRST.id],
  ['conn-again', ALICE_AGAIN.id],
  ['conn-bob', BOB.id],
])
jest.mock('../../../../src/modules/vrc/contacts/useContactFacts', () => ({
  ...jest.requireActual('../../../../src/modules/vrc/contacts/useContactFacts'),
  useConnectionRelationships: () => mockRelationships,
}))
let mockUnread: Record<string, number> = {}
jest.mock('../../../../src/hooks/useUnreadMessages', () => ({
  useUnreadMessages: () => ({ unreadByConnection: mockUnread, totalUnread: 0 }),
}))
let mockChatEvents = new Map<string, unknown[]>()
jest.mock('../../../../src/modules/chat/chatEventsStore', () => ({
  ...jest.requireActual('../../../../src/modules/chat/chatEventsStore'),
  useAllChatEvents: () => mockChatEvents,
}))

const mockUseAgent = useAgent as jest.MockedFunction<typeof useAgent>
const mockUseOpenIDCredentials = useOpenIDCredentials as jest.MockedFunction<typeof useOpenIDCredentials>

const Container: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ContainerProvider value={new MainContainer(container.createChildContainer()).init()}>{children}</ContainerProvider>
)

// Alice's first exchange was made in January, the second in March; Bob's is someone else's chat.
const connections = [
  { id: 'conn-first', createdAt: new Date('2026-01-05T10:00:00.000Z') },
  { id: 'conn-again', createdAt: new Date('2026-03-05T10:00:00.000Z') },
  { id: 'conn-bob', createdAt: new Date('2026-10-01T10:00:00.000Z') },
]
const merged = {
  id: 'link-1',
  content: { issuerDid: ALICE_AGAIN.id, contactId: ALICE_FIRST.id, confirmation: 'user' },
  tags: { recordType: CONTACT_LINK, issuerDid: ALICE_AGAIN.id, contactId: ALICE_FIRST.id, confirmation: 'user' },
}

const navigate = jest.fn()
let store: ReturnType<typeof memoryGenericRecords>
const open = (issuer: { id: string; name: string }) =>
  render(
    <ContactDetails
      route={{ params: { contact: { issuer } } } as any}
      navigation={{ getParent: () => ({ navigate }), pop: jest.fn() } as any}
    />,
    { wrapper: Container }
  )
/**
 * The connection the Message action opens, once the screen has read its links. Each merged case expects a connection
 * other than the opened relationship's own, so it can only pass once the merge has been read.
 */
const messageOpens = async (tree: ReturnType<typeof open>, expected: string) => {
  await waitFor(() => {
    navigate.mockClear()
    fireEvent.press(tree.getByTestId(testIdWithKey('ContactViewMessages')))
    expect(navigate.mock.calls[0]?.[1]).toEqual({ connectionId: expected })
  })
}

describe("a contact's Message action", () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => null)
    navigate.mockClear()
    mockUnread = {}
    mockChatEvents = new Map()
    store = memoryGenericRecords()
    ;(useConnections as jest.Mock).mockReturnValue({ records: connections, loading: false })
    ;(useBasicMessages as jest.Mock).mockReturnValue({ records: [] })
    mockUseAgent.mockReturnValue({
      agent: {
        config: { logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
        dependencyManager: {
          resolve: () => ({
            findByCounterpartyRelationshipDid: async (_context: unknown, did: string) =>
              ({ [ALICE_AGAIN.id]: { connectionId: 'conn-again' }, [ALICE_FIRST.id]: { connectionId: 'conn-first' } })[
                did
              ] ?? null,
          }),
        },
        genericRecords: store,
      },
    } as any)
    mockUseOpenIDCredentials.mockReturnValue({ openIdState: { w3cCredentialRecords: SEVERAL_RELATIONSHIPS } } as any)
  })
  afterEach(() => jest.restoreAllMocks())

  test('merged, nothing written yet: the newest-made connection, as its Messages row opens', async () => {
    store.records.push(merged)
    await messageOpens(open(ALICE_FIRST), 'conn-again')
  })

  test('merged, unread on the older connection: that one, where the messages are', async () => {
    store.records.push(merged)
    mockUnread = { 'conn-first': 2, 'conn-bob': 5 }
    await messageOpens(open(ALICE_AGAIN), 'conn-first')
  })

  test('merged, a newer message on the older connection: that one', async () => {
    store.records.push(merged)
    ;(useBasicMessages as jest.Mock).mockReturnValue({
      records: [{ connectionId: 'conn-first', createdAt: new Date('2026-04-01T10:00:00.000Z') }],
    })
    await messageOpens(open(ALICE_AGAIN), 'conn-first')
  })

  test('merged, a newer chat message on the older connection counts; a reaction does not', async () => {
    store.records.push(merged)
    mockChatEvents = new Map([['conn-first', [{ eventType: 'reaction', sentTime: '2026-05-01T10:00:00.000Z' }]]])
    // Opened from the first exchange: the second is reached only through the merge, so this waits for the links.
    const tree = open(ALICE_FIRST)
    await messageOpens(tree, 'conn-again')
    tree.unmount()

    mockChatEvents = new Map([['conn-first', [{ eventType: 'message', sentTime: '2026-05-01T10:00:00.000Z' }]]])
    await messageOpens(open(ALICE_AGAIN), 'conn-first')
  })

  test('not merged: its own connection, whatever waits on its namesake', async () => {
    mockUnread = { 'conn-again': 3 }
    await messageOpens(open(ALICE_FIRST), 'conn-first')
  })
})
