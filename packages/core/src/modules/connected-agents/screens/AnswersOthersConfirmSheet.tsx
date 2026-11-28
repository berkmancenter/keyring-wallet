import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'
import type { AnswersOthersSetResult } from '../components/AnswersOthersRow'
import { AGENT_COLORS } from '../components/agentStyle'

export interface AnswersOthersConfirmSheetProps {
  /** The agent's name, for the title. */
  name: string
  /**
   * "Turn on": the caller's `set(true)` from `useAnswersOthers(agentId)`, made only after the person pressed it. The
   * caller closes the sheet when it answers, and sets the row's `notSaved` on `'notSaved'`.
   */
  onTurnOn: () => Promise<AnswersOthersSetResult>
  /** "Keep it off": closes the sheet; nothing is changed. */
  onKeepOff: () => void
}

// Canvas frame 15 (docs/plans/agent-connect-plan/canvas/15-answers-on.png), drawn like frame 23's sheet: a 22 pt
// title, the body in the amber warning box with its triangle, then "Keep it off" filled in Keyring's purple above "Turn
// on" outlined in it. Keeping it off is the filled, first choice.
const styles = StyleSheet.create({
  sheet: { gap: 16, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  title: { fontFamily: 'SourceSans3-Bold', fontSize: 22, lineHeight: 28, color: AGENT_COLORS.text },
  warn: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#FFF6E5',
    borderWidth: 1,
    borderColor: '#F2C66D',
    borderRadius: 10,
    padding: 12,
  },
  warnText: { flex: 1, fontFamily: 'SourceSans3-Regular', fontSize: 17, lineHeight: 24, color: AGENT_COLORS.warnText },
  buttons: { gap: 12 },
  button: { minHeight: 52, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  keep: { backgroundColor: AGENT_COLORS.primary },
  keepText: { fontFamily: 'SourceSans3-Bold', fontSize: 18, color: '#FFFFFF' },
  turnOn: { backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: AGENT_COLORS.primary },
  turnOnText: { fontFamily: 'SourceSans3-Bold', fontSize: 18, color: AGENT_COLORS.primary },
  disabled: { opacity: 0.5 },
})

/**
 * Asked before "Answers other people" is turned on (§3.13, §6; step 7.14; canvas frame 15): "Let "<name>" answer other
 * people?", why it matters, then "Keep it off" / "Turn on". The contents only: the caller presents it in a bottom sheet.
 * "Turn on" calls `onTurnOn` once while it runs, and both buttons are disabled until it answers.
 */
const AnswersOthersConfirmSheet: React.FC<AnswersOthersConfirmSheetProps> = ({ name, onTurnOn, onKeepOff }) => {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  // Once while it runs: the ref holds before the re-render that disables the button, so a second press in the same
  // frame sends nothing.
  const running = useRef(false)
  const mounted = useRef(true)
  useEffect(
    () => () => {
      mounted.current = false
    },
    []
  )

  const turnOn = useCallback(async () => {
    if (running.current) return
    running.current = true
    setBusy(true)
    try {
      await onTurnOn()
    } catch {
      // The hook answers rather than throws; what a throw means is the caller's to show, as for 'notSaved'.
    } finally {
      running.current = false
      if (mounted.current) setBusy(false)
    }
  }, [onTurnOn])

  return (
    <View style={styles.sheet} testID={testIdWithKey('AnswersOnConfirm')}>
      <ThemedText style={styles.title} accessibilityRole="header">
        {t('ConnectedAgents.AnswersOnTitle', { name })}
      </ThemedText>
      <View style={styles.warn} accessible>
        <Icon name="alert-outline" size={22} color={AGENT_COLORS.warnText} accessibilityElementsHidden />
        <ThemedText style={styles.warnText}>{t('ConnectedAgents.AnswersOnBody')}</ThemedText>
      </View>
      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.button, styles.keep, busy && styles.disabled]}
          onPress={onKeepOff}
          disabled={busy}
          testID={testIdWithKey('AnswersOnKeepOff')}
          accessibilityRole="button"
          accessibilityLabel={t('ConnectedAgents.KeepItOff')}
          accessibilityState={{ disabled: busy }}
        >
          <ThemedText style={styles.keepText}>{t('ConnectedAgents.KeepItOff')}</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.turnOn, busy && styles.disabled]}
          onPress={turnOn}
          disabled={busy}
          testID={testIdWithKey('AnswersOnTurnOn')}
          accessibilityRole="button"
          accessibilityLabel={t('ConnectedAgents.TurnOn')}
          accessibilityState={{ disabled: busy, busy }}
        >
          {busy ? (
            <ActivityIndicator color={AGENT_COLORS.primary} />
          ) : (
            <ThemedText style={styles.turnOnText}>{t('ConnectedAgents.TurnOn')}</ThemedText>
          )}
        </TouchableOpacity>
      </View>
    </View>
  )
}

export default AnswersOthersConfirmSheet
