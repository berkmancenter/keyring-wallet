/**
 * "Join <community> with which agent?" (several agents, step 3): shown on Join
 * only when more than one agent is linked. Joining uses the current agent; any
 * other is one tap away, and switching to it is the choice (only the current
 * agent is connected). An agent that already holds an identity for this
 * community is suggested when the current one does not (Alberto, 10-04): said,
 * with "Use <agent>", never switched to without the person.
 *
 * @module trust-tasks/screens/JoinWithAgent
 */
import { useAgent } from '@bifold/react-hooks'
import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { GenericRecordsIdentityStore } from '../module/VtiIdentityStore'
import { vtaAgent } from '../module/vtaAgent'
import { useCommunityChanged } from '../module/communityChanged'

import { agentDisplayName, withAgentName } from './agentName'

/** Which agent to suggest: one holding an identity here, when the current one does not. */
export function suggestedAgent(current: string | undefined, holders: string[]): string | undefined {
  if (!current || holders.includes(current)) return undefined
  return holders[0]
}

/**
 * The agents on this phone that hold an identity in `communityDid`, and the
 * current one. `onlyOthers`: some do, and the current agent does not — what the
 * phone knows of this community (a membership, a request) is then another
 * agent's, not the current one's (the community store keeps one entry per
 * community, not per agent).
 */
export function useAgentsHoldingIdentity(communityDid: string | undefined): {
  holders: string[]
  current?: string
  onlyOthers: boolean
  /** The holders still linked to this phone: an agent unlinked since cannot be switched to. */
  linkedHolders: string[]
  several: boolean
} {
  const { agent } = useAgent()
  const state = useSyncExternalStore(vtaAgent.subscribe, vtaAgent.getState)
  const current = state.link.kind === 'linked' ? state.link.vtaDid : undefined
  const several = (state.agents ?? []).length > 1
  const [holders, setHolders] = useState<string[]>([])
  const [tick, setTick] = useState(0)
  useCommunityChanged(() => setTick((n) => n + 1))
  useEffect(() => {
    if (!agent || !communityDid) return
    let live = true
    void new GenericRecordsIdentityStore(agent)
      .listPersonas()
      .then((all) => {
        if (live) setHolders(all.filter((p) => p.communityDid === communityDid).map((p) => p.vtaDid))
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [agent, communityDid, tick, current])
  // A legacy identity kept with no agent counts as the current agent's. Not
  // only with several agents linked: an identity of an agent since unlinked
  // is another agent's too (Alberto's iPhone, 10-06: al-phone's membership
  // on al-signer).
  const onlyOthers = !!current && holders.length > 0 && !holders.some((h) => !h || h === current)
  const linked = new Set((state.agents ?? []).map((a) => a.vtaDid))
  return {
    holders,
    current,
    onlyOthers,
    linkedHolders: holders.filter((h) => !!h && linked.has(h)),
    several,
  }
}

export const JoinWithAgent: React.FC<{ communityDid: string; name: string }> = ({ communityDid, name }) => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const { ColorPalette, TextTheme } = useTheme()
  const state = useSyncExternalStore(vtaAgent.subscribe, vtaAgent.getState)
  const agents = state.agents ?? []
  const { linkedHolders, current } = useAgentsHoldingIdentity(communityDid)
  const holders = linkedHolders

  if (agents.length < 2) return null
  const styles = StyleSheet.create({
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    link: { color: ColorPalette.brand.link, textDecorationLine: 'underline' },
  })
  const nameOf = (vtaDid: string) =>
    agentDisplayName(withAgentName(agents.find((a) => a.vtaDid === vtaDid) ?? { vtaDid }, state.agentNames), t)
  const use = (vtaDid: string) => agent && void vtaAgent.useAgent(agent, vtaDid)
  const suggested = suggestedAgent(current, holders)

  return (
    <View style={styles.card} testID={testIdWithKey('JoinWithAgent')}>
      <ThemedText variant="labelTitle" accessibilityRole="header">
        {t('Join.WithWhichAgent', { community: name, interpolation: { escapeValue: false } })}
      </ThemedText>
      {suggested ? (
        <View style={{ gap: 8 }}>
          {/* The id on the words themselves, so a screen reader and a test find
              them under it (the device check read an empty container). */}
          <ThemedText testID={testIdWithKey('JoinAgentSuggested')}>
            {t('Join.AgentHasIdentity', { agent: nameOf(suggested), interpolation: { escapeValue: false } })}
          </ThemedText>
          <Button
            title={t('Join.UseAgent', { agent: nameOf(suggested), interpolation: { escapeValue: false } })}
            buttonType={ButtonType.Primary}
            onPress={() => use(suggested)}
            testID={testIdWithKey('JoinUseSuggestedAgent')}
          />
        </View>
      ) : null}
      {agents.map((a, i) => {
        const isCurrent = a.vtaDid === current
        const holds = holders.includes(a.vtaDid)
        return (
          <Pressable
            key={a.vtaDid}
            style={styles.row}
            disabled={isCurrent}
            onPress={() => use(a.vtaDid)}
            accessibilityRole="button"
            accessibilityState={{ selected: isCurrent, disabled: isCurrent }}
            testID={testIdWithKey(`JoinAgentRow_${i}`)}
          >
            <Icon
              name={isCurrent ? 'radiobox-marked' : 'radiobox-blank'}
              size={22}
              color={isCurrent ? ColorPalette.brand.primary : TextTheme.normal.color}
            />
            <View style={{ flex: 1 }}>
              <ThemedText variant="bold">{nameOf(a.vtaDid)}</ThemedText>
              <ThemedText style={styles.muted} testID={testIdWithKey(`JoinAgentNote_${i}`)}>
                {isCurrent
                  ? t('Join.JoiningWithThis')
                  : holds
                    ? t('Join.AlreadyHasIdentity')
                    : t('Join.UseAgent', { agent: nameOf(a.vtaDid), interpolation: { escapeValue: false } })}
              </ThemedText>
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}
