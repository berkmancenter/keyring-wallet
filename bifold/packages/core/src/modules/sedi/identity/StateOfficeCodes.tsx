/**
 * This phone's codes for a state office: the guardian's holder code (sedi/holder/controller) and the cared-for
 * person's ward code (./phoneIdentity), each shown as a QR and text to copy, made only when the person asks to see it.
 * The ward code can be made this phone's ward ("Use this code on this phone"), so a card naming it checks here.
 * With a demo side set (trust-tasks/module/sediDemoSide: "Set up as the guardian" or "as the ward"), only that side's
 * code is offered; with none, both.
 *
 * Gated at render, not only where it is opened: with trusted approvers or state-verified approvers off (the SEDI/KERI
 * kill included), or no state office on this build (K1's root a placeholder), it draws only that it is off, and its
 * entry row ({@link StateOfficeEntry}) draws nothing. A remote off reaches a screen that is already open.
 *
 * @module sedi/identity/StateOfficeCodes
 */
import { useAgent } from '@bifold/react-hooks'
import Clipboard from '@react-native-clipboard/clipboard'
import { useNavigation } from '@react-navigation/native'
import type { StackNavigationProp } from '@react-navigation/stack'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Platform, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import QRRenderer from '../../../components/misc/QRRenderer'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens, type MyAgentStackParams } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { sediDemoSide } from '../../trust-tasks/module/sediDemoSide'
import { k1Root } from '../guardian/stateRoots'
import { holderCodeOf } from '../holder/controller'

import { StateOfficeCodesIds as Ids } from './StateOfficeCodes.ids'
import { phoneCodesOn } from './phoneCodesOn'
import { becomeOwnWard, wardCodeOf, type IdentityAgent } from './phoneIdentity'

/** Whether the codes may be shown now: both switches on and a state office on this build. Read at each render. */
export const stateOfficeCodesShown = (): boolean => phoneCodesOn() && !!k1Root()

/** The row that opens this screen (on Who approves): nothing at all unless {@link stateOfficeCodesShown}. */
export const StateOfficeEntry: React.FC = () => {
  const { t } = useTranslation()
  const navigation = useNavigation<StackNavigationProp<MyAgentStackParams>>()
  if (!stateOfficeCodesShown()) return null
  return (
    <Button
      title={t('StateOffice.Entry')}
      buttonType={ButtonType.Secondary}
      onPress={() => navigation.navigate(Screens.StateOfficeCodes)}
      testID={testIdWithKey(Ids.entry)}
    />
  )
}

type Code = { aid?: string; failed?: boolean; copied?: boolean }

const StateOfficeCodes: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const { agent } = useAgent()
  const [holder, setHolder] = useState<Code>({})
  const [ward, setWard] = useState<Code>({})
  const [wardSet, setWardSet] = useState(false)

  const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    page: { padding: 20, gap: 14 },
    group: { gap: 10, paddingVertical: 8 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    code: { fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }), fontSize: 13 },
    problem: { color: ColorPalette.semantic.error },
  })

  if (!stateOfficeCodesShown())
    return (
      <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.page}>
          <ThemedText testID={testIdWithKey(Ids.off)}>{t('StateOffice.Off')}</ThemedText>
        </ScrollView>
      </SafeAreaView>
    )

  const a = agent as unknown as IdentityAgent | undefined
  // Read at each render, like the gate above: this phone's demo side, if one is set.
  const side = sediDemoSide()
  const showHolder = async () => {
    if (!a) return
    try {
      setHolder({ aid: await holderCodeOf(a) })
    } catch {
      setHolder({ failed: true })
    }
  }
  const showWard = async () => {
    if (!a) return
    try {
      const aid = await wardCodeOf(a)
      setWard(aid ? { aid } : { failed: true })
    } catch {
      setWard({ failed: true })
    }
  }
  const applyWard = async () => {
    if (!a) return
    try {
      setWardSet((await becomeOwnWard(a)) === 'done')
    } catch {
      setWard((w) => ({ ...w, failed: true }))
    }
  }

  const shown = (code: Code, qr: string, text: string, copy: string, set: (c: Code) => void) =>
    code.aid ? (
      <>
        <QRRenderer value={code.aid} size={200} quietZone={12} testID={qr} />
        <ThemedText selectable style={styles.code} testID={testIdWithKey(text)}>
          {code.aid}
        </ThemedText>
        <Button
          title={code.copied ? t('StateOffice.Copied') : t('StateOffice.Copy')}
          buttonType={ButtonType.Tertiary}
          onPress={() => {
            Clipboard.setString(code.aid as string)
            set({ ...code, copied: true })
          }}
          testID={testIdWithKey(copy)}
        />
      </>
    ) : null

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.page} testID={testIdWithKey(Ids.screen)}>
        <ThemedText>{t('StateOffice.Intro')}</ThemedText>

        {side === 'ward' ? null : (
          <View style={styles.group}>
            <ThemedText variant="bold" accessibilityRole="header">
              {t('StateOffice.HolderTitle')}
            </ThemedText>
            <ThemedText style={styles.muted}>{t('StateOffice.HolderNote')}</ThemedText>
            {holder.aid ? null : (
              <Button
                title={t('StateOffice.ShowHolder')}
                buttonType={ButtonType.Primary}
                onPress={() => void showHolder()}
                testID={testIdWithKey(Ids.showHolder)}
              />
            )}
            {shown(holder, Ids.holderQr, Ids.holderCode, Ids.copyHolder, setHolder)}
          </View>
        )}

        {side === 'guardian' ? null : (
          <View style={styles.group}>
            <ThemedText variant="bold" accessibilityRole="header">
              {t('StateOffice.WardTitle')}
            </ThemedText>
            <ThemedText style={styles.muted}>{t('StateOffice.WardNote')}</ThemedText>
            {ward.aid ? null : (
              <Button
                title={t('StateOffice.ShowWard')}
                buttonType={ButtonType.Secondary}
                onPress={() => void showWard()}
                testID={testIdWithKey(Ids.showWard)}
              />
            )}
            {shown(ward, Ids.wardQr, Ids.wardCode, Ids.copyWard, setWard)}
            {ward.aid && !wardSet ? (
              <Button
                title={t('StateOffice.UseWard')}
                buttonType={ButtonType.Secondary}
                onPress={() => void applyWard()}
                testID={testIdWithKey(Ids.useWard)}
              />
            ) : null}
            {wardSet ? <ThemedText testID={testIdWithKey(Ids.wardSet)}>{t('StateOffice.WardSet')}</ThemedText> : null}
          </View>
        )}

        {holder.failed || ward.failed ? (
          <ThemedText style={styles.problem} testID={testIdWithKey(Ids.problem)}>
            {t('StateOffice.Problem')}
          </ThemedText>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

export default StateOfficeCodes
