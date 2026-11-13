/**
 * "Confirm with {{name}}" from a 1:1 chat's "+" menu: a sheet holding the short form of the contact page's Safety row
 * (ConfirmItsYouRow variant="sheet", mock D1): one line, the note and Send. Once sent, it shows where the request stands
 * in one line (waiting, confirmed), or the red "not them" card whole. It closes with its ✕, a tap above it, or Back.
 *
 * Its own gate, read at every render: with the "Confirm it's you" switch off or a remote off (isConfirmItsYouEnabled,
 * the switch AND no kill), or with no connection, it shows nothing, even if a parent opened it. The row inside carries
 * the same check again.
 *
 * @module trust-tasks/components/ConfirmWithSheet
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { isConfirmItsYouEnabled } from '../module/confirmItsYouFlag'
import ConfirmItsYouRow from '../screens/ConfirmItsYouRow'

export const ConfirmWithSheetIds = {
  sheet: 'ConfirmWithSheet',
  close: 'ConfirmWithSheetClose',
  backdrop: 'ConfirmWithSheetBackdrop',
} as const

interface Props {
  connectionId: string | null
  /** The contact's name, as the chat shows it. */
  name: string
  visible: boolean
  onClose: () => void
}

const ConfirmWithSheet: React.FC<Props> = ({ connectionId, name, visible, onClose }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  if (!visible || !connectionId || !isConfirmItsYouEnabled()) return null

  const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    safeAreaView: {
      flexShrink: 1,
      backgroundColor: ColorPalette.brand.modalPrimaryBackground,
      borderTopRightRadius: 20,
      borderTopLeftRadius: 20,
    },
    backdrop: { flex: 1 },
    container: { paddingHorizontal: 24, paddingBottom: 24, paddingTop: 16, gap: 12 },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    title: { flex: 1 },
  })

  return (
    <SafeAreaModal visible transparent animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.overlay} edges={['top']}>
        {/* A tap above the sheet closes it, for sighted use only: a screen reader skips it and starts at the title, and
            closes with the ✕ (or the reader's own escape gesture, onRequestClose). */}
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessible={false}
          importantForAccessibility="no"
          accessibilityElementsHidden
          testID={testIdWithKey(ConfirmWithSheetIds.backdrop)}
        />
        <SafeAreaView style={styles.safeAreaView} edges={['bottom']} accessibilityViewIsModal>
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.container}
            testID={testIdWithKey(ConfirmWithSheetIds.sheet)}
          >
            <View style={styles.head}>
              <ThemedText variant="headingFour" style={styles.title}>
                {t('ConfirmItsYou.Title', { name, interpolation: { escapeValue: false } })}
              </ThemedText>
              <Pressable
                onPress={onClose}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={t('ConfirmItsYou.Close')}
                testID={testIdWithKey(ConfirmWithSheetIds.close)}
              >
                <Icon name="close" size={26} color={ColorPalette.brand.text} />
              </Pressable>
            </View>
            <ConfirmItsYouRow connectionId={connectionId} name={name} variant="sheet" />
          </ScrollView>
        </SafeAreaView>
      </SafeAreaView>
    </SafeAreaModal>
  )
}

export default ConfirmWithSheet
