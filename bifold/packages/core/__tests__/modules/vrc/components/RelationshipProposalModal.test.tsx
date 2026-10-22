/**
 * The consent sheet for a relationship proposal: a first exchange reads as it
 * always has (the e2e drivers find it by those words); an upgrade of an
 * existing relationship says what it adds, and nothing more.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import RelationshipProposalModal from '../../../../src/modules/vrc/components/RelationshipProposalModal'
import { vrcFlowStore } from '../../../../src/modules/vrc/witnessStatusStore'
import { testIdWithKey } from '../../../../src/utils/testable'
import { BasicAppContext } from '../../../helpers/app'

const mockRespond = jest.fn(async () => undefined)
jest.mock('../../../../src/modules/trust-tasks/ceremony', () => ({
  respondToRelationshipProposal: (...a: unknown[]) => mockRespond(...(a as [])),
}))
jest.mock('@bifold/react-hooks')

const show = () =>
  render(
    <BasicAppContext>
      <RelationshipProposalModal />
    </BasicAppContext>
  )

describe('the relationship request sheet', () => {
  beforeEach(() => {
    ;(useAgent as jest.Mock).mockReturnValue({ agent: {} })
    mockRespond.mockClear()
  })
  afterEach(() => vrcFlowStore.clearProposalPrompt('conn-1'))

  test('a first exchange reads as it always has', () => {
    vrcFlowStore.setProposalPrompt({ connectionId: 'conn-1', exchangeId: 'x1', counterpartyLabel: 'Oli' })
    const tree = show()
    expect(tree.getByText(/wants to form a relationship with you/)).toBeTruthy()
    expect(tree.queryByText(/Relationship\.RequestTitle/)).toBeNull()
  })

  test.each([
    ['resign', 'Relationship.RequestResign'],
    ['witness', 'Relationship.RequestWitness'],
  ] as const)('an upgrade (%s) says what it adds, and answers through the same consent', async (upgrade, words) => {
    vrcFlowStore.setProposalPrompt({ connectionId: 'conn-1', exchangeId: 'x2', counterpartyLabel: 'Oli', upgrade })
    const tree = show()
    expect(tree.getByText('Relationship.RequestTitle')).toBeTruthy()
    expect(tree.getByText(words)).toBeTruthy()
    expect(tree.queryByText(/wants to form a relationship/)).toBeNull()
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('ProposalAccept'))))
    expect(mockRespond).toHaveBeenCalledWith({}, 'conn-1', true)
  })
})
