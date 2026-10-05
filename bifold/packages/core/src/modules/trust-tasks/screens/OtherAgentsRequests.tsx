/**
 * What waits on this phone at the agents that are not current (several agents,
 * step 3): as rows on Requests ("Work: 2 requests wait for you", with "Switch
 * to Work"), or as one line on "Your agent". Only the current agent is
 * connected, so a request is decided after switching to its agent; a look
 * (`vtaAgent.lookAtOtherAgents`) is how the others' requests are known.
 *
 * @module trust-tasks/screens/OtherAgentsRequests
 */
import { useAgent } from '@bifold/react-hooks'
import React, { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'
import { waitingRequests } from '../module/waitingRequests'

import { agentDisplayName, withAgentName } from './agentName'

export interface OtherAgentWaiting {
  vtaDid: string
  name: string
  count: number
  reachable: boolean
}

/** The other agents with requests waiting, or that a look could not reach; oldest agent first. */
export function useOtherAgentsWaiting(now: number = Date.now()): OtherAgentWaiting[] {
  const { t } = useTranslation()
  const state = useSyncExternalStore(vtaAgent.subscribe, vtaAgent.getState)
  const current = state.link.kind === 'linked' ? state.link.vtaDid : undefined
  const others = state.otherRequests ?? {}
  const agents = state.agents ?? []
  return agents
    .filter((a) => a.vtaDid !== current && others[a.vtaDid])
    .map((a) => {
      const seen = others[a.vtaDid]
      return {
        vtaDid: a.vtaDid,
        name: agentDisplayName(withAgentName(a, state.agentNames), t),
        count: waitingRequests(seen.approvals, now).length,
        reachable: seen.reachable,
      }
    })
    .filter((o) => o.count > 0 || !o.reachable)
}

export const OtherAgentsRequests: React.FC<{ shape: 'rows' | 'line' }> = ({ shape }) => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const waiting = useOtherAgentsWaiting()
  const styles = StyleSheet.create({
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    link: { color: ColorPalette.brand.link, textDecorationLine: 'underline' },
  })
  const switchTo = (vtaDid: string) => agent && void vtaAgent.useAgent(agent, vtaDid)
  const named = (o: OtherAgentWaiting) => ({ agent: o.name, count: o.count, interpolation: { escapeValue: false } })

  if (shape === 'line') {
    const withRequests = waiting.filter((o) => o.count > 0)
    if (!withRequests.length) return null
    return (
      <View testID={testIdWithKey('AgentOtherWaiting')}>
        {withRequests.map((o) => (
          <Pressable
            key={o.vtaDid}
            style={styles.row}
            onPress={() => switchTo(o.vtaDid)}
            accessibilityRole="button"
            testID={testIdWithKey(`AgentOtherWaiting_${o.vtaDid}`)}
          >
            <Icon name="bell-ring-outline" size={20} color={ColorPalette.brand.primary} />
            <ThemedText style={[styles.link, { flex: 1 }]}>{t('VtaLink.OtherWaiting', named(o))}</ThemedText>
          </Pressable>
        ))}
      </View>
    )
  }

  if (!waiting.length) return null
  return (
    <View style={{ gap: 8 }} testID={testIdWithKey('RequestsOtherAgents')}>
      {waiting.map((o) => (
        <View key={o.vtaDid} style={styles.card} testID={testIdWithKey(`RequestsOther_${o.vtaDid}`)}>
          <ThemedText variant="bold">
            {o.reachable ? t('Requests.OtherWaiting', named(o)) : t('Requests.OtherUnreachable', named(o))}
          </ThemedText>
          {o.count > 0 ? (
            <Button
              title={t('Requests.SwitchTo', named(o))}
              buttonType={ButtonType.Secondary}
              onPress={() => switchTo(o.vtaDid)}
              testID={testIdWithKey(`RequestsSwitch_${o.vtaDid}`)}
            />
          ) : null}
        </View>
      ))}
    </View>
  )
}
