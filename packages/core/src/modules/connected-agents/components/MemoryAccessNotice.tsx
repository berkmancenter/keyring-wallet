import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'

import { AGENT_COLORS } from './agentStyle'

export type NoticeMemory = { id: string; name: string }

export interface MemoryAccessNoticeProps {
  /** Contexts on the agent's entry that the owner did not give it (drift, §3.15 step 5). */
  extra: NoticeMemory[]
  /** Memories the owner gave it that the entry no longer names. */
  missing: NoticeMemory[]
  /** "Restore": puts the entry back to what the owner chose. Left out, no button. */
  onRestore?: () => void
  /** "Revoke". Left out until step 7.10 wires the revoke sheet (plan PR, P-f): no button meanwhile. */
  onRevoke?: () => void
  /** The list row draws the notice without its buttons; the details draw them. */
  compact?: boolean
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: '#FFF6E5',
    borderWidth: 1.5,
    borderColor: '#F2C66D',
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  head: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  title: { fontFamily: 'SourceSans3-Bold', fontSize: 17, lineHeight: 23, color: AGENT_COLORS.warnText },
  line: { fontFamily: 'SourceSans3-Regular', fontSize: 17, lineHeight: 23, color: AGENT_COLORS.warnText },
  buttons: { flexDirection: 'row', gap: 10 },
  button: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  restore: { backgroundColor: AGENT_COLORS.primary },
  restoreText: { fontFamily: 'SourceSans3-Bold', fontSize: 17, color: '#FFFFFF' },
  revoke: { backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: AGENT_COLORS.danger },
  revokeText: { fontFamily: 'SourceSans3-Bold', fontSize: 17, color: AGENT_COLORS.danger },
})

/**
 * What Keyring found when it compared the agent's entry with the memories the owner gave it (§3.15 step 5; canvas
 * frame K22): "Its memory access changed." with "Something other than you changed what it can use." when the entry
 * names more, and "Lost access to <memory>." when it names fewer. Draws nothing when the two agree.
 */
const MemoryAccessNotice: React.FC<MemoryAccessNoticeProps> = ({ extra, missing, onRestore, onRevoke, compact }) => {
  const { t } = useTranslation()
  if (extra.length === 0 && missing.length === 0) return null
  const lost =
    missing.length > 0
      ? t('ConnectedAgents.LostAccessTo', { memory: missing.map((m) => m.name).join(', ') })
      : undefined
  const showButtons = !compact && (onRestore || onRevoke)
  return (
    <View style={styles.box} testID={testIdWithKey('MemoryAccessNotice')} accessibilityRole="alert">
      <View style={styles.head}>
        <Icon name="alert-outline" size={24} color={AGENT_COLORS.warnText} accessibilityElementsHidden />
        <View style={{ flex: 1 }}>
          {extra.length > 0 ? (
            <>
              <ThemedText style={styles.title}>{t('ConnectedAgents.MemoryAccessChanged')}</ThemedText>
              <ThemedText style={styles.line}>{t('ConnectedAgents.MemoryAccessChangedLine')}</ThemedText>
              {lost ? <ThemedText style={styles.line}>{lost}</ThemedText> : null}
            </>
          ) : (
            <ThemedText style={styles.title}>{lost}</ThemedText>
          )}
        </View>
      </View>
      {showButtons ? (
        <View style={styles.buttons}>
          {onRestore ? (
            <TouchableOpacity
              style={[styles.button, styles.restore]}
              onPress={onRestore}
              testID={testIdWithKey('MemoryAccessRestore')}
              accessibilityRole="button"
              accessibilityLabel={t('ConnectedAgents.RestoreMemoryAccess')}
            >
              <ThemedText style={styles.restoreText}>{t('ConnectedAgents.RestoreMemoryAccess')}</ThemedText>
            </TouchableOpacity>
          ) : null}
          {onRevoke ? (
            <TouchableOpacity
              style={[styles.button, styles.revoke]}
              onPress={onRevoke}
              testID={testIdWithKey('MemoryAccessRevoke')}
              accessibilityRole="button"
              accessibilityLabel={t('ConnectedAgents.Revoke')}
            >
              <ThemedText style={styles.revokeText}>{t('ConnectedAgents.Revoke')}</ThemedText>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

export default MemoryAccessNotice
