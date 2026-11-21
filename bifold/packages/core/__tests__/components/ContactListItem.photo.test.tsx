/**
 * A chat in the Messages list shows the contact's photo from their contact card, as Contacts does; the connection's
 * own image only when their card has none; and nothing until what is known of them has been read.
 */
import { DidCommConnectionRecord, DidCommDidExchangeRole, DidCommDidExchangeState } from '@credo-ts/didcomm'
import { render } from '@testing-library/react-native'
import React from 'react'

import ContactListItem from '../../src/components/listItems/ContactListItem'
import type { ConnectionFacts } from '../../src/modules/vrc/contacts/useContactFacts'
import { testIdWithKey } from '../../src/utils/testable'
import navigationContext from '../contexts/navigation'
import { BasicAppContext } from '../helpers/app'

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon')
jest.mock('../../src/hooks/chat-messages', () => ({
  ...jest.requireActual('../../src/hooks/chat-messages'),
  useChatMessagesByConnection: () => [],
}))
jest.mock('../../src/hooks/connections', () => ({
  ...jest.requireActual('../../src/hooks/connections'),
  useConnectionDisplayName: () => 'Alice',
}))
const mockFacts = jest.fn<ConnectionFacts, [string | undefined]>()
jest.mock('../../src/modules/vrc/contacts/useContactFacts', () => ({
  ...jest.requireActual('../../src/modules/vrc/contacts/useContactFacts'),
  useConnectionFacts: (connectionId: string | undefined) => mockFacts(connectionId),
}))

const id = testIdWithKey
const connection = (imageUrl?: string) =>
  new DidCommConnectionRecord({
    id: 'conn-1',
    createdAt: new Date(2026, 9, 1),
    state: DidCommDidExchangeState.Completed,
    role: DidCommDidExchangeRole.Requester,
    theirDid: 'did:example:alice',
    theirLabel: 'Alice',
    imageUrl,
  })
const show = (contact: DidCommConnectionRecord) =>
  render(
    <BasicAppContext>
      <ContactListItem contact={contact} navigation={navigationContext as never} />
    </BasicAppContext>
  )

describe('a chat in the Messages list', () => {
  beforeEach(() => mockFacts.mockReset())

  test('shows the photo from their contact card, read for this connection', () => {
    mockFacts.mockReturnValue({ name: { known: true, value: 'Alice' }, photo: { known: true, value: 'data:x' } })
    const tree = show(connection('https://example.org/logo.png'))
    expect(mockFacts).toHaveBeenCalledWith('conn-1')
    expect(tree.getByTestId(id('ContactPhotoImage')).props.source).toEqual({ uri: 'data:x' })
  })

  test('their card has no photo: the connection’s own image, as before', () => {
    mockFacts.mockReturnValue({ name: { known: true, value: 'Alice' }, photo: { known: true, value: undefined } })
    const tree = show(connection('https://example.org/logo.png'))
    expect(tree.getByTestId(id('ContactPhotoLogo')).props.source).toEqual({ uri: 'https://example.org/logo.png' })
  })

  test('no picture of them: their initial, as before', () => {
    mockFacts.mockReturnValue({ name: { known: true, value: 'Alice' }, photo: { known: true, value: undefined } })
    expect(show(connection()).getByTestId(id('ContactPhotoInitial'))).toHaveTextContent('A')
  })

  test('not read yet: no initial flashing up before their photo', () => {
    mockFacts.mockReturnValue({ name: { known: false }, photo: { known: false } })
    const tree = show(connection())
    expect(tree.queryByTestId(id('ContactPhotoInitial'))).toBeNull()
    expect(tree.getByTestId(id('Contact'))).toBeTruthy()
  })
})
