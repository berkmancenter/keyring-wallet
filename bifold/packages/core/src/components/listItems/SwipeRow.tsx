/**
 * A Messages row with one action behind it (the Messages list, L4; rooms in Messages, R3): a swipe left shows it,
 * and a long press or a screen reader's custom action does the same thing without the swipe. A chat's row carries
 * Delete, a room's Hide.
 *
 * The row's own touchable takes the long press and the screen reader's action, so the row stays one element with
 * one label; `children` gets those props to spread on it. Whatever the action then asks (a question, an Undo) is
 * the caller's: this only opens the way to it, and closes the swipe first.
 *
 * Needs a gesture-handler root view above it: the Messages list has one (the app has none of its own).
 *
 * @module components/listItems/SwipeRow
 */
import React, { useCallback, useRef } from 'react'
import { StyleSheet, TouchableOpacity, type AccessibilityActionEvent } from 'react-native'
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../texts/ThemedText'

/** The action's colour: red for what deletes, a dark grey for what only puts a row away. */
const TONE = { destructive: '#D21E30', neutral: '#4A4A4A' } as const

export interface SwipeRowAction {
  /** The screen reader's action name for it (`delete`, `hide`). */
  name: string
  /** Its words: on the action, and as the screen reader's action. */
  label: string
  /** A MaterialCommunityIcons name. */
  icon: string
  tone: keyof typeof TONE
  /** Width of the action behind the row. */
  width?: number
  onPress: () => void
  testID?: string
}

/** What the row's own touchable spreads on itself. */
export interface SwipeRowTouchProps {
  onLongPress: () => void
  accessibilityActions: { name: string; label: string }[]
  onAccessibilityAction: (event: AccessibilityActionEvent) => void
}

export interface SwipeRowProps {
  action: SwipeRowAction
  children: (touch: SwipeRowTouchProps) => React.ReactNode
}

const styles = StyleSheet.create({
  action: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  text: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
})

const SwipeRow: React.FC<SwipeRowProps> = ({ action, children }) => {
  const swipeable = useRef<SwipeableMethods>(null)
  const { name, label, icon, tone, width = 88, onPress, testID } = action
  const run = useCallback(() => {
    swipeable.current?.close()
    onPress()
  }, [onPress])

  const behind = () => (
    <TouchableOpacity
      onPress={run}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={[styles.action, { width, backgroundColor: TONE[tone] }]}
    >
      <Icon name={icon} size={22} color="#FFFFFF" />
      <ThemedText style={styles.text}>{label}</ThemedText>
    </TouchableOpacity>
  )

  return (
    <ReanimatedSwipeable
      ref={swipeable}
      renderRightActions={behind}
      rightThreshold={40}
      overshootRight={false}
      friction={2}
    >
      {children({
        onLongPress: run,
        accessibilityActions: [{ name, label }],
        onAccessibilityAction: (event) => {
          if (event.nativeEvent.actionName === name) run()
        },
      })}
    </ReanimatedSwipeable>
  )
}

export default SwipeRow
