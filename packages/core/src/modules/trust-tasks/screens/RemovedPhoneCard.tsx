/**
 * A removed phone, told where it lands (#10). Its agent no longer accepts it:
 * over TSP its next call is refused "not in ACL", and that refusal can happen
 * innocently, so it never erases itself. It says it is no longer linked and
 * offers Erase this phone's copy and Link again at equal weight, nothing
 * preselected; Erase says what goes and what stays and asks once more. A
 * positive wipe signal changes the words, not the choice (226).
 *
 * Shown on the link screen and on My Agent's landings (the agent screen and
 * My Agent), wherever the phone lands first: a removed phone that met the
 * plain "Link your agent" prompt was never told why (226 gate).
 *
 * @module trust-tasks/screens/RemovedPhoneCard
 */
import { useAgent } from '@bifold/react-hooks'
import { useNavigation } from '@react-navigation/native'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'
import type { VtaLinkState } from '../module/vtaLinkMachine'

import { agentDisplayNameStart } from './agentName'
import { openScanner } from './openScanner'
import { plainError } from './plainError'

type RevokedLink = Extract<VtaLinkState, { kind: 'revoked' }>

/**
 * Whether this phone's copy was just erased, so the screen that follows (the
 * unlinked one) can say so. Cleared by {@link clearJustErased} once the phone
 * links again.
 */
let justErased = false
export const wasJustErased = (): boolean => justErased
export const clearJustErased = (): void => {
  justErased = false
}

/** "This phone's copy is erased…", for the screen that follows an erase. */
export const ErasedNotice: React.FC = () => {
  const { t } = useTranslation()
  return wasJustErased() ? (
    <ThemedText testID={testIdWithKey('VtaLinkErased')}>{t('VtaLink.RevokedErased')}</ThemedText>
  ) : null
}

export const RemovedPhoneCard: React.FC<{ link: RevokedLink }> = ({ link }) => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const navigation = useNavigation()
  const { ColorPalette } = useTheme()
  const [confirmErase, setConfirmErase] = useState(false)
  const [erasing, setErasing] = useState(false)
  const [eraseError, setEraseError] = useState<string | undefined>()

  const styles = StyleSheet.create({
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 12 },
    error: { color: ColorPalette.semantic.error },
    // Two choices of equal weight, side by side.
    pair: { flexDirection: 'row', gap: 12 },
    pairItem: { flex: 1 },
  })

  const onErase = useCallback(async () => {
    if (!agent) return
    setEraseError(undefined)
    setErasing(true)
    try {
      await vtaAgent.eraseThisPhonesCopy(agent)
      justErased = true
      setConfirmErase(false)
    } catch (e) {
      setEraseError(t(plainError(e).line))
    } finally {
      setErasing(false)
    }
  }, [agent, t])

  const onLinkAgain = useCallback(() => {
    vtaAgent.relink()
    openScanner(navigation)
  }, [navigation])

  const wiped = link.cause === 'wiped'

  return (
    <View style={styles.card} testID={testIdWithKey('RemovedPhone')}>
      <ThemedText variant="headingThree" accessibilityRole="header">
        {t('VtaLink.RevokedTitle')}
      </ThemedText>
      <ThemedText style={styles.error} testID={testIdWithKey('VtaLinkError')}>
        {t(wiped ? 'VtaLink.RevokedBodyWiped' : 'VtaLink.RevokedBody', {
          label: agentDisplayNameStart(link, t),
          interpolation: { escapeValue: false },
        })}
      </ThemedText>
      {confirmErase ? (
        <ThemedText testID={testIdWithKey('VtaLinkEraseWhat')}>{t('VtaLink.RevokedEraseWhat')}</ThemedText>
      ) : null}
      {eraseError ? (
        <ThemedText style={styles.error} testID={testIdWithKey('VtaLinkEraseError')}>
          {eraseError}
        </ThemedText>
      ) : null}
      {confirmErase ? (
        <View style={styles.pair}>
          <View style={styles.pairItem}>
            <Button
              title={t('VtaLink.RevokedEraseKeep')}
              buttonType={ButtonType.Secondary}
              onPress={() => setConfirmErase(false)}
              disabled={erasing}
              testID={testIdWithKey('VtaLinkEraseKeep')}
            />
          </View>
          <View style={styles.pairItem}>
            <Button
              title={t('VtaLink.RevokedEraseConfirm')}
              buttonType={ButtonType.Secondary}
              onPress={() => void onErase()}
              disabled={erasing}
              testID={testIdWithKey('VtaLinkEraseConfirm')}
            >
              {erasing ? <ActivityIndicator color={ColorPalette.brand.primary} /> : null}
            </Button>
          </View>
        </View>
      ) : (
        <View style={styles.pair}>
          <View style={styles.pairItem}>
            <Button
              title={t('VtaLink.RevokedErase')}
              buttonType={ButtonType.Secondary}
              onPress={() => setConfirmErase(true)}
              testID={testIdWithKey('VtaLinkErase')}
            />
          </View>
          <View style={styles.pairItem}>
            <Button
              title={t('VtaLink.RevokedLinkAgain')}
              buttonType={ButtonType.Secondary}
              onPress={onLinkAgain}
              testID={testIdWithKey('VtaLinkScanAgain')}
            />
          </View>
        </View>
      )}
    </View>
  )
}
