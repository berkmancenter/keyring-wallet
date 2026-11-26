import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native'

import { ThemedText } from '../components/texts/ThemedText'
import { AGENT_COLORS } from '../modules/connected-agents/components/agentStyle'
import { revokeAgentConnection } from '../modules/connected-agents/revoke'
import type { RevokeDeps, RevokeOutcome } from '../modules/connected-agents/revoke'
import { testIdWithKey } from '../utils/testable'

import RevokeOutcomeNotice from './RevokeOutcomeNotice'

export interface RevokeAgentSheetProps {
  /** The agent's connection record id and the name the owner gave it. */
  agent: { id: string; name: string }
  /**
   * Whether the agent was added to any room. Without rooms (all of P0) the body is §6's no-room form, "It loses access
   * to your memory. Past messages stay."; with rooms it names the 4-hour tail of a room permission already held.
   */
  inRooms: boolean
  /** The store and the VTA that `revokeAgentConnection` (connected-agents/revoke.ts) runs on. */
  deps: RevokeDeps
  /** "Keep": closes the sheet; nothing changes. */
  onKeep: () => void
  /** Each revoke's outcome. On `revoked` the caller closes the sheet; otherwise the sheet shows why, with "Try again". */
  onOutcome?: (outcome: RevokeOutcome) => void
}

const styles = StyleSheet.create({
  sheet: { gap: 16, padding: 20 },
  title: { fontFamily: 'SourceSans3-Bold', fontSize: 22, lineHeight: 28, color: AGENT_COLORS.text },
  body: { fontFamily: 'SourceSans3-Regular', fontSize: 17, lineHeight: 23, color: AGENT_COLORS.text },
  buttons: { gap: 10 },
  button: { minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  revoke: { backgroundColor: AGENT_COLORS.danger },
  revokeText: { fontFamily: 'SourceSans3-Bold', fontSize: 17, color: '#FFFFFF' },
  keep: { backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: AGENT_COLORS.primary },
  keepText: { fontFamily: 'SourceSans3-Bold', fontSize: 17, color: AGENT_COLORS.primary },
})

/**
 * The Revoke sheet (§6, mockup 17; §3.9): "Revoke "<name>"?", what remains after it, and "Revoke" / "Keep". "Revoke"
 * runs `revokeAgentConnection`; when it is not confirmed the sheet shows §6's Revoke incomplete or Revoke not confirmed
 * line with "Try again". The contents only: the agent details present it in their bottom sheet. It never says the
 * revoke is immediate: a room permission already held can work for up to 4 hours (§3.9, step 7.10).
 */
const RevokeAgentSheet: React.FC<RevokeAgentSheetProps> = ({ agent, inRooms, deps, onKeep, onOutcome }) => {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<RevokeOutcome | undefined>()
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
      const result = await revokeAgentConnection(deps, agent.id)
      if (mounted.current) setOutcome(result)
      onOutcome?.(result)
    } catch {
      // No record, or one that has no revoke (§3.10's states): nothing was sent, and the sheet stays as it was.
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [deps, agent.id, onOutcome])

  return (
    <View style={styles.sheet} testID={testIdWithKey('RevokeAgentSheet')}>
      <ThemedText style={styles.title} accessibilityRole="header">
        {t('ConnectedAgents.RevokeTitle', { name: agent.name })}
      </ThemedText>
      <ThemedText style={styles.body} testID={testIdWithKey('RevokeAgentBody')}>
        {t(inRooms ? 'ConnectedAgents.RevokeBody' : 'ConnectedAgents.RevokeBodyNoRooms')}
      </ThemedText>
      {outcome && outcome.kind !== 'revoked' ? (
        <RevokeOutcomeNotice name={agent.name} outcome={outcome} onTryAgain={busy ? undefined : revoke} />
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
