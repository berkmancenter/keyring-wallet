/**
 * What goes on the member's card in a community, asked before anything is sent: each value with who will see it,
 * then that the community's administrators see all of it, including the ID the member joined with (parity plan
 * §9.4). Send writes it; Not now closes the sheet and writes nothing.
 *
 * @module directory/components/CardConsentSheet
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

export interface CardConsentSheetProps {
  visible: boolean
  /** The community, as the screens name it. */
  community: string
  /** The name that would go on the card. */
  name: string
  /** Who would see it, in words ("all members of Keyring Lab"). */
  seenBy: string
  saving: boolean
  onSend: () => void
  onClose: () => void
}

export const CardConsentSheet: React.FC<CardConsentSheetProps> = ({
  visible,
  community,
  name,
  seenBy,
  saving,
  onSend,
  onClose,
}) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const opts = { community, interpolation: { escapeValue: false } }
  const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.4)' },
    sheet: {
      backgroundColor: ColorPalette.brand.primaryBackground,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 20,
      paddingTop: 20,
      gap: 14,
    },
    title: { ...TextTheme.headingFour, fontSize: 22, color: ColorPalette.brand.text },
    value: {
      gap: 2,
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.lightGrey,
    },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })
  return (
    <SafeAreaModal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable
          style={styles.backdrop}
          onPress={saving ? undefined : onClose}
          accessibilityRole="button"
          accessibilityLabel={t('Global.Close') as string}
          testID={testIdWithKey('CardConsentBackdrop')}
        />
        <SafeAreaView edges={['bottom']} style={styles.sheet} testID={testIdWithKey('CardConsent')}>
          <ThemedText style={styles.title} accessibilityRole="header">
            {t('Directory.ConsentTitle', opts)}
          </ThemedText>
          <View style={styles.value} testID={testIdWithKey('CardConsentValue_displayName')}>
            <ThemedText variant="caption" style={styles.muted}>
              {t('Directory.ConsentNameLabel')}
            </ThemedText>
            <ThemedText variant="bold">{name}</ThemedText>
            <ThemedText variant="caption" style={styles.muted}>
              {t('Directory.SeenBy', { who: seenBy, interpolation: { escapeValue: false } })}
            </ThemedText>
          </View>
          <ThemedText testID={testIdWithKey('CardConsentAdmins')}>{t('Directory.ConsentAdmins')}</ThemedText>
          <Button
            title={t('Directory.ConsentSend')}
            buttonType={ButtonType.Primary}
            onPress={onSend}
            disabled={saving}
            testID={testIdWithKey('CardConsentSend')}
          >
            {saving ? <ActivityIndicator color={ColorPalette.grayscale.white} /> : null}
          </Button>
          <Button
            title={t('Directory.ConsentNotNow')}
            buttonType={ButtonType.Secondary}
            onPress={onClose}
            disabled={saving}
            testID={testIdWithKey('CardConsentNotNow')}
          />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </SafeAreaModal>
  )
}

export default CardConsentSheet
