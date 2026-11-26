import React from 'react'
import { useTranslation } from 'react-i18next'
import { Platform, StyleSheet, TouchableOpacity, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { AgentContactCardProps } from '../../../types/agent-contact-card'
import { testIdWithKey } from '../../../utils/testable'

import { AgentAvatar, AgentTag } from './AgentMark'
import { AGENT_COLORS } from './agentStyle'

/**
 * The default drawing of one connected agent among the contacts (§3.14, §6 "Contacts"; canvas frame 9): the robot in
 * place of a photo, the name with the mark "AI agent", the line "Your AI agent", a dashed edge where a person's card
 * has a solid one, and no verification badge. It keeps the person card's height and margins so the two sort together.
 *
 * Registered on `TOKENS.COMPONENT_AGENT_CONTACT_CARD` by the core container.
 */
const styles = StyleSheet.create({
  card: {
    backgroundColor: '#F5F5F5',
    marginHorizontal: 14,
    marginVertical: 4,
    paddingHorizontal: 14,
    height: 62,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: AGENT_COLORS.edge,
    flexDirection: 'row',
    alignItems: 'center',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 4 },
      android: { elevation: 3 },
    }),
  },
  text: { flex: 1, marginLeft: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontFamily: 'SourceSans3-Regular', fontSize: 16, color: AGENT_COLORS.text, flexShrink: 1 },
  subtitle: { fontFamily: 'SourceSans3-Regular', fontSize: 14, lineHeight: 18, color: AGENT_COLORS.muted },
})

const AgentContactCard: React.FC<AgentContactCardProps> = ({
  name,
  subtitle,
  onPress,
  testID = testIdWithKey('AgentContactCard'),
}) => {
  const { t } = useTranslation()
  const line = subtitle ?? t('ConnectedAgents.YourAgent')
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      testID={testID}
      accessible
      accessibilityRole="button"
      // "AI agent" is in the spoken label, so a screen reader hears what the dashed edge shows (§6, Accessibility).
      accessibilityLabel={`${name}, ${t('Rooms.AgentBadge')}, ${line}`}
    >
      <AgentAvatar />
      <View style={styles.text}>
        <View style={styles.nameRow}>
          <ThemedText style={styles.name} numberOfLines={1}>
            {name}
          </ThemedText>
          <AgentTag />
        </View>
        <ThemedText style={styles.subtitle} numberOfLines={1}>
          {line}
        </ThemedText>
      </View>
    </TouchableOpacity>
  )
}

export default AgentContactCard
