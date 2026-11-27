import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'

import { AGENT_COLORS } from './agentStyle'

/**
 * The seven statuses an agent's row can show (§6, "Agent list rows"), in the plan's order. "connectedUntil" is a
 * temporary agent and needs its end time; "unreachable" reads "Not connected right now".
 */
export const AGENT_STATUSES = [
  'connected',
  'connectedUntil',
  'unreachable',
  'expired',
  'notFinished',
  'revokeNotConfirmed',
  'revoked',
] as const
export type AgentStatus = (typeof AGENT_STATUSES)[number]

type Tone = 'ok' | 'warn' | 'quiet'

/** Green for connected, amber for the two that need the owner's eye, grey for the ended ones (canvas note o1, 7). */
export const STATUS_TONE: Record<AgentStatus, Tone> = {
  connected: 'ok',
  connectedUntil: 'ok',
  unreachable: 'warn',
  revokeNotConfirmed: 'warn',
  expired: 'quiet',
  notFinished: 'quiet',
  revoked: 'quiet',
}

const TONE_COLORS: Record<Tone, { bg: string; fg: string }> = {
  ok: { bg: AGENT_COLORS.okBg, fg: AGENT_COLORS.okText },
  warn: { bg: AGENT_COLORS.warnBg, fg: AGENT_COLORS.warnText },
  quiet: { bg: AGENT_COLORS.quietBg, fg: AGENT_COLORS.quietText },
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 2,
  },
  text: {
    fontFamily: 'SourceSans3-Bold',
    fontSize: 14,
    lineHeight: 19,
  },
})

/**
 * A status, and for a temporary agent the end of its grant, already formatted for this phone ("14:30"). The time is
 * required by the type: "Connected" alone is a persistent agent's status (§6), so a temporary one is never shown
 * without its end.
 */
export type AgentStatusChipProps =
  | { status: Exclude<AgentStatus, 'connectedUntil'>; until?: undefined }
  | { status: 'connectedUntil'; until: string }

/** One status as a word on a coloured chip. The colour only repeats the word: the word alone carries it (§6). */
export const AgentStatusChip: React.FC<AgentStatusChipProps> = (props) => {
  const { t } = useTranslation()
  const label = statusLabel(t, props)
  const tone = TONE_COLORS[STATUS_TONE[props.status]]
  return (
    <View
      style={[styles.chip, { backgroundColor: tone.bg }]}
      testID={testIdWithKey('AgentStatusChip')}
      accessible
      accessibilityLabel={label}
    >
      <ThemedText style={[styles.text, { color: tone.fg }]}>{label}</ThemedText>
    </View>
  )
}

/** The status in words, for the chip and for a row's spoken label. */
export function statusLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  chip: AgentStatusChipProps
): string {
  switch (chip.status) {
    case 'connected':
      return t('ConnectedAgents.StatusConnected')
    case 'connectedUntil':
      return t('ConnectedAgents.ConnectedUntil', { time: chip.until })
    case 'unreachable':
      return t('ConnectedAgents.StatusUnreachable')
    case 'expired':
      return t('ConnectedAgents.StatusExpired')
    case 'notFinished':
      return t('ConnectedAgents.StatusNotFinished')
    case 'revokeNotConfirmed':
      return t('ConnectedAgents.StatusRevokeNotConfirmed')
    case 'revoked':
      return t('ConnectedAgents.StatusRevoked')
  }
}
