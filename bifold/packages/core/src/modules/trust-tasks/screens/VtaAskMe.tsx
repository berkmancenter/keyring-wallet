/**
 * "Ask me before…": what the agent checks with this phone before it does it.
 *
 * Each switch is one consent rule from this phone, on a task the phone never
 * sends (approvalRules.ts), so a rule here can hold the agent but never the
 * phone. Rules set elsewhere (pnm, openvtc, another phone) are listed
 * read-only, and one that holds a task this phone sends is flagged: the
 * phone would be waiting on an approval itself.
 *
 * Two things this screen cannot change are said plainly: the agent asks only
 * if approvals are switched on where it is hosted (no task reports that
 * setting), and only an administrator of the agent may change its rules.
 * Changing a rule is an owner act: Face ID first, nothing sent without it.
 *
 * @module trust-tasks/screens/VtaAskMe
 */
import { useAgent } from '@bifold/react-hooks'
import { useFocusEffect } from '@react-navigation/native'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { effectiveMinApprovals } from '../module/approvalsPolicy'
import { releaseWarn } from '../module/releaseLog'
import { vtaAgent, type ApprovalRulesState } from '../module/vtaAgent'

import { deviceErrorWords } from './VtaDevices'

const VtaAskMe: React.FC = () => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const [state, setState] = useState<ApprovalRulesState | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState<string | undefined>()
  const [tested, setTested] = useState<string | undefined>()
  const [details, setDetails] = useState(false)

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { padding: 20, gap: 16 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 6 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    grow: { flex: 1 },
    error: { color: ColorPalette.semantic.error },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    mono: { fontFamily: 'Courier', fontSize: 12, color: ColorPalette.grayscale.mediumGrey },
  })

  const wordsFor = useCallback((e: unknown) => deviceErrorWords(e, t), [t])

  const load = useCallback(async () => {
    if (!agent) return
    setError(undefined)
    try {
      setState(await vtaAgent.approvalRules(agent))
    } catch (e) {
      setError(wordsFor(e))
    }
  }, [agent, wordsFor])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const onSwitch = async (taskType: string, on: boolean) => {
    releaseWarn(
      `[VTI] ask me before: ${on ? 'on' : 'off'} ${taskType.split('/spec/')[1] ?? taskType}${agent ? '' : ' (no agent)'}`
    )
    if (!agent) return
    setError(undefined)
    setTested(undefined)
    setBusy(taskType)
    try {
      setState(await vtaAgent.setApprovalRule(agent, taskType, on))
    } catch (e) {
      releaseWarn(
        `[VTI] ask me before: not changed (${(e as Error)?.name ?? 'error'}: ${(e as Error)?.message ?? e}${
          (e as { detail?: string })?.detail ? ` — ${(e as { detail?: string }).detail}` : ''
        })`
      )
      setError(wordsFor(e))
      await load()
    } finally {
      setBusy(undefined)
    }
  }

  const onTest = async () => {
    if (!agent) return
    setError(undefined)
    setTested(undefined)
    setBusy('test')
    try {
      const result = await vtaAgent.sendTestRequest(agent)
      setTested(
        result.kind === 'held'
          ? t('AskMe.TestHeld')
          : t(result.cleanedUp ? 'AskMe.TestLetThrough' : 'AskMe.TestLetThroughKept')
      )
    } catch (e) {
      setError(wordsFor(e))
    } finally {
      setBusy(undefined)
    }
  }

  const ruleWords = (rule: ApprovalRulesState['view']['elsewhere'][number]['rule']) =>
    rule.requires === 'reauth' ? t('AskMe.RuleReauth') : t('AskMe.RuleConsent', { count: effectiveMinApprovals(rule) })

  const canChange = state?.canChange ?? false

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} testID={testIdWithKey('AskMe')}>
        <ThemedText>{t('AskMe.Intro')}</ThemedText>
        <ThemedText style={styles.muted} testID={testIdWithKey('AskMeEnforcement')}>
          {t('AskMe.Enforcement')}
        </ThemedText>
        {error ? (
          <ThemedText style={styles.error} testID={testIdWithKey('AskMeError')}>
            {error}
          </ThemedText>
        ) : null}
        {state === undefined && !error ? (
          <View style={styles.row}>
            <ActivityIndicator color={ColorPalette.brand.primary} />
            <ThemedText style={styles.muted}>{t('AskMe.Loading')}</ThemedText>
          </View>
        ) : null}
        {state && !canChange ? (
          <ThemedText testID={testIdWithKey('AskMeReadOnly')}>
            {t(state.model.unreadable ? 'AskMe.Unreadable' : 'AskMe.OnlyAdmin')}
          </ThemedText>
        ) : null}

        {state?.view.offered.map(({ key, taskType, on, elsewhere }) => {
          const still = !canChange || elsewhere || busy !== undefined
          // The whole row is the switch, pressed like every button in the app: on
          // the #285 device check the bare RN Switch never turned on under a tap,
          // with no owner check, spinner or error (Android emulator, 10-04).
          return (
            <Pressable
              key={key}
              style={[styles.card, styles.row]}
              onPress={() => void onSwitch(taskType, !on)}
              disabled={still}
              accessibilityRole="switch"
              accessibilityLabel={t(`AskMe.Task.${key}`)}
              accessibilityState={{ checked: on, disabled: still, busy: busy === taskType }}
              testID={testIdWithKey(`AskMeSwitch_${key}`)}
            >
              <View style={styles.grow}>
                <ThemedText>{t(`AskMe.Task.${key}`)}</ThemedText>
                {elsewhere ? <ThemedText style={styles.muted}>{t('AskMe.SetElsewhereNamed')}</ThemedText> : null}
                {details ? <ThemedText style={styles.mono}>{taskType}</ThemedText> : null}
              </View>
              {busy === taskType ? <ActivityIndicator color={ColorPalette.brand.primary} /> : null}
              {/* Shown, never pressed: the row takes the press. */}
              <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                <Switch value={on} disabled={still} />
              </View>
            </Pressable>
          )
        })}

        {state?.view.canTest ? (
          <View style={styles.card}>
            <ThemedText style={styles.muted}>{t('AskMe.TestHint')}</ThemedText>
            <Button
              title={t('AskMe.Test')}
              buttonType={ButtonType.Secondary}
              onPress={() => void onTest()}
              disabled={busy !== undefined}
              testID={testIdWithKey('AskMeTest')}
            >
              {busy === 'test' ? <ActivityIndicator color={ColorPalette.brand.primary} /> : undefined}
            </Button>
            {tested ? <ThemedText testID={testIdWithKey('AskMeTested')}>{tested}</ThemedText> : null}
          </View>
        ) : null}

        {state ? <ThemedText style={styles.muted}>{t('AskMe.Nudge')}</ThemedText> : null}

        {state?.view.elsewhere.length ? (
          <View style={{ gap: 8 }} testID={testIdWithKey('AskMeElsewhere')}>
            <ThemedText variant="bold">{t('AskMe.SetElsewhereTitle')}</ThemedText>
            {state.view.elsewhere.map(({ rule, holdsThisPhone, offered }, i) => (
              <View key={`${rule.taskType}-${i}`} style={styles.card}>
                <ThemedText>
                  {offered ? t(`AskMe.Task.${offered}`) : (rule.taskType.split('/spec/')[1] ?? rule.taskType)}
                </ThemedText>
                <ThemedText style={styles.muted}>{ruleWords(rule)}</ThemedText>
                {holdsThisPhone ? (
                  <ThemedText style={styles.error} testID={testIdWithKey('AskMeHoldsThisPhone')}>
                    {t('AskMe.HoldsThisPhone')}
                  </ThemedText>
                ) : null}
                {details ? <ThemedText style={styles.mono}>{JSON.stringify(rule)}</ThemedText> : null}
              </View>
            ))}
          </View>
        ) : null}

        {state ? (
          <Button
            title={t(details ? 'AskMe.HideDetails' : 'AskMe.Details')}
            buttonType={ButtonType.Tertiary}
            onPress={() => setDetails(!details)}
            testID={testIdWithKey('AskMeDetails')}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

export default VtaAskMe
