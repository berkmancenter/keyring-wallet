/**
 * The Community screen's sections (276.10, option A): a small capitalised label over a grouped card of rows, the
 * way Rooms, Directory and About read there. Shared with the rooms and directory sections that screen shows.
 *
 * @module trust-tasks/screens/CommunitySection
 */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'

/** The label over a section: "ROOMS · 2", "DIRECTORY", "ABOUT". */
export const CommunitySectionLabel: React.FC<{ title: string; count?: number; testID?: string }> = ({
  title,
  count,
  testID,
}) => {
  const { ColorPalette } = useTheme()
  return (
    <ThemedText
      variant="label"
      accessibilityRole="header"
      style={{ color: ColorPalette.grayscale.mediumGrey, textTransform: 'uppercase', letterSpacing: 0.8 }}
      testID={testID}
    >
      {count === undefined ? title : `${title} · ${count}`}
    </ThemedText>
  )
}

/** The grouped card the rows of a section sit in. */
export const CommunityGroup: React.FC<{ children: React.ReactNode; style?: StyleProp<ViewStyle> }> = ({
  children,
  style,
}) => {
  const { ColorPalette } = useTheme()
  return (
    <View
      style={[
        {
          backgroundColor: ColorPalette.grayscale.white,
          borderRadius: 12,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: ColorPalette.grayscale.lightGrey,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </View>
  )
}

/** The line between two rows of a group. */
export const CommunityGroupDivider: React.FC = () => {
  const { ColorPalette } = useTheme()
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: ColorPalette.grayscale.lightGrey }} />
}
