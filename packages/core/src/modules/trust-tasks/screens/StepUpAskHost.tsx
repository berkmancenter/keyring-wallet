/**
 * The agent asks this phone to confirm it is the person before it does a task
 * (a step-up, #200). Its reason is shown here as the agent sent it, before
 * any owner check: on Android the owner check right after an act's own check
 * can pass without a prompt, so the reason cannot live in that prompt alone
 * (228 lab check, 2026-09-29). Mounted above the tabs beside the offline
 * banner, since a step-up can come from any screen's act.
 *
 * @module trust-tasks/screens/StepUpAskHost
 */
import React, { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'

const shortTask = (uri: string) => uri.replace('https://trusttasks.org/spec/', '')

export const StepUpAskHost: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const state = useSyncExternalStore(vtaAgent.subscribe, vtaAgent.getState)
  const ask = state.stepUpAsk
  if (!ask) return null

  const styles = StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'center', padding: 16, backgroundColor: 'rgba(0,0,0,0.5)' },
    card: { gap: 12, padding: 20, borderRadius: 12, backgroundColor: ColorPalette.brand.secondaryBackground },
    reason: { fontStyle: 'italic' },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })

  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => vtaAgent.answerStepUp(ask.id, 'deny')}>
      <View style={styles.backdrop}>
        <View style={styles.card} testID={testIdWithKey('StepUpAsk')} accessibilityViewIsModal>
          <ThemedText variant="headingFour" accessibilityRole="header">
            {t('VtaLink.StepUpTitle')}
          </ThemedText>
          <ThemedText>{t('VtaLink.StepUpBody')}</ThemedText>
          {/* The agent's own words, as it sent them. */}
          <ThemedText style={styles.reason} selectable testID={testIdWithKey('StepUpReason')}>
            {ask.reason}
          </ThemedText>
          {ask.taskType ? (
            <ThemedText style={styles.muted} testID={testIdWithKey('StepUpTask')}>
              {t('VtaLink.StepUpTask', { task: shortTask(ask.taskType), interpolation: { escapeValue: false } })}
            </ThemedText>
          ) : null}
          <Button
            title={t('VtaLink.StepUpConfirm')}
            buttonType={ButtonType.Primary}
            onPress={() => vtaAgent.answerStepUp(ask.id, 'approve')}
            testID={testIdWithKey('StepUpConfirm')}
          />
          <Button
            title={t('VtaLink.StepUpDecline')}
            buttonType={ButtonType.Secondary}
            onPress={() => vtaAgent.answerStepUp(ask.id, 'deny')}
            testID={testIdWithKey('StepUpDecline')}
          />
        </View>
      </View>
    </Modal>
  )
}

export default StepUpAskHost
