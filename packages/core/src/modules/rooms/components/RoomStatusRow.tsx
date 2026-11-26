/**
 * A row for one rooms operation. Available: a button that does it. Otherwise: shown but disabled, with the
 * status line from `roomsStatusText` ("Coming soon", "Not available yet", "Your agent needs an update", …)
 * and no action at all, so a row never pretends to work.
 *
 * @module rooms/components/RoomStatusRow
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import type { OperationStatus, RoomsOperation } from '../types'

import { roomsStatusText } from './roomsStatusText'

export interface RoomStatusRowProps {
  label: string
  status: OperationStatus
  /** What the row does, so a missing right is worded for it ("You can't post here"). */
  operation?: RoomsOperation
  /** Runs only when the operation is available. */
  onPress?: () => void
  testID?: string
}

export const RoomStatusRow: React.FC<RoomStatusRowProps> = ({ label, status, operation, onPress, testID }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const note = roomsStatusText(t, status, operation)
  const available = note === undefined
  const styles = StyleSheet.create({
    row: {
      minHeight: 48,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 10,
      backgroundColor: ColorPalette.brand.secondaryBackground,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      opacity: available ? 1 : 0.6,
    },
    label: { flex: 1, color: available ? ColorPalette.brand.primary : ColorPalette.grayscale.darkGrey },
    note: { fontSize: 13, color: ColorPalette.grayscale.mediumGrey },
  })
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={note ? `${label}, ${note}` : label}
      accessibilityState={{ disabled: !available }}
      disabled={!available}
      onPress={available ? onPress : undefined}
      style={styles.row}
      testID={testID}
    >
      <ThemedText style={styles.label}>{label}</ThemedText>
      {note ? (
        <View>
          <ThemedText style={styles.note}>{note}</ThemedText>
        </View>
      ) : null}
    </Pressable>
  )
}

export default RoomStatusRow
