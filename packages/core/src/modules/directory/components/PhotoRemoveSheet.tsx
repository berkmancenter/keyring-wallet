/**
 * Taking the photo off the member's card, asked first: it comes off the card, the community erases a picture no card
 * holds (its own rule, which the phone cannot check), and anyone who already saw it may have kept a copy. Remove
 * writes it; Not now closes the sheet and changes nothing. Scrolls, with its buttons last, as the photo consent does.
 *
 * @module directory/components/PhotoRemoveSheet
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

export interface PhotoRemoveSheetProps {
  visible: boolean
  saving: boolean
  onRemove: () => void
  onClose: () => void
}

export const PhotoRemoveSheet: React.FC<PhotoRemoveSheetProps> = ({ visible, saving, onRemove, onClose }) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.4)' },
    sheet: {
      maxHeight: '92%',
      backgroundColor: ColorPalette.brand.primaryBackground,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
    },
    content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8, gap: 14 },
    title: { ...TextTheme.headingFour, fontSize: 22, color: ColorPalette.brand.text },
  })
  return (
    <SafeAreaModal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        onPress={saving ? undefined : onClose}
        accessibilityRole="button"
        accessibilityLabel={t('Global.Close') as string}
        testID={testIdWithKey('PhotoRemoveBackdrop')}
      />
      <SafeAreaView edges={['bottom']} style={styles.sheet} testID={testIdWithKey('PhotoRemove')}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText style={styles.title} accessibilityRole="header">
            {t('Directory.PhotoRemoveTitle')}
          </ThemedText>
          <ThemedText testID={testIdWithKey('PhotoRemoveBody')}>{t('Directory.PhotoRemoveBody')}</ThemedText>
          <Button
            title={t('Directory.PhotoRemoveConfirm')}
            buttonType={ButtonType.Primary}
            onPress={onRemove}
            disabled={saving}
            testID={testIdWithKey('PhotoRemoveConfirm')}
          >
            {saving ? <ActivityIndicator color={ColorPalette.grayscale.white} /> : null}
          </Button>
          <Button
            title={t('Directory.ConsentNotNow')}
            buttonType={ButtonType.Secondary}
            onPress={onClose}
            disabled={saving}
            testID={testIdWithKey('PhotoRemoveNotNow')}
          />
        </ScrollView>
      </SafeAreaView>
    </SafeAreaModal>
  )
}

export default PhotoRemoveSheet
