/**
 * Room info's "Agents in this room" (step 7.13; canvas frame 37): the owner's agents in this room, each with the
 * memories it can use, then "Add an agent", then what an agent added here can reach.
 *
 * A view: it draws what it is given and calls back, and it is not reachable yet. The container that feeds it from
 * fb's `useRoomAgents(roomId)` and mounts it in RoomInfo, behind `isAgentRoomsEnabled()`, is a follow-up once that
 * hook merges (backlog 3, Section B, Part T1, built views-first on Keyring's interim of 11-28).
 *
 * @module rooms/components/AgentRoomSection
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { AgentAvatar, AgentTag } from '../../connected-agents/components/AgentMark'

// The result of fb's `useRoomAgents(roomId)`, exactly as the seam gives it (backlog 3, Section B, "The result types,
// exactly"). Declared here, once; later tracks import it from this file.
export type RoomAgentsSetting = 'yes' | 'no' | 'notStated'
export type RoomAgentsTier = 'open' | 'attributed'
export interface RoomAgentInRoom {
  agentId: string
  name: string
  memoryNames: string[]
}
export interface RoomAgentAddable {
  agentId: string
  name: string
  memoryNames: string[]
  widens: { context: string } | null // null exactly when its record lists a room of this persona
}
export interface RoomAgents {
  offered: boolean // false: the section, the "+" sheet's agent row and the mentions are all absent
  setting: RoomAgentsSetting
  persona: string
  tier: RoomAgentsTier // meaningful only when offered
  inRoom: RoomAgentInRoom[]
  addable: RoomAgentAddable[]
}

/** What the section draws: Part T1's props, without the two callbacks. */
export interface AgentRoomSectionData {
  /** The owner's agents in this room (`inRoom`). */
  agents: RoomAgentInRoom[]
  /** The persona the owner acts as in this room, by its name. */
  persona: string
  /** Whether any agent can be added (`addable` is not empty): "Add an agent" is drawn only then. */
  canAdd: boolean
  setting: RoomAgentsSetting
  tier: RoomAgentsTier
}

export interface AgentRoomSectionProps extends AgentRoomSectionData {
  /** A row was pressed: the caller opens "What it remembers" on that agent. */
  onOpenAgent: (agentId: string) => void
  /** "Add an agent" was pressed (only ever while it is enabled): the caller starts the add flow. */
  onAdd: () => void
}

/**
 * Whether the section shows, and what it draws, from `useRoomAgents`' result. Absent (`null`) when the room is not
 * offered, which is also the hook's answer with either switch off or in a private room, and when there is no agent in
 * the room and none to add: a person with no agent sees today's room info (Part T1, "Decided here").
 */
export const agentRoomSection = (room: RoomAgents): AgentRoomSectionData | null => {
  if (!room.offered) return null
  if (room.inRoom.length === 0 && room.addable.length === 0) return null
  return {
    agents: room.inRoom,
    persona: room.persona,
    canAdd: room.addable.length > 0,
    setting: room.setting,
    tier: room.tier,
  }
}

/** Why "Add an agent" is off, if it is: the tier first (ruling 7), then the community's setting (§3.8, PLAN:644). */
const addOffReason = (tier: RoomAgentsTier, setting: RoomAgentsSetting) => {
  if (tier === 'attributed') return 'ConnectedAgents.AgentsNotInAttributed'
  if (setting === 'no') return 'ConnectedAgents.CommunityNo'
  if (setting === 'notStated') return 'ConnectedAgents.CommunityNotStated'
  return undefined
}

const AgentRoomSection: React.FC<AgentRoomSectionProps> = ({
  agents,
  persona,
  canAdd,
  setting,
  tier,
  onOpenAgent,
  onAdd,
}) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()

  // RoomInfo's own caption and row styles, so the section reads as one of its sections.
  const styles = StyleSheet.create({
    caption: {
      paddingHorizontal: 16,
      paddingTop: 18,
      paddingBottom: 6,
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      color: ColorPalette.grayscale.mediumGrey,
    },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      minHeight: 56,
      paddingHorizontal: 16,
      paddingVertical: 8,
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      marginLeft: 66,
      backgroundColor: ColorPalette.grayscale.lightGrey,
    },
    text: { flex: 1, minWidth: 0, gap: 2 },
    nameLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
    name: { fontSize: 17, fontWeight: '700' },
    sub: { fontSize: 14, color: ColorPalette.grayscale.mediumGrey },
    plus: { width: 36, alignItems: 'center' },
    label: { flex: 1, minWidth: 0, fontSize: 17 },
    off: { color: ColorPalette.grayscale.mediumGrey },
    why: {
      paddingHorizontal: 16,
      paddingBottom: 12,
      fontSize: 14,
      color: ColorPalette.grayscale.mediumGrey,
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
    note: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
    noteText: { flex: 1, fontSize: 15, color: ColorPalette.grayscale.mediumGrey },
  })

  const addOff = addOffReason(tier, setting) !== undefined
  // The line under "Add an agent", with the row. In an attributed room it stands in for the every-room note, so it is
  // drawn there even when no agent is left to add (decided here: the brief draws it under the row, and an attributed
  // room with an agent already in it and none addable would otherwise say nothing about what applies).
  const why = canAdd || tier === 'attributed' ? addOffReason(tier, setting) : undefined

  return (
    <View testID={testIdWithKey('AgentRoomSection')}>
      <ThemedText style={styles.caption} accessibilityRole="header">
        {t('ConnectedAgents.AgentsInThisRoom')}
      </ThemedText>
      {agents.map((agent, i) => (
        <View key={agent.agentId}>
          {i > 0 ? <View style={styles.divider} /> : null}
          <Pressable
            style={styles.item}
            onPress={() => onOpenAgent(agent.agentId)}
            accessibilityRole="button"
            testID={testIdWithKey('AgentRoomRow')}
          >
            <AgentAvatar size={44} />
            <View style={styles.text}>
              <View style={styles.nameLine}>
                <ThemedText style={styles.name}>{agent.name}</ThemedText>
                <AgentTag />
              </View>
              <ThemedText style={styles.sub}>
                {agent.memoryNames.length > 0
                  ? t('ConnectedAgents.AgentMemory', { names: agent.memoryNames.join(', ') })
                  : t('ConnectedAgents.AgentNoMemory')}
              </ThemedText>
            </View>
            <Icon name="chevron-right" size={24} color={ColorPalette.grayscale.mediumGrey} />
          </Pressable>
        </View>
      ))}
      {canAdd ? (
        <>
          {agents.length > 0 ? <View style={styles.divider} /> : null}
          {/* Disabled, not refused afterwards: an attributed room, or a community that has not said yes, never
              reaches the add sheet. There is no "Add anyway" (PLAN:644). */}
          <Pressable
            style={styles.item}
            onPress={addOff ? undefined : onAdd}
            disabled={addOff}
            accessibilityRole="button"
            accessibilityState={{ disabled: addOff }}
            testID={testIdWithKey('AgentRoomAdd')}
          >
            <View style={styles.plus}>
              <Icon
                name="plus"
                size={28}
                color={addOff ? ColorPalette.grayscale.mediumGrey : ColorPalette.brand.primary}
              />
            </View>
            <ThemedText style={[styles.label, addOff ? styles.off : null]}>
              {t('ConnectedAgents.AddAnAgent')}
            </ThemedText>
          </Pressable>
        </>
      ) : null}
      {why ? (
        <ThemedText style={styles.why} testID={testIdWithKey('AgentRoomSetting')}>
          {t(why)}
        </ThemedText>
      ) : null}
      {/* In an attributed room no agent can read or answer, so the every-room note would not apply there: the line
          under "Add an agent" says what does (ruling 7). */}
      {tier === 'attributed' ? null : (
        <View style={styles.note} testID={testIdWithKey('AgentRoomNote')}>
          <Icon
            name="eye-outline"
            size={22}
            color={ColorPalette.grayscale.mediumGrey}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <ThemedText style={styles.noteText}>{t('ConnectedAgents.AgentsUseEveryRoom', { persona })}</ThemedText>
        </View>
      )}
    </View>
  )
}

export default AgentRoomSection
