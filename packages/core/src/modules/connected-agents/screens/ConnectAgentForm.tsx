import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'
import { AGENT_COLORS } from '../components/agentStyle'
import MemoryPicker, { CreateMemoryResult, PickerMemory } from '../components/MemoryPicker'
import { AGENT_PURPOSES, AgentPurpose } from '../pairing'

import ConnectFailureView from './ConnectFailureView'

/** The agent's name: 1 to 64 characters (the pairing machine's `choiceProblem` checks it again). */
export const AGENT_NAME_MAX = 64

/** The connect guard, run before the picker shows (§1.5, §2.6, §3.15). */
export type ConnectGuard = 'checking' | 'ok' | 'notAdministrator' | 'vtaTooOld' | 'unreachable'

/** What the name step hands on. The logic fills the persona and the empty context (seam, point 4). */
export type ConnectFormChoice = { name: string; memoryContexts: string[]; purposes: AgentPurpose[] }

const PURPOSE_KEY: Record<AgentPurpose, string> = {
  personalisation: 'ConnectedAgents.PurposePersonalisation',
  taskExecution: 'ConnectedAgents.PurposeTaskExecution',
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: 16, gap: 10, paddingBottom: 28 },
  section: { fontFamily: 'SourceSans3-Bold', fontSize: 18, color: AGENT_COLORS.text, marginTop: 8 },
  input: {
    borderWidth: 1.5,
    borderColor: '#8E8E93',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontFamily: 'SourceSans3-Regular',
    fontSize: 17,
    color: AGENT_COLORS.text,
    backgroundColor: '#FFFFFF',
  },
  helper: { fontFamily: 'SourceSans3-Regular', fontSize: 15, lineHeight: 20, color: AGENT_COLORS.muted },
  box: { backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#D9D9DE', paddingHorizontal: 14 },
  purpose: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 46, paddingVertical: 8 },
  rule: { borderTopWidth: 1, borderTopColor: '#E7E7E9' },
  purposeText: { flex: 1, fontFamily: 'SourceSans3-Regular', fontSize: 17, color: AGENT_COLORS.text },
  iconLine: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 8 },
  hours: { fontFamily: 'SourceSans3-Bold', fontSize: 18, color: AGENT_COLORS.text },
  center: { padding: 32, alignItems: 'center' },
  bar: { padding: 16, borderTopWidth: 1, borderTopColor: '#E7E7E9' },
})

export interface ConnectAgentFormProps {
  guard: ConnectGuard
  /** The owner's memories; undefined while they are listed. */
  memories?: PickerMemory[]
  onCreateMemory: (name: string) => Promise<CreateMemoryResult>
  onContinue: (choice: ConnectFormChoice) => void
  onClose: () => void
}

/**
 * Connect, the first step (§6 "Connect, name step"; canvas frames 1 and 1b): "Name this agent"; "Memory it can use"
 * as the memory picker, with its helper; "What it can use them for", the two purposes shown, not picked (D44); "For 4
 * hours" with its helper, with no expiry choice (D42); the terminal helper; and "Continue".
 *
 * Before any of that the connect guard runs: a phone that is not a full administrator, a VTA too old for agents, or a
 * VTA it cannot reach, ends the connect here, with no name field, no picker and no "New memory" (canvas frame K23).
 */
const ConnectAgentForm: React.FC<ConnectAgentFormProps> = ({
  guard,
  memories,
  onCreateMemory,
  onContinue,
  onClose,
}) => {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [naming, setNaming] = useState(false)

  if (guard === 'checking') {
    return (
      <View style={styles.center} testID={testIdWithKey('ConnectAgentChecking')}>
        <ActivityIndicator accessibilityLabel={t('ConnectedAgents.ConnectAnAgent')} />
      </View>
    )
  }
  if (guard !== 'ok') {
    return <ConnectFailureView end={guard === 'unreachable' ? 'vta-unreachable' : guard} onClose={onClose} />
  }

  const trimmed = name.trim()
  // Memories still being listed: wait for them, so a memory cannot be missed by a quick "Continue".
  const ready = trimmed.length > 0 && !naming && memories !== undefined
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  return (
    <View style={styles.screen} testID={testIdWithKey('ConnectAgentForm')}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <ThemedText style={styles.section} nativeID="ConnectAgentNameLabel">
          {t('ConnectedAgents.NameThisAgent')}
        </ThemedText>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          maxLength={AGENT_NAME_MAX}
          accessibilityLabel={t('ConnectedAgents.NameThisAgent')}
          accessibilityLabelledBy="ConnectAgentNameLabel"
          testID={testIdWithKey('ConnectAgentName')}
        />

        <ThemedText style={styles.section}>{t('ConnectedAgents.MemoryItCanUse')}</ThemedText>
        {memories === undefined ? (
          <ActivityIndicator testID={testIdWithKey('ConnectAgentMemoriesLoading')} />
        ) : (
          <MemoryPicker
            memories={memories}
            selected={selected}
            onToggle={toggle}
            onCreate={onCreateMemory}
            onNamingChange={setNaming}
          />
        )}
        <ThemedText style={styles.helper}>{t('ConnectedAgents.NameHelper')}</ThemedText>

        <ThemedText style={styles.section}>{t('ConnectedAgents.PurposesTitle')}</ThemedText>
        <View style={styles.box} testID={testIdWithKey('ConnectAgentPurposes')}>
          {AGENT_PURPOSES.map((purpose, i) => (
            <View key={purpose} style={[styles.purpose, i > 0 && styles.rule]} accessible>
              <Icon name="check" size={22} color={AGENT_COLORS.primary} accessibilityElementsHidden />
              <ThemedText style={styles.purposeText}>{t(PURPOSE_KEY[purpose])}</ThemedText>
            </View>
          ))}
        </View>

        <View style={styles.iconLine}>
          <Icon name="clock-outline" size={24} color={AGENT_COLORS.primary} accessibilityElementsHidden />
          <View style={{ flex: 1 }} accessible>
            <ThemedText style={styles.hours}>{t('ConnectedAgents.ForFourHours')}</ThemedText>
            <ThemedText style={styles.helper}>{t('ConnectedAgents.ForFourHoursHelper')}</ThemedText>
          </View>
        </View>
        <View style={styles.iconLine}>
          <Icon name="console" size={22} color={AGENT_COLORS.muted} accessibilityElementsHidden />
          <ThemedText style={[styles.helper, { flex: 1 }]}>{t('ConnectedAgents.TerminalHelper')}</ThemedText>
        </View>
      </ScrollView>
      <View style={styles.bar}>
        <Button
          title={t('Global.Continue')}
          buttonType={ButtonType.Primary}
          disabled={!ready}
          onPress={() =>
            ready && onContinue({ name: trimmed, memoryContexts: selected, purposes: [...AGENT_PURPOSES] })
          }
          testID={testIdWithKey('ConnectAgentContinue')}
          accessibilityLabel={t('Global.Continue')}
        />
      </View>
    </View>
  )
}

export default ConnectAgentForm
