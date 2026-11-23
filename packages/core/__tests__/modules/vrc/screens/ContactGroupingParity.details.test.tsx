/**
 * Contact details resolved by contact id must look exactly as they did by issuer while nothing is linked. The
 * snapshots were recorded against the screen as it was before contact ids, from a store with several relationships
 * per person and no link records; the grouped screen must reproduce them.
 *
 * One deliberate change since: the two Alice relationships share a name, so each now carries the "Same person?"
 * merge offer (ContactMergeSection). Their snapshots gained that section and nothing else; Bob's is as recorded.
 *
 * Recorded with "Confirm it's you" off, which was how it shipped. It ships on now and adds a Safety section to the
 * page, so it is turned off here: this file is about how relationships are grouped, and the Safety section has its own
 * rows (ContactDetails.test.tsx).
 */
import { render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { container } from 'tsyringe'
import { useAgent } from '@bifold/react-hooks'

import ContactDetails from '../../../../src/modules/vrc/screens/ContactDetails'
import { ContainerProvider } from '../../../../src/container-api'
import { MainContainer } from '../../../../src/container-impl'
import { useOpenIDCredentials } from '../../../../src/modules/openid/context/OpenIDCredentialRecordProvider'
import { setConfirmItsYouEnabled } from '../../../../src/modules/trust-tasks/module/confirmItsYouFlag'
import { ContactCredentialDetails } from '../../../../src/types/navigators'
import { ALICE_AGAIN, ALICE_FIRST, BOB, SEVERAL_RELATIONSHIPS } from '../fixtures/severalRelationships'

jest.mock('@bifold/react-hooks')
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon')
jest.mock('../../../../src/modules/openid/context/OpenIDCredentialRecordProvider')
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), getParent: jest.fn() }),
}))

const mockUseAgent = useAgent as jest.MockedFunction<typeof useAgent>
const mockUseOpenIDCredentials = useOpenIDCredentials as jest.MockedFunction<typeof useOpenIDCredentials>

const Container: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ContainerProvider value={new MainContainer(container.createChildContainer()).init()}>{children}</ContainerProvider>
)

beforeEach(() => {
  setConfirmItsYouEnabled(false)
  jest.spyOn(console, 'log').mockImplementation(() => null)
  mockUseAgent.mockReturnValue({
    agent: {
      config: { logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
      dependencyManager: { resolve: () => ({ findByCounterpartyRelationshipDid: async () => null }) },
      genericRecords: { findAllByQuery: async () => [] },
    },
  } as any)
  mockUseOpenIDCredentials.mockReturnValue({ openIdState: { w3cCredentialRecords: SEVERAL_RELATIONSHIPS } } as any)
})
afterEach(() => jest.restoreAllMocks())

test.each([
  ['the second Alice relationship', ALICE_AGAIN],
  ['the first Alice relationship', ALICE_FIRST],
  ['Bob, witnessed', BOB],
])('contact details, nothing linked: %s', async (_label, issuer) => {
  const contact: ContactCredentialDetails = { issuer }
  const tree = render(<ContactDetails route={{ params: { contact } } as any} navigation={{} as any} />, {
    wrapper: Container,
  })
  await waitFor(() => expect(tree.getByText(issuer.name)).toBeTruthy())
  expect(tree.toJSON()).toMatchSnapshot()
})
