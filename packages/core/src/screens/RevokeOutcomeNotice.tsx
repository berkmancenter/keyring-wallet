import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../components/texts/ThemedText'
import { AGENT_COLORS } from '../modules/connected-agents/components/agentStyle'
import type { RevokeOutcome } from '../modules/connected-agents/revoke'
import { testIdWithKey } from '../utils/testable'

export interface RevokeOutcomeNoticeProps {
  name: string
  /** What the last revoke came to. `revoked` draws nothing. */
  outcome: RevokeOutcome
  /** "Try again": runs the revoke again. Left out, no button. */
  onTryAgain?: () => void
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: AGENT_COLORS.warnBg,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  head: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  title: { fontFamily: 'SourceSans3-Bold', fontSize: 17, lineHeight: 23, color: AGENT_COLORS.warnText },
  line: { fontFamily: 'SourceSans3-Regular', fontSize: 17, lineHeight: 23, color: AGENT_COLORS.warnText },
  button: {
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AGENT_COLORS.primary,
  },
  buttonText: { fontFamily: 'SourceSans3-Bold', fontSize: 17, color: '#FFFFFF' },
})

/**
 * The agent details' line while a revoke is not confirmed (§6, §3.9): "Revoke not confirmed" with ""<name>" may still
 * have access. Keyring will check again." when the VTA answered but a full listing did not show the agent gone, or
 * "We couldn't reach your VTA, so "<name>" is still connected." when nothing answered; "Try again" in both. Announced
 * by its text (an alert), not by colour.
 */
const RevokeOutcomeNotice: React.FC<RevokeOutcomeNoticeProps> = ({ name, outcome, onTryAgain }) => {
  const { t } = useTranslation()
  if (outcome.kind === 'revoked') return null
  const line =
    outcome.kind === 'unreachable'
      ? t('ConnectedAgents.RevokeUnreachable', { name })
      : t('ConnectedAgents.RevokeNotConfirmedBody', { name })
  return (
    <View style={styles.box} testID={testIdWithKey('RevokeOutcomeNotice')} accessibilityRole="alert">
      <View style={styles.head}>
        <Icon name="alert-outline" size={24} color={AGENT_COLORS.warnText} accessibilityElementsHidden />
        <View style={{ flex: 1 }}>
          <ThemedText style={styles.title}>{t('ConnectedAgents.StatusRevokeNotConfirmed')}</ThemedText>
          <ThemedText style={styles.line}>{line}</ThemedText>
        </View>
      </View>
      {onTryAgain ? (
        <TouchableOpacity
          style={styles.button}
          onPress={onTryAgain}
          testID={testIdWithKey('RevokeTryAgain')}
          accessibilityRole="button"
          accessibilityLabel={t('ConnectedAgents.TryAgain')}
        >
          <ThemedText style={styles.buttonText}>{t('ConnectedAgents.TryAgain')}</ThemedText>
        </TouchableOpacity>
      ) : null}
    </View>
  )
}

export default RevokeOutcomeNotice
