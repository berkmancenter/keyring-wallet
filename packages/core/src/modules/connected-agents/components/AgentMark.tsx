import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'

import { AGENT_COLORS, AGENT_ICON } from './agentStyle'

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AGENT_COLORS.avatar,
  },
  tag: {
    borderWidth: 1.5,
    borderColor: AGENT_COLORS.primary,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
    alignSelf: 'center',
  },
  tagText: {
    fontFamily: 'SourceSans3-Bold',
    fontSize: 12,
    lineHeight: 16,
    color: AGENT_COLORS.primary,
  },
})

/**
 * The robot in its avatar circle, where a person has a photo (§6, "The agent icon"). Decorative: whatever draws it
 * also says "AI agent" in words ({@link AgentTag}), so a screen reader never meets the glyph alone.
 */
export const AgentAvatar: React.FC<{ size?: number }> = ({ size = 36 }) => (
  <View
    style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
    accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
    testID={testIdWithKey('AgentAvatar')}
  >
    <Icon name={AGENT_ICON} size={Math.round(size * 0.6)} color={AGENT_COLORS.primary} />
  </View>
)

/** The mark "AI agent" beside an agent's name: the words, outlined (the existing `Rooms.AgentBadge` string). */
export const AgentTag: React.FC = () => {
  const { t } = useTranslation()
  return (
    <View style={styles.tag} testID={testIdWithKey('AgentTag')}>
      <ThemedText style={styles.tagText}>{t('Rooms.AgentBadge')}</ThemedText>
    </View>
  )
}
