/**
 * A chat's day marker: one small centered pill per day ("Today", "Yesterday", "Wed 15 Oct"). gifted-chat draws it,
 * through `renderDay`, above the first message of each day, and again as the copy that floats at the top while the
 * list scrolls; nothing else in the chat names a day, so a day is never said twice.
 *
 * @module components/chat/DayPill
 */
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { dayLabel, useDateWords } from '../../utils/localDay'
import { testIdWithKey } from '../../utils/testable'

import { ChatIds } from './Chat.ids'

const styles = StyleSheet.create({
  row: { alignItems: 'center', marginVertical: 10 },
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, backgroundColor: '#E6E0E6' },
  // #4A4A4A on #E6E0E6 is 7:1.
  text: { color: '#4A4A4A', fontSize: 13, lineHeight: 18, fontWeight: '600' },
})

export const DayPill: React.FC<{ date: Date }> = ({ date }) => {
  const words = useDateWords()
  return (
    <View style={styles.row} pointerEvents="none">
      <View style={styles.pill}>
        <Text
          style={styles.text}
          // The theme's cap for text (keyring-theme maxFontSizeMultiplier).
          maxFontSizeMultiplier={2}
          accessibilityRole="header"
          testID={testIdWithKey(ChatIds.dayPill)}
        >
          {dayLabel(date, words)}
        </Text>
      </View>
    </View>
  )
}

/**
 * gifted-chat's renderDay: the pill above each day's first message, and the floating copy while scrolling.
 * gifted-chat's DayProps is not exported from the package root; only createdAt is read.
 */
export const renderDayPill = (props: { createdAt?: Date | number }): React.ReactNode =>
  props.createdAt ? <DayPill date={new Date(props.createdAt)} /> : null

export default DayPill
