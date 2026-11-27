import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native'

import { ThemedText } from '../../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../../utils/testable'
import { AGENT_COLORS } from '../../components/agentStyle'
import ConnectNotice from '../../components/ConnectNotice'
import type { HcpRevokeResult } from '../revoke'

import { useHcpCopy } from './useHcpCopy'

// Canvas frame 54, as the base sheet (frame 19): 16 pt sides, a 22 pt title, a 17 pt body, and two full-width 52 pt
// buttons, "Revoke" filled in the danger red and "Keep" outlined in Keyring's purple.
const styles = StyleSheet.create({
  sheet: { gap: 16, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  title: { fontFamily: 'SourceSans3-Bold', fontSize: 22, lineHeight: 28, color: AGENT_COLORS.text },
  body: { fontFamily: 'SourceSans3-Regular', fontSize: 17, lineHeight: 24, color: AGENT_COLORS.text },
  buttons: { gap: 12 },
  button: { minHeight: 52, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  revoke: { backgroundColor: AGENT_COLORS.danger },
  revokeText: { fontFamily: 'SourceSans3-Bold', fontSize: 18, color: '#FFFFFF' },
  keep: { backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: AGENT_COLORS.primary },
  keepText: { fontFamily: 'SourceSans3-Bold', fontSize: 18, color: AGENT_COLORS.primary },
})

/** What the sheet shows after a revoke that did not end it. */
type Outcome = { kind: 'unreachable'; text: string } | { kind: 'failed' }

export interface HcpRevokeSheetProps {
  /** The name the person gave the agent. */
  name: string
  /**
   * "Revoke": runs the revoke and answers what it came to. The wiring passes `revokeHcpGrant` (hcp/revoke.ts) bound to
   * the record; this view never imports it.
   */
  onRevoke: () => Promise<HcpRevokeResult>
  /** "Keep": closes the sheet; nothing changes. */
  onKeep: () => void
  /** The revoke went through: the caller closes the sheet (the list or details then show the notice line). */
  onDone: () => void
}

/**
 * The HCP Revoke sheet (canvas frame 54; companion finding 6; backlog Section C, U2): "Revoke "<name>"?", "It stops at
 * once. We'll tell it, and show you when it has heard.", "Revoke" and "Keep". The contents only: the caller presents
 * it in a bottom sheet.
 *
 * - `ok`: calls `onDone`, once, and the sheet is spent.
 * - `unreachable`: shows the result's own `RevokeUnreachable` line, with "Revoke" still there to press again.
 * - `missing` or `refused`: shows `ConnectedAgents.FailGeneric` (the brief's choice for both).
 * - `off`, or a revoke that throws: also `FailGeneric` (not in the brief: nothing was revoked, and the HCP copy has no
 *   words for either).
 *
 * One revoke at a time: while one is open, "Revoke" and "Keep" are disabled and a second press sends nothing.
 */
const HcpRevokeSheet: React.FC<HcpRevokeSheetProps> = ({ name, onRevoke, onKeep, onDone }) => {
  const { t } = useTranslation()
  const hcp = useHcpCopy()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | undefined>()
  // The state above disables the buttons; the ref stops a second press that lands before the re-render.
  const open = useRef(false)
  const mounted = useRef(true)
  useEffect(
    () => () => {
      mounted.current = false
    },
    []
  )

  const revoke = useCallback(async () => {
    if (open.current || done) return
    open.current = true
    setBusy(true)
    let result: HcpRevokeResult | undefined
    try {
      result = await onRevoke()
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
      setOutcome({ kind: 'unreachable', text: hcp(result.message.key, result.message.params) })
    } else {
      setOutcome({ kind: 'failed' })
    }
  }, [done, hcp, onDone, onRevoke])

  const revokeWord = hcp('Revoke')
  const keepWord = hcp('Keep')
  const off = busy || done
  return (
    <View style={styles.sheet} testID={testIdWithKey('HcpRevokeSheet')}>
      <ThemedText style={styles.title} accessibilityRole="header">
        {hcp('RevokeTitle', { name })}
      </ThemedText>
      <ThemedText style={styles.body}>{hcp('RevokeBody')}</ThemedText>
      {outcome ? (
        <ConnectNotice
          text={outcome.kind === 'unreachable' ? outcome.text : t('ConnectedAgents.FailGeneric')}
          testID={testIdWithKey('HcpRevokeOutcome')}
        />
      ) : null}
      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.button, styles.revoke]}
          onPress={revoke}
          disabled={off}
          testID={testIdWithKey('HcpRevokeConfirm')}
          accessibilityRole="button"
          accessibilityLabel={revokeWord}
          accessibilityState={{ disabled: off, busy }}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <ThemedText style={styles.revokeText}>{revokeWord}</ThemedText>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.keep]}
          onPress={onKeep}
          disabled={off}
          testID={testIdWithKey('HcpRevokeKeep')}
          accessibilityRole="button"
          accessibilityLabel={keepWord}
          accessibilityState={{ disabled: off }}
        >
          <ThemedText style={styles.keepText}>{keepWord}</ThemedText>
        </TouchableOpacity>
      </View>
    </View>
  )
}

export default HcpRevokeSheet
