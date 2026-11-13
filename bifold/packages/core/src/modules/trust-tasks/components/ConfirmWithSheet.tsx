/**
 * "Confirm with {{name}}" from a 1:1 chat's "+" menu: a sheet holding the same row as the contact page's Safety section
 * (ConfirmItsYouRow), opened on the note form. Once sent, the sheet shows where the request stands, as the row does:
 * waiting, confirmed, or the red "not them" card.
 *
 * Its own gate, read at every render: with the "Confirm it's you" switch off or a remote off (isConfirmItsYouEnabled,
 * the switch AND no kill), or with no connection, it shows nothing, even if a parent opened it. The row inside carries
 * the same check again.
 *
 * @module trust-tasks/components/ConfirmWithSheet
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { isConfirmItsYouEnabled } from '../module/confirmItsYouFlag'
import ConfirmItsYouRow from '../screens/ConfirmItsYouRow'

export const ConfirmWithSheetIds = {
  sheet: 'ConfirmWithSheet',
  close: 'ConfirmWithSheetClose',
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
    container: { paddingHorizontal: 24, paddingBottom: 24, paddingTop: 24, gap: 12 },
  })

  return (
    <SafeAreaModal visible transparent animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.overlay} edges={['top']}>
        <SafeAreaView style={styles.safeAreaView} edges={['bottom']}>
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.container}
            testID={testIdWithKey(ConfirmWithSheetIds.sheet)}
          >
            <ConfirmItsYouRow connectionId={connectionId} name={name} startComposing />
            <Button
              title={t('ConfirmItsYou.Close')}
              buttonType={ButtonType.Tertiary}
              onPress={onClose}
              testID={testIdWithKey(ConfirmWithSheetIds.close)}
            />
          </ScrollView>
        </SafeAreaView>
      </SafeAreaView>
    </SafeAreaModal>
  )
}

export default ConfirmWithSheet
