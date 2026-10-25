/**
 * A contact's screen covers every relationship linked to it: the cards of all of them, newest first, while the DID it
 * shows (and messages, upgrade, removal) stay on the relationship the row opened. Unlinked, the same store shows that
 * relationship's cards only, which is the positive control.
 *
 * Evidence only while it is red against the screens before contact grouping: the linked cases fail with the
 * ContactDetails and relationshipLayers of b71dce9a (this change's first commit, screens unmodified) and pass after.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { container } from 'tsyringe'
import { useAgent } from '@bifold/react-hooks'

import ContactDetails from '../../../../src/modules/vrc/screens/ContactDetails'
import { ContainerProvider } from '../../../../src/container-api'
import { MainContainer } from '../../../../src/container-impl'
import { useOpenIDCredentials } from '../../../../src/modules/openid/context/OpenIDCredentialRecordProvider'
import { testIdWithKey } from '../../../../src/utils/testable'
import { verifyVrcHardwareEvidence } from '../../../../src/modules/vrc/services/BiometricSignatureVerifier'
import {
  getVrcCredentialJsonForSubject,
  hasVrcHardwareAttestation,
} from '../../../../src/modules/vrc/utils/witnessCredentialUtils'
import { contactFacts } from '../../../../src/modules/vrc/contacts/useContactFacts'
import { ALICE_AGAIN, ALICE_FIRST, SEVERAL_RELATIONSHIPS } from '../fixtures/severalRelationships'

jest.mock('@bifold/react-hooks')
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon')
jest.mock('../../../../src/modules/openid/context/OpenIDCredentialRecordProvider')
jest.mock('../../../../src/modules/vrc/services/BiometricSignatureVerifier', () => ({
  verifyVrcHardwareEvidence: jest.fn(async () => ({ valid: false })),
}))
jest.mock('../../../../src/modules/vrc/utils/witnessCredentialUtils', () => {
  const actual = jest.requireActual('../../../../src/modules/vrc/utils/witnessCredentialUtils')
  return {
    ...actual,
    getVrcCredentialJsonForSubject: jest.fn(actual.getVrcCredentialJsonForSubject),
    hasVrcHardwareAttestation: jest.fn(actual.hasVrcHardwareAttestation),
  }
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
// The screen's read of the contact links, kept so a test can wait for exactly that read (and what it renders) before
// asserting, rather than for a time budget a loaded CI worker can run out of: a linked contact shows one layer until
// the links land, then all of its relationships' (CI, 10-25: "expected 3, received 1").
let linksRead: Promise<unknown> = Promise.resolve()
const linksLoaded = () =>
  act(async () => {
    await linksRead
  })
const withLinks = (links: { issuerDid: string; contactId: string }[]) =>
  mockUseAgent.mockReturnValue({
    agent: {
      config: { logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
      dependencyManager: {
        resolve: () => ({
          findByCounterpartyRelationshipDid: findRelationship,
          // The relationship records the contact facts read (contacts/useContactFacts).
          getAll: async () => [
            { connectionId: 'conn-first', counterpartyRelationshipDid: ALICE_FIRST.id },
            { connectionId: 'conn-again', counterpartyRelationshipDid: ALICE_AGAIN.id },
          ],
        }),
      },
      genericRecords: { findAllByQuery: () => (linksRead = Promise.resolve(links.map((content) => ({ content })))) },
    },
  } as any)

const openAliceAgain = () =>
  render(<ContactDetails route={{ params: { contact: { issuer: ALICE_AGAIN } } } as any} navigation={{} as any} />, {
    wrapper: Container,
  })

describe("a contact's screen grouped by contact", () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => null)
    contactFacts.forget()
    findRelationship.mockClear()
    mockUseOpenIDCredentials.mockReturnValue({ openIdState: { w3cCredentialRecords: SEVERAL_RELATIONSHIPS } } as any)
  })
  afterEach(() => jest.restoreAllMocks())

  test('unlinked: the one card of this relationship', async () => {
    withLinks([])
    const tree = openAliceAgain()
    await linksLoaded()
    // Still one once the (empty) links have been read: the control for the linked case below.
    expect(tree.getAllByTestId(testIdWithKey('RelationshipLayer'))).toHaveLength(1)
  })

  test('linked: the cards of both relationships, and the DID and connection of the one the row opened', async () => {
    withLinks([{ issuerDid: ALICE_AGAIN.id, contactId: ALICE_FIRST.id }])
    const tree = openAliceAgain()
    await linksLoaded()
    expect(tree.getAllByTestId(testIdWithKey('RelationshipLayer'))).toHaveLength(3)
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
    ;(hasVrcHardwareAttestation as jest.Mock).mockReturnValue(true)
    ;(verifyVrcHardwareEvidence as jest.Mock).mockImplementation(async (raw: { issuer: string }) => {
      if (raw.issuer === ALICE_AGAIN.id) throw new Error('evidence unreadable')
      return { valid: true }
    })
    // What the app's provider does at the root: read the facts the screen then shares.
    await act(async () => contactFacts.load(mockUseAgent().agent as never, SEVERAL_RELATIONSHIPS as never))
    const tree = openAliceAgain()
    // The older relationship is checked only once the links say it is this contact's.
    await linksLoaded()
    expect(await tree.findByTestId('SecureExchangeBadge')).toBeTruthy()
    expect(verifyVrcHardwareEvidence).toHaveBeenCalledWith({ issuer: ALICE_FIRST.id })
  })
})

// UI-smoothness plan, Phase 4: the contact's page verified hardware evidence itself, from false, so the Secure Exchange
// badge appeared late — and again after the Contacts list had verified the same evidence.
describe("a contact's Secure Exchange badge", () => {
  const openWithFacts = async () => {
    await act(async () => contactFacts.load(mockUseAgent().agent as never, SEVERAL_RELATIONSHIPS as never))
    return render(
      <ContactDetails
        route={{ params: { contact: { issuer: ALICE_AGAIN, hasHardwareAttestation: true } } } as any}
        navigation={{} as any}
      />,
      { wrapper: Container }
    )
  }
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => null)
    contactFacts.forget()
    mockUseOpenIDCredentials.mockReturnValue({ openIdState: { w3cCredentialRecords: SEVERAL_RELATIONSHIPS } } as any)
    withLinks([])
    ;(getVrcCredentialJsonForSubject as jest.Mock).mockImplementation((_records: unknown, issuerDid: string) => ({
      issuer: issuerDid,
    }))
    ;(hasVrcHardwareAttestation as jest.Mock).mockReturnValue(true)
  })
  afterEach(() => jest.restoreAllMocks())

  test('evidence still being checked: its place is held from the first render, then the badge', async () => {
    let answer: (v: { valid: boolean }) => void = () => undefined
    ;(verifyVrcHardwareEvidence as jest.Mock).mockImplementation(() => new Promise((r) => (answer = r)))
    const tree = await openWithFacts()
    expect(tree.getByTestId('SecureExchangeChecking')).toBeTruthy()
    expect(tree.queryByTestId('SecureExchangeBadge')).toBeNull()
    await act(async () => answer({ valid: true }))
    expect(tree.getByTestId('SecureExchangeBadge')).toBeTruthy()
    expect(tree.queryByTestId('SecureExchangeChecking')).toBeNull()
  })

  test('already verified (the Contacts list checked it): the badge from the first render, not checked again', async () => {
    ;(verifyVrcHardwareEvidence as jest.Mock).mockClear()
    ;(verifyVrcHardwareEvidence as jest.Mock).mockImplementation(async () => ({ valid: true }))
    await act(async () => contactFacts.load(mockUseAgent().agent as never, SEVERAL_RELATIONSHIPS as never))
    await act(async () => {
      contactFacts.verify([ALICE_AGAIN.id])
      await Promise.resolve()
    })
    expect(verifyVrcHardwareEvidence).toHaveBeenCalledTimes(1)
    const tree = render(
      <ContactDetails
        route={{ params: { contact: { issuer: ALICE_AGAIN, hasHardwareAttestation: true } } } as any}
        navigation={{} as any}
      />,
      { wrapper: Container }
    )
    expect(tree.getByTestId('SecureExchangeBadge')).toBeTruthy()
    expect(verifyVrcHardwareEvidence).toHaveBeenCalledTimes(1)
  })
})
