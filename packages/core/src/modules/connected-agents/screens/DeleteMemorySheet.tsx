import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'
import { AGENT_COLORS } from '../components/agentStyle'
import type { DeleteMemoryResult, DeletePreview } from '../deleteMemory'
import { MEMORY_COUNT_WARNING } from '../memories'

export interface DeleteMemorySheetProps {
  /** The memory being deleted. */
  memory: { name: string }
  /** What the delete would do, from the logic's `previewDelete` (deleteMemory.ts), read before the sheet opens. */
  preview: DeletePreview
  /**
   * "Delete": the caller's call to `deleteMemory(…, true)` (deleteMemory.ts), made only after the person pressed it.
   * This view never imports it, and never calls this before "Delete" is pressed.
   */
  onConfirm: () => Promise<DeleteMemoryResult>
  /** "Keep", or "Close" after a held delete: closes the sheet; nothing was deleted. */
  onKeep: () => void
  /** The memory is gone: straight after a clean delete, or on "Close" after one that left records to clear. */
  onDone: () => void
}

/** What the sheet shows after "Delete" came back without closing it. */
type Outcome = { kind: 'recordsLeft'; count: number } | { kind: 'held' } | { kind: 'unreachable' }

// Canvas frame 23 (docs/plans/agent-connect-plan/canvas/23-delete-memory.png), drawn at 2x like frame 19's Revoke
// sheet: 16 pt sides, a 22 pt title, a 17 pt body, and two full-width 52 pt buttons, "Delete" filled in the danger red
// and "Keep" outlined in Keyring's purple.
const styles = StyleSheet.create({
  sheet: { gap: 16, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  title: { fontFamily: 'SourceSans3-Bold', fontSize: 22, lineHeight: 28, color: AGENT_COLORS.text },
  body: { fontFamily: 'SourceSans3-Regular', fontSize: 17, lineHeight: 24, color: AGENT_COLORS.text },
  warn: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#FFF6E5',
    borderWidth: 1,
    borderColor: '#F2C66D',
    borderRadius: 10,
    padding: 10,
  },
  warnText: { flex: 1, fontFamily: 'SourceSans3-Regular', fontSize: 15, lineHeight: 20, color: AGENT_COLORS.warnText },
  buttons: { gap: 12 },
  button: { minHeight: 52, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  delete: { backgroundColor: AGENT_COLORS.danger },
  deleteText: { fontFamily: 'SourceSans3-Bold', fontSize: 18, color: '#FFFFFF' },
  keep: { backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: AGENT_COLORS.primary },
  keepText: { fontFamily: 'SourceSans3-Bold', fontSize: 18, color: AGENT_COLORS.primary },
})

/**
 * Delete a memory (§3.15 "Deleting a memory", step 7.16; canvas frame 23): "Delete "<memory>"?", what it destroys and
 * which agents lose it, the warning over the limit, then "Delete" / "Keep". The contents only: the caller presents it
 * in a bottom sheet. A view: the facts come from the preview, and "Delete" calls `onConfirm`, once while it is open.
 *
 * What "Delete" came to:
 * - deleted, every record updated: `onDone`;
 * - deleted, some records not updated: how many still list it, and "Close" (`onDone`);
 * - held by an approval rule on the owner's VTA: why, and "Close" (`onKeep`), never a way to try again;
 * - not reached: why, with "Delete" still there.
 * A preview that could not be read shows why, with "Keep" only: nothing to confirm.
 */
const DeleteMemorySheet: React.FC<DeleteMemorySheetProps> = ({ memory, preview, onConfirm, onKeep, onDone }) => {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | undefined>()
  // Once while open: the ref holds before the re-render that disables the button, so a second press in the same frame
  // sends nothing.
  const open = useRef(false)
  const mounted = useRef(true)
  useEffect(
    () => () => {
      mounted.current = false
    },
    []
  )

  const confirm = useCallback(async () => {
    if (open.current) return
    open.current = true
    setBusy(true)
    let result: DeleteMemoryResult
    try {
      result = await onConfirm()
    } catch {
      // The logic answers rather than throws; a throw is taken as "not reached", so nothing is claimed deleted.
      result = { ok: false, code: 'unreachable' }
    }
    open.current = false
    if (!mounted.current) return
    setBusy(false)
    if (result.ok && result.recordsNotUpdated === 0) {
      onDone()
    } else if (result.ok) {
      setOutcome({ kind: 'recordsLeft', count: result.recordsNotUpdated })
    } else {
      setOutcome({ kind: result.code === 'heldForApproval' ? 'held' : 'unreachable' })
    }
  }, [onConfirm, onDone])

  const title = (
    <ThemedText style={styles.title} accessibilityRole="header">
      {t('ConnectedAgents.DeleteMemoryTitle', { memory: memory.name })}
    </ThemedText>
  )
  const line = (text: string) => (
    <ThemedText style={styles.body} accessibilityRole="alert" testID={testIdWithKey('DeleteMemoryOutcome')}>
      {text}
    </ThemedText>
  )
  const keep = (label: string, onPress: () => void, testID?: string) => (
    <TouchableOpacity
      style={[styles.button, styles.keep]}
      onPress={onPress}
      disabled={busy}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy }}
    >
      <ThemedText style={styles.keepText}>{label}</ThemedText>
    </TouchableOpacity>
  )

  // Nothing to confirm: the preview could not be read (a preview whose count failed is the same: previewDelete never
  // answers ok with one, and the sheet will not state a count it does not have).
  if (!preview.ok || !preview.count.ok) {
    return (
      <View style={styles.sheet} testID={testIdWithKey('DeleteMemorySheet')}>
        {title}
        <ThemedText style={styles.body} accessibilityRole="alert">
          {t('ConnectedAgents.FailUnreachable')}
        </ThemedText>
        <View style={styles.buttons}>{keep(t('ConnectedAgents.Keep'), onKeep, testIdWithKey('DeleteMemoryKeep'))}</View>
      </View>
    )
  }

  // Deleted with records left to clear, or held: the outcome and "Close". "Delete" is gone: the memory is deleted, or a
  // retry would be held the same way until the owner's rule changes.
  if (outcome && outcome.kind !== 'unreachable') {
    return (
      <View style={styles.sheet} testID={testIdWithKey('DeleteMemorySheet')}>
        {title}
        {outcome.kind === 'recordsLeft'
          ? line(t('ConnectedAgents.DeleteMemoryRecordsLeft', { count: outcome.count }))
          : line(t('ConnectedAgents.DeleteMemoryHeld'))}
        <View style={styles.buttons}>{keep(t('Global.Close'), outcome.kind === 'recordsLeft' ? onDone : onKeep)}</View>
      </View>
    )
  }

  const count = preview.count.count
  const agents = preview.agents.map((a) => a.name || t('ConnectedAgents.UnnamedAgent')).join(', ')
  return (
    <View style={styles.sheet} testID={testIdWithKey('DeleteMemorySheet')}>
      {title}
      <ThemedText style={styles.body}>
        {preview.agents.length > 0
          ? t('ConnectedAgents.DeleteMemoryBody', { count, agents })
          : t('ConnectedAgents.DeleteMemoryBodyNoAgents', { count })}
      </ThemedText>
      {preview.overWarning ? (
        <View style={styles.warn} accessibilityRole="alert">
          <Icon name="alert-outline" size={20} color={AGENT_COLORS.warnText} accessibilityElementsHidden />
          <ThemedText style={styles.warnText}>
            {t('ConnectedAgents.MemoryCountWarning', { memory: memory.name, limit: MEMORY_COUNT_WARNING })}
          </ThemedText>
        </View>
      ) : null}
      {outcome?.kind === 'unreachable' ? line(t('ConnectedAgents.FailUnreachable')) : null}
      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.button, styles.delete]}
          onPress={confirm}
          disabled={busy}
          testID={testIdWithKey('DeleteMemoryConfirm')}
          accessibilityRole="button"
          accessibilityLabel={t('ConnectedAgents.Delete')}
          accessibilityState={{ disabled: busy, busy }}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <ThemedText style={styles.deleteText}>{t('ConnectedAgents.Delete')}</ThemedText>
          )}
        </TouchableOpacity>
        {keep(t('ConnectedAgents.Keep'), onKeep, testIdWithKey('DeleteMemoryKeep'))}
      </View>
    </View>
  )
}

export default DeleteMemorySheet
