import React from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../../utils/testable'
import { AGENT_COLORS } from '../../components/agentStyle'
import type { HcpNoticeLine as HcpNoticeLineData } from '../status'

import { useHcpCopy } from './useHcpCopy'

// Canvas frame 55: telling in Keyring's purple with a spinner, told in green with a tick, not told in amber with a
// warning sign. The colour and the mark only repeat the words.
const TONES = {
  RevokeTelling: { bg: '#F3EBF3', border: AGENT_COLORS.primary, text: AGENT_COLORS.text },
  RevokeTold: { bg: '#EEF6EA', border: '#7FB27A', text: '#1F4A1A' },
  RevokeNotTold: { bg: '#FFF6E5', border: '#F2C66D', text: AGENT_COLORS.warnText },
} as const

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  text: { flex: 1, fontFamily: 'SourceSans3-Bold', fontSize: 17, lineHeight: 23 },
})

export interface HcpNoticeLineProps {
  /** The notice of a revoked record (`hcpNoticeLine`, or the `notice` of `hcpStatus`'s `StatusRevoked`). */
  line: HcpNoticeLineData
  /** Formats an ISO-8601 instant for this phone. */
  formatTime: (iso: string) => string
}

/**
 * The line that follows an HCP revoke (canvas frame 55; companion finding 6): "Revoked. Telling "<name>"…" while the
 * client is told, "… was told at <time>." once it has heard, or "… stops being usable at <time>." if telling it was
 * abandoned. A status line, so it is announced as text, not as an alert.
 */
const HcpNoticeLine: React.FC<HcpNoticeLineProps> = ({ line, formatTime }) => {
  const hcp = useHcpCopy()
  const text =
    line.key === 'RevokeTelling'
      ? hcp(line.key, line.params)
      : hcp(line.key, { ...line.params, time: formatTime(line.params.time) })
  const tone = TONES[line.key]
  return (
    <View
      style={[styles.box, { backgroundColor: tone.bg, borderColor: tone.border }]}
      accessible
      accessibilityLabel={text}
      testID={testIdWithKey('HcpNoticeLine')}
    >
      {line.key === 'RevokeTelling' ? (
        <ActivityIndicator size="small" color={AGENT_COLORS.primary} />
      ) : (
        <Icon
          name={line.key === 'RevokeTold' ? 'check' : 'alert-outline'}
          size={22}
          color={tone.text}
          accessibilityElementsHidden
        />
      )}
      <ThemedText style={[styles.text, { color: tone.text }]}>{text}</ThemedText>
    </View>
  )
}

export default HcpNoticeLine
