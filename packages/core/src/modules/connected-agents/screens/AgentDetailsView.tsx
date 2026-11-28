import React from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'
import { AgentAvatar, AgentTag } from '../components/AgentMark'
import AgentActionNotice, { AgentActionLine, AgentActionName } from '../components/AgentActionNotice'
import { AgentStatusChip } from '../components/AgentStatusChip'
import { AGENT_COLORS } from '../components/agentStyle'
import MemoryAccessNotice, { NoticeMemory } from '../components/MemoryAccessNotice'

import { AgentRowData, rowActions } from './AgentListView'

/** One memory's count, read once when the details open (§3.15, step 7.7); never on a timer. */
export type MemoryCountData = {
  count?: number
  /** The last change, formatted for this phone. */
  lastChange?: string
  /** How many more items than at the last opening, when it rose. */
  rose?: number
  failed: boolean
}

export type AgentDetailsData = AgentRowData & {
  ownerName: string
  memories: NoticeMemory[]
  /** Memories the owner chose that a one-context grant has not reached yet (#1048 finding 7). */
  pending: NoticeMemory[]
}

export interface AgentDetailsViewProps {
  agent: AgentDetailsData
  /** Per memory id; undefined while they are counted. */
  counts?: Record<string, MemoryCountData>
  /** The count above which a memory is called out (MEMORY_COUNT_WARNING; #1060 P-c proposes 1,000). */
  warnAbove: number
  /**
   * The line each action's last outcome left (ac's #1122 obligation 1), from the logic's `agentActionLine`. An action
   * with a line draws the line where its control was, and not the control: the line spends the action. Left out, the
   * details are as before.
   */
  actionLines?: Partial<Record<AgentActionName, AgentActionLine>>
  onChangeMemories: () => void
  onRestore: () => void
  onRetryPending: () => void
  onExtend: () => void
  onRemove: () => void
  onConnectAgain: () => void
  /** "Message": left out until the chat exists (step 7.9). */
  onMessage?: () => void
  /** "Keep it connected": left out until step 7.28, and only for a temporary agent. */
  onKeepConnected?: () => void
  /** "Revoke": left out until step 7.10 wires the revoke sheet (#1060 P-f). */
  onRevoke?: () => void
}

export type { AgentActionLine, AgentActionLineKey, AgentActionName } from '../components/AgentActionNotice'

const styles = StyleSheet.create({
  body: { padding: 16, gap: 14, paddingBottom: 28 },
  head: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  name: { fontFamily: 'SourceSans3-Bold', fontSize: 24, lineHeight: 30, color: AGENT_COLORS.text },
  line: { fontFamily: 'SourceSans3-Regular', fontSize: 17, lineHeight: 23, color: AGENT_COLORS.text },
  group: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D9D9DE',
    paddingHorizontal: 14,
  },
  fact: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 12 },
  rule: { borderTopWidth: 1, borderTopColor: '#E7E7E9' },
  factText: { flex: 1, fontFamily: 'SourceSans3-Regular', fontSize: 17, lineHeight: 23, color: AGENT_COLORS.text },
  bold: { fontFamily: 'SourceSans3-Bold' },
  memory: { paddingLeft: 36, paddingVertical: 10, gap: 4 },
  small: { fontFamily: 'SourceSans3-Regular', fontSize: 15, lineHeight: 20, color: AGENT_COLORS.muted },
  warn: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#FFF6E5',
    borderWidth: 1,
    borderColor: '#F2C66D',
    borderRadius: 10,
    padding: 10,
    marginTop: 4,
  },
  warnText: { flex: 1, fontFamily: 'SourceSans3-Regular', fontSize: 15, lineHeight: 20, color: AGENT_COLORS.warnText },
  link: { fontFamily: 'SourceSans3-Bold', fontSize: 17, color: AGENT_COLORS.primary },
  two: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
})

/**
 * An agent's details (§6 "Agent bottom sheet and agent details"; canvas frame 11 in its no-room form, frame 11d for
 * the counts). The header title is the agent's name, set by the navigator (§6, #1060 finding 9). P0 has
 * no rooms, so neither "in every room it is in" nor any "Can read all of <room>" line is drawn, and the P1 lines
 * ("Mention it as", "Answers other people", "Add a credential") are left out.
 */
const AgentDetailsView: React.FC<AgentDetailsViewProps> = ({
  agent,
  counts,
  warnAbove,
  actionLines = {},
  onChangeMemories,
  onRestore,
  onRetryPending,
  onExtend,
  onRemove,
  onConnectAgain,
  onMessage,
  onKeepConnected,
  onRevoke,
}) => {
  const { t } = useTranslation()
  const actions = rowActions(agent)
  const names = agent.memories.map((m) => m.name).join(', ')
  const chip =
    agent.status === 'connectedUntil' ? (
      <AgentStatusChip status="connectedUntil" until={agent.until ?? ''} />
    ) : (
      <AgentStatusChip status={agent.status} />
    )

  return (
    <ScrollView contentContainerStyle={styles.body} testID={testIdWithKey('AgentDetails')}>
      <View style={styles.head}>
        <AgentAvatar size={64} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={styles.nameRow}>
            <ThemedText style={styles.name} accessibilityRole="header">
              {agent.name}
            </ThemedText>
            <AgentTag />
          </View>
          <ThemedText style={styles.line}>{t('ConnectedAgents.BelongsTo', { owner: agent.ownerName })}</ThemedText>
          <View style={{ paddingTop: 4 }}>{chip}</View>
        </View>
      </View>

      {onMessage ? (
        <Button
          title={t('ConnectedAgents.Message')}
          buttonType={ButtonType.Primary}
          onPress={onMessage}
          testID={testIdWithKey('AgentDetailsMessage')}
          accessibilityLabel={t('ConnectedAgents.Message')}
        />
      ) : null}
      {/* Drawn whatever the record now says: "It's kept connected, but…" is shown once the agent is persistent. */}
      {actionLines.keepConnected ? (
        <AgentActionNotice line={actionLines.keepConnected} testID={testIdWithKey('AgentDetailsKeepConnectedLine')} />
      ) : onKeepConnected && agent.temporary && actions.includes('extend') ? (
        <Button
          title={t('ConnectedAgents.KeepConnected')}
          buttonType={ButtonType.Secondary}
          onPress={onKeepConnected}
          testID={testIdWithKey('AgentDetailsKeepConnected')}
          accessibilityLabel={t('ConnectedAgents.KeepConnected')}
        />
      ) : null}

      {agent.keyChanged ? (
        <View style={styles.warn} accessible accessibilityRole="alert" testID={testIdWithKey('AgentDetailsKeyChanged')}>
          <Icon name="alert-outline" size={20} color={AGENT_COLORS.warnText} accessibilityElementsHidden />
          <ThemedText style={styles.warnText}>{t('ConnectedAgents.KeyChanged', { name: agent.name })}</ThemedText>
        </View>
      ) : null}
      {agent.drift ? (
        <MemoryAccessNotice
          extra={agent.drift.extra}
          missing={agent.drift.missing}
          onRestore={actionLines.restore ? undefined : onRestore}
          onRevoke={onRevoke}
        />
      ) : null}
      {actionLines.restore ? (
        <AgentActionNotice line={actionLines.restore} testID={testIdWithKey('AgentDetailsRestoreLine')} />
      ) : null}

      <View style={styles.group} testID={testIdWithKey('AgentDetailsMemories')}>
        <View style={styles.fact} accessible>
          <Icon name="layers-outline" size={22} color={AGENT_COLORS.primary} accessibilityElementsHidden />
          <ThemedText style={[styles.factText, styles.bold]}>
            {agent.memories.length > 0 ? t('ConnectedAgents.Memories', { names }) : t('ConnectedAgents.NoMemory')}
          </ThemedText>
        </View>
        {agent.memories.map((memory) => {
          const c = counts?.[memory.id]
          return (
            <View key={memory.id} style={styles.memory} accessible testID={testIdWithKey('AgentDetailsMemoryCount')}>
              <ThemedText style={[styles.factText, styles.bold]}>{memory.name}</ThemedText>
              {counts === undefined ? (
                <ActivityIndicator size="small" style={{ alignSelf: 'flex-start' }} />
              ) : !c || c.failed || c.count === undefined ? (
                <ThemedText style={styles.small}>{t('ConnectedAgents.MemoryCountFailed')}</ThemedText>
              ) : (
                <>
                  <ThemedText style={styles.small}>
                    {c.lastChange
                      ? t('ConnectedAgents.MemoryCount', { count: c.count, date: c.lastChange })
                      : t('ConnectedAgents.MemoryCountNoDate', { count: c.count })}
                  </ThemedText>
                  {c.rose ? (
                    <ThemedText style={styles.small}>
                      {t('ConnectedAgents.MemoryCountRose', { count: c.rose })}
                    </ThemedText>
                  ) : null}
                  {c.count > warnAbove ? (
                    <View
                      style={styles.warn}
                      accessibilityRole="alert"
                      testID={testIdWithKey('AgentDetailsCountWarning')}
                    >
                      <Icon name="alert-outline" size={20} color={AGENT_COLORS.warnText} accessibilityElementsHidden />
                      <ThemedText style={styles.warnText}>
                        {t('ConnectedAgents.MemoryCountWarning', { memory: memory.name, limit: warnAbove })}
                      </ThemedText>
                    </View>
                  ) : null}
                </>
              )}
            </View>
          )
        })}
        {agent.pending.map((memory) => (
          <View key={`pending-${memory.id}`} style={styles.memory} testID={testIdWithKey('AgentDetailsPending')}>
            <ThemedText style={styles.small}>{t('ConnectedAgents.PendingMemory', { memory: memory.name })}</ThemedText>
            {/* §6 keeps "Try again" after a failed retry; only a retry the logic says is gone or no longer offered
                leaves a line, and then the retry is spent. */}
            {actionLines.retryPending ? null : (
              <TouchableOpacity
                onPress={onRetryPending}
                accessibilityRole="button"
                accessibilityLabel={t('ConnectedAgents.TryAgain')}
                testID={testIdWithKey('AgentDetailsRetryPending')}
                style={{ minHeight: 44, justifyContent: 'center' }}
              >
                <ThemedText style={styles.link}>{t('ConnectedAgents.TryAgain')}</ThemedText>
              </TouchableOpacity>
            )}
          </View>
        ))}
        {actionLines.retryPending ? (
          <AgentActionNotice line={actionLines.retryPending} testID={testIdWithKey('AgentDetailsRetryPendingLine')} />
        ) : null}
        {agent.memories.length > 0 ? (
          <View style={[styles.fact, styles.rule]} accessible>
            <Icon name="check" size={22} color={AGENT_COLORS.primary} accessibilityElementsHidden />
            <ThemedText style={styles.factText}>{t('ConnectedAgents.CanUseMemory', { names })}</ThemedText>
          </View>
        ) : null}
        <View style={[styles.fact, styles.rule]} accessible>
          <Icon name="shield-outline" size={22} color={AGENT_COLORS.primary} accessibilityElementsHidden />
          <ThemedText style={styles.factText}>{t('ConnectedAgents.VtaKeepsItToThese')}</ThemedText>
        </View>
        {agent.status === 'expired' || agent.status === 'revoked' ? null : (
          <TouchableOpacity
            style={[styles.fact, styles.rule]}
            onPress={onChangeMemories}
            accessibilityRole="button"
            accessibilityLabel={t('ConnectedAgents.ChangeMemories')}
            testID={testIdWithKey('AgentDetailsChangeMemories')}
          >
            <Icon name="pencil-outline" size={22} color={AGENT_COLORS.primary} accessibilityElementsHidden />
            <ThemedText style={[styles.factText, styles.link]}>{t('ConnectedAgents.ChangeMemories')}</ThemedText>
            <Icon name="chevron-right" size={22} color="#8E8E93" accessibilityElementsHidden />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.two}>
        {actions.includes('extend') && !actionLines.extend ? (
          <View style={styles.half}>
            <Button
              title={t('ConnectedAgents.Extend')}
              buttonType={ButtonType.Secondary}
              onPress={onExtend}
              testID={testIdWithKey('AgentDetailsExtend')}
              accessibilityLabel={t('ConnectedAgents.Extend')}
            />
          </View>
        ) : null}
        {actions.includes('connectAgain') ? (
          <View style={styles.half}>
            <Button
              title={t('ConnectedAgents.ConnectAgain')}
              buttonType={ButtonType.Primary}
              onPress={onConnectAgain}
              testID={testIdWithKey('AgentDetailsConnectAgain')}
              accessibilityLabel={t('ConnectedAgents.ConnectAgain')}
            />
          </View>
        ) : null}
        {actions.includes('remove') && !actionLines.remove ? (
          <View style={styles.half}>
            <Button
              title={t('ConnectedAgents.Remove')}
              buttonType={ButtonType.Critical}
              onPress={onRemove}
              testID={testIdWithKey('AgentDetailsRemove')}
              accessibilityLabel={t('ConnectedAgents.Remove')}
            />
          </View>
        ) : null}
        {actions.includes('revoke') && onRevoke ? (
          <View style={styles.half}>
            <Button
              title={t('ConnectedAgents.Revoke')}
              buttonType={ButtonType.Critical}
              onPress={onRevoke}
              testID={testIdWithKey('AgentDetailsRevoke')}
              accessibilityLabel={t('ConnectedAgents.Revoke')}
            />
          </View>
        ) : null}
      </View>
      {actionLines.extend ? (
        <AgentActionNotice line={actionLines.extend} testID={testIdWithKey('AgentDetailsExtendLine')} />
      ) : null}
      {actionLines.remove ? (
        <AgentActionNotice line={actionLines.remove} testID={testIdWithKey('AgentDetailsRemoveLine')} />
      ) : null}
    </ScrollView>
  )
}

export default AgentDetailsView
