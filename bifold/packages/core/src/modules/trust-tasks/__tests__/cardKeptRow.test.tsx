/**
 * A community's card on "Your agent" shows the person's membership and role
 * cards, and where each is kept (226, agent-kept cards): by the agent, on its
 * way there, not yet, or on this phone only and why. The line follows the
 * vault state as it changes, without a reload.
 */
import { act, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { COMMUNITY, membership, membershipCard, roleCard, seedCardVaultState } from '../../../../__tests__/helpers/cardVault'
import { testIdWithKey } from '../../../utils/testable'
import { resetCardVaultCache } from '../module/vtiCardVault'
import { CardKeptRow } from '../screens/CardKeptRow'
import { CommunityCard, communityCardKey } from '../screens/CommunityCard'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const key = communityCardKey(COMMUNITY)
const keptLine = (tree: ReturnType<typeof render>, kind: 'membership' | 'role') =>
  tree.getByTestId(testIdWithKey(`AgentCardKept_${kind}_${key}`))

describe('where a card is kept', () => {
  beforeEach(() => resetCardVaultCache())

  it.each([
    [{ state: 'kept', at: '2026-09-26T10:00:00Z' }, 'VtaLink.CardKept'],
    [{ state: 'pending' }, 'VtaLink.CardSaving'],
    [{ state: 'cannotKeep', reason: 'proofSet' }, 'VtaLink.CardPhoneOnlyProofSet'],
    [{ state: 'cannotKeep', reason: 'refusedByAgent' }, 'VtaLink.CardPhoneOnlyRefused'],
  ] as const)('%j reads %s', (state, words) => {
    seedCardVaultState(membershipCard.id as string, state)
    const tree = render(
      <BasicAppContext>
        <CardKeptRow card={membershipCard} kind="membership" handle={key} />
      </BasicAppContext>
    )
    expect(keptLine(tree, 'membership')).toHaveTextContent(words)
  })

  it('a card never sent says "not yet", and the line follows the vault as it keeps it', () => {
    const tree = render(
      <BasicAppContext>
        <CardKeptRow card={membershipCard} kind="membership" handle={key} />
      </BasicAppContext>
    )
    expect(keptLine(tree, 'membership')).toHaveTextContent('VtaLink.CardNotYetKept')
    act(() => seedCardVaultState(membershipCard.id as string, { state: 'pending' }))
    expect(keptLine(tree, 'membership')).toHaveTextContent('VtaLink.CardSaving')
    act(() => seedCardVaultState(membershipCard.id as string, { state: 'kept', at: '2026-09-26T10:00:00Z' }))
    expect(keptLine(tree, 'membership')).toHaveTextContent('VtaLink.CardKept')
  })

  it('a card without an id says nothing, rather than something untrue', () => {
    const { id: _id, ...noId } = membershipCard
    const tree = render(
      <BasicAppContext>
        <CardKeptRow card={noId} kind="membership" handle={key} />
      </BasicAppContext>
    )
    expect(tree.queryByTestId(testIdWithKey(`AgentCard_membership_${key}`))).toBeNull()
  })
})

describe("the community's card on Your agent", () => {
  beforeEach(() => resetCardVaultCache())

  it('shows the membership and the role card, each with where it is kept', () => {
    seedCardVaultState(membershipCard.id as string, { state: 'kept', at: '2026-09-26T10:00:00Z' })
    seedCardVaultState(roleCard.id as string, { state: 'cannotKeep', reason: 'proofSet' })
    const tree = render(
      <BasicAppContext>
        <CommunityCard
          communityDid={COMMUNITY}
          membership={membership}
          invited={false}
          vetter={false}
          onOpen={jest.fn()}
          onPrimary={jest.fn()}
        />
      </BasicAppContext>
    )
    expect(tree.getByTestId(testIdWithKey(`AgentCard_membership_${key}`))).toHaveTextContent(/VtaLink\.YourMembershipCard/)
    expect(keptLine(tree, 'membership')).toHaveTextContent('VtaLink.CardKept')
    expect(tree.getByTestId(testIdWithKey(`AgentCard_role_${key}`))).toHaveTextContent(/VtaLink\.YourRoleCard/)
    expect(keptLine(tree, 'role')).toHaveTextContent('VtaLink.CardPhoneOnlyProofSet')
  })

  it('without a membership there is no card to show', () => {
    const tree = render(
      <BasicAppContext>
        <CommunityCard communityDid={COMMUNITY} invited={false} vetter={false} onOpen={jest.fn()} onPrimary={jest.fn()} />
      </BasicAppContext>
    )
    expect(tree.queryByTestId(testIdWithKey(`AgentCard_membership_${key}`))).toBeNull()
  })
})
