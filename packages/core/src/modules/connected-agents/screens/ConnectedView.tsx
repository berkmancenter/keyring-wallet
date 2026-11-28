import React from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'
import AgentActionNotice, { AgentActionLine } from '../components/AgentActionNotice'
import { AgentAvatar, AgentTag } from '../components/AgentMark'
import { AGENT_COLORS } from '../components/agentStyle'

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  avatar: { position: 'relative' },
  tick: {
    position: 'absolute',
    right: -6,
    bottom: -6,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: AGENT_COLORS.okText,
    borderWidth: 3,
    borderColor: '#F4F4F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: 'SourceSans3-Bold',
    fontSize: 22,
    lineHeight: 28,
    color: AGENT_COLORS.text,
    textAlign: 'center',
  },
  line: { fontFamily: 'SourceSans3-Regular', fontSize: 18, color: AGENT_COLORS.text, textAlign: 'center' },
  bar: { padding: 16, gap: 10, borderTopWidth: 1, borderTopColor: '#E7E7E9' },
})

/**
 * Between Approve and the end, while the agent finishes enrolling (the pairing's awaitingEnrolment phase, up to ten
 * minutes before it reads "Not finished"): "Connecting "<name>"…", busy, with no cancel (seam point 5).
 */
export const ConnectingView: React.FC<{ name: string }> = ({ name }) => {
  const { t } = useTranslation()
  const words = t('ConnectedAgents.Connecting', { name })
  return (
    <View
      style={styles.center}
      testID={testIdWithKey('ConnectConnecting')}
      accessible
      accessibilityLabel={words}
      accessibilityState={{ busy: true }}
      accessibilityLiveRegion="polite"
    >
      <AgentAvatar size={88} />
      <ActivityIndicator size="large" />
      <ThemedText style={styles.line}>{words}</ThemedText>
    </View>
  )
}

export interface ConnectedViewProps {
  name: string
  /** The end of the 4-hour grant, formatted for this phone. */
  until: string
  /**
   * "Open chat", once the chat exists (step 7.9). Until then, left out, and the main action is "See details"
   * (#1060, P-e). TODO(#1060 P-e): remove the "See details" path when 7.9 passes this in.
   */
  onOpenChat?: () => void
  onSeeDetails: () => void
  /** "Keep it connected": offered only from step 7.28, and only while the agent is temporary (D42). Left out, no button. */
  onKeepConnected?: () => void
  /**
   * The line "Keep it connected"'s last outcome left (ac's #1122 obligation 1), from the logic's
   * `agentActionLine('keepConnected', code)`: drawn in place of the button, which it spends. Left out, as before.
   */
  keepConnectedLine?: AgentActionLine
}

/**
 * Done (§6 "Done"; canvas frame 5b): the robot with a tick, "<name> is connected.", the mark "AI agent", "Connected
 * until <time>.", the main action, and "Keep it connected" as a secondary one, never pre-selected and only when
 * offered.
 */
const ConnectedView: React.FC<ConnectedViewProps> = ({
  name,
  until,
  onOpenChat,
  onSeeDetails,
  onKeepConnected,
  keepConnectedLine,
}) => {
  const { t } = useTranslation()
  return (
    <View style={styles.screen} testID={testIdWithKey('ConnectConnected')}>
      <View style={styles.center}>
        <View style={styles.avatar}>
          <AgentAvatar size={88} />
          <View style={styles.tick} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Icon name="check" size={18} color="#FFFFFF" />
          </View>
        </View>
        <ThemedText style={styles.title} accessibilityRole="header">
          {t('ConnectedAgents.IsConnected', { name })}
        </ThemedText>
        <AgentTag />
        <ThemedText style={styles.line}>{t('ConnectedAgents.ConnectedUntilSentence', { time: until })}</ThemedText>
      </View>
      <View style={styles.bar}>
        {onOpenChat ? (
          <Button
            title={t('ConnectedAgents.OpenChat')}
            buttonType={ButtonType.Primary}
            onPress={onOpenChat}
            testID={testIdWithKey('ConnectOpenChat')}
            accessibilityLabel={t('ConnectedAgents.OpenChat')}
          />
        ) : (
          <Button
            title={t('ConnectedAgents.SeeDetails')}
            buttonType={ButtonType.Primary}
            onPress={onSeeDetails}
            testID={testIdWithKey('ConnectSeeDetails')}
            accessibilityLabel={t('ConnectedAgents.SeeDetails')}
          />
        )}
        {keepConnectedLine ? (
          <AgentActionNotice line={keepConnectedLine} testID={testIdWithKey('ConnectKeepConnectedLine')} />
        ) : onKeepConnected ? (
          <Button
            title={t('ConnectedAgents.KeepConnected')}
            buttonType={ButtonType.Secondary}
            onPress={onKeepConnected}
            testID={testIdWithKey('ConnectKeepConnected')}
            accessibilityLabel={t('ConnectedAgents.KeepConnected')}
          />
        ) : null}
      </View>
    </View>
  )
}

export default ConnectedView
