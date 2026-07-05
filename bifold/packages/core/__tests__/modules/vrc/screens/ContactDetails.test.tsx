import { render, waitFor, fireEvent } from '@testing-library/react-native'
import React from 'react'
import { useAgent } from '@credo-ts/react-hooks'

import ContactDetails from '../../../../src/modules/vrc/screens/ContactDetails'
import { TEST_CONTACTS, generateTestDid } from '../fixtures/dtg-credentials'
import { ContactCredentialDetails } from '../../../../src/types/navigators'
import { useOpenIDCredentials } from '../../../../src/modules/openid/context/OpenIDCredentialRecordProvider'

// Mock dependencies
jest.mock('@credo-ts/react-hooks')
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

  test('Renders contact details correctly', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)

    const contact: ContactCredentialDetails = {
      issuer: TEST_CONTACTS.alice.issuer,
    }

    const { findByText } = render(<ContactDetails {...createRouteParams(contact)} />)

    await waitFor(async () => {
      // Should display issuer name
      expect(await findByText('Alice Smith')).toBeTruthy()

      // Should display issuer DID
      expect(await findByText(TEST_CONTACTS.alice.issuer.id)).toBeTruthy()
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

    const { findByText } = render(<ContactDetails {...createRouteParams(contact)} />)

    await waitFor(async () => {
      expect(await findByText('ContactDetails.ViewMessages')).toBeTruthy()
    })
  })

  test('Disables View Messages button when no connection exists', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)

    const contact: ContactCredentialDetails = {
      issuer: TEST_CONTACTS.alice.issuer,
    }

    const { getByLabelText } = render(<ContactDetails {...createRouteParams(contact)} />)

    await waitFor(() => {
      const button = getByLabelText('ContactDetails.ViewMessages')
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

    const { getByLabelText } = render(<ContactDetails {...createRouteParams(contact)} />)

    await waitFor(() => {
      const button = getByLabelText('ContactDetails.ViewMessages')
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

    const { findByText } = render(<ContactDetails {...createRouteParams(contact)} />)

    await waitFor(async () => {
      const viewMessagesButton = await findByText('ContactDetails.ViewMessages')
      fireEvent.press(viewMessagesButton)

      expect(mockNavigate).toHaveBeenCalledWith('Chat', { connectionId })
    })
  })

  test('Throws error when route params are missing', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => {
      render(<ContactDetails route={undefined as any} navigation={undefined as any} />)
    }).toThrow('ContactDetails route params were not set properly')

    consoleError.mockRestore()
  })

  test('Handles repository lookup errors gracefully', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockRejectedValue(new Error('Repository error'))

    const contact: ContactCredentialDetails = {
      issuer: TEST_CONTACTS.alice.issuer,
    }

    const { getByLabelText } = render(<ContactDetails {...createRouteParams(contact)} />)

    await waitFor(() => {
      // Button should be visible but disabled after error
      const button = getByLabelText('ContactDetails.ViewMessages')
      expect(button).toBeTruthy()
      expect(button.props.accessibilityState?.disabled).toBe(true)
    })
  })

  test('DID is selectable for copying', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)

    const contact: ContactCredentialDetails = {
      issuer: TEST_CONTACTS.bob.issuer,
    }

    const { getByText } = render(<ContactDetails {...createRouteParams(contact)} />)

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

    const { findByText } = render(<ContactDetails {...createRouteParams(contact)} />)

    await waitFor(async () => {
      // Should display email label
      expect(await findByText('Email')).toBeTruthy()
      // Should display email value
      expect(await findByText('alice@example.com')).toBeTruthy()
    })
  })

  test('Displays organization when available', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)

    const contact: ContactCredentialDetails = {
      issuer: TEST_CONTACTS.alice.issuer,
    }

    const { findByText } = render(<ContactDetails {...createRouteParams(contact)} />)

    await waitFor(async () => {
      // Should display organisation label
      expect(await findByText('Organisation')).toBeTruthy()
      // Should display organisation value
      expect(await findByText('Tech Corp')).toBeTruthy()
    })
  })

  test('Does not display email section when email is not available', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)

    const contact: ContactCredentialDetails = {
      issuer: TEST_CONTACTS.charlie.issuer, // charlie has organization but no email
    }

    const { queryByText, findByText } = render(<ContactDetails {...createRouteParams(contact)} />)

    await waitFor(async () => {
      // Should display name
      expect(await findByText('Charlie Wilson')).toBeTruthy()
      // Should display organization
      expect(await findByText('Wilson Industries')).toBeTruthy()
      // Should NOT display email (charlie doesn't have email)
      expect(queryByText('Email')).toBeNull()
    })
  })

  test('Does not display organization section when organization is not available', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)

    const contact: ContactCredentialDetails = {
      issuer: TEST_CONTACTS.bob.issuer, // bob has email but no organization
    }

    const { queryByText, findByText } = render(<ContactDetails {...createRouteParams(contact)} />)

    await waitFor(async () => {
      // Should display name
      expect(await findByText('Bob Jones')).toBeTruthy()
      // Should display email
      expect(await findByText('bob@example.org')).toBeTruthy()
      // Should NOT display organisation (bob doesn't have organisation)
      expect(queryByText('Organisation')).toBeNull()
    })
  })

  test('Does not display email or organization when neither is available', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)

    const contact: ContactCredentialDetails = {
      issuer: TEST_CONTACTS.diana.issuer, // diana has neither email nor organization
    }

    const { queryByText, findByText } = render(<ContactDetails {...createRouteParams(contact)} />)

    await waitFor(async () => {
      // Should display name
      expect(await findByText('Diana Martinez')).toBeTruthy()
      // Should display DID
      expect(await findByText(TEST_CONTACTS.diana.issuer.id)).toBeTruthy()
      // Should NOT display email or organization sections
      expect(queryByText('Email')).toBeNull()
      expect(queryByText('Organisation')).toBeNull()
    })
  })

  test('Displays different contacts correctly', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)

    const contacts = [TEST_CONTACTS.alice, TEST_CONTACTS.bob, TEST_CONTACTS.charlie]

    for (const testContact of contacts) {
      const contact: ContactCredentialDetails = {
        issuer: testContact.issuer,
      }

      const { findByText, unmount } = render(<ContactDetails {...createRouteParams(contact)} />)

      await waitFor(async () => {
        expect(await findByText(testContact.issuer.name)).toBeTruthy()
        expect(await findByText(testContact.issuer.id)).toBeTruthy()
      })

      unmount()
    }
  })

  test('Repository is called with correct issuer DID', async () => {
    mockRepository.findByCounterpartyRelationshipDid.mockResolvedValue(null)

    const contact: ContactCredentialDetails = {
      issuer: TEST_CONTACTS.diana.issuer,
    }

    render(<ContactDetails {...createRouteParams(contact)} />)

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

    const { getByLabelText } = render(<ContactDetails {...createRouteParams(contact)} />)

    await waitFor(() => {
      expect(mockRepository.findByCounterpartyRelationshipDid).not.toHaveBeenCalled()
      // Button should be visible but disabled when agent is undefined
      const button = getByLabelText('ContactDetails.ViewMessages')
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

    const { getByLabelText } = render(<ContactDetails {...createRouteParams(contact)} />)

    await waitFor(() => {
      const button = getByLabelText('ContactDetails.ViewMessages')
      expect(button.props.accessibilityRole).toBe('button')
    })
  })
})
