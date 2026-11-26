/**
 * The Contacts list grouped by contact id must look exactly as it did grouped by issuer while nothing is linked.
 * The snapshot was recorded against the list as it was before contact ids, from a store with several relationships
 * per person and no link records; the grouped list must reproduce it.
 */
import { render, waitFor } from '@testing-library/react-native'
import React from 'react'

import ListContacts from '../../../../src/modules/vrc/screens/ListContacts'
import { useOpenIDCredentials } from '../../../../src/modules/openid/context/OpenIDCredentialRecordProvider'
import { BasicAppContext } from '../../../helpers/app'
import { SEVERAL_RELATIONSHIPS } from '../fixtures/severalRelationships'

// eslint-disable-next-line @typescript-eslint/no-empty-function
jest.mock('react-native-localize', () => {})
jest.useFakeTimers({ legacyFakeTimers: true })
jest.mock('../../../../src/modules/openid/context/OpenIDCredentialRecordProvider', () => ({
  ...jest.requireActual('../../../../src/modules/openid/context/OpenIDCredentialRecordProvider'),
  useOpenIDCredentials: jest.fn(),
}))

const mockUseOpenIDCredentials = useOpenIDCredentials as jest.MockedFunction<typeof useOpenIDCredentials>

test('the Contacts list, several relationships per person, nothing linked', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => null)
  mockUseOpenIDCredentials.mockReturnValue({ openIdState: { w3cCredentialRecords: SEVERAL_RELATIONSHIPS } } as any)
  const tree = render(
    <BasicAppContext>
      <ListContacts />
    </BasicAppContext>
  )
  await waitFor(() => expect(tree.getAllByText('Alice Smith')).toHaveLength(2))
  expect(tree.getByText('Bob Jones')).toBeTruthy()
  expect(tree.toJSON()).toMatchSnapshot()
})
