import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'

import { AGENT_COLORS } from './agentStyle'

/** One memory as the picker shows it: by its name, never its context id (§6, copy rules for memory). */
export type PickerMemory = { id: string; name: string; containsOthers: boolean }

type CreateRefusal = 'duplicateName' | 'failed' | 'heldForApproval'

/**
 * A create's outcome. "heldForApproval": the owner's VTA asks for approval before a memory is made, so this one was
 * not made, and the phone does not wait on its own approval; a retry would fail the same way, so nothing offers one.
 */
export type CreateMemoryResult = { ok: true; memory: PickerMemory } | { ok: false; code: CreateRefusal }

const REFUSAL_KEY: Record<CreateRefusal, string> = {
  duplicateName: 'ConnectedAgents.MemoryNameTaken',
  failed: 'ConnectedAgents.MemoryCreateFailed',
  // Never "Try again" here (§6, #1060 finding 20): a retry fails the same way. A test holds it in every language.
  heldForApproval: 'ConnectedAgents.MemoryHeldForApproval',
}

/** A memory's name: 1 to 64 characters (§6, memory pickers). */
export const MEMORY_NAME_MAX = 64

export interface MemoryPickerProps {
  memories: PickerMemory[]
  /** The ids picked. Nothing picked is allowed (§6). */
  selected: string[]
  onToggle: (id: string) => void
  /** Creates a top-level memory with this name; the picker picks it when it is made. */
  onCreate: (name: string) => Promise<CreateMemoryResult>
  /** Told when the "Name this memory" field opens or closes, so the screen can hold its own button meanwhile. */
  onNamingChange?: (naming: boolean) => void
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D9D9DE',
    paddingHorizontal: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingVertical: 8,
    gap: 12,
  },
  rule: { borderTopWidth: 1, borderTopColor: '#E7E7E9' },
  name: { fontFamily: 'SourceSans3-Regular', fontSize: 17, color: AGENT_COLORS.text },
  nameOff: { color: AGENT_COLORS.disabled },
  sub: { fontFamily: 'SourceSans3-Regular', fontSize: 14, color: AGENT_COLORS.disabled },
  newText: { fontFamily: 'SourceSans3-Bold', fontSize: 17, color: AGENT_COLORS.text },
  naming: { paddingVertical: 12, gap: 8 },
  label: { fontFamily: 'SourceSans3-Bold', fontSize: 17, color: AGENT_COLORS.text },
  input: {
    borderWidth: 1.5,
    borderColor: AGENT_COLORS.primary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'SourceSans3-Regular',
    fontSize: 17,
    color: AGENT_COLORS.text,
  },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  counter: { fontFamily: 'SourceSans3-Regular', fontSize: 14, color: AGENT_COLORS.muted },
  create: {
    minWidth: 96,
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AGENT_COLORS.primary,
  },
  createOff: { backgroundColor: '#D4D4D8' },
  createText: { fontFamily: 'SourceSans3-Bold', fontSize: 17, color: '#FFFFFF' },
  error: { fontFamily: 'SourceSans3-Regular', fontSize: 15, color: AGENT_COLORS.danger },
})

/**
 * The memory picker (§6 "Memory pickers", §3.15; canvas frames 1 and 1b): one checkbox row per memory by its name,
 * a memory that contains other memories greyed with "Contains other memories" and not pickable (an ancestor in an
 * agent's `act` would bind it to the whole subtree), and a row "New memory" that opens "Name this memory" with
 * "Create". The connect step and "Change memories" use the same control.
 */
const MemoryPicker: React.FC<MemoryPickerProps> = ({ memories, selected, onToggle, onCreate, onNamingChange }) => {
  const { t } = useTranslation()
  const [naming, setNaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<CreateRefusal | undefined>()

  const openNaming = (open: boolean) => {
    setNaming(open)
    setError(undefined)
    if (!open) setDraft('')
    onNamingChange?.(open)
  }

  const name = draft.trim()
  const canCreate = !creating && name.length >= 1 && name.length <= MEMORY_NAME_MAX

  const create = async () => {
    if (!canCreate) return
    // The VTA allows two memories of one name; Keyring does not, among the owner's own (§3.15). Say so at once.
    if (memories.some((m) => m.name === name)) {
      setError('duplicateName')
      return
    }
    setCreating(true)
    setError(undefined)
    try {
      const result = await onCreate(name)
      if (result.ok) {
        onToggle(result.memory.id)
        openNaming(false)
      } else {
        setError(result.code)
      }
    } catch {
      setError('failed')
    } finally {
      setCreating(false)
    }
  }

  return (
    <View style={styles.box} testID={testIdWithKey('MemoryPicker')}>
      {memories.map((memory, index) => {
        const checked = selected.includes(memory.id)
        const off = memory.containsOthers
        return (
          <TouchableOpacity
            key={memory.id}
            style={[styles.row, index > 0 && styles.rule]}
            onPress={() => onToggle(memory.id)}
            disabled={off}
            testID={testIdWithKey('MemoryPickerRow')}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: off ? false : checked, disabled: off }}
            accessibilityLabel={off ? `${memory.name}, ${t('ConnectedAgents.ContainsOtherMemories')}` : memory.name}
          >
            <Icon
              name={off ? 'checkbox-blank-outline' : checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
              size={28}
              color={off ? '#C8C8CE' : AGENT_COLORS.primary}
            />
            <View style={{ flex: 1 }}>
              <ThemedText style={[styles.name, off && styles.nameOff]}>{memory.name}</ThemedText>
              {off ? <ThemedText style={styles.sub}>{t('ConnectedAgents.ContainsOtherMemories')}</ThemedText> : null}
            </View>
          </TouchableOpacity>
        )
      })}
      <TouchableOpacity
        style={[styles.row, memories.length > 0 && styles.rule]}
        onPress={() => openNaming(!naming)}
        testID={testIdWithKey('MemoryPickerNew')}
        accessibilityRole="button"
        accessibilityState={{ expanded: naming }}
        accessibilityLabel={t('ConnectedAgents.NewMemory')}
      >
        <Icon name="plus" size={28} color={AGENT_COLORS.primary} />
        <ThemedText style={styles.newText}>{t('ConnectedAgents.NewMemory')}</ThemedText>
      </TouchableOpacity>
      {naming ? (
        <View style={[styles.naming, styles.rule]}>
          <ThemedText style={styles.label} nativeID="MemoryPickerNameLabel">
            {t('ConnectedAgents.NameThisMemory')}
          </ThemedText>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={(text) => {
              setDraft(text)
              setError(undefined)
            }}
            maxLength={MEMORY_NAME_MAX}
            autoFocus
            accessibilityLabel={t('ConnectedAgents.NameThisMemory')}
            accessibilityLabelledBy="MemoryPickerNameLabel"
            onSubmitEditing={create}
            testID={testIdWithKey('MemoryPickerName')}
          />
          {error ? (
            <ThemedText
              style={styles.error}
              accessibilityLiveRegion="polite"
              testID={testIdWithKey('MemoryPickerError')}
            >
              {t(REFUSAL_KEY[error])}
            </ThemedText>
          ) : null}
          <View style={styles.footer}>
            <ThemedText style={styles.counter}>{`${draft.length} / ${MEMORY_NAME_MAX}`}</ThemedText>
            <TouchableOpacity
              style={[styles.create, !canCreate && styles.createOff]}
              onPress={create}
              disabled={!canCreate}
              testID={testIdWithKey('MemoryPickerCreate')}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canCreate, busy: creating }}
              accessibilityLabel={t('ConnectedAgents.CreateMemory')}
            >
              {creating ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <ThemedText style={styles.createText}>{t('ConnectedAgents.CreateMemory')}</ThemedText>
              )}
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  )
}

export default MemoryPicker
