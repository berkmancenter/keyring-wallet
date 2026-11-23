import React from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import EmojiPicker from './EmojiPicker'
import { EmojiPickerIds } from './EmojiPicker.ids'

export interface EmojiPickerSheetProps {
  visible: boolean
  /** Called with the fully-qualified emoji chosen. The caller decides whether the sheet stays open. */
  onSelect: (emoji: string) => void
  onClose: () => void
  /** Once the sheet has finished closing. iOS only, as the modal's onDismiss is: Android never calls it. */
  onClosed?: () => void
}

/**
 * The emoji picker as a sheet over the chat: from the composer's emoji button,
 * and from "+" on a message's reaction bar.
 */
const EmojiPickerSheet: React.FC<EmojiPickerSheetProps> = ({ visible, onSelect, onClose, onClosed }) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()

  const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.3)', justifyContent: 'flex-end' },
    sheet: {
      height: '60%',
      backgroundColor: ColorPalette.brand.primaryBackground,
      borderTopLeftRadius: 12,
      borderTopRightRadius: 12,
      overflow: 'hidden',
    },
    header: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 12, paddingTop: 8 },
    close: { paddingHorizontal: 8, paddingVertical: 4 },
  })

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onDismiss={onClosed}>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessible={false}
        testID={testIdWithKey(EmojiPickerIds.sheetBackdrop)}
      >
        {/* A press inside the sheet must not reach the backdrop. */}
        <Pressable style={styles.sheet} onPress={() => undefined} accessible={false}>
          <SafeAreaView edges={['bottom']} style={{ flex: 1 }} testID={testIdWithKey(EmojiPickerIds.sheet)}>
            <View style={styles.header}>
              <Pressable
                style={styles.close}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={t('Global.Close')}
                testID={testIdWithKey(EmojiPickerIds.sheetClose)}
              >
                <Text style={TextTheme.bold}>{t('Global.Close')}</Text>
              </Pressable>
            </View>
            <EmojiPicker onSelect={onSelect} />
          </SafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

export default EmojiPickerSheet
