/**
 * The pieces the poll screens share (Polls V2 mock): a status chip, the Ticket · Vote · Receipt bar, a line with an
 * icon before it, and a tinted callout. Words come from the screens; these only lay them out.
 *
 * @module polls/components/PollParts
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View, type ViewStyle } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

import { PollsIds } from './Polls.ids'

export type ChipTone = 'open' | 'done' | 'quiet' | 'results'

/** A short status in a pill: filled for an open poll, tinted otherwise. The words carry it, never the colour alone. */
export const PollChip: React.FC<{ label: string; tone: ChipTone; testID?: string }> = ({ label, tone, testID }) => {
  const { ColorPalette } = useTheme()
  const look = {
    open: { backgroundColor: ColorPalette.brand.primary, color: ColorPalette.grayscale.white },
    done: { backgroundColor: ColorPalette.notification.success, color: ColorPalette.notification.successText },
    quiet: { backgroundColor: ColorPalette.grayscale.veryLightGrey, color: ColorPalette.grayscale.darkGrey },
    results: { backgroundColor: ColorPalette.notification.info, color: ColorPalette.notification.infoText },
  }[tone]
  return (
    <View
      style={{ alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, ...look }}
      testID={testID}
    >
      <ThemedText variant="labelSubtitle" style={{ color: look.color, fontWeight: '700' }} maxFontSizeMultiplier={1.5}>
        {label}
      </ThemedText>
    </View>
  )
}

export type PollStep = 'ticket' | 'vote' | 'receipt'

/** Where the member is: the ticket, then the vote, then the receipt. Steps before `at` are done; `done` marks all. */
export const PollStepBar: React.FC<{ at: PollStep; done?: boolean }> = ({ at, done }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const steps: { key: PollStep; label: string }[] = [
    { key: 'ticket', label: t('Polls.StepTicket') },
    { key: 'vote', label: t('Polls.StepVote') },
    { key: 'receipt', label: t('Polls.StepReceiptShort') },
  ]
  const reached = steps.findIndex((s) => s.key === at)
  return (
    <View style={{ flexDirection: 'row', gap: 6 }} testID={testIdWithKey(PollsIds.stepBar)}>
      {steps.map((s, i) => {
        const finished = done || i < reached
        const current = !done && i === reached
        const color = finished
          ? ColorPalette.semantic.success
          : current
            ? ColorPalette.brand.primary
            : ColorPalette.grayscale.lightGrey
        return (
          <View
            key={s.key}
            style={{ flex: 1, gap: 4 }}
            accessible
            accessibilityState={{ selected: current }}
            accessibilityLabel={`${i + 1}. ${s.label}`}
          >
            <View style={{ height: 4, borderRadius: 2, backgroundColor: color }} />
            <ThemedText
              variant="labelSubtitle"
              maxFontSizeMultiplier={1.5}
              style={{
                fontWeight: finished || current ? '700' : '400',
                color: finished
                  ? ColorPalette.semantic.success
                  : current
                    ? ColorPalette.brand.primary
                    : ColorPalette.grayscale.mediumGrey,
              }}
            >
              {finished ? `✓ ${s.label}` : `${i + 1} ${s.label}`}
            </ThemedText>
          </View>
        )
      })}
    </View>
  )
}

/** A line with an icon before it, the icon only decoration. */
export const PollLine: React.FC<{
  icon: string
  color?: string
  children: React.ReactNode
  bold?: boolean
  testID?: string
}> = ({ icon, color, children, bold, testID }) => {
  const { ColorPalette } = useTheme()
  return (
    <View style={styles.line} testID={testID}>
      <Icon
        name={icon}
        size={22}
        color={color ?? ColorPalette.brand.primary}
        style={styles.lineIcon}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <ThemedText variant={bold ? 'bold' : 'normal'} style={styles.flex}>
        {children}
      </ThemedText>
    </View>
  )
}

export type CalloutTone = 'warn' | 'error'

/** A tinted box for a line that must not be missed: the timing warning, one operator running both. */
export const PollCallout: React.FC<{ tone: CalloutTone; icon: string; children: React.ReactNode; testID?: string }> = ({
  tone,
  icon,
  children,
  testID,
}) => {
  const { ColorPalette } = useTheme()
  const look =
    tone === 'warn'
      ? {
          box: { backgroundColor: ColorPalette.notification.warn, borderColor: ColorPalette.notification.warnBorder },
          icon: ColorPalette.notification.warnIcon,
          text: ColorPalette.notification.warnText,
        }
      : {
          box: { backgroundColor: ColorPalette.notification.error, borderColor: ColorPalette.notification.errorBorder },
          icon: ColorPalette.notification.errorIcon,
          text: ColorPalette.notification.errorText,
        }
  return (
    <View style={[styles.callout, look.box as ViewStyle]} testID={testID}>
      <Icon
        name={icon}
        size={22}
        color={look.icon}
        style={styles.lineIcon}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <ThemedText variant="bold" style={[styles.flex, { color: look.text }]}>
        {children}
      </ThemedText>
    </View>
  )
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  lineIcon: { marginTop: 2 },
  flex: { flex: 1 },
  callout: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 10, borderWidth: 1, padding: 12 },
})
