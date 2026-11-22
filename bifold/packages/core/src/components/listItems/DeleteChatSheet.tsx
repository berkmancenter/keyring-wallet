/**
 * The question before a chat is deleted from the Messages list (L4), as approved: what goes (every message and
 * photo, from this phone), who keeps a copy (they do; nothing is sent to them), and that the contact stays, with the
 * chat back here when either of them writes again.
 *
 * @module components/listItems/DeleteChatSheet
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../buttons/Button'
import SafeAreaModal from '../modals/SafeAreaModal'
import { ThemedText } from '../texts/ThemedText'
import { useTheme } from '../../contexts/theme'
import { testIdWithKey } from '../../utils/testable'

interface DeleteChatSheetProps {
  visible: boolean
  name: string
  onDelete: () => void
  onCancel: () => void
}

const FACT_ICON = '#4A4A4A'

const DeleteChatSheet: React.FC<DeleteChatSheetProps> = ({ visible, name, onDelete, onCancel }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const words = { name, interpolation: { escapeValue: false } }
  const styles = StyleSheet.create({
    back: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(1,11,19,0.42)' },
    sheet: {
      backgroundColor: ColorPalette.brand.modalPrimaryBackground,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 20,
      paddingBottom: 34,
      gap: 14,
    },
    fact: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
    factText: { flex: 1, fontSize: 15, lineHeight: 21 },
  })
  return (
    <SafeAreaModal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.back}>
        {visible ? (
          <View style={styles.sheet} testID={testIdWithKey('DeleteChatSheet')}>
            <ThemedText variant="headingThree" accessibilityRole="header">
              {t('MessagesList.DeleteTitle', words)}
            </ThemedText>
            <ThemedText>{t('MessagesList.DeleteBody')}</ThemedText>
            <View style={styles.fact}>
              <Icon name="account-arrow-right-outline" size={20} color={FACT_ICON} />
              <ThemedText style={styles.factText}>{t('MessagesList.DeleteTheyKeep', words)}</ThemedText>
            </View>
            <View style={styles.fact}>
              <Icon name="account-check-outline" size={20} color={FACT_ICON} />
              <ThemedText style={styles.factText}>{t('MessagesList.DeleteContactStays', words)}</ThemedText>
            </View>
            <Button
              title={t('MessagesList.DeleteConfirm')}
              buttonType={ButtonType.Critical}
              onPress={onDelete}
              testID={testIdWithKey('DeleteChatConfirm')}
            />
            <Button
              title={t('Global.Cancel')}
              buttonType={ButtonType.Secondary}
              onPress={onCancel}
              testID={testIdWithKey('DeleteChatCancel')}
            />
          </View>
        ) : null}
      </View>
    </SafeAreaModal>
  )
}

export default DeleteChatSheet
