/**
 * The agent picker of the add flow (step 7.13; canvas frame 34): which of the owner's agents to add to this room, when
 * more than one can be (PLAN:592; with exactly one the flow skips it).
 *
 * A view, and not reachable yet: the add flow that mounts it comes once fb's `useRoomAgents` merges (backlog 3,
 * Section B, Part T1). It draws only the agents it is given: fb's hook leaves out an expired one, one already in the
 * room, and one of another persona.
 *
 * @module rooms/components/AgentPickerSheet
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'
import { AgentAvatar, AgentTag } from '../../connected-agents/components/AgentMark'
import { AGENT_COLORS } from '../../connected-agents/components/agentStyle'

export interface AgentPickerSheetProps {
  /** The agents that can be added here (`useRoomAgents`' `addable`), by name. */
  agents: { agentId: string; name: string }[]
  /** An agent was picked: the flow goes on to the add sheet for it. */
  onPick: (agentId: string) => void
  /** The sheet is dismissed (the screen reader's escape gesture here; the backdrop is the caller's). */
  onClose: () => void
}

// Canvas frame 34, drawn at 2x: 16 pt sides, a 44 pt avatar, the name in 20 pt bold with the "AI agent" mark, and a
// chevron, rows divided by a hairline.
const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 8 },
  rule: { borderTopWidth: 1, borderTopColor: '#E7E7E9' },
  nameLine: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  name: { fontFamily: 'SourceSans3-Bold', fontSize: 20, color: AGENT_COLORS.text },
})

/**
 * One row per agent: the robot, the name and "AI agent", with a chevron. No heading: the plan gives the picker no words
 * (frame 34's canvas note), so the sheet is labelled for a screen reader with "Add my agent", an existing string
 * (Part T1, "Decided here").
 */
const AgentPickerSheet: React.FC<AgentPickerSheetProps> = ({ agents, onPick, onClose }) => {
  const { t } = useTranslation()
  const badge = t('Rooms.AgentBadge')
  return (
    <View
      style={styles.sheet}
      testID={testIdWithKey('AgentPickerSheet')}
      accessibilityLabel={t('ConnectedAgents.AddMyAgent')}
      accessibilityViewIsModal
      onAccessibilityEscape={onClose}
    >
      {agents.map((agent, i) => (
        <Pressable
          key={agent.agentId}
          style={[styles.row, i > 0 ? styles.rule : null]}
          onPress={() => onPick(agent.agentId)}
          accessibilityRole="button"
          accessibilityLabel={`${agent.name}, ${badge}`}
          testID={testIdWithKey('AgentPickerRow')}
        >
          <AgentAvatar size={44} />
          <View style={styles.nameLine}>
            <ThemedText style={styles.name}>{agent.name}</ThemedText>
            <AgentTag />
          </View>
          <Icon name="chevron-right" size={24} color={AGENT_COLORS.muted} />
        </Pressable>
      ))}
    </View>
  )
}

export default AgentPickerSheet
