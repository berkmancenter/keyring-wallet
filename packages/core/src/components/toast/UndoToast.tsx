/**
 * A toast that says what was just done and offers to undo it (the Messages list's delete, L4): the words, and an
 * Undo button. Undo hides the toast; what it undoes is the caller's (`props.onUndo`).
 *
 * @module components/toast/UndoToast
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native'
import Toast from 'react-native-toast-message'

import { testIdWithKey } from '../../utils/testable'
import { ThemedText } from '../texts/ThemedText'

interface UndoToastProps {
  text?: string
  onUndo?: () => void
}

const UndoToast: React.FC<UndoToastProps> = ({ text, onUndo }) => {
  const { t } = useTranslation()
  const { width } = useWindowDimensions()
  const styles = StyleSheet.create({
    container: {
      width: width - 32,
      minHeight: 52,
      marginTop: 25,
      borderRadius: 12,
      paddingLeft: 16,
      paddingRight: 4,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: '#2E2A2E',
    },
    text: { flex: 1, color: '#FFFFFF', fontSize: 15, lineHeight: 20 },
    undo: { minHeight: 44, minWidth: 64, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
    // A light accent on the dark toast, whatever the theme's brand colours (9.3:1 on #2E2A2E).
    undoText: { color: '#E8C7E8', fontSize: 15, fontWeight: '700' },
  })
  return (
    <View style={styles.container} testID={testIdWithKey('UndoToast')} accessibilityLiveRegion="polite">
      <ThemedText style={styles.text} numberOfLines={2}>
        {text}
      </ThemedText>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t('MessagesList.Undo')}
        testID={testIdWithKey('UndoToastUndo')}
        style={styles.undo}
        onPress={() => {
          onUndo?.()
          Toast.hide()
        }}
      >
        <ThemedText style={styles.undoText}>{t('MessagesList.Undo')}</ThemedText>
      </TouchableOpacity>
    </View>
  )
}

export default UndoToast
