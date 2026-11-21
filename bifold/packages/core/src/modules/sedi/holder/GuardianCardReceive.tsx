/**
 * A Guardian card from a state office, opened from its link (a scan of the office's QR, or "Open in Keyring" on the
 * pickup page). It checks the card first and keeps nothing until the person taps Keep; Keep checks it again, so what is
 * kept is what was checked at that moment (sedi/holder/receiveGuardianCard).
 *
 * Gated at render, not only where it is opened: with trusted approvers or state-verified approvers off (the SEDI/KERI
 * kill included), or no state office configured on this build, it says so and does nothing, so a remote off reaches a
 * screen that is already open.
 *
 * @module sedi/holder/GuardianCardReceive
 */
import { useAgent } from '@bifold/react-hooks'
import type { RouteProp } from '@react-navigation/native'
import { useRoute } from '@react-navigation/native'
import type { TFunction } from 'i18next'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import type { MyAgentStackParams, Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { k1Root } from '../guardian/stateRoots'
import { phoneCodesOn } from '../identity/phoneCodesOn'
import type { IdentityAgent } from '../identity/phoneIdentity'

import { GuardianCardReceiveIds as Ids } from './GuardianCardReceive.ids'
import { guardianCardUrlOf } from './guardianCardLink'
import {
  checkGuardianCard,
  offerKeptCard,
  receiveGuardianCard,
  type CardCheckFailure,
  type ReceiveResult,
} from './receiveGuardianCard'

type Shown =
  | { kind: 'checking' }
  | { kind: 'badLink' }
  | CardCheckFailure
  | { kind: 'checked'; state: string }
  | { kind: 'keeping'; state: string }
  | ReceiveResult

/** The words for a result, by its kind (and a refusal's reason): plain, never the check's own text. */
export function guardianCardWords(t: TFunction, shown: Shown): string {
  switch (shown.kind) {
    case 'checking':
    case 'keeping':
      return t('GuardianCard.Checking')
    case 'checked':
      return t('GuardianCard.Checked', { state: shown.state, interpolation: { escapeValue: false } })
    case 'kept':
      return t('GuardianCard.Kept', { state: shown.state, interpolation: { escapeValue: false } })
    case 'off':
      return t('GuardianCard.Off')
    case 'noHost':
      return t('GuardianCard.NoHostInBuild')
    case 'hostNotNamed':
      return t('GuardianCard.HostNotNamed')
    case 'badLink':
    case 'wrongHost':
      return t('GuardianCard.WrongPlace')
    case 'unreachable':
      return t('GuardianCard.Unreachable')
    case 'tooLarge':
    case 'badCard':
      return t('GuardianCard.Unreadable')
    case 'notForThisPhone':
      return t('GuardianCard.NotForThisPhone')
    case 'refused':
      if (['revoked', 'revokedInIssuerRecord', 'revokedInStateRecord'].includes(shown.reason))
        return t('GuardianCard.Revoked')
      if (shown.reason === 'stateNotResolved') return t('GuardianCard.Unreachable')
      return t('GuardianCard.DidNotCheckOut')
  }
}

const GuardianCardReceive: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const { agent } = useAgent()
  const route = useRoute<RouteProp<MyAgentStackParams, Screens.GuardianCardReceive>>()
  const link = route.params?.link ?? ''
  const [shown, setShown] = useState<Shown>({ kind: 'checking' })
  // The people the kept card went to (their earlier yes to sending it); anyone never asked gets the question sheet.
  const [sentTo, setSentTo] = useState<string[]>([])
  const on = phoneCodesOn() && !!k1Root()

  useEffect(() => {
    if (!on || !agent) return
    const url = guardianCardUrlOf(link)
    if (!url) {
      setShown({ kind: 'badLink' })
      return
    }
    let live = true
    void checkGuardianCard(agent as unknown as IdentityAgent, url).then((r) => {
      if (!live) return
      setShown(r.kind === 'checked' ? { kind: 'checked', state: r.state } : r)
    })
    return () => {
      live = false
    }
  }, [on, agent, link])

  const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    page: { padding: 20, gap: 16 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })

  if (!on)
    return (
      <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.page}>
          <ThemedText testID={testIdWithKey(Ids.off)}>{t('GuardianCard.Off')}</ThemedText>
        </ScrollView>
      </SafeAreaView>
    )

  const keep = async () => {
    const url = guardianCardUrlOf(link)
    if (!agent || !url || shown.kind !== 'checked') return
    setShown({ kind: 'keeping', state: shown.state })
    const kept = await receiveGuardianCard(
      agent as unknown as IdentityAgent & Parameters<typeof receiveGuardianCard>[0],
      url
    )
    setShown(kept)
    if (kept.kind === 'kept') setSentTo(await offerKeptCard(agent))
  }

  const busy = shown.kind === 'checking' || shown.kind === 'keeping'
  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.page} testID={testIdWithKey(Ids.screen)}>
        {busy ? <ActivityIndicator testID={testIdWithKey(Ids.checking)} color={ColorPalette.brand.primary} /> : null}
        <ThemedText testID={testIdWithKey(Ids.result)}>{guardianCardWords(t, shown)}</ThemedText>
        {shown.kind === 'checked' ? (
          <>
            <ThemedText style={styles.muted}>{t('GuardianCard.KeepNote')}</ThemedText>
            <Button
              title={t('GuardianCard.Keep')}
              buttonType={ButtonType.Primary}
              onPress={() => void keep()}
              testID={testIdWithKey(Ids.keep)}
            />
          </>
        ) : null}
        {shown.kind === 'kept' ? (
          <ThemedText style={styles.muted} testID={testIdWithKey(Ids.kept)}>
            {t('GuardianCard.KeptNote')}
          </ThemedText>
        ) : null}
        {shown.kind === 'kept' && sentTo.length > 0 ? (
          <ThemedText>
            {t('GuardianCard.SentTo', { names: sentTo.join(', '), interpolation: { escapeValue: false } })}
          </ThemedText>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

export default GuardianCardReceive
