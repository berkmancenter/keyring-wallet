/**
 * One pass: a neutral face until the community's look is known (no monogram, no pattern, never the default look
 * first), then its colour and monogram or logo; its dates in front only; the time left when it is soon.
 */
import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { StyleSheet } from 'react-native'

import { testIdWithKey } from '../../../utils/testable'
import CommunityPass from '../components/CommunityPass'
import type { CommunityBrand } from '../module/communityBrand'
import type { PassFace } from '../screens/communityPass'

const face: PassFace = {
  communityDid: 'did:webvh:Qm:dids.example.org:harbor',
  published: 'Harbor Tenants Union',
  title: 'Harbor Tenants Union',
  kind: 'Member',
  field: { label: 'Member since', value: '14 Mar 2026' },
  secondField: { label: 'Valid until', value: '14 Mar 2027' },
  accessibilityLabel: 'Harbor Tenants Union, Member, Member since 14 Mar 2026',
}
const brand: CommunityBrand = { color: '#265373', pattern: 'waves', monogram: 'HU', fromAccent: false }
const passOf = (tree: ReturnType<typeof render>) => tree.getByTestId(testIdWithKey('CommunityPass'))
const backgroundOf = (tree: ReturnType<typeof render>) => StyleSheet.flatten(passOf(tree).props.style).backgroundColor

describe('a community pass', () => {
  test('while the look is unknown: a neutral face with the name, no monogram', () => {
    const tree = render(<CommunityPass face={face} brand={{ known: false }} front onPress={jest.fn()} />)
    expect(backgroundOf(tree)).toBe('#4A4F57')
    expect(tree.getByText('Harbor Tenants Union')).toBeTruthy()
    expect(tree.queryByText('HU')).toBeNull()
  })

  test('once known: the community’s colour and monogram', () => {
    const tree = render(<CommunityPass face={face} brand={{ known: true, value: brand }} front onPress={jest.fn()} />)
    expect(backgroundOf(tree)).toBe('#265373')
    expect(tree.getByText('HU')).toBeTruthy()
  })

  test('a kept logo takes the monogram’s place', () => {
    const tree = render(
      <CommunityPass
        face={face}
        brand={{ known: true, value: { ...brand, logo: 'file:///caches/community-logos/abc' } }}
        front
        onPress={jest.fn()}
      />
    )
    expect(tree.queryByText('HU')).toBeNull()
    expect(tree.getByTestId(testIdWithKey('CommunityPassLogo')).props.source).toEqual({
      uri: 'file:///caches/community-logos/abc',
    })
  })

  test('in front, its dates; tucked behind another, its strip only', () => {
    const front = render(<CommunityPass face={face} brand={{ known: true, value: brand }} front onPress={jest.fn()} />)
    expect(front.getByText('14 Mar 2026')).toBeTruthy()
    expect(front.getByText('14 Mar 2027')).toBeTruthy()
    const tucked = render(
      <CommunityPass face={face} brand={{ known: true, value: brand }} front={false} onPress={jest.fn()} />
    )
    expect(tucked.getByText('Harbor Tenants Union')).toBeTruthy()
    expect(tucked.queryByText('14 Mar 2026')).toBeNull()
  })

  test('the time left shows on the strip, so it shows tucked too; a screen reader hears the whole face', () => {
    const tree = render(
      <CommunityPass
        face={{ ...face, lapsing: '19 days left' }}
        brand={{ known: true, value: brand }}
        front={false}
        onPress={jest.fn()}
      />
    )
    expect(tree.getByTestId(testIdWithKey('CommunityPassLapsing'))).toHaveTextContent('19 days left')
    expect(passOf(tree).props.accessibilityLabel).toBe(face.accessibilityLabel)
  })

  test('the holding agent, when the phone has several, shows on the strip', () => {
    const tree = render(
      <CommunityPass
        face={{ ...face, agent: 'Personal' }}
        brand={{ known: true, value: brand }}
        front={false}
        onPress={jest.fn()}
      />
    )
    expect(tree.getByTestId(testIdWithKey('CommunityPassAgent'))).toHaveTextContent('Personal')
  })

  test('a card the Wallet knows is revoked says so on its strip, and to a screen reader', () => {
    const tree = render(
      <CommunityPass
        face={face}
        brand={{ known: true, value: brand }}
        front={false}
        onPress={jest.fn()}
        status="Revoked"
      />
    )
    expect(tree.getByTestId(testIdWithKey('CommunityPassStatus'))).toHaveTextContent('Revoked')
    expect(passOf(tree).props.accessibilityLabel).toBe(`${face.accessibilityLabel}, Revoked`)
  })

  test('a tap opens it', () => {
    const onPress = jest.fn()
    const tree = render(<CommunityPass face={face} brand={{ known: true, value: brand }} front onPress={onPress} />)
    fireEvent.press(passOf(tree))
    expect(onPress).toHaveBeenCalledTimes(1)
  })
})
