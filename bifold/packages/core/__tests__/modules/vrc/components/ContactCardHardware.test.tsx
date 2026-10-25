/**
 * The default contact card's hardware badge: the badge once verified; while the contact's evidence is still checked,
 * an outline holding its place, so the badge fills in rather than popping in (UI-smoothness plan, Phase 4); nothing
 * otherwise. The `hardwareChecking` prop is optional: a renderer that ignores it shows the badge once verified.
 */
import { render } from '@testing-library/react-native'
import React from 'react'

import ContactCard from '../../../../src/modules/vrc/components/ContactCard'
import { testIdWithKey } from '../../../../src/utils/testable'

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon')

const contact = { issuer: { id: 'did:peer:alice', name: 'Alice' } } as never
const draw = (props: { hardwareVerified: boolean; hardwareChecking?: boolean }) =>
  render(<ContactCard contact={contact} onPress={() => undefined} {...props} />)

describe('the contact card hardware badge', () => {
  it('checking: the outline holds its place, no badge', () => {
    const tree = draw({ hardwareVerified: false, hardwareChecking: true })
    expect(tree.getByTestId(testIdWithKey('ContactHardwareChecking'))).toBeTruthy()
    expect(tree.UNSAFE_queryAllByProps({ name: 'shield-check' })).toHaveLength(0)
  })

  it('verified: the badge, and no outline', () => {
    const tree = draw({ hardwareVerified: true, hardwareChecking: true })
    expect(tree.UNSAFE_queryAllByProps({ name: 'shield-check' })).toHaveLength(1)
    expect(tree.queryByTestId(testIdWithKey('ContactHardwareChecking'))).toBeNull()
  })

  it('neither (or a renderer that never passes checking): nothing', () => {
    const tree = draw({ hardwareVerified: false })
    expect(tree.UNSAFE_queryAllByProps({ name: 'shield-check' })).toHaveLength(0)
    expect(tree.queryByTestId(testIdWithKey('ContactHardwareChecking'))).toBeNull()
  })
})
