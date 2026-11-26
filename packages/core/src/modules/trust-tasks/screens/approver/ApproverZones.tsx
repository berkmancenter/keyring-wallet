/**
 * The pieces Who approves draws each approver with, so it reads at a glance (Alberto, 11-12: "hard to tell what's
 * happening in this screen"): a header pill, then up to three labelled boxes, always in this order:
 *
 * 1. "What Keyring checked" (solid green border): a tick for what passed, a cross for what failed, a warning for what
 *    couldn't be checked, and an open ring for what isn't checked yet (the gaps are shown, not left out).
 * 2. The demo state's own box, titled with its name and the Demo pill (dashed amber border): only for a root this
 *    phone's list marks demo. The Demo pill belongs to the state, never to the approver.
 * 3. "Needs <name>'s yes" (purple border): the actions the agent won't do without them.
 *
 * Pure layout: what goes in each box, and when a box shows, is decided by the screen.
 *
 * @module trust-tasks/screens/approver/ApproverZones
 */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../../components/texts/ThemedText'
import { useTheme } from '../../../../contexts/theme'
import { testIdWithKey } from '../../../../utils/testable'

export type ZoneKind = 'checked' | 'state' | 'needs'
export type MarkKind = 'pass' | 'fail' | 'warn' | 'gap'
export type PillTone = 'ok' | 'bad' | 'unknown' | 'quiet'

/** One labelled box. `title` may carry a node beside it (the Demo pill on the state's box). */
export const Zone: React.FC<
  React.PropsWithChildren<{ kind: ZoneKind; title: string; beside?: React.ReactNode; testID: string }>
> = ({ kind, title, beside, testID, children }) => {
  const { ColorPalette } = useTheme()
  const border = {
    checked: ColorPalette.notification.successBorder,
    state: ColorPalette.notification.warnBorder,
    needs: ColorPalette.brand.primary,
  }[kind]
  const icon = { checked: 'shield-check-outline', state: 'flask-outline', needs: 'lock-outline' }[kind]
  const styles = StyleSheet.create({
    zone: {
      borderWidth: kind === 'state' ? 1.5 : 1,
      borderStyle: kind === 'state' ? 'dashed' : 'solid',
      borderColor: border,
      borderRadius: 8,
      padding: 12,
      gap: 6,
    },
    title: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  })
  return (
    <View style={styles.zone} testID={testIdWithKey(testID)}>
      <View style={styles.title} accessibilityRole="header">
        <Icon name={icon} size={18} color={border} accessibilityElementsHidden importantForAccessibility="no" />
        <ThemedText variant="bold">{title}</ThemedText>
        {beside}
      </View>
      {children}
    </View>
  )
}

/** One row inside a box: a mark, then the words (which keep their own testID, as the screen's lines always had). */
export const Mark: React.FC<React.PropsWithChildren<{ kind: MarkKind; testID?: string }>> = ({
  kind,
  testID,
  children,
}) => {
  const { ColorPalette } = useTheme()
  const icon = { pass: 'check-circle', fail: 'close-circle', warn: 'alert', gap: 'circle-outline' }[kind]
  const color = {
    pass: ColorPalette.semantic.success,
    fail: ColorPalette.semantic.error,
    warn: ColorPalette.notification.warnIcon,
    gap: ColorPalette.grayscale.mediumGrey,
  }[kind]
  return (
    <View
      style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}
      testID={testID ? testIdWithKey(`${testID}_${kind}`) : undefined}
    >
      <Icon
        name={icon}
        size={18}
        color={color}
        style={{ marginTop: 3 }}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <View style={{ flex: 1, gap: 2 }}>{children}</View>
    </View>
  )
}

/** The header pill beside an approver's name: the state card's own pill words (B3). */
export const StatusPill: React.FC<{ tone: PillTone; words: string; testID: string }> = ({ tone, words, testID }) => {
  const { ColorPalette } = useTheme()
  const color = {
    ok: ColorPalette.semantic.success,
    bad: ColorPalette.semantic.error,
    unknown: ColorPalette.notification.warnIcon,
    quiet: ColorPalette.grayscale.mediumGrey,
  }[tone]
  return (
    <View
      style={{ borderRadius: 999, borderWidth: 1, borderColor: color, paddingHorizontal: 8, paddingVertical: 1 }}
      testID={testIdWithKey(testID)}
    >
      <ThemedText style={{ fontSize: 13, color }}>{words}</ThemedText>
    </View>
  )
}
