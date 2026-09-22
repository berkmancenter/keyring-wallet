/**
 * The agent's status, in words a person reads: one line with a dot on the
 * agent screen, and a banner across the app when the agent has been away long
 * enough to matter (plan §4.1–§4.2). Both render the link state machine; a
 * clock ticks only while the agent is not online, so a quiet app stays quiet.
 *
 * @module trust-tasks/screens/VtaStatus
 */

import type { TFunction } from 'i18next'
import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'
import { resolveVtaDid, showsOfflineBanner, type VtaConnection } from '../module/vtaLinkMachine'

/** The link state, plus a clock that ticks each second while the agent is away. */
export function useVtaLinkWithClock() {
  const state = useSyncExternalStore(vtaAgent.subscribe, vtaAgent.getState)
  const [now, setNow] = useState(() => Date.now())
  const away = state.link.kind === 'linked' && state.link.connection.kind !== 'online'
  useEffect(() => {
    if (!away) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [away])
  return { state, now }
}

/** The linked agent, else the one the build names (see `resolveVtaDid`). */
export function useVtaDid(configured?: string): string | undefined {
  const state = useSyncExternalStore(vtaAgent.subscribe, vtaAgent.getState)
  return resolveVtaDid(state.link, configured)
}

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** "Online" · "Reconnecting…" · "Offline since 14:02" */
export function connectionText(connection: VtaConnection, t: TFunction): string {
  switch (connection.kind) {
    case 'online':
      return t('VtaLink.StatusOnline')
    case 'reconnecting':
      return t('VtaLink.StatusReconnecting')
    case 'offline':
      return t('VtaLink.StatusOfflineSince', { time: clock(connection.since), interpolation: { escapeValue: false } })
  }
}

export const VtaStatusLine: React.FC<{ connection: VtaConnection }> = ({ connection }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const color =
    connection.kind === 'online'
      ? ColorPalette.semantic.success
      : connection.kind === 'reconnecting'
        ? ColorPalette.semantic.focus
        : ColorPalette.semantic.error
  const text = connectionText(connection, t)
  return (
    <View style={styles.row} testID={testIdWithKey('VtaStatusLine')} accessibilityLabel={text}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <ThemedText testID={testIdWithKey('VtaStatusText')}>{text}</ThemedText>
    </View>
  )
}

/** Across the app, only once the agent has been away for a few seconds. */
export const VtaOfflineBanner: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const { state, now } = useVtaLinkWithClock()
  if (!showsOfflineBanner(state.link, now) || state.link.kind !== 'linked') return null
  return (
    <View
      style={[styles.banner, { backgroundColor: ColorPalette.semantic.error }]}
      testID={testIdWithKey('VtaOfflineBanner')}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <ThemedText style={{ color: ColorPalette.grayscale.white }}>
        {t('VtaLink.BannerAway', {
          status: connectionText(state.link.connection, t),
          interpolation: { escapeValue: false },
        })}
      </ThemedText>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 24 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  banner: { paddingHorizontal: 16, paddingVertical: 8 },
})
