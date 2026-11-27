import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from 'react-native'

import Button, { ButtonType } from '../../../../components/buttons/Button'
import { ThemedText } from '../../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../../utils/testable'
import { AGENT_COLORS } from '../../components/agentStyle'
import ConnectNotice from '../../components/ConnectNotice'
import { type HcpAddMemoryResult, HCP_MEMORY_MAX_CHARS, hcpMemoryTextValid } from '../newMemory'

import { useHcpCopy } from './useHcpCopy'

// Canvas frame 51: 16 pt sides, a 26 pt title, the field's 19 pt label, a white field with Keyring's purple edge, a
// muted 16 pt helper, and "Save" full width in a bar at the bottom.
const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: 16, gap: 12, paddingBottom: 28 },
  title: { fontFamily: 'SourceSans3-Bold', fontSize: 26, lineHeight: 32, color: AGENT_COLORS.text },
  label: { fontFamily: 'SourceSans3-Bold', fontSize: 19, lineHeight: 24, color: AGENT_COLORS.text, marginTop: 8 },
  input: {
    borderWidth: 2,
    borderColor: AGENT_COLORS.primary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
    fontFamily: 'SourceSans3-Regular',
    fontSize: 19,
    color: AGENT_COLORS.text,
    backgroundColor: '#FFFFFF',
    textAlignVertical: 'top',
  },
  helper: { fontFamily: 'SourceSans3-Regular', fontSize: 16, lineHeight: 21, color: AGENT_COLORS.muted },
  spinner: { marginRight: 8 },
  bar: { padding: 16, borderTopWidth: 1, borderTopColor: '#E7E7E9' },
})

/** What the view shows after a save that did not end it. */
type Outcome = { kind: 'notSaved'; text: string } | { kind: 'failed' }

export interface HcpNewMemoryViewProps {
  /** The name the person gave the agent. */
  name: string
  /**
   * "Save": saves the text and answers what it came to. The wiring passes `addHcpMemory` (hcp/newMemory.ts) bound to
   * its port, session, language and clock; this view never imports it.
   */
  onSave: (text: string) => Promise<HcpAddMemoryResult>
  /** The memory was saved: the caller closes the view. */
  onDone: () => void
  /**
   * The field's text when the view opens (empty by default). Not in the brief's props: the screen catalogue can press
   * but not type, so its "not saved" state starts from frame 51's sample text.
   */
  initialText?: string
}

/**
 * The HCP new memory (canvas frame 51; companion finding 6; backlog Section C, U3): "Add a memory for "<name>"", the
 * field "What should it know?" (multiline, at most {@link HCP_MEMORY_MAX_CHARS} characters), "Saved as something you
 * said." and "Save". The header and where it opens from are the navigator's and the wiring's.
 *
 * - "Save" is disabled until `hcpMemoryTextValid(text)`: 1 to 4096 characters after trimming.
 * - `ok`: calls `onDone`, once, and the view is spent.
 * - `unreachable`: shows the result's own `MemoryNotSaved` line, keeping the text, with "Save" there to press again.
 * - `invalid` or `refused`: shows `ConnectedAgents.FailGeneric` (the brief's choice for both), keeping the text.
 * - `noManager`, `off`, or a save that throws: also `FailGeneric` (not in the brief; see the PR), keeping the text.
 *
 * One save at a time: while one is open, the field and "Save" are disabled and a second press sends nothing.
 */
const HcpNewMemoryView: React.FC<HcpNewMemoryViewProps> = ({ name, onSave, onDone, initialText = '' }) => {
  const { t } = useTranslation()
  const hcp = useHcpCopy()
  const [text, setText] = useState(initialText)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | undefined>()
  // The state above disables "Save"; the ref stops a second press that lands before the re-render.
  const open = useRef(false)
  const mounted = useRef(true)
  useEffect(
    () => () => {
      mounted.current = false
    },
    []
  )

  const valid = hcpMemoryTextValid(text)

  const save = useCallback(async () => {
    if (open.current || done || !hcpMemoryTextValid(text)) return
    open.current = true
    setBusy(true)
    let result: HcpAddMemoryResult | undefined
    try {
      result = await onSave(text)
    } catch {
      result = undefined
    }
    open.current = false
    if (!mounted.current) return
    setBusy(false)
    if (result?.ok) {
      setDone(true)
      setOutcome(undefined)
      onDone()
    } else if (result && 'unreachable' in result) {
      setOutcome({ kind: 'notSaved', text: hcp(result.message.key) })
    } else {
      setOutcome({ kind: 'failed' })
    }
  }, [done, hcp, onDone, onSave, text])

  const fieldLabel = hcp('NewMemoryField')
  const saveWord = hcp('NewMemorySave')
  const off = busy || done
  return (
    <View style={styles.screen} testID={testIdWithKey('HcpNewMemory')}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <ThemedText style={styles.title} accessibilityRole="header">
          {hcp('NewMemoryTitle', { name })}
        </ThemedText>
        <ThemedText style={styles.label} nativeID="HcpNewMemoryFieldLabel">
          {fieldLabel}
        </ThemedText>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={HCP_MEMORY_MAX_CHARS}
          editable={!off}
          accessibilityLabel={fieldLabel}
          accessibilityLabelledBy="HcpNewMemoryFieldLabel"
          testID={testIdWithKey('HcpNewMemoryField')}
        />
        <ThemedText style={styles.helper}>{hcp('NewMemoryHelper')}</ThemedText>
        {outcome ? (
          <ConnectNotice
            text={outcome.kind === 'notSaved' ? outcome.text : t('ConnectedAgents.FailGeneric')}
            testID={testIdWithKey('HcpNewMemoryOutcome')}
          />
        ) : null}
      </ScrollView>
      <View style={styles.bar}>
        <Button
          title={saveWord}
          buttonType={ButtonType.Primary}
          disabled={!valid || off}
          onPress={save}
          testID={testIdWithKey('HcpNewMemorySave')}
          accessibilityLabel={saveWord}
        >
          {busy ? <ActivityIndicator style={styles.spinner} /> : null}
        </Button>
      </View>
    </View>
  )
}

export default HcpNewMemoryView
