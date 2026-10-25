/**
 * A community card's Details: the pass on top, what the card says in plain rows (nothing masked), where it is kept,
 * the way to the community, and its identifiers behind Technical details. The ids the Details it replaced used are
 * kept on what does the same job, so the wallet's end-to-end flows still find them.
 */
import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { COMMUNITY, membershipCard, roleCard, seedCardVaultState } from '../../../../__tests__/helpers/cardVault'
import { testIdWithKey } from '../../../utils/testable'
import { resetCardVaultCache } from '../module/vtiCardVault'
import CommunityPassDetails from '../screens/CommunityPassDetails'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('../module/useCommunityBrand', () => ({
  useCommunityBrand: () => ({
    known: true,
    value: { color: '#265373', pattern: 'waves', monogram: 'KT', fromAccent: false },
  }),
}))

const id = testIdWithKey
const show = (card: Record<string, unknown>, open = jest.fn()) =>
  render(
    <BasicAppContext>
      <CommunityPassDetails card={card} onOpenCommunity={open} />
    </BasicAppContext>
  )

describe('a community card’s Details', () => {
  beforeEach(() => resetCardVaultCache())

  test('the pass on top, then the card’s rows in plain view: nothing masked, no "Show"', () => {
    const tree = show(membershipCard)
    expect(tree.getByTestId(id('CommunityPass'))).toBeTruthy()
    expect(tree.getAllByTestId(id('CommunityPassRow')).length).toBeGreaterThan(0)
    expect(tree.queryByText(/••••|^Show$|Record\.Show/)).toBeNull()
  })

  test('the pass here is not a button (it is the card already open)', () => {
    const tree = show(membershipCard)
    expect(tree.getByTestId(id('CommunityPass')).props.accessibilityRole).toBe('summary')
  })

  test('where it is kept, as before', () => {
    seedCardVaultState(membershipCard.id as string, { state: 'kept', at: '2026-09-26T10:00:00Z' })
    const tree = show(membershipCard)
    expect(tree.getByText('VtaLink.CardKept')).toBeTruthy()
  })

  test('the way to the community, by the id the end-to-end flows use', () => {
    const open = jest.fn()
    const tree = show(membershipCard, open)
    fireEvent.press(tree.getByTestId(id('CommunityCardOpenCommunity')))
    expect(open).toHaveBeenCalledWith(COMMUNITY)
    expect(tree.getByTestId(id('CommunityCardDetails'))).toBeTruthy()
  })

  test('the role line keeps its id, on the text alone, and says what the card is (a membership: "Member")', () => {
    // The flows read this id's own text for "member", so it is the value, not the row with its "Card" label. (Keys
    // here; communityPass.test.ts reads "Member" through real i18next.)
    expect(show(membershipCard).getByTestId(id('CommunityCardRole'))).toHaveTextContent(/^Community\.PassMember$/)
    expect(show(roleCard).getByTestId(id('CommunityCardRole'))).not.toHaveTextContent(/^$/)
  })

  test('the identifiers are behind Technical details, shown on request', () => {
    const tree = show(membershipCard)
    expect(tree.queryByTestId(id('CommunityPassTechnicalRows'))).toBeNull()
    expect(tree.queryByText(COMMUNITY)).toBeNull()
    fireEvent.press(tree.getByTestId(id('CommunityPassTechnical')))
    expect(tree.getByTestId(id('CommunityPassTechnicalRows'))).toBeTruthy()
    expect(tree.getByText(COMMUNITY)).toBeTruthy()
    expect(tree.getByText((membershipCard.credentialSubject as { id: string }).id)).toBeTruthy()
  })

  test('any other credential: nothing', () => {
    const tree = show({ type: ['VerifiableCredential'], issuer: 'did:example:x' })
    expect(tree.queryByTestId(id('CommunityCardDetails'))).toBeNull()
  })
})
