import React from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'
import { AGENT_COLORS } from '../components/agentStyle'
import { countNotice, MEMORY_COUNT_WARNING, MemoryCount } from '../memories'

/** One of the owner's memories, as the list draws it. */
export type ListedMemory = { id: string; name: string }

export interface MemoriesListViewProps {
  /** The owner's memories; undefined while they are read. */
  memories?: ListedMemory[]
  /** Per memory id, counted once when the list opens (§3.15); undefined while they are counted. */
  counts?: Record<string, MemoryCount>
  /** Formats a count's `lastChange` (an ISO-8601 instant) for this phone. */
  formatDate: (iso: string) => string
  /** "Delete" on a row: the caller previews the delete and opens the sheet (DeleteMemorySheet). Sends nothing. */
  onDelete: (id: string) => void
}

// Canvas frame 57 (docs/plans/agent-connect-plan/canvas/57-memories-list.png), drawn at 2x: a 26 pt heading, one
// white card with a hairline between rows, each row the layers icon, the name in bold, the count line in grey under
// it, and "Delete" in the danger red at the right; the warning box under the count when over the limit.
const styles = StyleSheet.create({
  body: { padding: 16, gap: 16 },
  heading: { fontFamily: 'SourceSans3-Bold', fontSize: 26, lineHeight: 32, color: AGENT_COLORS.text },
  group: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D9D9DE',
    paddingHorizontal: 14,
  },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 12 },
  rule: { borderTopWidth: 1, borderTopColor: '#E7E7E9' },
  main: { flex: 1, gap: 4 },
  name: { fontFamily: 'SourceSans3-Bold', fontSize: 17, lineHeight: 23, color: AGENT_COLORS.text },
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
  delete: { fontFamily: 'SourceSans3-Bold', fontSize: 17, lineHeight: 23, color: AGENT_COLORS.danger },
})

/**
 * The owner's memories (§3.15 "Deleting a memory", step 7.16; canvas frame 57): "Your memories", then one row per
 * memory with its name, its count line (the same words as the agent details: the count and its last change, the count
 * alone, or "Couldn't count its items"), the warning over MEMORY_COUNT_WARNING, and "Delete". A view: "Delete" calls
 * `onDelete` with the memory's id; the list sits in Settings and in the agent details, and placing it is the wiring's.
 * A count that is not `complete` is shown as counted: the logic decides completeness.
 */
const MemoriesListView: React.FC<MemoriesListViewProps> = ({ memories, counts, formatDate, onDelete }) => {
  const { t } = useTranslation()

  const countLine = (memory: ListedMemory) => {
    if (counts === undefined) return <ActivityIndicator size="small" style={{ alignSelf: 'flex-start' }} />
    const c = counts[memory.id]
    if (!c || !c.ok) return <ThemedText style={styles.small}>{t('ConnectedAgents.MemoryCountFailed')}</ThemedText>
    return (
      <>
        <ThemedText style={styles.small}>
          {c.lastChange
            ? t('ConnectedAgents.MemoryCount', { count: c.count, date: formatDate(c.lastChange) })
            : t('ConnectedAgents.MemoryCountNoDate', { count: c.count })}
        </ThemedText>
        {/* Over the limit as countNotice decides it (memories.ts), as the delete's preview does. */}
        {countNotice(c.count, undefined).overWarning ? (
          <View style={styles.warn} accessibilityRole="alert">
            <Icon name="alert-outline" size={20} color={AGENT_COLORS.warnText} accessibilityElementsHidden />
            <ThemedText style={styles.warnText}>
              {t('ConnectedAgents.MemoryCountWarning', { memory: memory.name, limit: MEMORY_COUNT_WARNING })}
            </ThemedText>
          </View>
        ) : null}
      </>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.body} testID={testIdWithKey('MemoriesList')}>
      <ThemedText style={styles.heading} accessibilityRole="header">
        {t('ConnectedAgents.MemoriesTitle')}
      </ThemedText>
      {memories === undefined ? (
        <ActivityIndicator size="small" style={{ alignSelf: 'flex-start' }} />
      ) : memories.length > 0 ? (
        <View style={styles.group}>
          {memories.map((memory, i) => (
            <View key={memory.id} style={[styles.row, i > 0 && styles.rule]} testID={testIdWithKey('MemoriesListRow')}>
              <Icon name="layers-outline" size={22} color={AGENT_COLORS.primary} accessibilityElementsHidden />
              <View style={styles.main} accessible>
                <ThemedText style={styles.name}>{memory.name}</ThemedText>
                {countLine(memory)}
              </View>
              <TouchableOpacity
                onPress={() => onDelete(memory.id)}
                testID={testIdWithKey('MemoriesListDelete')}
                accessibilityRole="button"
                accessibilityLabel={t('ConnectedAgents.Delete')}
                accessibilityHint={memory.name}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <ThemedText style={styles.delete}>{t('ConnectedAgents.Delete')}</ThemedText>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  )
}

export default MemoriesListView
