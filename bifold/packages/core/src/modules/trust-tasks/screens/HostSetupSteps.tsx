/**
 * Where an agent host's setup has got to, as named steps with the time the
 * current one has taken. It used to be one fixed sentence ("Waiting for your
 * agent…") for anything up to several minutes, while the phone knew all along
 * whether the host was still creating the agent, or the phone was signing in,
 * and which try that was. One clock runs from the first step.
 *
 * @module trust-tasks/screens/HostSetupSteps
 */

import type { TFunction } from 'i18next'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { HostSetupStage } from '../module/vtaLinkMachine'

export interface HostSetupRow {
  key: 'creating' | 'connecting'
  label: string
  state: 'done' | 'current' | 'pending'
  /** How long the whole setup has taken, as m:ss: one clock, shown beside the current step. */
  elapsed?: string
}

/** A duration as m:ss — "0:42", "3:05". */
export function elapsedClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** The two steps a person sees, from where the setup has got to. */
export function hostSetupRows(stage: HostSetupStage | undefined, now: number, t: TFunction): HostSetupRow[] {
  if (!stage) return []
  const creating = stage.step === 'creating'
  const elapsed = elapsedClock(now - stage.startedAt)
  // A retry says it is still trying, and which try — never out of how many,
  // which read as a countdown to failure. The last try's failure says so itself.
  const connectingLabel =
    stage.step === 'signingIn' && stage.attempt
      ? (t('VtaLink.Host.Steps.SigningIn', { attempt: stage.attempt }) as string)
      : (t('VtaLink.Host.Steps.Connecting') as string)
  return [
    {
      key: 'creating',
      label: t('VtaLink.Host.Steps.Creating') as string,
      state: creating ? 'current' : 'done',
      ...(creating ? { elapsed } : {}),
    },
    {
      key: 'connecting',
      label: connectingLabel,
      state: creating ? 'pending' : 'current',
      ...(creating ? {} : { elapsed }),
    },
  ]
}

export const HostSetupSteps: React.FC<{ stage?: HostSetupStage }> = ({ stage }) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!stage) return
    setNow(Date.now())
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [stage])
  const styles = StyleSheet.create({
    steps: { gap: 10 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    icon: { width: 22, alignItems: 'center' },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })
  return (
    <View style={styles.steps} testID={testIdWithKey('VtaLinkHostSteps')}>
      {hostSetupRows(stage, now, t).map((row) => (
        <View key={row.key} style={styles.row} testID={testIdWithKey(`VtaLinkHostStep_${row.key}`)}>
          <View style={styles.icon}>
            {row.state === 'current' ? (
              <ActivityIndicator color={ColorPalette.brand.primary} />
            ) : (
              <Icon
                name={row.state === 'done' ? 'check-circle' : 'circle-outline'}
                size={20}
                color={row.state === 'done' ? ColorPalette.brand.primary : TextTheme.normal.color}
              />
            )}
          </View>
          <ThemedText
            style={[{ flex: 1 }, row.state === 'pending' ? styles.muted : undefined]}
            testID={testIdWithKey(row.state === 'current' ? 'VtaLinkState' : `VtaLinkHostStepLabel_${row.key}`)}
          >
            {row.label}
          </ThemedText>
          {row.elapsed ? (
            <ThemedText style={styles.muted} testID={testIdWithKey('VtaLinkHostStepElapsed')}>
              {row.elapsed}
            </ThemedText>
          ) : null}
        </View>
      ))}
    </View>
  )
}

export default HostSetupSteps
