import React from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'
import { AgentAvatar } from '../components/AgentMark'
import { AgentStatus, AgentStatusChip, AgentStatusChipProps } from '../components/AgentStatusChip'
import { AGENT_COLORS } from '../components/agentStyle'
import MemoryAccessNotice, { NoticeMemory } from '../components/MemoryAccessNotice'

/** One agent as the list draws it. The wiring maps the logic's AgentView onto this. */
export type AgentRowData = {
  id: string
  name: string
  status: AgentStatus
  /** The end of a temporary agent's grant, formatted for this phone; required for "connectedUntil". */
  until?: string
  temporary: boolean
  keyChanged: boolean
  drift?: { extra: NoticeMemory[]; missing: NoticeMemory[] }
  /**
   * P1 (step 7.14; canvas frame 12): the record's `answersOthers`, given by the caller only when
   * `isAgentRoomsEnabled()`. Drawn as "Answers other people: Off" or "On" under the status; left out, no line.
   */
  answersOthers?: boolean
}

/** Which actions a row offers (§6 "Agent list rows"; #1060 findings 12 and 13 for Expired and Not finished). */
export function rowActions(agent: AgentRowData): Array<'extend' | 'revoke' | 'remove' | 'connectAgain'> {
  // No `default`, on purpose: with every status a case and a declared return type, a new status fails the type check
  // here instead of silently offering nothing (or everything) on a state nobody decided.
  switch (agent.status) {
    case 'connected':
    case 'connectedUntil':
    case 'unreachable':
      // Extend only for a temporary agent; a changed key is Revoke only (canvas frame 6b).
      return agent.temporary && !agent.keyChanged ? ['extend', 'revoke'] : ['revoke']
    case 'expired':
      // The VTA sweeps an expired entry within minutes, so Extend cannot be relied on (measured): a new pairing.
      return ['connectAgain', 'remove']
    case 'notFinished':
      return ['remove']
    case 'revokeNotConfirmed':
    case 'revoked':
      return []
  }
}

const ACTION_TEST_ID: Record<'extend' | 'revoke' | 'remove' | 'connectAgain', string> = {
  extend: testIdWithKey('AgentRowExtend'),
  revoke: testIdWithKey('AgentRowRevoke'),
  remove: testIdWithKey('AgentRowRemove'),
  connectAgain: testIdWithKey('AgentRowConnectAgain'),
}

const chipProps = (agent: AgentRowData): AgentStatusChipProps =>
  agent.status === 'connectedUntil'
    ? { status: 'connectedUntil', until: agent.until ?? '' }
    : { status: agent.status as Exclude<AgentStatus, 'connectedUntil'> }

const styles = StyleSheet.create({
  screen: { flex: 1 },
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
  name: { fontFamily: 'SourceSans3-Bold', fontSize: 18, color: AGENT_COLORS.text },
  sub: { fontFamily: 'SourceSans3-Regular', fontSize: 15, lineHeight: 20, color: AGENT_COLORS.muted },
  warn: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#FFF6E5',
    borderWidth: 1,
    borderColor: '#F2C66D',
    borderRadius: 10,
    padding: 10,
  },
  warnText: { flex: 1, fontFamily: 'SourceSans3-Regular', fontSize: 15, lineHeight: 20, color: AGENT_COLORS.warnText },
  actions: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#E7E7E9' },
  action: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontFamily: 'SourceSans3-Bold', fontSize: 17, color: AGENT_COLORS.primary },
  danger: { color: AGENT_COLORS.danger },
  bottomPad: { height: 12 },
  bar: { padding: 16, borderTopWidth: 1, borderTopColor: '#E7E7E9' },
})

export interface AgentListViewProps {
  /** The owner's agents; undefined while they are read. */
  agents?: AgentRowData[]
  onOpen: (id: string) => void
  onConnect: () => void
  onExtend: (id: string) => void
  onRemove: (id: string) => void
  onConnectAgain: (id: string) => void
  /** Left out until step 7.10 wires the revoke sheet (#1060 P-f): no Revoke action meanwhile. */
  onRevoke?: (id: string) => void
}

/**
 * "AI agents" (§6 "Agent list rows"; canvas frames 6 and 6b): one dashed card per agent with the robot, its name and
 * its status in words; "changed its key" as a warning line; a changed memory set as the notice, without its buttons
 * (they are on the details); and the actions the status allows. "Connect an agent" at the bottom. A tap on a card
 * opens the agent's details. The "Answers other people" line is P1 (step 7.14; frame 12): drawn under the status only
 * for a row whose `answersOthers` is given. This list is the base path's; the HCP list is its own.
 */
const AgentListView: React.FC<AgentListViewProps> = ({
  agents,
  onOpen,
  onConnect,
  onExtend,
  onRemove,
  onConnectAgain,
  onRevoke,
}) => {
  const { t } = useTranslation()
  const label: Record<'extend' | 'revoke' | 'remove' | 'connectAgain', string> = {
    extend: t('ConnectedAgents.Extend'),
    revoke: t('ConnectedAgents.Revoke'),
    remove: t('ConnectedAgents.Remove'),
    connectAgain: t('ConnectedAgents.ConnectAgain'),
  }
  const handler = { extend: onExtend, revoke: onRevoke, remove: onRemove, connectAgain: onConnectAgain }

  return (
    <View style={styles.screen} testID={testIdWithKey('AgentList')}>
      {agents === undefined ? (
        <ActivityIndicator style={{ marginTop: 32 }} testID={testIdWithKey('AgentListLoading')} />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {agents.map((agent) => {
            const actions = rowActions(agent).filter((a) => handler[a] !== undefined)
            const ended = agent.status === 'expired' || agent.status === 'revoked' || agent.status === 'notFinished'
            return (
              <View key={agent.id} style={[styles.card, ended && styles.cardEnded]} testID={testIdWithKey('AgentRow')}>
                <TouchableOpacity
                  style={styles.top}
                  onPress={() => onOpen(agent.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${agent.name}, ${t('Rooms.AgentBadge')}`}
                  testID={testIdWithKey('AgentRowOpen')}
                >
                  <AgentAvatar />
                  <View style={{ flex: 1, gap: 4 }}>
                    <ThemedText style={styles.name}>{agent.name}</ThemedText>
                    <AgentStatusChip {...chipProps(agent)} />
                  </View>
                  <Icon name="chevron-right" size={24} color="#8E8E93" accessibilityElementsHidden />
                </TouchableOpacity>
                {agent.answersOthers !== undefined ? (
                  <ThemedText style={styles.sub} testID={testIdWithKey('AgentRowAnswersOthers')}>
                    {agent.answersOthers
                      ? t('ConnectedAgents.AnswersOthersOnLine')
                      : t('ConnectedAgents.AnswersOthersOffLine')}
                  </ThemedText>
                ) : null}
                {agent.keyChanged ? (
                  <View
                    style={styles.warn}
                    accessible
                    accessibilityRole="alert"
                    testID={testIdWithKey('AgentRowKeyChanged')}
                  >
                    <Icon name="alert-outline" size={20} color={AGENT_COLORS.warnText} accessibilityElementsHidden />
                    <ThemedText style={styles.warnText}>
                      {t('ConnectedAgents.KeyChanged', { name: agent.name })}
                    </ThemedText>
                  </View>
                ) : null}
                {agent.drift ? (
                  <MemoryAccessNotice extra={agent.drift.extra} missing={agent.drift.missing} compact />
                ) : null}
                {agent.status === 'notFinished' ? (
                  <ThemedText style={styles.sub}>{t('ConnectedAgents.NotFinishedLine')}</ThemedText>
                ) : null}
                {actions.length > 0 ? (
                  <View style={styles.actions}>
                    {actions.map((action) => (
                      <TouchableOpacity
                        key={action}
                        style={styles.action}
                        onPress={() => handler[action]?.(agent.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`${label[action]}, ${agent.name}`}
                        testID={ACTION_TEST_ID[action]}
                      >
                        <ThemedText
                          style={[styles.actionText, (action === 'revoke' || action === 'remove') && styles.danger]}
                        >
                          {label[action]}
                        </ThemedText>
                      </TouchableOpacity>
                    ))}
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
          testID={testIdWithKey('AgentListConnect')}
          accessibilityLabel={t('ConnectedAgents.ConnectAnAgent')}
        />
      </View>
    </View>
  )
}

export default AgentListView
