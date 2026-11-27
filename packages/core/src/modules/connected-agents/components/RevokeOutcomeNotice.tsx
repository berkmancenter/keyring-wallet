import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'

import { AGENT_COLORS } from './agentStyle'

/**
 * What a revoke came to, as the views show it. `revokeAgentConnection`'s `RevokeOutcome` (revoke.ts) fits it as it
 * is; the views name only the kinds they draw, so they do not import revoke.ts (the revoke is wired by the caller).
 */
export type RevokeViewOutcome = { kind: 'revoked' } | { kind: 'notConfirmed' } | { kind: 'unreachable' }

export interface RevokeOutcomeNoticeProps {
  name: string
  /** What the last revoke came to. `revoked` draws nothing. */
  outcome: RevokeViewOutcome
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
  words: { flex: 1 },
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
 * The line a revoke that did not end leaves (§6, §3.9; canvas frame 17). When the VTA answered but no full listing
 * showed the agent gone: the status "Revoke not confirmed" as a title, with `ConnectedAgents.RevokeNotConfirmedBody`
 * (""<name>" may still have access. Keyring will check again."). When nothing answered: only the line
 * `ConnectedAgents.RevokeUnreachable` ("We couldn't reach your VTA, so "<name>" is still connected."), with no title,
 * as §6 writes it; "Revoke not confirmed" names the other case, and here the agent is plainly still connected (option
 * A, agreed by relay from the plan owner). "Try again" in both. Announced by its text (an
 * alert), not by colour. A view: it never runs the revoke itself.
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
        <View style={styles.words}>
          {outcome.kind === 'notConfirmed' ? (
            <ThemedText style={styles.title}>{t('ConnectedAgents.StatusRevokeNotConfirmed')}</ThemedText>
          ) : null}
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
