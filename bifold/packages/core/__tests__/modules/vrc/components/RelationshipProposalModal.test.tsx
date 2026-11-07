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

/** Past a large text size the sheet scrolls: the words and the buttons are in one scroll, the words first. */
const expectButtonPastTheWords = (tree: ReturnType<typeof render>, words: string, buttonId: string) => {
  let parent = tree.getByTestId(buttonId).parent
  while (parent && String(parent.type) !== 'RCTScrollView') parent = parent.parent
  expect(parent).toBeTruthy()
  const json = JSON.stringify(tree.toJSON())
  expect(json.indexOf(words)).toBeGreaterThanOrEqual(0)
  expect(json.indexOf(words)).toBeLessThan(json.indexOf(buttonId))
}

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

  test('Accept is reached only past the words, in a scroll', () => {
    vrcFlowStore.setProposalPrompt({ connectionId: 'conn-1', exchangeId: 'x1', counterpartyLabel: 'Ori' })
    expectButtonPastTheWords(show(), 'wants to form a relationship with you', testIdWithKey('ProposalAccept'))
  })
})

// Someone scanned this phone's shared-connect code (WP9): the request carries no name, so the sheet says Keyring
// can't tell who it is and shows only the address prefix. The answer goes back under the encounter's key.
describe('the request from someone who scanned a shared-connect code', () => {
  const prompt = {
    connectionId: 'enc:XOcGXOQTCHb5iz4T2JD2RQ',
    exchangeId: 'enc:XOcGXOQTCHb5iz4T2JD2RQ',
    counterpartyLabel: '',
    sharedConnect: { didShort: 'did:peer:2.Ez6LSbys…' },
  }
  beforeEach(() => {
    ;(useAgent as jest.Mock).mockReturnValue({ agent: {} })
    mockRespond.mockClear()
    vrcFlowStore.setProposalPrompt(prompt)
  })
  afterEach(() => vrcFlowStore.clearProposalPrompt(prompt.connectionId))

  test('says who is asking only as far as Keyring knows: nobody named, and their address', () => {
    const tree = show()
    expect(tree.getByText('SharedConnectInvite.ConsentTitle')).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('ProposalWho')).props.children).toBe('SharedConnectInvite.ConsentWhoUnknown')
    expect(tree.getByTestId(testIdWithKey('ProposalAddress')).props.children).toBe('did:peer:2.Ez6LSbys…')
    // Not the first-exchange words, which put a name in front of "wants to form a relationship".
    expect(tree.queryByText(/wants to form a relationship/)).toBeNull()
  })

  test.each([
    ['ProposalAccept', true],
    ['ProposalDecline', false],
  ] as const)('%s answers under the encounter’s key', async (button, accept) => {
    const tree = show()
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey(button))))
    expect(mockRespond).toHaveBeenCalledWith({}, prompt.connectionId, accept)
  })

  test('the hint to accept only a scan made in front of you sits right above Accept, in the scroll', () => {
    expectButtonPastTheWords(show(), 'SharedConnectInvite.ConsentHint', testIdWithKey('ProposalAccept'))
  })
})
