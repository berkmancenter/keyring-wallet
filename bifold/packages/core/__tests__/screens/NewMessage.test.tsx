/**
 * New message (L3): pick a contact to write to. People only (never the mediator, a witness service or an unfinished
 * connection), one row per contact as the other lists group them, by the name the app shows, A to Z. A tap opens the
 * chat its Messages row would open, and the picker closes behind it.
 */
import { useConnections } from '@bifold/react-hooks'
import {
  DidCommConnectionRecord,
  DidCommConnectionType,
  DidCommDidExchangeRole,
  DidCommDidExchangeState,
} from '@credo-ts/didcomm'
import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { StoreContext } from '../../src'
import NewMessage from '../../src/screens/NewMessage'
import { testIdWithKey } from '../../src/utils/testable'
import { testDefaultState } from '../contexts/store'
import { BasicAppContext } from '../helpers/app'

let mockLinks: Map<string, string> = new Map()
jest.mock('../../src/modules/vrc/contacts/useContactLinks', () => ({ useContactLinks: () => mockLinks }))
const mockRelationships = new Map([
  ['conn-a', 'did:bob:1'],
  ['conn-b', 'did:bob:2'],
  ['conn-ada', 'did:ada:1'],
  ['conn-zoe', 'did:zoe:1'],
])
jest.mock('../../src/modules/vrc/contacts/useContactFacts', () => ({
  ...jest.requireActual('../../src/modules/vrc/contacts/useContactFacts'),
  useConnectionRelationships: () => mockRelationships,
}))
// Zoe's card gives her a name of her own (the cached VRC issuer name), which a rename on this phone still beats.
jest.mock('../../src/modules/vrc/context/VrcNameCacheProvider', () => ({
  ...jest.requireActual('../../src/modules/vrc/context/VrcNameCacheProvider'),
  useVrcNameCache: () => ({ getVrcName: (id?: string) => (id === 'conn-zoe' ? 'Zoe Card' : undefined) }),
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
const witness = connection('conn-witness', 'keyring-witness')
witness.metadata.set('witnessConnection', { witnessDid: 'did:example:witness' })
// Zoe first and Bob's two exchanges apart, so the order on screen is the picker's own.
const records = [
  connection('conn-zoe', 'Zoe'),
  connection('conn-a', 'Bob Backer', { createdAt: new Date(Date.UTC(2026, 9, 15, 9)) }),
  connection('conn-ada', 'ada'),
  connection('conn-b', 'Bob Backer', { createdAt: new Date(Date.UTC(2026, 9, 25, 19)) }),
  connection('conn-mediator', 'My Mediator', { mediator: true }),
  connection('conn-pending', 'Someone', { state: DidCommDidExchangeState.RequestSent }),
  witness,
]

const parentNavigate = jest.fn()
const navigation = { goBack: jest.fn(), navigate: jest.fn(), getParent: () => ({ navigate: parentNavigate }) }
const picker = (alternateContactNames: Record<string, string> = {}) => {
  const state = { ...testDefaultState, preferences: { ...testDefaultState.preferences, alternateContactNames } }
  return render(
    <StoreContext.Provider value={[state, () => undefined]}>
      <BasicAppContext>
        <NewMessage navigation={navigation as never} />
      </BasicAppContext>
    </StoreContext.Provider>
  )
}
const names = (tree: ReturnType<typeof picker>) =>
  tree.queryAllByTestId(testIdWithKey('NewMessageContact')).map((row) => row.props.accessibilityLabel)

beforeEach(() => {
  jest.clearAllMocks()
  mockLinks = new Map([['did:bob:2', 'did:bob:1']])
  mockUnread = {}
  ;(useConnections as jest.Mock).mockReturnValue({ records, loading: false })
})

test('people only, a merged contact once, A to Z whatever the case, by the name on their card', () => {
  expect(names(picker())).toEqual(['ada', 'Bob Backer', 'Zoe Card'])
})

test('by the name the app shows: a rename on this phone beats the name on their card', () => {
  expect(names(picker({ 'conn-zoe': 'Aaron' }))).toEqual(['Aaron', 'ada', 'Bob Backer'])
})

test('a tap opens the chat its Messages row would (the exchange with unread messages first), and the picker closes', () => {
  mockUnread = { 'conn-a': 1 }
  const tree = picker()
  fireEvent.press(tree.getAllByTestId(testIdWithKey('NewMessageContact'))[1])
  expect(navigation.goBack).toHaveBeenCalledTimes(1)
  expect(parentNavigate).toHaveBeenCalledWith('Contacts Stack', { screen: 'Chat', params: { connectionId: 'conn-a' } })
})

test('nobody to write to: says so, and offers to add a contact', () => {
  ;(useConnections as jest.Mock).mockReturnValue({ records: [records[4], records[5], witness], loading: false })
  const tree = picker()
  expect(names(tree)).toEqual([])
  expect(tree.getByText('MessagesList.PickerEmpty')).toBeTruthy()
  fireEvent.press(tree.getByTestId(testIdWithKey('NewMessageAddContact')))
  expect(parentNavigate).toHaveBeenCalledWith('Connect Stack', expect.objectContaining({ screen: 'Scan' }))
})
