import { fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'

import { useNavigation as testUseNavigation } from '../../../../__mocks__/@react-navigation/native'
import ListContacts from '../../../../src/modules/vrc/screens/ListContacts'
import { BasicAppContext } from '../../../helpers/app'
import { useOpenIDCredentials } from '../../../../src/modules/openid/context/OpenIDCredentialRecordProvider'
import {
  createDTGCredential,
  createCredentialsFromSameIssuer,
  createTestCredentialsForHolder,
  TEST_CONTACTS,
  generateTestDid,
} from '../fixtures/dtg-credentials'

// eslint-disable-next-line @typescript-eslint/no-empty-function
jest.mock('react-native-localize', () => {})
jest.useFakeTimers({ legacyFakeTimers: true })

// Mock the OpenID credentials hook
jest.mock('../../../../src/modules/openid/context/OpenIDCredentialRecordProvider', () => ({
  ...jest.requireActual('../../../../src/modules/openid/context/OpenIDCredentialRecordProvider'),
  useOpenIDCredentials: jest.fn(),
}))

// Mock the witness connection hook
jest.mock('../../../../src/modules/vrc/context/WitnessConnectionProvider', () => ({
  ...jest.requireActual('../../../../src/modules/vrc/context/WitnessConnectionProvider'),
  useWitnessConnection: jest.fn().mockReturnValue({
    connectedWitness: null,
    connectToWitness: jest.fn(),
    disconnectWitness: jest.fn(),
    isWitnessConnected: jest.fn().mockReturnValue(false),
    isLocalityVerified: jest.fn().mockReturnValue(false),
    checkWitnessLocalityFresh: jest.fn().mockResolvedValue({ available: false }),
    verifyLocality: jest.fn(),
    setActiveSession: jest.fn(),
    clearActiveSession: jest.fn(),
    getState: jest.fn().mockReturnValue({}),
    validateWitnessConnection: jest.fn().mockResolvedValue(true),
  }),
}))

const mockUseOpenIDCredentials = useOpenIDCredentials as jest.MockedFunction<typeof useOpenIDCredentials>

const navigation = testUseNavigation()

describe('ListContacts Screen', () => {
  const holderDid = generateTestDid('holder')

  beforeEach(() => {
    jest.clearAllTimers()
    jest.clearAllMocks()

    // Default mock implementation
    mockUseOpenIDCredentials.mockReturnValue({
      openIdState: {
        w3cCredentialRecords: [],
        sdJwtVcRecords: [],
        mdocVcRecords: [],
        openIDCredentialRecords: [],
        isLoading: false,
      },
      getW3CCredentialById: jest.fn(),
      getSdJwtCredentialById: jest.fn(),
      getMdocCredentialById: jest.fn(),
      storeCredential: jest.fn(),
      removeCredential: jest.fn(),
      resolveBundleForCredential: jest.fn(),
    } as any)
  })

  test('Renders correctly with no contacts', async () => {
    const tree = render(
      <BasicAppContext>
        <ListContacts />
      </BasicAppContext>
    )

    await waitFor(() => {
      expect(tree.getByText('Contacts.EmptyList')).toBeTruthy()
    })
  })

  test('Displays contacts from DTG credentials', async () => {
    const credentials = createTestCredentialsForHolder(holderDid, [
      { issuer: TEST_CONTACTS.alice.issuer },
      { issuer: TEST_CONTACTS.bob.issuer },
      { issuer: TEST_CONTACTS.charlie.issuer },
    ])

    mockUseOpenIDCredentials.mockReturnValue({
      openIdState: {
        w3cCredentialRecords: credentials,
        sdJwtVcRecords: [],
        mdocVcRecords: [],
        openIDCredentialRecords: [],
        isLoading: false,
      },
      getW3CCredentialById: jest.fn(),
      getSdJwtCredentialById: jest.fn(),
      getMdocCredentialById: jest.fn(),
      storeCredential: jest.fn(),
      removeCredential: jest.fn(),
      resolveBundleForCredential: jest.fn(),
    } as any)

    const { findByText } = render(
      <BasicAppContext>
        <ListContacts />
      </BasicAppContext>
    )

    await waitFor(async () => {
      expect(await findByText('Alice Smith')).toBeTruthy()
      expect(await findByText('Bob Jones')).toBeTruthy()
      expect(await findByText('Charlie Wilson')).toBeTruthy()
    })
  })

  test('Groups multiple credentials from same issuer', async () => {
    // Create 3 credentials from Alice at different times
    const aliceCredentials = createCredentialsFromSameIssuer(
      TEST_CONTACTS.alice.issuer,
      holderDid,
      3,
      new Date('2024-01-01')
    )
    const bobCredential = createDTGCredential({
      issuer: TEST_CONTACTS.bob.issuer,
      credentialSubject: { id: holderDid },
    })

    const credentials = [...aliceCredentials, bobCredential]

    mockUseOpenIDCredentials.mockReturnValue({
      openIdState: {
        w3cCredentialRecords: credentials,
        sdJwtVcRecords: [],
        mdocVcRecords: [],
        openIDCredentialRecords: [],
        isLoading: false,
      },
      getW3CCredentialById: jest.fn(),
      getSdJwtCredentialById: jest.fn(),
      getMdocCredentialById: jest.fn(),
      storeCredential: jest.fn(),
      removeCredential: jest.fn(),
      resolveBundleForCredential: jest.fn(),
    } as any)

    const { queryAllByText, findByText } = render(
      <BasicAppContext>
        <ListContacts />
      </BasicAppContext>
    )

    await waitFor(async () => {
      // Alice should appear only once despite having 3 credentials
      const aliceElements = queryAllByText('Alice Smith')
      expect(aliceElements).toHaveLength(1)

      // Bob should also appear once
      expect(await findByText('Bob Jones')).toBeTruthy()
    })
  })

  test('Sorts contacts alphabetically', async () => {
    const credentials = createTestCredentialsForHolder(holderDid, [
      { issuer: TEST_CONTACTS.charlie.issuer },
      { issuer: TEST_CONTACTS.alice.issuer },
      { issuer: TEST_CONTACTS.diana.issuer },
      { issuer: TEST_CONTACTS.bob.issuer },
    ])

    mockUseOpenIDCredentials.mockReturnValue({
      openIdState: {
        w3cCredentialRecords: credentials,
        sdJwtVcRecords: [],
        mdocVcRecords: [],
        openIDCredentialRecords: [],
        isLoading: false,
      },
      getW3CCredentialById: jest.fn(),
      getSdJwtCredentialById: jest.fn(),
      getMdocCredentialById: jest.fn(),
      storeCredential: jest.fn(),
      removeCredential: jest.fn(),
      resolveBundleForCredential: jest.fn(),
    } as any)

    const { getAllByRole } = render(
      <BasicAppContext>
        <ListContacts />
      </BasicAppContext>
    )

    await waitFor(() => {
      const buttons = getAllByRole('button')
      // Filter out witness banner button (if present) - it has "witness" in accessibility label
      const contactButtons = buttons.filter(
        (btn) => btn.props.accessibilityLabel && !btn.props.accessibilityLabel.toLowerCase().includes('witness')
      )
      // Check that contacts are in alphabetical order
      expect(contactButtons[0].props.accessibilityLabel).toContain('Alice Smith')
      expect(contactButtons[1].props.accessibilityLabel).toContain('Bob Jones')
      expect(contactButtons[2].props.accessibilityLabel).toContain('Charlie Wilson')
      expect(contactButtons[3].props.accessibilityLabel).toContain('Diana Martinez')
    })
  })

  test('Pressing on a contact navigates to contact details screen', async () => {
    const credentials = createTestCredentialsForHolder(holderDid, [{ issuer: TEST_CONTACTS.alice.issuer }])

    mockUseOpenIDCredentials.mockReturnValue({
      openIdState: {
        w3cCredentialRecords: credentials,
        sdJwtVcRecords: [],
        mdocVcRecords: [],
        openIDCredentialRecords: [],
        isLoading: false,
      },
      getW3CCredentialById: jest.fn(),
      getSdJwtCredentialById: jest.fn(),
      getMdocCredentialById: jest.fn(),
      storeCredential: jest.fn(),
      removeCredential: jest.fn(),
      resolveBundleForCredential: jest.fn(),
    } as any)

    const { findByText } = render(
      <BasicAppContext>
        <ListContacts />
      </BasicAppContext>
    )

    await waitFor(async () => {
      const contactElement = await findByText('Alice Smith')
      fireEvent(contactElement, 'press')

      expect(navigation.navigate).toBeCalledWith('Contact Details', {
        contact: expect.objectContaining({
          issuer: expect.objectContaining({
            id: TEST_CONTACTS.alice.issuer.id,
            name: TEST_CONTACTS.alice.issuer.name,
            email: TEST_CONTACTS.alice.issuer.email,
            organization: TEST_CONTACTS.alice.issuer.organization,
          }),
        }),
      })
    })
  })

  test('Displays unknown issuer format when name is missing', async () => {
    const unknownIssuerDid = generateTestDid('unknown')
    const credential = createDTGCredential({
      issuer: {
        id: unknownIssuerDid,
        name: '', // Empty name
      },
      credentialSubject: { id: holderDid },
    })

    mockUseOpenIDCredentials.mockReturnValue({
      openIdState: {
        w3cCredentialRecords: [credential],
        sdJwtVcRecords: [],
        mdocVcRecords: [],
        openIDCredentialRecords: [],
        isLoading: false,
      },
      getW3CCredentialById: jest.fn(),
      getSdJwtCredentialById: jest.fn(),
      getMdocCredentialById: jest.fn(),
      storeCredential: jest.fn(),
      removeCredential: jest.fn(),
      resolveBundleForCredential: jest.fn(),
    } as any)

    const { findByText } = render(
      <BasicAppContext>
        <ListContacts />
      </BasicAppContext>
    )

    await waitFor(async () => {
      // Should show "Unknown" with last 8 characters of DID
      const last8 = unknownIssuerDid.slice(-8)
      expect(await findByText(`Unknown ...${last8}`)).toBeTruthy()
    })
  })

  test('Filters out non-DTG credentials', async () => {
    const dtgCredential = createDTGCredential({
      issuer: TEST_CONTACTS.alice.issuer,
      credentialSubject: { id: holderDid },
    })

    // Create a non-DTG credential (without DTGCredential in type)
    const nonDtgCredential = createDTGCredential({
      issuer: TEST_CONTACTS.bob.issuer,
      credentialSubject: { id: holderDid },
    })
    // Modify the type array to remove DTGCredential
    ;(nonDtgCredential.credential as any).type = ['VerifiableCredential']

    mockUseOpenIDCredentials.mockReturnValue({
      openIdState: {
        w3cCredentialRecords: [dtgCredential, nonDtgCredential],
        sdJwtVcRecords: [],
        mdocVcRecords: [],
        openIDCredentialRecords: [],
        isLoading: false,
      },
      getW3CCredentialById: jest.fn(),
      getSdJwtCredentialById: jest.fn(),
      getMdocCredentialById: jest.fn(),
      storeCredential: jest.fn(),
      removeCredential: jest.fn(),
      resolveBundleForCredential: jest.fn(),
    } as any)

    const { queryByText, findByText } = render(
      <BasicAppContext>
        <ListContacts />
      </BasicAppContext>
    )

    await waitFor(async () => {
      // Alice (DTG) should appear
      expect(await findByText('Alice Smith')).toBeTruthy()

      // Bob (non-DTG) should not appear
      expect(queryByText('Bob Jones')).toBeNull()
    })
  })

  test('Uses most recent credential data for contact display', async () => {
    // Create credentials with different dates
    const olderCredential = createDTGCredential({
      issuer: {
        id: TEST_CONTACTS.alice.issuer.id,
        name: 'Old Name',
      },
      credentialSubject: { id: holderDid },
      validFrom: '2024-01-01T00:00:00Z',
    })

    const newerCredential = createDTGCredential({
      issuer: {
        id: TEST_CONTACTS.alice.issuer.id,
        name: 'Alice Smith', // Updated name
      },
      credentialSubject: { id: holderDid },
      validFrom: '2024-06-01T00:00:00Z',
    })

    mockUseOpenIDCredentials.mockReturnValue({
      openIdState: {
        w3cCredentialRecords: [olderCredential, newerCredential],
        sdJwtVcRecords: [],
        mdocVcRecords: [],
        openIDCredentialRecords: [],
        isLoading: false,
      },
      getW3CCredentialById: jest.fn(),
      getSdJwtCredentialById: jest.fn(),
      getMdocCredentialById: jest.fn(),
      storeCredential: jest.fn(),
      removeCredential: jest.fn(),
      resolveBundleForCredential: jest.fn(),
    } as any)

    const { findByText, queryByText } = render(
      <BasicAppContext>
        <ListContacts />
      </BasicAppContext>
    )

    await waitFor(async () => {
      // Should display the newer name
      expect(await findByText('Alice Smith')).toBeTruthy()
      expect(queryByText('Old Name')).toBeNull()
    })
  })
})
