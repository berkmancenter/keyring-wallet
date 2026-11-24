/**
 * The Contacts list reads each contact's hardware verification from the facts every screen shares
 * (contacts/useContactFacts), not from its own check started at false (UI-smoothness plan, Phase 4). While a
 * contact's evidence is checked, the row holds the badge's place; once verified, the badge.
 */
import { act, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { useAgent } from '@bifold/react-hooks'

import ListContacts from '../../../../src/modules/vrc/screens/ListContacts'
import { contactFacts } from '../../../../src/modules/vrc/contacts/useContactFacts'
import { useOpenIDCredentials } from '../../../../src/modules/openid/context/OpenIDCredentialRecordProvider'
import { verifyVrcHardwareEvidence } from '../../../../src/modules/vrc/services/BiometricSignatureVerifier'
import { testIdWithKey } from '../../../../src/utils/testable'
import { BasicAppContext } from '../../../helpers/app'
import { ALICE_AGAIN, ALICE_FIRST, SEVERAL_RELATIONSHIPS } from '../fixtures/severalRelationships'

// eslint-disable-next-line @typescript-eslint/no-empty-function
jest.mock('react-native-localize', () => {})
jest.mock('@bifold/react-hooks')
jest.mock('../../../../src/modules/openid/context/OpenIDCredentialRecordProvider', () => ({
  ...jest.requireActual('../../../../src/modules/openid/context/OpenIDCredentialRecordProvider'),
  useOpenIDCredentials: jest.fn(),
}))
jest.mock('../../../../src/modules/vrc/services/BiometricSignatureVerifier', () => ({
  verifyVrcHardwareEvidence: jest.fn(),
}))
// Every relationship here carries hardware evidence, and its credential is the one verified.
jest.mock('../../../../src/modules/vrc/utils/witnessCredentialUtils', () => ({
  ...jest.requireActual('../../../../src/modules/vrc/utils/witnessCredentialUtils'),
  hasVrcHardwareAttestation: () => true,
  getVrcCredentialJsonForSubject: (_records: unknown, issuerDid: string) => ({ id: `urn:vrc:${issuerDid}` }),
}))

const agent = {
  context: {},
  config: { logger: { warn: jest.fn() } },
  genericRecords: { findAllByQuery: jest.fn(async () => []) },
  dependencyManager: {
    resolve: () => ({
      getAll: async () => [
        { connectionId: 'conn-first', counterpartyRelationshipDid: ALICE_FIRST.id },
        { connectionId: 'conn-again', counterpartyRelationshipDid: ALICE_AGAIN.id },
      ],
    }),
  },
}

describe('the Contacts list, hardware badge from the shared facts', () => {
  beforeEach(() => {
    contactFacts.forget()
    jest.spyOn(console, 'warn').mockImplementation(() => null)
    ;(useAgent as jest.Mock).mockReturnValue({ agent })
    ;(useOpenIDCredentials as jest.Mock).mockReturnValue({
      openIdState: { w3cCredentialRecords: SEVERAL_RELATIONSHIPS },
    })
  })
  afterEach(() => jest.restoreAllMocks())

  it('while the evidence is checked the row holds the badge’s place; once verified, the badge', async () => {
    const answers: ((v: { valid: boolean }) => void)[] = []
    ;(verifyVrcHardwareEvidence as jest.Mock).mockImplementation(() => new Promise((r) => answers.push(r)))
    await act(async () => contactFacts.load(agent as never, SEVERAL_RELATIONSHIPS as never))
    const tree = render(
      <BasicAppContext>
        <ListContacts />
      </BasicAppContext>
    )
    await waitFor(() => expect(tree.getAllByTestId(testIdWithKey('ContactHardwareChecking')).length).toBeGreaterThan(0))
    expect(tree.UNSAFE_queryAllByProps({ name: 'shield-check' })).toHaveLength(0)
    await act(async () => answers.forEach((answer) => answer({ valid: true })))
    await waitFor(() => expect(tree.UNSAFE_queryAllByProps({ name: 'shield-check' }).length).toBeGreaterThan(0))
    expect(tree.queryAllByTestId(testIdWithKey('ContactHardwareChecking'))).toHaveLength(0)
  })
})
