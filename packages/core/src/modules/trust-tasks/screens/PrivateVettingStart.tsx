/**
 * The button under a private (hidden) vetting way on Join. Whether this
 * person's agent can carry it is asked only here, on the tap: asking an agent
 * may push a consent request to an approver's phone, so nothing asks while
 * the card draws. On "yes" Join goes on to the identity step; otherwise the
 * reason is said in place, with what the person can do about it.
 *
 * @module trust-tasks/screens/PrivateVettingStart
 */

import { useAgent } from '@bifold/react-hooks'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { VtiCriterion } from '../module/joinManifest'

import { hiddenVettingSeam, type HiddenVettingRefusal } from './hiddenVettingSeam'

/** What each refusal says: what is wrong, and the step that fixes it. */
export const REFUSAL_KEY: Record<HiddenVettingRefusal, string> = {
  suiteUnsupported: 'Join.Ways.PrivateVetting',
  noAgent: 'Join.Ways.PrivateVettingNoAgent',
  agentTooOld: 'Join.Ways.PrivateVettingAgentTooOld',
  phoneNotAllowed: 'Join.Ways.PrivateVettingPhoneNotAllowed',
  cannotTell: 'Join.Ways.PrivateVettingCannotTell',
}

export const PrivateVettingStart: React.FC<{
  criterion?: VtiCriterion
  community: string
  rowId: string
  onReady: () => void
}> = ({ criterion, community, rowId, onReady }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const { agent } = useAgent()
  const [checking, setChecking] = useState(false)
  const [refusal, setRefusal] = useState<HiddenVettingRefusal>()
  const named = { community, interpolation: { escapeValue: false } }

  const onPress = async () => {
    const seam = hiddenVettingSeam()
    // Nothing to ask with (no module, no agent session, the way not read yet): not a cause, just not asked.
    if (!seam || !agent || !criterion) {
      setRefusal('cannotTell')
      return
    }
    setChecking(true)
    setRefusal(undefined)
    try {
      const checked = await seam.check(agent, criterion)
      if (checked.ok) onReady()
      else setRefusal(checked.reason)
    } catch {
      // Not asked at all (offline, no answer): said as that, never guessed as a cause.
      setRefusal('cannotTell')
    } finally {
      setChecking(false)
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <Button
        title={t('Join.Ways.PrivateVettingButton')}
        buttonType={ButtonType.Primary}
        disabled={checking}
        onPress={() => void onPress()}
        testID={testIdWithKey(`JoinPrivateVettingStart_${rowId}`)}
      />
      {checking ? <ActivityIndicator color={ColorPalette.brand.primary} /> : null}
      {refusal ? (
        <ThemedText testID={testIdWithKey(`JoinPrivateVettingRefused_${rowId}`)}>
          {t(REFUSAL_KEY[refusal], named)}
        </ThemedText>
      ) : null}
    </View>
  )
}
