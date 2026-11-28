import React from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'
import { AgentAvatar, AgentTag } from '../components/AgentMark'
import AnswersOthersRow, { AnswersOthersRowProps } from '../components/AnswersOthersRow'
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
  // P1 (step 7.14; canvas frame 16). The caller gives each only when `isAgentRoomsEnabled()`; with all four left out,
  // the details are as in P0.
  /** The agent's handle, from its record (`useAgentConnection(id)`): "Mention it as @<handle>." under the owner. */
  handle?: string
  /** The name of the persona whose rooms the agent can use; absent while it has been added to no room (ruling 6). */
  persona?: string
  /** Every context in the entry's `act`, by name, so the persona's context shows (PLAN:1361). Drawn with `persona`. */
  actNames?: string[]
  /** "Answers other people": `useAnswersOthers(id)`'s state with the caller's handlers (a base-path agent only). */
  answersOthers?: AnswersOthersRowProps
}

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
  mention: { fontFamily: 'SourceSans3-Regular', fontSize: 15, lineHeight: 20, color: AGENT_COLORS.muted },
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
 * the counts). The header title is the agent's name, set by the navigator (§6, #1060 finding 9).
 *
 * The P1 lines (step 7.14; frame 16) are drawn only from their props: "Mention it as" with `handle`, "Answers other
 * people" with `answersOthers`, and with `persona` the room form of the access lines: "Can use memory <names> in every
 * room it is in." from `actNames`, and one "It can use every open room you're in as <persona>." in place of §6's
 * per-room "Can read all of <room>" lines (ruling 6). Without `persona` the no-room form is drawn: "in every room it is
 * in" is never said of an agent in no room, where it would claim rooms that do not exist. "Add a credential" is step
 * 7.23 and is left out.
 */
const AgentDetailsView: React.FC<AgentDetailsViewProps> = ({
  agent,
  counts,
  warnAbove,
  onChangeMemories,
  onRestore,
  onRetryPending,
  onExtend,
  onRemove,
  onConnectAgain,
  onMessage,
  onKeepConnected,
  onRevoke,
  handle,
  persona,
  actNames,
  answersOthers,
}) => {
  const { t } = useTranslation()
  const actions = rowActions(agent)
  const names = agent.memories.map((m) => m.name).join(', ')
  // The room form's access line names every context the entry can use, the persona's included (PLAN:1361). Without
  // `actNames` it falls back to the bound memories, which are part of `act`.
  const roomNames = (actNames ?? agent.memories.map((m) => m.name)).join(', ')
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
          {handle ? <ThemedText style={styles.mention}>{t('ConnectedAgents.MentionAs', { handle })}</ThemedText> : null}
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
      {onKeepConnected && agent.temporary && actions.includes('extend') ? (
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
          onRestore={onRestore}
          onRevoke={onRevoke}
        />
      ) : null}

      {answersOthers ? <AnswersOthersRow {...answersOthers} /> : null}

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
            <TouchableOpacity
              onPress={onRetryPending}
              accessibilityRole="button"
              accessibilityLabel={t('ConnectedAgents.TryAgain')}
              testID={testIdWithKey('AgentDetailsRetryPending')}
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <ThemedText style={styles.link}>{t('ConnectedAgents.TryAgain')}</ThemedText>
            </TouchableOpacity>
          </View>
        ))}
        {persona !== undefined ? (
          roomNames ? (
            <View style={[styles.fact, styles.rule]} accessible>
              <Icon name="check" size={22} color={AGENT_COLORS.primary} accessibilityElementsHidden />
              <ThemedText style={styles.factText}>
                {t('ConnectedAgents.CanUseInEveryRoom', { names: roomNames })}
              </ThemedText>
            </View>
          ) : null
        ) : agent.memories.length > 0 ? (
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
        {persona !== undefined ? (
          <View style={[styles.fact, styles.rule]} accessible>
            <Icon name="eye-outline" size={22} color={AGENT_COLORS.primary} accessibilityElementsHidden />
            <ThemedText style={styles.factText}>{t('ConnectedAgents.CanUseEveryRoomAs', { persona })}</ThemedText>
          </View>
        ) : null}
      </View>

      <View style={styles.two}>
        {actions.includes('extend') ? (
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
        {actions.includes('remove') ? (
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
    </ScrollView>
  )
}

export default AgentDetailsView
