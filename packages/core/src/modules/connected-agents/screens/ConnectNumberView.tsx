import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AccessibilityInfo, Pressable, StyleSheet, TextInput, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'
import { AGENT_COLORS } from '../components/agentStyle'
import { MATCH_NUMBER_DIGITS } from '../pairing'

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: 16, paddingTop: 28, gap: 18 },
  title: { fontFamily: 'SourceSans3-Bold', fontSize: 24, lineHeight: 30, color: AGENT_COLORS.text },
  line: { fontFamily: 'SourceSans3-Regular', fontSize: 17, lineHeight: 23, color: AGENT_COLORS.text },
  cells: { flexDirection: 'row', gap: 12, paddingHorizontal: 14 },
  cell: {
    width: 56,
    height: 66,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#8E8E93',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellCurrent: { borderColor: AGENT_COLORS.primary, borderWidth: 2.5 },
  cellWrong: { borderColor: AGENT_COLORS.danger, backgroundColor: '#FBEDEF' },
  digit: { fontFamily: 'SourceSans3-Bold', fontSize: 30, color: AGENT_COLORS.text },
  digitWrong: { color: '#5A0D17' },
  hidden: { position: 'absolute', opacity: 0, width: 1, height: 1 },
  bar: { padding: 16, gap: 10, borderTopWidth: 1, borderTopColor: '#E7E7E9' },
})

/** The digit cells, as typed: also drawn, red, under the wrong-number notice (§6). Not focusable themselves. */
export const DigitCells: React.FC<{ value: string; cells: number; wrong?: boolean; current?: number }> = ({
  value,
  cells,
  wrong,
  current,
}) => (
  <View style={styles.cells} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    {Array.from({ length: cells }, (_, i) => (
      <View
        key={i}
        style={[styles.cell, wrong && styles.cellWrong, !wrong && current === i && styles.cellCurrent]}
        testID={testIdWithKey('ConnectNumberCell')}
      >
        <ThemedText style={[styles.digit, wrong && styles.digitWrong]}>{value[i] ?? ''}</ThemedText>
      </View>
    ))}
  </View>
)

export interface ConnectNumberViewProps {
  /** Sends the digits once (`enterNumber`); the view then holds, since there is one try (§6). */
  onSubmit: (digits: string) => void
  onCancel: () => void
  /** The cell count. One constant, MATCH_NUMBER_DIGITS (the plan's Q8: two today). */
  cells?: number
}

/**
 * "Enter the number from your terminal" (§6 "Number step"; canvas frame 3): a cell per digit over one numeric field
 * labelled "Number from your terminal", each digit announced as it is typed, "Continue" once every cell is filled,
 * and "Cancel". The number is never shown by Keyring: the person types what their terminal shows.
 */
const ConnectNumberView: React.FC<ConnectNumberViewProps> = ({ onSubmit, onCancel, cells = MATCH_NUMBER_DIGITS }) => {
  const { t } = useTranslation()
  const input = useRef<TextInput>(null)
  const [value, setValue] = useState('')
  const [sent, setSent] = useState(false)

  const change = (text: string) => {
    const next = text.replace(/\D/g, '').slice(0, cells)
    if (next.length > value.length) {
      const position = next.length
      AccessibilityInfo.announceForAccessibility(
        t('ConnectedAgents.NumberDigitFilled', { position, total: cells, digit: next[position - 1] })
      )
    }
    setValue(next)
  }

  const submit = () => {
    if (sent || value.length !== cells) return
    setSent(true)
    onSubmit(value)
  }

  const body = cells === 4 ? 'ConnectedAgents.NumberBodyFourDigits' : 'ConnectedAgents.NumberBodyTwoDigits'
  return (
    <View style={styles.screen} testID={testIdWithKey('ConnectNumber')}>
      <View style={styles.body}>
        <ThemedText style={styles.title} accessibilityRole="header">
          {t('ConnectedAgents.NumberTitle')}
        </ThemedText>
        <ThemedText style={styles.line}>{t(body)}</ThemedText>
        <Pressable onPress={() => input.current?.focus()} accessible={false}>
          <DigitCells value={value} cells={cells} current={value.length} />
        </Pressable>
        <TextInput
          ref={input}
          style={styles.hidden}
          value={value}
          onChangeText={change}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={cells}
          autoFocus
          editable={!sent}
          textContentType="oneTimeCode"
          accessibilityLabel={t('ConnectedAgents.NumberFieldLabel')}
          onSubmitEditing={submit}
          testID={testIdWithKey('ConnectNumberField')}
        />
      </View>
      <View style={styles.bar}>
        <Button
          title={t('Global.Continue')}
          buttonType={ButtonType.Primary}
          onPress={submit}
          disabled={sent || value.length !== cells}
          testID={testIdWithKey('ConnectNumberContinue')}
          accessibilityLabel={t('Global.Continue')}
        />
        <Button
          title={t('Global.Cancel')}
          buttonType={ButtonType.Secondary}
          onPress={onCancel}
          testID={testIdWithKey('ConnectNumberCancel')}
          accessibilityLabel={t('Global.Cancel')}
        />
      </View>
    </View>
  )
}

export default ConnectNumberView
