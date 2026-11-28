import React from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../../components/buttons/Button'
import { ThemedText } from '../../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../../utils/testable'
import { AgentAvatar } from '../../components/AgentMark'
import { AGENT_COLORS } from '../../components/agentStyle'
import { hcpStatus, type HcpStatus } from '../status'
import type { HcpConnection } from '../types'

import HcpNoticeLine from './HcpNoticeLine'
import { useHcpCopy } from './useHcpCopy'

// Canvas frame 52, drawn like the base list (screens/AgentListView, frame 12): one dashed card per agent, the robot,
// the name and the status on a chip, the actions under a rule, and "Connect an agent" in the bottom bar.
const styles = StyleSheet.create({
  screen: { flex: 1 },
  loading: { marginTop: 32 },
  body: { padding: 14, gap: 10, paddingBottom: 24 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: AGENT_COLORS.edge,
    paddingHorizontal: 14,
    paddingTop: 12,
    gap: 8,
  },
  cardEnded: { borderColor: '#B9B9C0' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  who: { flex: 1, gap: 4 },
  name: { fontFamily: 'SourceSans3-Bold', fontSize: 18, color: AGENT_COLORS.text },
  chip: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 },
  chipText: { fontFamily: 'SourceSans3-Bold', fontSize: 14, lineHeight: 19 },
  actions: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#E7E7E9' },
  action: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  danger: { fontFamily: 'SourceSans3-Bold', fontSize: 17, color: AGENT_COLORS.danger },
  bottomPad: { height: 12 },
  bar: { padding: 16, borderTopWidth: 1, borderTopColor: '#E7E7E9' },
})

/** Green while connected, grey once ended (the base chip's tones, canvas note o1, item 7). */
const CHIP_TONE: Record<HcpStatus['key'], { bg: string; fg: string }> = {
  StatusConnectedUntil: { bg: AGENT_COLORS.okBg, fg: AGENT_COLORS.okText },
  StatusExpired: { bg: AGENT_COLORS.quietBg, fg: AGENT_COLORS.quietText },
  StatusRevoked: { bg: AGENT_COLORS.quietBg, fg: AGENT_COLORS.quietText },
}

export interface HcpAgentListViewProps {
  /** The owner's HCP connections; undefined while they are read. */
  connections?: HcpConnection[]
  /** The time the statuses are read at (`hcpStatus`). */
  now: Date
  /** Formats an ISO-8601 instant for this phone. */
  formatTime: (iso: string) => string
  /** A tap on a card: the connection's details. */
  onOpen: (id: string) => void
  /** Left out until the wiring passes the revoke sheet: no Revoke action meanwhile. */
  onRevoke?: (id: string) => void
  onConnect: () => void
}

/**
 * The HCP agent list (canvas frame 52; plan §6 "HCP lane screens"; backlog Section C, U2): one card per HCP
 * connection with the robot, its name and its status in words (`hcpStatus`). A revoked row adds its notice line under
 * the status (Brendan, 2026-11-25: the after-revoke line is a status line on the list row and the details). "Revoke"
 * only on a connected row, and only when `onRevoke` is given. "Connect an agent" at the bottom. "What it saw" is P1
 * (step 7.29) and is not drawn. A view: it reads no store and revokes nothing.
 */
const HcpAgentListView: React.FC<HcpAgentListViewProps> = ({
  connections,
  now,
  formatTime,
  onOpen,
  onRevoke,
  onConnect,
}) => {
  const { t } = useTranslation()
  const hcp = useHcpCopy()
  const revokeWord = hcp('Revoke')

  const statusWords = (status: HcpStatus): string =>
    status.key === 'StatusConnectedUntil' ? hcp(status.key, { time: formatTime(status.params.time) }) : hcp(status.key)

  return (
    <View style={styles.screen} testID={testIdWithKey('HcpAgentList')}>
      {connections === undefined ? (
        <ActivityIndicator style={styles.loading} />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {connections.map((c) => {
            const status = hcpStatus(c, now)
            const words = statusWords(status)
            const tone = CHIP_TONE[status.key]
            const canRevoke = status.key === 'StatusConnectedUntil' && onRevoke !== undefined
            return (
              <View
                key={c.id}
                style={[styles.card, status.key !== 'StatusConnectedUntil' && styles.cardEnded]}
                testID={testIdWithKey('HcpAgentRow')}
              >
                <TouchableOpacity
                  style={styles.top}
                  onPress={() => onOpen(c.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.name}, ${t('Rooms.AgentBadge')}`}
                >
                  <AgentAvatar />
                  <View style={styles.who}>
                    <ThemedText style={styles.name}>{c.name}</ThemedText>
                    <View style={[styles.chip, { backgroundColor: tone.bg }]} accessible accessibilityLabel={words}>
                      <ThemedText style={[styles.chipText, { color: tone.fg }]}>{words}</ThemedText>
                    </View>
                  </View>
                  <Icon name="chevron-right" size={24} color="#8E8E93" accessibilityElementsHidden />
                </TouchableOpacity>
                {status.key === 'StatusRevoked' ? <HcpNoticeLine line={status.notice} formatTime={formatTime} /> : null}
                {canRevoke ? (
                  <View style={styles.actions}>
                    <TouchableOpacity
                      style={styles.action}
                      onPress={() => onRevoke?.(c.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`${revokeWord}, ${c.name}`}
                      testID={testIdWithKey('HcpAgentRowRevoke')}
                    >
                      <ThemedText style={styles.danger}>{revokeWord}</ThemedText>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.bottomPad} />
                )}
              </View>
            )
          })}
        </ScrollView>
      )}
      <View style={styles.bar}>
        <Button
          title={t('ConnectedAgents.ConnectAnAgent')}
          buttonType={ButtonType.Primary}
          onPress={onConnect}
          testID={testIdWithKey('HcpAgentListConnect')}
          accessibilityLabel={t('ConnectedAgents.ConnectAnAgent')}
        />
      </View>
    </View>
  )
}

export default HcpAgentListView
