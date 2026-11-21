/**
 * The QR sits in the middle of its white box. Sized smaller than the box (the
 * link screen draws a 260 dp code in a full-width box), it sat at the left
 * with white space on the right (228, a maintainer's and a tester's screenshots).
 */
import { render } from '@testing-library/react-native'
import React from 'react'
import { StyleSheet } from 'react-native'

import QRRenderer from '../../src/components/misc/QRRenderer'
import { testIdWithKey } from '../../src/utils/testable'
import { BasicAppContext } from '../helpers/app'

test('centres the code in its box', () => {
  const tree = render(
    <BasicAppContext>
      <QRRenderer value="did:key:z6MkNewPhone" size={200} />
    </BasicAppContext>
  )
  const box = StyleSheet.flatten(tree.getByTestId(testIdWithKey('QRRenderer')).props.style)
  expect(box).toMatchObject({ alignItems: 'center', backgroundColor: 'white' })
})
