import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'
import { AGENT_COLORS } from '../components/agentStyle'

export interface WhatItRemembersSheetProps {
  /** The agent's name, as the owner gave it. */
  name: string
  /** The persona whose open rooms the agent can use, by its name. */
  persona: string
  /** The names of the memories the agent can use, in the order to draw them. */
  memoryNames: string[]
  /** "Done": closes the sheet. */
  onDone: () => void
  /** "Connect another agent": the caller opens the connect (R1's ConnectAgent route, through the My Agent stack). */
  onConnectAnother: () => void
}

// Canvas frame 36, drawn at 2x like the other agent sheets: 16 pt sides, a 22 pt title, a 17 pt body, the memories in
// a bordered card, a grey note, and two full-width 52 pt buttons, "Done" filled in Keyring's purple and "Connect
// another agent" outlined.
const styles = StyleSheet.create({
  sheet: { gap: 16, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  title: { fontFamily: 'SourceSans3-Bold', fontSize: 22, lineHeight: 28, color: AGENT_COLORS.text },
  body: { fontFamily: 'SourceSans3-Regular', fontSize: 17, lineHeight: 24, color: AGENT_COLORS.text },
  card: { backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#D9D9DE', paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 8 },
  rule: { borderTopWidth: 1, borderTopColor: '#E7E7E9' },
  memory: { flex: 1, fontFamily: 'SourceSans3-Regular', fontSize: 17, color: AGENT_COLORS.text },
  note: { flexDirection: 'row', gap: 10 },
  noteText: { flex: 1, fontFamily: 'SourceSans3-Regular', fontSize: 15, lineHeight: 20, color: AGENT_COLORS.muted },
  buttons: { gap: 12 },
  button: { minHeight: 52, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  primary: { backgroundColor: AGENT_COLORS.primary },
  primaryText: { fontFamily: 'SourceSans3-Bold', fontSize: 18, color: '#FFFFFF' },
  secondary: { backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: AGENT_COLORS.primary },
  secondaryText: { fontFamily: 'SourceSans3-Bold', fontSize: 18, color: AGENT_COLORS.primary },
})

/**
 * "What <name> remembers" (step 7.13; canvas frame 36): the memories the agent can use, in every room it is in, and
 * that it can use every open room the owner is in as the persona (backlog 3, ruling 6). Shown after an agent is added
 * to a room (PLAN:596) and from a row of room info's "Agents in this room"; not from the agent's details in this
 * backlog, whose memory group already shows the same set.
 *
 * A view, and not reachable yet: the add flow that mounts it comes once fb's room hooks merge (backlog 3, Section B,
 * Part T1). The memory rows are not tappable: frame 36 draws chevrons, but "What a memory holds" (PLAN:1017) is P1's
 * credentials, not 7.13 (decided in Part T1).
 */
const WhatItRemembersSheet: React.FC<WhatItRemembersSheetProps> = ({
  name,
  persona,
  memoryNames,
  onDone,
  onConnectAnother,
}) => {
  const { t } = useTranslation()
  return (
    <View
      style={styles.sheet}
      testID={testIdWithKey('WhatItRemembers')}
      accessibilityViewIsModal
      onAccessibilityEscape={onDone}
    >
      <ThemedText style={styles.title} accessibilityRole="header">
        {t('ConnectedAgents.WhatItRemembers', { name })}
      </ThemedText>
      {memoryNames.length > 0 ? (
        <>
          <ThemedText style={styles.body}>
            {t('ConnectedAgents.WhatItRemembersBody', { name, names: memoryNames.join(', ') })}
          </ThemedText>
          <View style={styles.card}>
            {memoryNames.map((memory, i) => (
              <View
                key={`${i}:${memory}`}
                style={[styles.row, i > 0 ? styles.rule : null]}
                testID={testIdWithKey('WhatItRemembersRow')}
              >
                <Icon name="layers-outline" size={24} color={AGENT_COLORS.primary} accessibilityElementsHidden />
                <ThemedText style={styles.memory}>{memory}</ThemedText>
              </View>
            ))}
          </View>
        </>
      ) : (
        <ThemedText style={styles.body}>{t('ConnectedAgents.WhatItRemembersNone', { name })}</ThemedText>
      )}
      <ThemedText style={styles.body}>{t('ConnectedAgents.CanUseEveryRoomAs', { persona })}</ThemedText>
      <View style={styles.note}>
        <Icon name="information-outline" size={22} color={AGENT_COLORS.muted} accessibilityElementsHidden />
        <ThemedText style={styles.noteText}>{t('ConnectedAgents.MemoryIsText')}</ThemedText>
      </View>
      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.button, styles.primary]}
          onPress={onDone}
          testID={testIdWithKey('WhatItRemembersDone')}
          accessibilityRole="button"
          accessibilityLabel={t('Global.Done')}
        >
          <ThemedText style={styles.primaryText}>{t('Global.Done')}</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.secondary]}
          onPress={onConnectAnother}
          testID={testIdWithKey('WhatItRemembersConnectAnother')}
          accessibilityRole="button"
          accessibilityLabel={t('ConnectedAgents.ConnectAnotherAgent')}
        >
          <ThemedText style={styles.secondaryText}>{t('ConnectedAgents.ConnectAnotherAgent')}</ThemedText>
        </TouchableOpacity>
      </View>
    </View>
  )
}

export default WhatItRemembersSheet
