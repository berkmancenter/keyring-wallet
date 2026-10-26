/**
 * The credential Details screen gives a community's card its own Details (the pass, plain rows, the way to the
 * community) instead of the generic ones: a fixed-height card the colour of the page with an empty body and every
 * field hidden behind Show. Any other credential keeps the generic Details.
 */
import { W3cCredentialRecord } from '@credo-ts/core'
import { render, waitFor } from '@testing-library/react-native'
import React from 'react'

import OpenIDCredentialDetails from '../../src/modules/openid/screens/OpenIDCredentialDetails'
import { credentialRegistry } from '../../src/modules/openid/refresh/registry'
import { OpenIDCredentialType } from '../../src/modules/openid/types'
import { testIdWithKey } from '../../src/utils/testable'
import { COMMUNITY, membershipCard } from '../helpers/cardVault'
import { BasicAppContext } from '../helpers/app'

jest.mock('react-native-localize', () => {})
jest.mock('@bifold/credo-tsp-adapter', () => ({}))
const mockGetW3c = jest.fn()
jest.mock('../../src/modules/openid/context/OpenIDCredentialRecordProvider', () => ({
  ...jest.requireActual('../../src/modules/openid/context/OpenIDCredentialRecordProvider'),
  useOpenIDCredentials: () => ({
    getW3CCredentialById: (id: string) => mockGetW3c(id),
    getSdJwtCredentialById: jest.fn(),
    getMdocCredentialById: jest.fn(),
    removeCredential: jest.fn(),
  }),
}))

const proof = {
  type: 'DataIntegrityProof',
  cryptosuite: 'eddsa-jcs-2022',
  created: '2026-09-26T09:00:00Z',
  verificationMethod: `${COMMUNITY}#key-0`,
  proofPurpose: 'assertionMethod',
  proofValue: 'z3FXQjecWufY46yg5abdVZsXqLhxhueuSoZgNSARiKBk9czhSePTFehP8c3PGfb6a22gkfUKM7Mz2HnNhqFz5Rakm',
}
const recordOf = (credential: Record<string, unknown>) =>
  new W3cCredentialRecord({ credentialInstances: [{ credential: { ...credential, proof } as never }] })

// The screen draws the generic Details first and swaps in the community Details once the card's overlay resolves.
// On a loaded CI worker that can take longer than waitFor's 1 s default (the generic tree, with only HideAll, was
// seen there), so every wait for the swap gets the same longer timeout. Keep it explicit: a bare waitFor or findBy
// here passes locally and fails under parallel CI load.
const SWAP = { timeout: 5000 }

const open = (record: W3cCredentialRecord) => {
  mockGetW3c.mockResolvedValue(record)
  return render(
    <BasicAppContext>
      <OpenIDCredentialDetails
        route={{ params: { credentialId: record.id, type: OpenIDCredentialType.W3cCredential } } as never}
        navigation={{ navigate: jest.fn(), pop: jest.fn(), setOptions: jest.fn() } as never}
      />
    </BasicAppContext>
  )
}

describe('the credential Details screen', () => {
  test('a community card opens its own Details: the pass and the way to the community, nothing masked', async () => {
    const tree = open(recordOf(membershipCard))
    expect(await tree.findByTestId(testIdWithKey('CommunityCardDetailsScreen'), {}, SWAP)).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('CommunityPass'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('CommunityCardOpenCommunity'))).toBeTruthy()
    // The generic Details' "Issued by" box and its Remove are not shown for a community card.
    expect(tree.queryByTestId(testIdWithKey('IssuerName'))).toBeNull()
    // Not flagged by the credential registry: no status (the control for the "Revoked" test below).
    expect(tree.queryByTestId(testIdWithKey('CommunityPassStatus'))).toBeNull()
  })

  test('a card the credential registry marks invalid says "Revoked" on its pass, as the Details before did', async () => {
    const flagged = recordOf(membershipCard)
    credentialRegistry.setState({ expired: [flagged.id] })
    try {
      const tree = open(flagged)
      // The screen renders again once its overlay resolves, so read the status from the tree as it settles.
      await waitFor(
        () => expect(tree.getByTestId(testIdWithKey('CommunityPassStatus'))).toHaveTextContent(/Revoked/),
        SWAP
      )
    } finally {
      credentialRegistry.setState({ expired: [] })
    }
  })

  test('any other credential keeps the generic Details (positive control)', async () => {
    const other = recordOf({
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      id: 'urn:uuid:other',
      type: ['VerifiableCredential'],
      issuer: 'did:example:someone',
      validFrom: '2026-09-26T09:00:00Z',
      credentialSubject: { id: 'did:example:me' },
    })
    const tree = open(other)
    expect(await tree.findByTestId(testIdWithKey('IssuerName'), {}, SWAP)).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('CommunityCardDetailsScreen'))).toBeNull()
  })
})
