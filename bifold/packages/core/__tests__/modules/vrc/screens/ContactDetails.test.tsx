import { W3cCredentialRecord } from '@credo-ts/core'
import { render, waitFor, fireEvent } from '@testing-library/react-native'
import React from 'react'
import { container } from 'tsyringe'
import { useAgent } from '@bifold/react-hooks'

import ContactDetails from '../../../../src/modules/vrc/screens/ContactDetails'
import { TEST_CONTACTS, generateTestDid } from '../fixtures/dtg-credentials'
import { ContactCredentialDetails } from '../../../../src/types/navigators'
import { useOpenIDCredentials } from '../../../../src/modules/openid/context/OpenIDCredentialRecordProvider'
import { WITNESS_VERIFIED_TAG } from '../../../../src/modules/vrc/utils/witnessCredentialUtils'
import { testIdWithKey } from '../../../../src/utils/testable'
import { ContainerProvider } from '../../../../src/container-api'
import { MainContainer } from '../../../../src/container-impl'
import { StoreProvider, defaultReducer } from '../../../../src/contexts/store'
import { testDefaultState } from '../../../contexts/store'
import { buildRCardTemplate } from '../../../../src/modules/vrc/types/rcard'

// ContactDetails resolves TOKENS.COMPONENT_CONTACT_DETAILS_FOOTER via
// useServices, so every render needs a real container in context — the same
// MainContainer-with-defaults pattern other screen tests use (e.g.
// __tests__/screens/PINCreate.test.tsx), wrapped once here since every test
// in this file renders the same screen.
const TestContainerWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const main = new MainContainer(container.createChildContainer()).init()
  return <ContainerProvider value={main}>{children}</ContainerProvider>
}

/** A minimal VWC naming `subjectId` — same lightweight shape used in
 * witnessCredentialUtils.test.ts and ListContacts.test.tsx, since the code
 * under test only ever reads `.encoded`. `witnessContext: {}` (no
 * `localityConfirmed` at all) represents a witness that never offered
 * locality — the three-state 'not-offered' case. */
/**
 * A VWC naming `subjectId`.
 *
 * `verified` is what the ceremony paths mark a credential with once they have
 * checked it (WITNESS_VERIFIED_TAG); the screen shows witness and locality
 * information for marked records only. It defaults to true here because these
 * tests are about a genuine witnessed exchange — pass false for a record the
 * wallet holds but never verified, which must earn nothing.
 */
function createLocalityVwc(
  subjectId: string,
  witnessContext: Record<string, unknown>,
  verified = true
): W3cCredentialRecord {
  return {
    id: 'credential-locality-vwc',
    getTags: () => (verified ? { [WITNESS_VERIFIED_TAG]: 'true' } : {}),
    encoded: {
      type: ['VerifiableCredential', 'WitnessCredential'],
      issuer: 'did:example:witness',
      credentialSubject: { id: subjectId, witnessContext },
    },
  } as unknown as W3cCredentialRecord
}

// Mock dependencies
jest.mock('@bifold/react-hooks')
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon')
jest.mock('../../../../src/modules/openid/context/OpenIDCredentialRecordProvider')

const mockUseAgent = useAgent as jest.MockedFunction<typeof useAgent>
const mockUseOpenIDCredentials = useOpenIDCredentials as jest.MockedFunction<typeof useOpenIDCredentials>
const mockNavigate = jest.fn()
const mockGoBack = jest.fn()
const mockGetParent = jest.fn(() => ({
  navigate: mockNavigate,
}))

// Mock navigation
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    getParent: mockGetParent,
  }),
}))

describe('ContactDetails Screen', () => {
  const mockAgent: any = {
    config: { logger: { info: jest.fn(), error: jest.fn() } },
    dependencyManager: {
      resolve: jest.fn(),
    },
  }

  const mockRepository = {
    findByCounterpartyRelationshipDid: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockUseAgent.mockReturnValue({ agent: mockAgent } as any)
    mockAgent.dependencyManager.resolve.mockReturnValue(mockRepository)
    mockUseOpenIDCredentials.mockReturnValue({
      openIdState: { w3cCredentialRecords: [] },
    } as any)
  })

  const createRouteParams = (contact: ContactCredentialDetails) => ({
    route: {
      params: { contact },
    } as any,
    navigation: { navigate: mockNavigate, goBack: mockGoBack, getParent: mockGetParent } as any,
  })

  // Wraps ContactDetails with a StoreProvider seeded with the given live
  // profiles, so useRCardCredential()'s live lookup has something to resolve
  // against — plain TestContainerWrapper falls back to an empty profile list.
  const renderWithProfiles = (contact: ContactCredentialDetails, profiles: ReturnType<typeof buildRCardTemplate>[]) =>
    render(<ContactDetails {...createRouteParams(contact)} />, {
      wrapper: ({ children }) => (
        <StoreProvider
          initialState={{
            ...testDefaultState,
            rCard: { profiles, activeProfileId: profiles[0]?.id, lastSyncedAt: new Date().toISOString() },
          }}
          reducer={defaultReducer}
        >
          <TestContainerWrapper>{children}</TestContainerWrapper>
        </StoreProvider>
      ),
    })

  test('Renders contact details correctly', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)

    const contact: ContactCredentialDetails = {
      issuer: TEST_CONTACTS.alice.issuer,
    }

    const { findByText, queryByText, findByTestId } = render(<ContactDetails {...createRouteParams(contact)} />, {
      wrapper: TestContainerWrapper,
    })

    await waitFor(async () => {
      // Should display issuer name
      expect(await findByText('Alice Smith')).toBeTruthy()
    })
    // The relationship DID is kept behind Details (#12), and shown once opened.
    expect(queryByText(TEST_CONTACTS.alice.issuer.id)).toBeNull()
    fireEvent.press(await findByTestId(testIdWithKey('ContactRelationshipToggle')))
    expect(await findByText(TEST_CONTACTS.alice.issuer.id)).toBeTruthy()
  })

  test('Displays the contact photo when provided', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)

    const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkI'
    const contact: ContactCredentialDetails = {
      issuer: { ...TEST_CONTACTS.alice.issuer, photo },
    }

    const { findByTestId } = render(<ContactDetails {...createRouteParams(contact)} />, {
      wrapper: TestContainerWrapper,
    })

    await waitFor(async () => {
      const image = await findByTestId(testIdWithKey('ContactAvatarImage'))
      expect(image.props.source).toEqual({ uri: photo })
    })
  })

  test('Falls back to the generic icon when there is no photo', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)

    // Stated explicitly rather than leaning on the fixture happening to have
    // no photo — the seeded contacts all carry one.
    const contact: ContactCredentialDetails = {
      issuer: { ...TEST_CONTACTS.alice.issuer, photo: undefined },
    }

    const { findByText, queryByTestId } = render(<ContactDetails {...createRouteParams(contact)} />, {
      wrapper: TestContainerWrapper,
    })

    await waitFor(async () => {
      expect(await findByText('Alice Smith')).toBeTruthy()
      expect(queryByTestId(testIdWithKey('ContactAvatarImage'))).toBeNull()
    })
  })

  test('Shows View Messages button when connection exists', async () => {
    const connectionId = 'test-connection-123'
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue({
      connectionId,
      myRelationshipDid: generateTestDid('myrel'),
      counterpartyRelationshipDid: generateTestDid('theirrel'),
    })

    const contact: ContactCredentialDetails = {
      issuer: TEST_CONTACTS.alice.issuer,
    }

    const { findByText } = render(<ContactDetails {...createRouteParams(contact)} />, { wrapper: TestContainerWrapper })

    await waitFor(async () => {
      expect(await findByText('ContactDetails.QuickMessage')).toBeTruthy()
    })
  })

  // Upgrading a relationship in place: offered on a contact with a connection,
  // and the layers it has so far, from the records on this phone.
  test('offers adding to the relationship when a connection exists, and lists its layers', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue({
      connectionId: 'test-connection-123',
      myRelationshipDid: generateTestDid('myrel'),
      counterpartyRelationshipDid: generateTestDid('theirrel'),
    })
    mockUseOpenIDCredentials.mockReturnValue({
      openIdState: {
        w3cCredentialRecords: [
          {
            encoded: {
              '@context': ['https://www.w3.org/ns/credentials/v2'],
              type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
              issuer: TEST_CONTACTS.alice.issuer.id,
              validFrom: '2026-10-01T00:00:00Z',
              credentialSubject: { id: generateTestDid('myrel') },
            },
          },
        ],
      },
    } as any)
    const contact: ContactCredentialDetails = { issuer: TEST_CONTACTS.alice.issuer }
    const { findByTestId, getByTestId } = render(<ContactDetails {...createRouteParams(contact)} />, {
      wrapper: TestContainerWrapper,
    })
    expect(await findByTestId(testIdWithKey('RelationshipUpgrade'))).toBeTruthy()
    expect(getByTestId(testIdWithKey('RelationshipUpgradeResign'))).toBeTruthy()
    expect(getByTestId(testIdWithKey('RelationshipLayers'))).toHaveTextContent(/Relationship\.DayCards/)
  })

  // Without a connection nothing can be added to: the actions are shown disabled, with why, never hidden.
  test('without a connection, the actions are shown disabled and say why', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)
    const contact: ContactCredentialDetails = { issuer: TEST_CONTACTS.alice.issuer }
    const { findByText, getByTestId } = render(<ContactDetails {...createRouteParams(contact)} />, {
      wrapper: TestContainerWrapper,
    })
    expect(await findByText('Alice Smith')).toBeTruthy()
    expect(getByTestId(testIdWithKey('RelationshipUpgradeResign')).props.accessibilityState?.disabled).toBe(true)
    expect(getByTestId(testIdWithKey('RelationshipUpgradeWitness')).props.accessibilityState?.disabled).toBe(true)
    expect(await findByText('Relationship.NoRelationship')).toBeTruthy()
  })

  test('Disables View Messages button when no connection exists', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)

    const contact: ContactCredentialDetails = {
      issuer: TEST_CONTACTS.alice.issuer,
    }

    const { getByLabelText } = render(<ContactDetails {...createRouteParams(contact)} />, {
      wrapper: TestContainerWrapper,
    })

    await waitFor(() => {
      const button = getByLabelText('ContactDetails.QuickMessage')
      expect(button).toBeTruthy()
      expect(button.props.accessibilityState?.disabled).toBe(true)
    })
  })

  test('Disables View Messages button when connection has no connectionId', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue({
      connectionId: undefined,
      myRelationshipDid: generateTestDid('myrel'),
      counterpartyRelationshipDid: generateTestDid('theirrel'),
    })

    const contact: ContactCredentialDetails = {
      issuer: TEST_CONTACTS.alice.issuer,
    }

    const { getByLabelText } = render(<ContactDetails {...createRouteParams(contact)} />, {
      wrapper: TestContainerWrapper,
    })

    await waitFor(() => {
      const button = getByLabelText('ContactDetails.QuickMessage')
      expect(button).toBeTruthy()
      expect(button.props.accessibilityState?.disabled).toBe(true)
    })
  })

  test('View Messages button navigates to Chat screen', async () => {
    const connectionId = 'test-connection-123'
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue({
      connectionId,
      myRelationshipDid: generateTestDid('myrel'),
      counterpartyRelationshipDid: generateTestDid('theirrel'),
    })

    const contact: ContactCredentialDetails = {
      issuer: TEST_CONTACTS.alice.issuer,
    }

    const { findByText } = render(<ContactDetails {...createRouteParams(contact)} />, { wrapper: TestContainerWrapper })

    await waitFor(async () => {
      const viewMessagesButton = await findByText('ContactDetails.QuickMessage')
      fireEvent.press(viewMessagesButton)

      expect(mockNavigate).toHaveBeenCalledWith('Chat', { connectionId })
    })
  })

  test('Throws error when route params are missing', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => {
      render(<ContactDetails route={undefined as any} navigation={undefined as any} />, {
        wrapper: TestContainerWrapper,
      })
    }).toThrow('ContactDetails route params were not set properly')

    consoleError.mockRestore()
  })

  test('Handles repository lookup errors gracefully', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockRejectedValue(new Error('Repository error'))

    const contact: ContactCredentialDetails = {
      issuer: TEST_CONTACTS.alice.issuer,
    }

    const { getByLabelText } = render(<ContactDetails {...createRouteParams(contact)} />, {
      wrapper: TestContainerWrapper,
    })

    await waitFor(() => {
      // Button should be visible but disabled after error
      const button = getByLabelText('ContactDetails.QuickMessage')
      expect(button).toBeTruthy()
      expect(button.props.accessibilityState?.disabled).toBe(true)
    })
  })

  test('DID is selectable for copying', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)

    const contact: ContactCredentialDetails = {
      issuer: TEST_CONTACTS.bob.issuer,
    }

    const { getByText, findByTestId } = render(<ContactDetails {...createRouteParams(contact)} />, {
      wrapper: TestContainerWrapper,
    })

    fireEvent.press(await findByTestId(testIdWithKey('ContactRelationshipToggle')))
    await waitFor(() => {
      const didElement = getByText(TEST_CONTACTS.bob.issuer.id)
      expect(didElement.props.selectable).toBe(true)
    })
  })

  test('Displays email when available', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)

    const contact: ContactCredentialDetails = {
      issuer: TEST_CONTACTS.alice.issuer,
    }

    const { findByText } = render(<ContactDetails {...createRouteParams(contact)} />, { wrapper: TestContainerWrapper })

    await waitFor(async () => {
      // Should display email label
      expect(await findByText('ContactDetails.Email')).toBeTruthy()
      // Should display email value
      expect(await findByText('alice@example.com')).toBeTruthy()
    })
  })

  test('Displays organization when available', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)

    const contact: ContactCredentialDetails = {
      issuer: TEST_CONTACTS.alice.issuer,
    }

    const { findByText } = render(<ContactDetails {...createRouteParams(contact)} />, { wrapper: TestContainerWrapper })

    await waitFor(async () => {
      // The organisation shows under the name, without a label
      expect(await findByText('Tech Corp')).toBeTruthy()
    })
  })

  test('Does not display email section when email is not available', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)

    const contact: ContactCredentialDetails = {
      issuer: TEST_CONTACTS.charlie.issuer, // charlie has organization but no email
    }

    const { queryByText, findByText } = render(<ContactDetails {...createRouteParams(contact)} />, {
      wrapper: TestContainerWrapper,
    })

    await waitFor(async () => {
      // Should display name
      expect(await findByText('Charlie Wilson')).toBeTruthy()
      // Should display organization
      expect(await findByText('Wilson Industries')).toBeTruthy()
      // Should NOT display email (charlie doesn't have email)
      expect(queryByText('ContactDetails.Email')).toBeNull()
    })
  })

  test('Does not display organization section when organization is not available', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)

    const contact: ContactCredentialDetails = {
      issuer: TEST_CONTACTS.bob.issuer, // bob has email but no organization
    }

    const { queryByText, findByText } = render(<ContactDetails {...createRouteParams(contact)} />, {
      wrapper: TestContainerWrapper,
    })

    await waitFor(async () => {
      // Should display name
      expect(await findByText('Bob Jones')).toBeTruthy()
      // Should display email
      expect(await findByText('bob@example.org')).toBeTruthy()
      // Should NOT display an organisation (bob doesn't have one): only the name, the email and the actions' words
      expect(queryByText(/Tech Corp|Wilson Industries/)).toBeNull()
    })
  })

  test('Does not display email or organization when neither is available', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)

    const contact: ContactCredentialDetails = {
      issuer: TEST_CONTACTS.diana.issuer, // diana has neither email nor organization
    }

    const { queryByText, findByText } = render(<ContactDetails {...createRouteParams(contact)} />, {
      wrapper: TestContainerWrapper,
    })

    await waitFor(async () => {
      // Should display name
      expect(await findByText('Diana Martinez')).toBeTruthy()
      // The DID is behind Details (#12)
      expect(queryByText(TEST_CONTACTS.diana.issuer.id)).toBeNull()
      // Should NOT display email or organization sections
      expect(queryByText('ContactDetails.Email')).toBeNull()
      expect(queryByText(/Tech Corp|Wilson Industries/)).toBeNull()
    })
  })

  test('Displays different contacts correctly', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)

    const contacts = [TEST_CONTACTS.alice, TEST_CONTACTS.bob, TEST_CONTACTS.charlie]

    for (const testContact of contacts) {
      const contact: ContactCredentialDetails = {
        issuer: testContact.issuer,
      }

      const { findByText, unmount } = render(<ContactDetails {...createRouteParams(contact)} />, {
        wrapper: TestContainerWrapper,
      })

      await waitFor(async () => {
        expect(await findByText(testContact.issuer.name)).toBeTruthy()
      })

      unmount()
    }
  })

  test('Repository is called with correct issuer DID', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)

    const contact: ContactCredentialDetails = {
      issuer: TEST_CONTACTS.diana.issuer,
    }

    render(<ContactDetails {...createRouteParams(contact)} />, { wrapper: TestContainerWrapper })

    await waitFor(() => {
      expect(mockRepository.findByCounterpartyRelationshipDid).toHaveBeenCalledWith(
        mockAgent.context,
        TEST_CONTACTS.diana.issuer.id
      )
    })
  })

  test('Does not attempt repository lookup when agent is undefined', async () => {
    mockUseAgent.mockReturnValue({ agent: undefined } as any)

    const contact: ContactCredentialDetails = {
      issuer: TEST_CONTACTS.alice.issuer,
    }

    const { getByLabelText } = render(<ContactDetails {...createRouteParams(contact)} />, {
      wrapper: TestContainerWrapper,
    })

    await waitFor(() => {
      expect(mockRepository.findByCounterpartyRelationshipDid).not.toHaveBeenCalled()
      // Button should be visible but disabled when agent is undefined
      const button = getByLabelText('ContactDetails.QuickMessage')
      expect(button).toBeTruthy()
      expect(button.props.accessibilityState?.disabled).toBe(true)
    })
  })

  test('View Messages button has correct accessibility labels', async () => {
    const connectionId = 'test-connection-123'
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue({
      connectionId,
      myRelationshipDid: generateTestDid('myrel'),
      counterpartyRelationshipDid: generateTestDid('theirrel'),
    })

    const contact: ContactCredentialDetails = {
      issuer: TEST_CONTACTS.alice.issuer,
    }

    const { getByLabelText } = render(<ContactDetails {...createRouteParams(contact)} />, {
      wrapper: TestContainerWrapper,
    })

    await waitFor(() => {
      const button = getByLabelText('ContactDetails.QuickMessage')
      expect(button.props.accessibilityRole).toBe('button')
    })
  })

  describe('locality confirmation', () => {
    // The witness record's lines are in its day's sheet (How you know them), opened with a tap.
    const openDay = (tree: { getAllByTestId: (id: string) => unknown[] }) =>
      fireEvent.press(tree.getAllByTestId(testIdWithKey('RelationshipLayer'))[0] as never)

    test('shows the In-Person badge and a Confirmed record line for a confirmed-locality VWC', async () => {
      mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)
      const vwc = createLocalityVwc(TEST_CONTACTS.alice.issuer.id, {
        localityConfirmed: true,
        localityMethod: 'ble-challenge-response/0.1',
        localityVenue: 'ATL, Room 2',
      })
      mockUseOpenIDCredentials.mockReturnValue({
        openIdState: { w3cCredentialRecords: [vwc] },
      } as any)

      const contact: ContactCredentialDetails = { issuer: TEST_CONTACTS.alice.issuer }
      const tree = render(<ContactDetails {...createRouteParams(contact)} />, {
        wrapper: TestContainerWrapper,
      })

      await waitFor(async () => {
        expect(await tree.findByTestId('LocalityConfirmedBadge')).toBeTruthy()
        expect(await tree.findByText('ContactDetails.BadgeInPerson')).toBeTruthy()
      })
      openDay(tree)
      expect(tree.getByText('Relationship.DayLocationConfirmed · ATL, Room 2')).toBeTruthy()
    })

    test('does not show the badge, and shows a Declined record line, when the holder declined locality', async () => {
      mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)
      const vwc = createLocalityVwc(TEST_CONTACTS.alice.issuer.id, {
        localityConfirmed: false,
        localityMethod: 'none',
        localityReason: 'declinedByHolder',
      })
      mockUseOpenIDCredentials.mockReturnValue({
        openIdState: { w3cCredentialRecords: [vwc] },
      } as any)

      const contact: ContactCredentialDetails = { issuer: TEST_CONTACTS.alice.issuer }
      const tree = render(<ContactDetails {...createRouteParams(contact)} />, {
        wrapper: TestContainerWrapper,
      })

      await tree.findByTestId(testIdWithKey('RelationshipLayer'))
      expect(tree.queryByTestId('LocalityConfirmedBadge')).toBeNull()
      openDay(tree)
      expect(tree.getByText('Relationship.DayLocationDeclined')).toBeTruthy()
    })

    test('shows an Interrupted record line when the ceremony window was lost, not Declined', async () => {
      mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)
      const vwc = createLocalityVwc(TEST_CONTACTS.alice.issuer.id, {
        localityConfirmed: false,
        localityMethod: 'none',
        localityReason: 'windowLost',
      })
      mockUseOpenIDCredentials.mockReturnValue({
        openIdState: { w3cCredentialRecords: [vwc] },
      } as any)

      const contact: ContactCredentialDetails = { issuer: TEST_CONTACTS.alice.issuer }
      const tree = render(<ContactDetails {...createRouteParams(contact)} />, {
        wrapper: TestContainerWrapper,
      })

      await tree.findByTestId(testIdWithKey('RelationshipLayer'))
      openDay(tree)
      expect(tree.getByText('Relationship.DayLocationInterrupted')).toBeTruthy()
      expect(tree.queryByText('Relationship.DayLocationDeclined')).toBeNull()
    })

    test('shows neither the badge nor a record line for a witness that never offered locality', async () => {
      mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)
      const vwc = createLocalityVwc(TEST_CONTACTS.alice.issuer.id, {})
      mockUseOpenIDCredentials.mockReturnValue({
        openIdState: { w3cCredentialRecords: [vwc] },
      } as any)

      const contact: ContactCredentialDetails = { issuer: TEST_CONTACTS.alice.issuer }
      const tree = render(<ContactDetails {...createRouteParams(contact)} />, {
        wrapper: TestContainerWrapper,
      })

      // Still shows the Witnessed badge and section (a VWC exists), just no locality-specific indicator anywhere.
      expect(await tree.findByText('ContactDetails.BadgeVerified')).toBeTruthy()
      expect(tree.getByTestId('WitnessSection')).toBeTruthy()
      expect(tree.queryByTestId('LocalityConfirmedBadge')).toBeNull()
      // Its day's sheet has the witness's record (a positive control), and no location check line.
      openDay(tree)
      expect(tree.getByTestId('WitnessRecord')).toBeTruthy()
      expect(tree.queryByText('Relationship.DayLocationCheck')).toBeNull()
    })
  })

  describe('only a witness credential this device verified earns the marks', () => {
    const confirmed = {
      localityConfirmed: true,
      localityMethod: 'ble-challenge-response/0.1',
      localityVenue: 'ATL, Room 2',
    }
    const renderWith = (vwc: W3cCredentialRecord) => {
      mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)
      mockUseOpenIDCredentials.mockReturnValue({
        openIdState: { w3cCredentialRecords: [vwc] },
      } as any)
      const contact: ContactCredentialDetails = { issuer: TEST_CONTACTS.alice.issuer }
      return render(<ContactDetails {...createRouteParams(contact)} />, { wrapper: TestContainerWrapper })
    }

    test('shows neither the Witnessed nor the In-Person badge for a credential the wallet never verified', async () => {
      // A peer-supplied record claiming a confirmed in-person exchange, without the ceremony's verified mark.
      const { findByText, queryByTestId, queryByText } = renderWith(
        createLocalityVwc(TEST_CONTACTS.alice.issuer.id, confirmed, false)
      )

      await waitFor(async () => {
        expect(await findByText('Alice Smith')).toBeTruthy()
        expect(queryByTestId('WitnessedBadge')).toBeNull()
        expect(queryByTestId('LocalityConfirmedBadge')).toBeNull()
        expect(queryByText('ContactDetails.BadgeInPerson')).toBeNull()
        expect(queryByText('Confirmed — ATL, Room 2')).toBeNull()
      })
    })

    test('shows both badges for the same credential once the ceremony verified it', async () => {
      const { findByTestId } = renderWith(createLocalityVwc(TEST_CONTACTS.alice.issuer.id, confirmed, true))

      await waitFor(async () => {
        expect(await findByTestId('WitnessedBadge')).toBeTruthy()
        expect(await findByTestId('LocalityConfirmedBadge')).toBeTruthy()
      })
    })
  })

  describe('linked profile display', () => {
    test('shows the live profile name and photo, in a card, when sharedProfileId still resolves to an existing profile', async () => {
      const photo =
        'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkI'
      const workProfile = buildRCardTemplate(
        { firstName: 'Jane', lastName: 'Doe', email: '', organization: '', photo },
        { label: 'Work' }
      )
      mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue({
        sharedProfileId: workProfile.id,
        sharedProfileLabel: 'Work (renamed since)',
      })

      const contact: ContactCredentialDetails = { issuer: TEST_CONTACTS.alice.issuer }
      const { findByText, findByTestId } = renderWithProfiles(contact, [workProfile])

      await waitFor(async () => {
        expect(await findByText('ContactDetails.LinkedProfile')).toBeTruthy()
        // Live label wins over the share-time snapshot.
        expect(await findByText('Work')).toBeTruthy()
        const avatar = await findByTestId(testIdWithKey('LinkedProfileAvatarImage'))
        expect(avatar.props.source).toEqual({ uri: photo })
        expect(await findByTestId('LinkedProfileCard')).toBeTruthy()
      })
    })

    // The default profile's name is stored as data ("My Profile"): shown in the app's language, never as stored.
    test('a profile still under its default name shows the default name in the app language', async () => {
      const profile = buildRCardTemplate({ firstName: 'Jane', lastName: 'Doe', email: '', organization: '' })
      expect(profile.label).toBe('My Profile')
      mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue({ sharedProfileId: profile.id })

      const contact: ContactCredentialDetails = { issuer: TEST_CONTACTS.alice.issuer }
      const { findByText, queryByText } = renderWithProfiles(contact, [profile])

      expect(await findByText('MyProfiles.DefaultLabel')).toBeTruthy()
      expect(queryByText('My Profile')).toBeNull()
    })

    test('falls back to the share-time label snapshot, with no photo, when the linked profile no longer exists', async () => {
      mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue({
        sharedProfileId: 'urn:uuid:deleted-profile',
        sharedProfileLabel: 'Old Work Profile',
      })

      const contact: ContactCredentialDetails = { issuer: TEST_CONTACTS.alice.issuer }
      const { findByText, queryByTestId } = renderWithProfiles(contact, [])

      await waitFor(async () => {
        expect(await findByText('ContactDetails.LinkedProfile')).toBeTruthy()
        expect(await findByText('ContactDetails.LinkedProfileDeleted')).toBeTruthy()
        expect(queryByTestId(testIdWithKey('LinkedProfileAvatarImage'))).toBeNull()
      })
    })

    test('does not show the Linked Profile card when no profile was ever recorded as shared', async () => {
      mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)

      const contact: ContactCredentialDetails = { issuer: TEST_CONTACTS.alice.issuer }
      const { findByText, queryByText, queryByTestId } = renderWithProfiles(contact, [])

      await waitFor(async () => {
        expect(await findByText('Alice Smith')).toBeTruthy()
        expect(queryByText('ContactDetails.LinkedProfile')).toBeNull()
        expect(queryByTestId('LinkedProfileCard')).toBeNull()
      })
    })
  })
})
