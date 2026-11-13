/**
 * "Check that your agent waits for them": the practice request (approverEnforcementCheck.ts), as one card any screen
 * can show. It runs a live probe with side effects, so only on a tap, never on open or focus; the last result for
 * this agent this session shows until the next tap.
 *
 * Shown on Developer › Demos only (B7, Alberto 11-12: "move the practice request to Developer"). Who approves no
 * longer shows it; after an add it says where the check is (Approver.CheckAfterAdd, under `checkPrompt`). Renders
 * nothing with the trusted-approvers switch off (or its remote off), read at each render, wherever it is placed.
 *
 * @module trust-tasks/screens/approver/EnforcementCheckCard
 */
import { useAgent } from '@bifold/react-hooks'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, View } from 'react-native'

import Button, { ButtonType } from '../../../../components/buttons/Button'
import { ThemedText } from '../../../../components/texts/ThemedText'
import { useTheme } from '../../../../contexts/theme'
import { testIdWithKey } from '../../../../utils/testable'
import { isTrustedApproversEnabled } from '../../module/trustedApproversFlag'
import { vtaAgent } from '../../module/vtaAgent'
import { checkEnforcement, lastEnforcementCheck, type EnforcementCheck } from '../approverEnforcementCheck'

/**
 * The IDs this card has always rendered under (the strings are kept; only this object holds them). `checkPrompt` is now
 * Who approves' line after an add, pointing here; the card itself no longer renders it.
 */
export const EnforcementCheckIds = {
  check: 'TrustedApproversCheck',
  checkResult: 'TrustedApproversCheckResult',
  checkPrompt: 'TrustedApproversCheckPrompt',
} as const

export interface EnforcementCheckCardProps {
  /** The host screen is writing something: the button waits, as every other button there does. */
  hostBusy?: boolean
  /** Told when the probe starts and ends, so the host screen can hold its own buttons meanwhile. */
  onBusy?: (busy: boolean) => void
}

export const EnforcementCheckCard: React.FC<EnforcementCheckCardProps> = ({ hostBusy, onBusy }) => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const [checked, setChecked] = useState<EnforcementCheck | undefined>(() =>
    lastEnforcementCheck(vtaAgent.getState().vtaDid)
  )
  const [busy, setBusy] = useState(false)

  if (!isTrustedApproversEnabled()) return null

  // A live probe with side effects (approverEnforcementCheck.ts): only ever on a tap.
  const onCheck = async () => {
    if (!agent) return
    setBusy(true)
    onBusy?.(true)
    try {
      setChecked(await checkEnforcement(agent))
    } finally {
      setBusy(false)
      onBusy?.(false)
    }
  }

  return (
    <View
      style={{ backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 6 }}
      testID={testIdWithKey(EnforcementCheckIds.check)}
    >
      <ThemedText style={{ color: ColorPalette.grayscale.mediumGrey }}>{t('Approver.CheckHint')}</ThemedText>
      <Button
        title={t('Approver.Check')}
        buttonType={ButtonType.Secondary}
        onPress={() => void onCheck()}
        disabled={busy || hostBusy === true}
        testID={testIdWithKey(`${EnforcementCheckIds.check}Button`)}
      >
        {busy ? <ActivityIndicator color={ColorPalette.brand.primary} /> : undefined}
      </Button>
      {checked ? (
        <View testID={testIdWithKey(EnforcementCheckIds.checkResult)} style={{ gap: 4 }}>
          <ThemedText>
            {checked.kind === 'held'
              ? t('Approver.CheckHeld')
              : checked.kind === 'letThrough'
                ? t('Approver.CheckNotOn')
                : checked.kind === 'wouldReachOthers'
                  ? t('Approver.CheckWouldReachOthers')
                  : checked.kind === 'needsTestRule'
                    ? t('Approver.CheckNeedsTestRule', {
                        task: t('AskMe.Task.contextsCreate'),
                        interpolation: { escapeValue: false },
                      })
                    : t('Approver.CheckUnknown')}
          </ThemedText>
          {checked.kind === 'letThrough' && checked.kept ? (
            <ThemedText style={{ color: ColorPalette.grayscale.mediumGrey }}>
              {t('AskMe.TestLetThroughKept')}
            </ThemedText>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

export default EnforcementCheckCard
