import React from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'

import { AGENT_COLORS } from './agentStyle'

export interface RevokeAgentSheetProps {
  /** The agent's name, as the owner gave it. */
  name: string
  /**
   * Whether the agent was added to any room. Without rooms (all of P0) the body is §6's no-room form, "It loses access
   * to your memory. Past messages stay."; with rooms it names the 4-hour tail of a room permission already held.
   */
  inRooms: boolean
  /** "Revoke": the caller runs `revokeAgent` (revoke.ts). */
  onRevoke: () => void
  /** "Keep": closes the sheet; nothing changes. */
  onKeep: () => void
  /** While the revoke runs: the buttons are off and "Revoke" shows a spinner. */
  busy?: boolean
}

const styles = StyleSheet.create({
  sheet: { gap: 16, padding: 20 },
  title: { fontFamily: 'SourceSans3-Bold', fontSize: 22, lineHeight: 28, color: AGENT_COLORS.text },
  body: { fontFamily: 'SourceSans3-Regular', fontSize: 17, lineHeight: 23, color: AGENT_COLORS.text },
  buttons: { gap: 10 },
  button: { minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  revoke: { backgroundColor: AGENT_COLORS.danger },
  revokeText: { fontFamily: 'SourceSans3-Bold', fontSize: 17, color: '#FFFFFF' },
  keep: { backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: AGENT_COLORS.primary },
  keepText: { fontFamily: 'SourceSans3-Bold', fontSize: 17, color: AGENT_COLORS.primary },
})

/**
 * The Revoke sheet (§6, mockup 17; §3.9): "Revoke "<name>"?", what remains after it, and "Revoke" / "Keep". The
 * contents only: the agent details present it in their bottom sheet. It never says the revoke is immediate: a room
 * permission already held can work for up to 4 hours (§3.9, step 7.10).
 */
const RevokeAgentSheet: React.FC<RevokeAgentSheetProps> = ({ name, inRooms, onRevoke, onKeep, busy }) => {
  const { t } = useTranslation()
  return (
    <View style={styles.sheet} testID={testIdWithKey('RevokeAgentSheet')}>
      <ThemedText style={styles.title} accessibilityRole="header">
        {t('ConnectedAgents.RevokeTitle', { name })}
      </ThemedText>
      <ThemedText style={styles.body} testID={testIdWithKey('RevokeAgentBody')}>
        {t(inRooms ? 'ConnectedAgents.RevokeBody' : 'ConnectedAgents.RevokeBodyNoRooms')}
      </ThemedText>
      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.button, styles.revoke]}
          onPress={onRevoke}
          disabled={busy}
          testID={testIdWithKey('RevokeAgentConfirm')}
          accessibilityRole="button"
          accessibilityLabel={t('ConnectedAgents.Revoke')}
          accessibilityState={{ disabled: Boolean(busy), busy: Boolean(busy) }}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <ThemedText style={styles.revokeText}>{t('ConnectedAgents.Revoke')}</ThemedText>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.keep]}
          onPress={onKeep}
          disabled={busy}
          testID={testIdWithKey('RevokeAgentKeep')}
          accessibilityRole="button"
          accessibilityLabel={t('ConnectedAgents.Keep')}
          accessibilityState={{ disabled: Boolean(busy) }}
        >
          <ThemedText style={styles.keepText}>{t('ConnectedAgents.Keep')}</ThemedText>
        </TouchableOpacity>
      </View>
    </View>
  )
}

export default RevokeAgentSheet
