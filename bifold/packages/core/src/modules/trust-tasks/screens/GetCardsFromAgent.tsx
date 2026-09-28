/**
 * Manage → "Get your cards from your agent" (226, agent-kept cards): fetch the
 * community cards the person's agent keeps and keep them on this phone again,
 * after a reinstall that kept the phone's identities, or any time a card went
 * missing here.
 *
 * Only for communities this phone holds an identity in. A new phone holds none
 * until it adopts its agent's identities, which is later work: it joins its
 * communities again, and so it is not offered this.
 *
 * @module trust-tasks/screens/GetCardsFromAgent
 */

import type { Agent } from '@credo-ts/core'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { emitCommunityChanged } from '../module/communityChanged'
import { vtaAgent } from '../module/vtaAgent'
import { recoverCardsFromAgent, type RecoveredRefusal, type VaultTask } from '../module/vtiCardVault'
import { GenericRecordsCommunityStore, type VtiCommunityStore } from '../module/VtiCommunityStore'
import type { VtiPersona } from '../module/VtiIdentityStore'

export interface CardsBack {
  found: number
  restored: number
  refused: RecoveredRefusal[]
  /** Identities whose agent did not answer. */
  unreachable: number
}

export interface GetCardsDeps {
  recover: typeof recoverCardsFromAgent
  store: (agent: Agent) => VtiCommunityStore
  /** The persona's agent, connected, as a task sender. */
  taskFor: (agent: Agent, persona: VtiPersona) => Promise<VaultTask>
}

const defaultDeps: GetCardsDeps = {
  recover: recoverCardsFromAgent,
  store: (agent) => new GenericRecordsCommunityStore(agent),
  taskFor: async (agent, persona) => {
    await vtaAgent.connect(agent, persona.vtaDid)
    const client = vtaAgent.client(agent, persona.vtaDid)
    return <T,>(type: string, payload: Record<string, unknown>) => client.task<T>(type, payload)
  },
}

/**
 * Every identity on this phone, one after another (the agent answers one task
 * at a time); a count across all of them as it goes. An identity whose agent
 * does not answer is counted, and the others still run.
 */
export async function getCardsFromAgent(
  agent: Agent,
  personas: VtiPersona[],
  onProgress: (p: { found: number; restored: number }) => void,
  deps: GetCardsDeps = defaultDeps
): Promise<CardsBack> {
  const store = deps.store(agent)
  const total: CardsBack = { found: 0, restored: 0, refused: [], unreachable: 0 }
  for (const persona of personas) {
    const before = { found: total.found, restored: total.restored }
    try {
      const task = await deps.taskFor(agent, persona)
      const got = await deps.recover(agent, store, persona, task, {
        onProgress: (p) => onProgress({ found: before.found + p.found, restored: before.restored + p.restored }),
      })
      total.found += got.found
      total.restored += got.restored.length
      total.refused.push(...got.refused)
      if (got.restored.length) emitCommunityChanged(persona.communityDid, 'membership')
    } catch {
      total.unreachable += 1
    }
  }
  return total
}

/** Why a card was not kept, in words (the vault module gives codes). */
export const REFUSED_WORDS: Record<RecoveredRefusal['reason'], string> = {
  failedCheck: 'VtaLink.CardsBackFailedCheck',
  notOurs: 'VtaLink.CardsBackNotOurs',
  unreadable: 'VtaLink.CardsBackUnreadable',
}

export const GetCardsFromAgent: React.FC<{ agent: Agent; personas: VtiPersona[]; deps?: GetCardsDeps }> = ({
  agent,
  personas,
  deps,
}) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const [progress, setProgress] = useState<{ found: number; restored: number }>()
  const [result, setResult] = useState<CardsBack>()
  const running = progress !== undefined && result === undefined
  const styles = StyleSheet.create({
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })
  if (personas.length === 0) return null

  const start = async () => {
    setResult(undefined)
    setProgress({ found: 0, restored: 0 })
    setResult(await getCardsFromAgent(agent, personas, setProgress, deps))
  }

  const refusedBy = (reason: RecoveredRefusal['reason']) => result?.refused.filter((r) => r.reason === reason).length ?? 0

  return (
    <View style={styles.card} testID={testIdWithKey('AgentGetCards')}>
      <ThemedText variant="labelTitle">{t('VtaLink.GetCardsTitle')}</ThemedText>
      <ThemedText style={styles.muted}>{t('VtaLink.GetCardsBody')}</ThemedText>
      {running ? (
        <View style={styles.row}>
          <ActivityIndicator color={ColorPalette.brand.primary} />
          <ThemedText testID={testIdWithKey('AgentGetCardsProgress')}>
            {t('VtaLink.GetCardsProgress', { found: progress!.found, restored: progress!.restored })}
          </ThemedText>
        </View>
      ) : null}
      {result ? (
        <View testID={testIdWithKey('AgentGetCardsResult')}>
          <ThemedText>
            {result.restored > 0
              ? t('VtaLink.CardsBack', { count: result.restored })
              : result.found > 0
                ? t('VtaLink.CardsBackNoneKept')
                : result.unreachable === personas.length
                  ? t('VtaLink.CardsBackUnreachable')
                  : t('VtaLink.CardsBackNone')}
          </ThemedText>
          {(Object.keys(REFUSED_WORDS) as RecoveredRefusal['reason'][])
            .filter((reason) => refusedBy(reason) > 0)
            .map((reason) => (
              <ThemedText key={reason} style={styles.muted} testID={testIdWithKey(`AgentGetCardsRefused_${reason}`)}>
                {t(REFUSED_WORDS[reason], { count: refusedBy(reason) })}
              </ThemedText>
            ))}
          {result.unreachable > 0 && result.unreachable < personas.length ? (
            <ThemedText style={styles.muted}>{t('VtaLink.CardsBackSomeUnreachable')}</ThemedText>
          ) : null}
        </View>
      ) : null}
      <Button
        title={t('VtaLink.GetCardsButton')}
        buttonType={ButtonType.Secondary}
        disabled={running}
        onPress={() => void start()}
        testID={testIdWithKey('AgentGetCardsButton')}
      />
    </View>
  )
}
