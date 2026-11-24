/**
 * The gear in "Your agent"'s header (Alberto, 10-06): it opens Agent
 * settings, as other tabs keep their own tools in the header. The Join menu
 * that sat in the other corner is gone (Alberto, 239): it said again what the
 * page's cards say, and a member joins another community from a row at the
 * page's end (`AgentJoinAnother`).
 *
 * Test id: `AgentSettings` on the gear.
 *
 * @module trust-tasks/screens/AgentHeaderButtons
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { hitSlop } from '../../../constants'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

/**
 * Sized as the app's own header buttons (IconButton): the icon, and a margin
 * on the screen's side only. The header gives each corner what the title (68%
 * of the width) leaves, and with padding on both sides the icon was clipped
 * at the edge (236, iPhone and Pixel). The tap area stays large through
 * `hitSlop`.
 */
const ICON_SIZE = 26
const corner = StyleSheet.create({
  right: { marginRight: 15, paddingVertical: 8 },
})

/** The gear: Agent settings. A dot when something there wants a look. */
export const AgentSettingsButton: React.FC<{ onPress: () => void; testID?: string }> = ({
  onPress,
  testID = testIdWithKey('AgentSettings'),
}) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      style={corner.right}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={t('VtaLink.AgentSettings')}
      testID={testID}
    >
      <Icon name="cog-outline" size={ICON_SIZE} color={ColorPalette.brand.headerIcon} />
    </Pressable>
  )
}
