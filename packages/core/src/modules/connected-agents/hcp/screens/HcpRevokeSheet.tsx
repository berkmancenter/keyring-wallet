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

/** What the sheet shows after a revoke that did not close it: the result's own line, or the generic one. */
type Outcome = { kind: 'message'; text: string } | { kind: 'failed' }

/**
 * How the sheet was spent: `closing` once `onDone` was called (`ok` or `missing`; both buttons stay off until the
 * caller closes it), `refused` after a refusal (Revoke stays off, since the same request would be refused again, and
 * Keep still closes the sheet).
 */
type Spent = 'closing' | 'refused'

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
 * - `unreachable`: shows the result's own `RevokeUnreachable` line, with "Revoke" still there to press again: only an
 *   unreachable VTA is worth trying again.
 * - `refused`: shows the result's own `RevokeRefused` line ("…so nothing changed here"), and the sheet is spent:
 *   "Revoke" stays disabled, "Keep" closes it. (Decided at review, in place of the brief's
 *   `ConnectedAgents.FailGeneric`, whose "Nothing was connected." is false in a revoke sheet.)
 * - `missing`: calls `onDone` and closes with no line (decided at review); the list's re-read shows the record gone.
 * - `off`, or a revoke that throws: `ConnectedAgents.FailGeneric`, with "Revoke" there to press again (not in the
 *   brief: the HCP copy has no words for either, and no part may add one).
 *
 * One revoke at a time: while one is open, "Revoke" and "Keep" are disabled and a second press sends nothing.
 */
const HcpRevokeSheet: React.FC<HcpRevokeSheetProps> = ({ name, onRevoke, onKeep, onDone }) => {
  const { t } = useTranslation()
  const hcp = useHcpCopy()
  const [busy, setBusy] = useState(false)
  const [spent, setSpent] = useState<Spent | undefined>()
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
    if (open.current || spent) return
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
      setSpent('closing')
      setOutcome(undefined)
      onDone()
    } else if (result && 'missing' in result) {
      // `missing` closes silently, as a success does, BECAUSE nothing removes an HCP connection record: the store has
      // no delete for HCP_CONNECTION_KIND, and a failed read throws (the catch above) rather than answering `missing`.
      // So `missing` cannot mean "our record vanished while the VTA still holds the grant". Once anything can delete a
      // connection record (an HCP "Remove", a cleanup, a `deleteKeyed` on HCP_CONNECTION_KIND), it can, and closing
      // with no line would tell the person the agent is gone when it may not be: give `missing` its own words then.
      setSpent('closing')
      setOutcome(undefined)
      onDone()
    } else if (result && 'message' in result) {
      // `refused` or `unreachable`: the result's own words, which name the agent and say what is true.
      if ('refused' in result) setSpent('refused')
      setOutcome({ kind: 'message', text: hcp(result.message.key, result.message.params) })
    } else {
      setOutcome({ kind: 'failed' })
    }
  }, [spent, hcp, onDone, onRevoke])

  const revokeWord = hcp('Revoke')
  const keepWord = hcp('Keep')
  const revokeOff = busy || spent !== undefined
  const keepOff = busy || spent === 'closing'
  return (
    <View style={styles.sheet} testID={testIdWithKey('HcpRevokeSheet')}>
      <ThemedText style={styles.title} accessibilityRole="header">
        {hcp('RevokeTitle', { name })}
      </ThemedText>
      <ThemedText style={styles.body}>{hcp('RevokeBody')}</ThemedText>
      {outcome ? (
        <ConnectNotice
          text={outcome.kind === 'message' ? outcome.text : t('ConnectedAgents.FailGeneric')}
          testID={testIdWithKey('HcpRevokeOutcome')}
        />
      ) : null}
      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.button, styles.revoke]}
          onPress={revoke}
          disabled={revokeOff}
          testID={testIdWithKey('HcpRevokeConfirm')}
          accessibilityRole="button"
          accessibilityLabel={revokeWord}
          accessibilityState={{ disabled: revokeOff, busy }}
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
          disabled={keepOff}
          testID={testIdWithKey('HcpRevokeKeep')}
          accessibilityRole="button"
          accessibilityLabel={keepWord}
          accessibilityState={{ disabled: keepOff }}
        >
          <ThemedText style={styles.keepText}>{keepWord}</ThemedText>
        </TouchableOpacity>
      </View>
    </View>
  )
}

export default HcpRevokeSheet
