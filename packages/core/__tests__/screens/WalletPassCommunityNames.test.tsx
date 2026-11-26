/**
 * The Wallet's community cards name their community without My Agent having been opened (IN-814).
 *
 * A pass reads the community's name from the names kept in memory and redraws when one is learned, but nothing put
 * the names saved on the phone there except the My Agent screen. So after a start of the app a card showed no
 * community name until My Agent had loaded. The names are now read when the tabs first show (the tab navigator's
 * `useSavedCommunityNames`): this is that read, with the Wallet on screen, as on a start that opens on the Wallet.
 */
import { W3cCredentialRecord } from '@credo-ts/core'
import { useAgent, useCredentials } from '@bifold/react-hooks'
import { act, render, renderHook } from '@testing-library/react-native'
import React from 'react'

import {
  forgetSavedCommunityNamesRead,
  useSavedCommunityNames,
} from '../../src/modules/trust-tasks/module/savedCommunityNames'
import { communityTarget } from '../../src/modules/trust-tasks/module/vtiCommunityLink'
import ListCredentials from '../../src/screens/ListCredentials'
import { testIdWithKey } from '../../src/utils/testable'
import { BasicAppContext } from '../helpers/app'
import { COMMUNITY, membershipCard } from '../helpers/cardVault'

jest.mock('react-native-localize', () => {})
jest.mock('@bifold/credo-tsp-adapter', () => ({}))
const mockUseOpenId = jest.fn()
jest.mock('../../src/modules/openid/context/OpenIDCredentialRecordProvider', () => ({
  ...jest.requireActual('../../src/modules/openid/context/OpenIDCredentialRecordProvider'),
  useOpenIDCredentials: () => mockUseOpenId(),
}))
jest.mock('../../src/modules/trust-tasks/module/useCommunityBrand', () => ({
  useCommunityBrand: () => ({
    known: true,
    value: { color: '#265373', pattern: 'waves', monogram: 'HT', fromAccent: false },
  }),
}))

const NAME = 'Harbour Town Makers'
const agent = (useAgent as jest.Mock)().agent
const card = () => {
  const record = new W3cCredentialRecord({
    credentialInstances: [{ credential: { ...membershipCard, id: 'urn:uuid:card-1' } as never }],
  })
  record.createdAt = new Date('2026-09-26T09:00:00Z')
  return record
}
const wallet = () => {
  mockUseOpenId.mockReturnValue({
    openIdState: { w3cCredentialRecords: [card()], sdJwtVcRecords: [], mdocVcRecords: [], isLoading: false },
  } as never)
  ;(useCredentials as jest.Mock).mockReturnValue({ records: [], loading: false })
  return render(
    <BasicAppContext>
      <ListCredentials />
    </BasicAppContext>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  // As after a start of the app: no name in memory, the saved names not read yet. One is saved on the phone.
  communityTarget.clear()
  forgetSavedCommunityNamesRead(agent)
  ;(agent.genericRecords.findAllByQuery as jest.Mock).mockImplementation(async (query: { kind?: string }) =>
    query.kind === 'community-name'
      ? [
          {
            content: { communityDid: COMMUNITY, name: NAME, at: '2026-11-25T00:00:00.000Z' },
            getTags: () => ({ recordType: 'keyring/vti-community', kind: 'community-name', key: COMMUNITY }),
            updatedAt: new Date(Date.UTC(2026, 10, 25)),
          },
        ]
      : []
  )
})

test('the control: with the Wallet alone on screen, the card does not show the saved name', async () => {
  const tree = wallet()
  await tree.findAllByTestId(testIdWithKey('CommunityPass'))
  await act(async () => undefined)
  expect(tree.queryByText(NAME)).toBeNull()
})

test("with the app's start-up read, the card shows its community's saved name, and My Agent was never opened", async () => {
  const tree = wallet()
  await tree.findAllByTestId(testIdWithKey('CommunityPass'))
  expect(tree.queryByText(NAME)).toBeNull()
  // What the tab navigator does when the tabs first show.
  renderHook(() => useSavedCommunityNames(agent))
  expect((await tree.findAllByText(NAME)).length).toBeGreaterThan(0)
})
