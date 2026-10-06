/**
 * The person's agents as a row of chips across the top of "Your agent": the
 * current one filled, each other one a tap away, each with its own count of
 * requests waiting, and "Add" at the end (Alberto, 10-06). The drop-down list
 * it replaces opened into a column of names and status lines that read as
 * one block of text, and the count for another agent was a line in it.
 *
 * Unlinking another agent moved to Agent settings, with the other settings.
 * A switch in progress disables the chips and is said under them.
 *
 * Test ids kept from the list: `AgentSwitcherRow_<i>` per agent,
 * `AgentSwitcherCurrent` on the current one's tick, `AgentHomeName` on its
 * name (another's is `AgentSwitcherOther_<i>`), `AgentSwitcherAdd`,
 * `AgentSwitching`; a chip's badge is `AgentSwitcherBadge_<i>`.
 *
 * @module trust-tasks/screens/AgentChips
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

export interface AgentChip {
  vtaDid: string
  /** What the chip says: the agent's name, or "Agent 2" when it has none. */
  name: string
  current: boolean
  /** Requests waiting on this agent: the current one's, or what was last seen of another's. */
  waiting: number
}

export interface AgentChipsProps {
  agents: AgentChip[]
  /** The DID being switched to, while a switch lasts. */
  switchingTo?: string
  /** What a switch in progress says ("Switching to …"). */
  switchingText?: string
  onUse: (vtaDid: string) => void
  onAdd: () => void
}

export const AgentChips: React.FC<AgentChipsProps> = ({ agents, switchingTo, switchingText, onUse, onAdd }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const busy = Boolean(switchingTo)
  const styles = StyleSheet.create({
    strip: { gap: 8, paddingVertical: 2, paddingRight: 4 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      minHeight: 44,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 22,
      borderWidth: 2,
      borderColor: ColorPalette.brand.primary,
      maxWidth: 220,
    },
    chipCurrent: { backgroundColor: ColorPalette.brand.primary },
    chipOther: { backgroundColor: 'transparent' },
    chipBusy: { opacity: 0.5 },
    nameCurrent: { color: ColorPalette.grayscale.white, flexShrink: 1 },
    nameOther: { color: ColorPalette.brand.primary, flexShrink: 1 },
    badge: {
      minWidth: 22,
      height: 22,
      borderRadius: 11,
      paddingHorizontal: 6,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: ColorPalette.semantic.error,
    },
    badgeText: { color: ColorPalette.grayscale.white, fontSize: 12, lineHeight: 16, fontWeight: '700' },
    add: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      minHeight: 44,
      paddingHorizontal: 14,
      borderRadius: 22,
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: ColorPalette.grayscale.mediumGrey,
    },
    addText: { color: ColorPalette.brand.link },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })

  return (
    <View style={{ gap: 8 }} testID={testIdWithKey('AgentSwitcher')}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
        accessibilityRole="tablist"
        accessibilityLabel={t('VtaLink.SwitcherTitle')}
        testID={testIdWithKey('AgentChips')}
      >
        {agents.map((a, i) => (
          <Pressable
            key={a.vtaDid}
            style={[styles.chip, a.current ? styles.chipCurrent : styles.chipOther, busy ? styles.chipBusy : undefined]}
            disabled={a.current || busy}
            onPress={() => onUse(a.vtaDid)}
            accessibilityRole="tab"
            accessibilityLabel={a.waiting > 0 ? `${a.name}, ${t('Requests.RowWaiting', { count: a.waiting })}` : a.name}
            accessibilityState={{ selected: a.current, disabled: a.current || busy }}
            testID={testIdWithKey(`AgentSwitcherRow_${i}`)}
          >
            {a.current ? (
              <View testID={testIdWithKey('AgentSwitcherCurrent')}>
                <Icon name="check" size={18} color={ColorPalette.grayscale.white} />
              </View>
            ) : null}
            <ThemedText
              variant="bold"
              numberOfLines={1}
              style={a.current ? styles.nameCurrent : styles.nameOther}
              testID={testIdWithKey(a.current ? 'AgentHomeName' : `AgentSwitcherOther_${i}`)}
            >
              {a.name}
            </ThemedText>
            {a.waiting > 0 ? (
              <View style={styles.badge} testID={testIdWithKey(`AgentSwitcherBadge_${i}`)}>
                <ThemedText style={styles.badgeText}>{a.waiting > 99 ? '99+' : String(a.waiting)}</ThemedText>
              </View>
            ) : null}
          </Pressable>
        ))}
        <Pressable
          style={[styles.add, busy ? styles.chipBusy : undefined]}
          disabled={busy}
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel={t('VtaLink.SwitcherAdd')}
          testID={testIdWithKey('AgentSwitcherAdd')}
        >
          <Icon name="plus" size={18} color={ColorPalette.brand.link} />
          <ThemedText style={styles.addText}>
            {agents.length > 1 ? t('VtaLink.ChipAdd') : t('VtaLink.SwitcherAdd')}
          </ThemedText>
        </Pressable>
      </ScrollView>
      {/* A switch leaves one agent and signs in to the next (about 20 s on the
          device check): said while it lasts, so it is not tapped again. */}
      {switchingTo ? (
        <View style={styles.row} testID={testIdWithKey('AgentSwitching')}>
          <ActivityIndicator color={ColorPalette.brand.primary} />
          <ThemedText style={styles.muted}>{switchingText}</ThemedText>
        </View>
      ) : null}
    </View>
  )
}

export default AgentChips
