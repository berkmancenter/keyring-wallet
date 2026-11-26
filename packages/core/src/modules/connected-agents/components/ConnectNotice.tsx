import React from 'react'
import { StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'

import { AGENT_COLORS } from './agentStyle'

const TONES = {
  error: { bg: '#FBEDEF', border: '#E2A3AC', fg: AGENT_COLORS.danger, text: '#5A0D17' },
  warn: { bg: '#FFF6E5', border: '#F2C66D', fg: AGENT_COLORS.warnText, text: AGENT_COLORS.warnText },
} as const

const styles = StyleSheet.create({
  box: { flexDirection: 'row', gap: 10, borderWidth: 1.5, borderRadius: 12, padding: 14, alignItems: 'flex-start' },
  text: { flex: 1, fontFamily: 'SourceSans3-Bold', fontSize: 17, lineHeight: 23 },
})

export interface ConnectNoticeProps {
  text: string
  icon?: string
  tone?: keyof typeof TONES
  testID?: string
}

/**
 * A boxed line that ends or warns about a connect (canvas frames 4, 18, K23, and the "Only continue if..." box on
 * Approve). It is announced as an alert, so a screen reader hears the words, not a colour (§6, Accessibility).
 */
const ConnectNotice: React.FC<ConnectNoticeProps> = ({
  text,
  icon = 'alert-outline',
  tone = 'error',
  testID = testIdWithKey('ConnectNotice'),
}) => {
  const c = TONES[tone]
  return (
    <View
      style={[styles.box, { backgroundColor: c.bg, borderColor: c.border }]}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={text}
      accessibilityLiveRegion="assertive"
      testID={testID}
    >
      <Icon name={icon} size={24} color={c.fg} />
      <ThemedText style={[styles.text, { color: c.text }]}>{text}</ThemedText>
    </View>
  )
}

export default ConnectNotice
