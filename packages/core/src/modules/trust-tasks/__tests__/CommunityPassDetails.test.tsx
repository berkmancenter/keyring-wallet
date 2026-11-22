/**
 * A community card's Details: the pass on top, what the card says in plain rows (nothing masked), where it is kept,
 * the way to the community, and its identifiers behind Technical details. The ids the Details it replaced used are
 * kept on what does the same job, so the wallet's end-to-end flows still find them.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { COMMUNITY, membershipCard, roleCard, seedCardVaultState } from '../../../../__tests__/helpers/cardVault'
import { resetReduceMotion } from '../../../hooks/reduce-motion'
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

describe('a community card opened in place, in the Wallet', () => {
  beforeEach(() => {
    resetCardVaultCache()
    resetReduceMotion()
  })

  const opened = (lift: number, onClose = jest.fn()) =>
    render(
      <BasicAppContext>
        <CommunityPassDetails card={membershipCard} onOpenCommunity={jest.fn()} onClose={onClose} liftFrom={lift} />
      </BasicAppContext>
    )
  const translateOf = (node: { props: { style?: unknown } }) => {
    const style = StyleSheet.flatten(node.props.style as never) as { transform?: { translateY?: number }[] }
    return style.transform?.find((t) => 'translateY' in t)?.translateY
  }

  const targetsOf = (timing: jest.SpyInstance) =>
    timing.mock.calls.map(([, config]) => config as { toValue: number; useNativeDriver: boolean; duration?: number })

  test('the pass starts where it sat in the stack, and lifts to its place on the native driver', async () => {
    const timing = jest.spyOn(Animated, 'timing')
    try {
      const tree = opened(180)
      expect(translateOf(tree.getByTestId(id('PassOpenLift')))).toBe(180)
      // The lift runs natively (jest does not play native-driven frames), so what is asserted is the animation:
      // to its place (0), on the native driver; and the rest of the card coming in (to 1) after it.
      await waitFor(() => expect(timing).toHaveBeenCalledTimes(2))
      const targets = targetsOf(timing)
      expect(targets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ toValue: 0, useNativeDriver: true }),
          expect.objectContaining({ toValue: 1, useNativeDriver: true, delay: expect.any(Number) }),
        ])
      )
    } finally {
      timing.mockRestore()
    }
  })

  test('Reduce Motion on: nothing travels; the pass is in its place and the rest of the card dissolves in', async () => {
    const reduce = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true)
    const timing = jest.spyOn(Animated, 'timing')
    try {
      const tree = opened(180)
      await waitFor(() => expect(timing).toHaveBeenCalled())
      expect(translateOf(tree.getByTestId(id('PassOpenLift')))).toBe(0)
      // One animation: the dissolve (to 1). No lift (a timing to 0), and the rest does not rise.
      expect(targetsOf(timing)).toEqual([expect.objectContaining({ toValue: 1, useNativeDriver: true })])
      // Known now: a card opened next starts in its place from its first frame.
      const next = opened(240)
      expect(translateOf(next.getAllByTestId(id('PassOpenLift')).slice(-1)[0])).toBe(0)
    } finally {
      reduce.mockRestore()
      timing.mockRestore()
    }
  })

  test('"All cards" above it returns to the stack', () => {
    const onClose = jest.fn()
    const tree = opened(0, onClose)
    fireEvent.press(tree.getByTestId(id('PassOpenClose')))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(tree.getByText('Community.PassAllCards')).toBeTruthy()
  })

  test('a screen reader is told which card opened (the stack it came from is gone)', () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility')
    try {
      opened(40)
      expect(announce).toHaveBeenCalledWith(expect.stringMatching(/keyring-test-vtc|Community\./))
    } finally {
      announce.mockRestore()
    }
  })

  test('opened any other way (the Details screen): no lift, no "All cards", nothing announced', () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility')
    try {
      const tree = show(membershipCard)
      expect(tree.queryByTestId(id('PassOpenClose'))).toBeNull()
      expect(translateOf(tree.getByTestId(id('PassOpenLift')))).toBe(0)
      expect(announce).not.toHaveBeenCalled()
    } finally {
      announce.mockRestore()
    }
  })
})
