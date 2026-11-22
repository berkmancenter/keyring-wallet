/**
 * The chat's title: the contact's photo beside their name, from what is known of this connection.
 */
import { render } from '@testing-library/react-native'
import React from 'react'

import ChatHeaderTitle from '../../../../src/modules/vrc/components/ChatHeaderTitle'
import type { ConnectionFacts } from '../../../../src/modules/vrc/contacts/useContactFacts'
import { testIdWithKey } from '../../../../src/utils/testable'
import { BasicAppContext } from '../../../helpers/app'

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon')
// The header's own title (it reads the navigation theme, which the shared navigation mock does not provide): its text.
jest.mock('@react-navigation/elements', () => {
  const { Text } = jest.requireActual('react-native')
  return { HeaderTitle: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text> }
})
const mockFacts = jest.fn<ConnectionFacts, [string | undefined]>()
jest.mock('../../../../src/modules/vrc/contacts/useContactFacts', () => ({
  ...jest.requireActual('../../../../src/modules/vrc/contacts/useContactFacts'),
  useConnectionFacts: (connectionId: string | undefined) => mockFacts(connectionId),
}))

describe('the chat’s title', () => {
  test('their photo beside their name', () => {
    mockFacts.mockReturnValue({ name: { known: true, value: 'Alice' }, photo: { known: true, value: 'data:x' } })
    const tree = render(
      <BasicAppContext>
        <ChatHeaderTitle connectionId="conn-1" label="Alice" />
      </BasicAppContext>
    )
    expect(mockFacts).toHaveBeenCalledWith('conn-1')
    expect(tree.getByTestId(testIdWithKey('ContactPhotoImage')).props.source).toEqual({ uri: 'data:x' })
    expect(tree.getByText('Alice')).toBeTruthy()
  })
})
