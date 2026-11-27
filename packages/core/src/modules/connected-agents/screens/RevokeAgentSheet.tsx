import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'
import { AGENT_COLORS } from '../components/agentStyle'
import RevokeOutcomeNotice, { RevokeViewOutcome } from '../components/RevokeOutcomeNotice'

export interface RevokeAgentSheetProps {
  /** The name the owner gave the agent. */
  name: string
  /**
   * Whether the agent was added to any room. Without rooms (all of P0) the body is §6's no-room form, "It loses access
   * to your memory. Past messages stay."; with rooms it names the 4-hour tail of a room permission already held.
   */
  hasRooms: boolean
  /**
   * "Revoke" and "Try again": runs the revoke and answers what it came to. The wiring PR passes
   * `revokeAgentConnection` (connected-agents/revoke.ts) bound to the record; this view never imports it. On `revoked`
   * the caller closes the sheet; otherwise the sheet shows why, with "Try again".
   */
  onRevoke: () => Promise<RevokeViewOutcome>
  /** "Keep": closes the sheet; nothing changes. */
  onKeep: () => void
}

// Canvas frame 19 (docs/plans/agent-connect-plan/canvas/19-revoke.png), drawn at 2x: 16 pt sides, a 22 pt title, a
// 17 pt body, and two full-width 52 pt buttons, "Revoke" filled in the danger red and "Keep" outlined in Keyring's
// purple.
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

/**
 * The Revoke sheet (§6 mockup 17, canvas frame 19; §3.9): "Revoke "<name>"?", what remains after it, and "Revoke" /
 * "Keep". A view: "Revoke" calls `onRevoke`, and when the revoke is not confirmed the sheet shows §6's Revoke
 * incomplete or Revoke not confirmed line with "Try again". The contents only: the agent details present it in their
 * bottom sheet. It never says the revoke is immediate: a room permission already held can work for up to 4 hours
 * (§3.9, step 7.10). P0 has no "Also delete what it remembered" row: the canvas draws it for P2 (step 7.18).
 */
const RevokeAgentSheet: React.FC<RevokeAgentSheetProps> = ({ name, hasRooms, onRevoke, onKeep }) => {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<RevokeViewOutcome | undefined>()
  const mounted = useRef(true)
  useEffect(
    () => () => {
      mounted.current = false
    },
    []
  )

  const revoke = useCallback(async () => {
    setBusy(true)
    try {
      const result = await onRevoke()
      if (mounted.current) setOutcome(result)
    } catch {
      // No record, or one that has no revoke (§3.10's states): nothing was sent, and the sheet stays as it was.
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [onRevoke])

  return (
    <View style={styles.sheet} testID={testIdWithKey('RevokeAgentSheet')}>
      <ThemedText style={styles.title} accessibilityRole="header">
        {t('ConnectedAgents.RevokeTitle', { name })}
      </ThemedText>
      <ThemedText style={styles.body} testID={testIdWithKey('RevokeAgentBody')}>
        {t(hasRooms ? 'ConnectedAgents.RevokeBody' : 'ConnectedAgents.RevokeBodyNoRooms')}
      </ThemedText>
      {outcome && outcome.kind !== 'revoked' ? (
        <RevokeOutcomeNotice name={name} outcome={outcome} onTryAgain={busy ? undefined : revoke} />
      ) : null}
      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.button, styles.revoke]}
          onPress={revoke}
          disabled={busy}
          testID={testIdWithKey('RevokeAgentConfirm')}
          accessibilityRole="button"
          accessibilityLabel={t('ConnectedAgents.Revoke')}
          accessibilityState={{ disabled: busy, busy }}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <ThemedText style={styles.revokeText}>{t('ConnectedAgents.Revoke')}</ThemedText>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.keep]}
          onPress={onKeep}
          disabled={busy}
          testID={testIdWithKey('RevokeAgentKeep')}
          accessibilityRole="button"
          accessibilityLabel={t('ConnectedAgents.Keep')}
          accessibilityState={{ disabled: busy }}
        >
          <ThemedText style={styles.keepText}>{t('ConnectedAgents.Keep')}</ThemedText>
        </TouchableOpacity>
      </View>
    </View>
  )
}

export default RevokeAgentSheet
