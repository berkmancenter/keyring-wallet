/**
 * A contact's screen covers every relationship linked to it: the cards of all of them, newest first, while the DID it
 * shows (and messages, upgrade, removal) stay on the relationship the row opened. Unlinked, the same store shows that
 * relationship's cards only, which is the positive control.
 *
 * Evidence only while it is red against the screens before contact grouping: the linked cases fail with the
 * ContactDetails and relationshipLayers of b71dce9a (this change's first commit, screens unmodified) and pass after.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { container } from 'tsyringe'
import { useAgent } from '@bifold/react-hooks'

import ContactDetails from '../../../../src/modules/vrc/screens/ContactDetails'
import { ContainerProvider } from '../../../../src/container-api'
import { MainContainer } from '../../../../src/container-impl'
import { useOpenIDCredentials } from '../../../../src/modules/openid/context/OpenIDCredentialRecordProvider'
import { testIdWithKey } from '../../../../src/utils/testable'
import { verifyVrcHardwareEvidence } from '../../../../src/modules/vrc/services/BiometricSignatureVerifier'
import { getVrcCredentialJsonForSubject } from '../../../../src/modules/vrc/utils/witnessCredentialUtils'
import { ALICE_AGAIN, ALICE_FIRST, SEVERAL_RELATIONSHIPS } from '../fixtures/severalRelationships'

jest.mock('@bifold/react-hooks')
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon')
jest.mock('../../../../src/modules/openid/context/OpenIDCredentialRecordProvider')
jest.mock('../../../../src/modules/vrc/services/BiometricSignatureVerifier', () => ({
  verifyVrcHardwareEvidence: jest.fn(async () => ({ valid: false })),
}))
jest.mock('../../../../src/modules/vrc/utils/witnessCredentialUtils', () => {
  const actual = jest.requireActual('../../../../src/modules/vrc/utils/witnessCredentialUtils')
  return { ...actual, getVrcCredentialJsonForSubject: jest.fn(actual.getVrcCredentialJsonForSubject) }
})
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), getParent: jest.fn() }),
}))

const mockUseAgent = useAgent as jest.MockedFunction<typeof useAgent>
const mockUseOpenIDCredentials = useOpenIDCredentials as jest.MockedFunction<typeof useOpenIDCredentials>

const Container: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ContainerProvider value={new MainContainer(container.createChildContainer()).init()}>{children}</ContainerProvider>
)

const findRelationship = jest.fn(async () => null)
const withLinks = (links: { issuerDid: string; contactId: string }[]) =>
  mockUseAgent.mockReturnValue({
    agent: {
      config: { logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
      dependencyManager: { resolve: () => ({ findByCounterpartyRelationshipDid: findRelationship }) },
      genericRecords: { findAllByQuery: async () => links.map((content) => ({ content })) },
    },
  } as any)

const openAliceAgain = () =>
  render(<ContactDetails route={{ params: { contact: { issuer: ALICE_AGAIN } } } as any} navigation={{} as any} />, {
    wrapper: Container,
  })

describe("a contact's screen grouped by contact", () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => null)
    findRelationship.mockClear()
    mockUseOpenIDCredentials.mockReturnValue({ openIdState: { w3cCredentialRecords: SEVERAL_RELATIONSHIPS } } as any)
  })
  afterEach(() => jest.restoreAllMocks())

  test('unlinked: the one card of this relationship', async () => {
    withLinks([])
    const tree = openAliceAgain()
    await waitFor(() => expect(tree.getAllByTestId(testIdWithKey('RelationshipLayer'))).toHaveLength(1))
  })

  test('linked: the cards of both relationships, and the DID and connection of the one the row opened', async () => {
    withLinks([{ issuerDid: ALICE_AGAIN.id, contactId: ALICE_FIRST.id }])
    const tree = openAliceAgain()
    await waitFor(() => expect(tree.getAllByTestId(testIdWithKey('RelationshipLayer'))).toHaveLength(3))
    fireEvent.press(tree.getByTestId(testIdWithKey('ContactRelationshipToggle')))
    expect(tree.getByText(ALICE_AGAIN.id)).toBeTruthy()
    expect(tree.queryByText(ALICE_FIRST.id)).toBeNull()
    expect(findRelationship).toHaveBeenCalledWith(undefined, ALICE_AGAIN.id)
    expect(findRelationship).not.toHaveBeenCalledWith(undefined, ALICE_FIRST.id)
  })

  test("linked: a relationship whose check throws doesn't hide the Secure Exchange of another", async () => {
    withLinks([{ issuerDid: ALICE_AGAIN.id, contactId: ALICE_FIRST.id }])
    // Both relationships carry hardware evidence; the opened one's check throws, the older one's verifies.
    ;(getVrcCredentialJsonForSubject as jest.Mock).mockImplementation((_records: unknown, issuerDid: string) => ({
      issuer: issuerDid,
    }))
    ;(verifyVrcHardwareEvidence as jest.Mock).mockImplementation(async (raw: { issuer: string }) => {
      if (raw.issuer === ALICE_AGAIN.id) throw new Error('evidence unreadable')
      return { valid: true }
    })
    const tree = openAliceAgain()
    expect(await tree.findByTestId('SecureExchangeBadge')).toBeTruthy()
    expect(verifyVrcHardwareEvidence).toHaveBeenCalledWith({ issuer: ALICE_FIRST.id })
  })
})
