/**
 * The agent's status line at app start (IN-48): a phone that has not reached
 * its agent yet is connecting, in a calm colour, not "Offline since" in red.
 * It turns into offline only once the start-up grace has passed.
 */
import { render } from '@testing-library/react-native'
import React from 'react'
import { StyleSheet } from 'react-native'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { ColorPalette } from '../../../theme'
import { testIdWithKey } from '../../../utils/testable'
import { STARTUP_GRACE_MS } from '../module/vtaLinkMachine'
import { VtaStatusLine } from '../screens/VtaStatus'

const since = 1_000
const renderLine = (now: number) =>
  render(
    <BasicAppContext>
      <VtaStatusLine connection={{ kind: 'connecting', since }} now={now} />
    </BasicAppContext>
  )
const dotColor = (tree: ReturnType<typeof render>) =>
  StyleSheet.flatten(tree.getByTestId(testIdWithKey('VtaStatusDot')).props.style).backgroundColor

describe('the status line while the app is still reaching its agent', () => {
  it('says it is connecting, not offline, and is not drawn in the error colour', () => {
    const tree = renderLine(since + STARTUP_GRACE_MS - 1)
    expect(tree.getByTestId(testIdWithKey('VtaStatusText'))).toHaveTextContent('VtaLink.StatusConnecting')
    expect(dotColor(tree)).not.toBe(ColorPalette.semantic.error)
  })

  it('says offline once the start-up grace has passed', () => {
    const tree = renderLine(since + STARTUP_GRACE_MS)
    expect(tree.getByTestId(testIdWithKey('VtaStatusText'))).toHaveTextContent('VtaLink.StatusOfflineSince')
    expect(dotColor(tree)).toBe(ColorPalette.semantic.error)
  })
})
