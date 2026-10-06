/**
 * A line between a page's sections, so it is clear where each one ends: on
 * the theme's background the cards' own edges do not show (Alberto, 239).
 * Each section opens with a heading of one style (`labelTitle`). Used on
 * "Your agent" and Agent settings.
 *
 * @module trust-tasks/screens/SectionRule
 */
import React from 'react'
import { StyleSheet, View } from 'react-native'

import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

export const SectionRule: React.FC = () => {
  const { ColorPalette } = useTheme()
  return (
    <View
      style={{ height: StyleSheet.hairlineWidth, backgroundColor: ColorPalette.grayscale.lightGrey }}
      testID={testIdWithKey('AgentSectionRule')}
    />
  )
}
