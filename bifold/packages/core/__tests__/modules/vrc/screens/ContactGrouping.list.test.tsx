/**
 * The Contacts list groups by contact: relationships linked as one person show as one row, the row being the
 * relationship of the newest card, with badges from every relationship. The same store unlinked shows a row per
 * relationship (ContactGroupingParity.list.test.tsx); here it is the positive control.
 *
 * Evidence only while it is red against the list before contact grouping: the linked case fails with the
 * ListContacts of b71dce9a (this change's first commit, screens unmodified) and passes after.
 */
import { W3cCredentialRecord } from '@credo-ts/core'
import { render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { useAgent } from '@bifold/react-hooks'

import ListContacts from '../../../../src/modules/vrc/screens/ListContacts'
import { CONTACT_LINK } from '../../../../src/modules/vrc/contacts/contactLinks'
import { useOpenIDCredentials } from '../../../../src/modules/openid/context/OpenIDCredentialRecordProvider'
import { WITNESS_VERIFIED_TAG } from '../../../../src/modules/vrc/utils/witnessCredentialUtils'
import { BasicAppContext } from '../../../helpers/app'
import { ALICE_AGAIN, ALICE_FIRST, SEVERAL_RELATIONSHIPS } from '../fixtures/severalRelationships'

// eslint-disable-next-line @typescript-eslint/no-empty-function
jest.mock('react-native-localize', () => {})
jest.useFakeTimers({ legacyFakeTimers: true })
jest.mock('@bifold/react-hooks')
jest.mock('../../../../src/modules/openid/context/OpenIDCredentialRecordProvider', () => ({
  ...jest.requireActual('../../../../src/modules/openid/context/OpenIDCredentialRecordProvider'),
  useOpenIDCredentials: jest.fn(),
}))

const mockUseAgent = useAgent as jest.MockedFunction<typeof useAgent>
const mockUseOpenIDCredentials = useOpenIDCredentials as jest.MockedFunction<typeof useOpenIDCredentials>

/** A verified witness record for the FIRST Alice relationship only. */
const aliceFirstWitnessed = {
  id: 'witness-alice-first',
  getTags: () => ({ [WITNESS_VERIFIED_TAG]: 'true' }),
  encoded: {
    type: ['VerifiableCredential', 'WitnessCredential'],
    issuer: 'did:example:witness',
    issuanceDate: '2026-01-06T10:00:00.000Z',
    credentialSubject: { id: ALICE_FIRST.id, witnessContext: { localityConfirmed: false } },
  },
} as unknown as W3cCredentialRecord

const withLinks = (links: { issuerDid: string; contactId: string }[]) =>
  mockUseAgent.mockReturnValue({
    agent: {
      config: { logger: { warn: jest.fn() } },
      genericRecords: { findAllByQuery: jest.fn(async () => links.map((content) => ({ content }))) },
    },
  } as any)

const show = () =>
  render(
    <BasicAppContext>
      <ListContacts />
    </BasicAppContext>
  )

describe('the Contacts list grouped by contact', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => null)
    mockUseOpenIDCredentials.mockReturnValue({
      openIdState: { w3cCredentialRecords: [...SEVERAL_RELATIONSHIPS, aliceFirstWitnessed] },
    } as any)
  })
  afterEach(() => jest.restoreAllMocks())

  test('unlinked, two Alice relationships are two rows; only the first carries the witness badge', async () => {
    withLinks([])
    const tree = show()
    await waitFor(() => expect(tree.getAllByText('Alice Smith')).toHaveLength(2))
    expect(tree.getAllByTestId('WitnessVerifiedBadge')).toHaveLength(2) // Alice's first relationship, and Bob
  })

  test('linked, they are one row, opened on the newest relationship, with the witness badge of the older one', async () => {
    withLinks([{ issuerDid: ALICE_AGAIN.id, contactId: ALICE_FIRST.id }])
    const tree = show()
    await waitFor(() => expect(tree.getAllByText('Alice Smith')).toHaveLength(1))
    expect(tree.getByText('Bob Jones')).toBeTruthy()
    expect(tree.getAllByTestId('WitnessVerifiedBadge')).toHaveLength(2) // merged Alice, and Bob
    const query = (mockUseAgent.mock.results[0].value as any).agent.genericRecords.findAllByQuery
    expect(query).toHaveBeenCalledWith({ recordType: CONTACT_LINK })
  })
})
