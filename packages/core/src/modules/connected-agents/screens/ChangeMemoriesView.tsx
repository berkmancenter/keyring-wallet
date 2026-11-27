import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'
import { AGENT_COLORS } from '../components/agentStyle'
import ConnectNotice from '../components/ConnectNotice'
import MemoryPicker, { CreateMemoryResult, PickerMemory } from '../components/MemoryPicker'

/** A widen or narrow, as the logic answers it; the view re-reads the agent's memories after either. */
export type MemoryChangeResult = { ok: true } | { ok: false; code: string }

export interface ChangeMemoriesViewProps {
  agentName: string
  /** Every memory the owner has, as the picker shows them. */
  memories: PickerMemory[]
  /** The memories the agent can use now (ids). */
  current: string[]
  onCreateMemory: (name: string) => Promise<CreateMemoryResult>
  /** The phone's face or fingerprint check; true only when it passed. Widening asks it first (D34). */
  confirm: () => Promise<boolean>
  onWiden: (memoryId: string) => Promise<MemoryChangeResult>
  onNarrow: (memoryId: string) => Promise<MemoryChangeResult>
}

type Ask = { kind: 'widen' | 'narrow'; memory: PickerMemory }

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: 16, gap: 10, paddingBottom: 24 },
  section: { fontFamily: 'SourceSans3-Bold', fontSize: 18, color: AGENT_COLORS.text },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#E7E7E9',
  },
  title: { fontFamily: 'SourceSans3-Bold', fontSize: 21, lineHeight: 27, color: AGENT_COLORS.text },
  line: { fontFamily: 'SourceSans3-Regular', fontSize: 17, lineHeight: 23, color: AGENT_COLORS.text },
})

/**
 * "Change memories" (§6; §3.15 step 4, D34; canvas frames K20 and K20b), in its P0 no-room form: the same picker as
 * the connect step, showing what the agent can use now. Ticking a memory asks first: "Let "<name>" use "<memory>"?",
 * "It will be able to read and change it.", and "Allow" takes the phone's face or fingerprint check. Unticking asks
 * once: "Stop "<name>" using "<memory>"?", with "Stop using" and "Keep". Nothing changes until the person answers, and
 * one change is made at a time. The room sentence ("This also applies in <rooms>.") is the P1 form.
 */
const ChangeMemoriesView: React.FC<ChangeMemoriesViewProps> = ({
  agentName,
  memories,
  current,
  onCreateMemory,
  confirm,
  onWiden,
  onNarrow,
}) => {
  const { t } = useTranslation()
  const [ask, setAsk] = useState<Ask | undefined>()
  const [working, setWorking] = useState(false)
  const [failed, setFailed] = useState(false)
  // Memories made here, until the next listing carries them: the picker ticks a new one at once, before any re-read.
  const made = useRef<PickerMemory[]>([])
  const known = () => [...memories, ...made.current.filter((m) => !memories.some((n) => n.id === m.id))]

  const toggle = (id: string) => {
    if (working || ask) return
    const memory = known().find((m) => m.id === id)
    if (!memory) return
    setFailed(false)
    setAsk({ kind: current.includes(id) ? 'narrow' : 'widen', memory })
  }

  // A memory made here is not the agent's yet: it is ticked, so widening it asks as any other would.
  const create = async (name: string): Promise<CreateMemoryResult> => {
    const result = await onCreateMemory(name)
    if (result.ok) made.current = [...made.current, result.memory]
    return result
  }

  const answer = async (yes: boolean) => {
    if (!ask || working) return
    if (!yes) {
      setAsk(undefined)
      return
    }
    setWorking(true)
    try {
      // Only widening takes the face or fingerprint check (D34): it gives the agent more. Narrowing only takes access
      // away, so one confirmation is enough, by design; do not make the two match.
      if (ask.kind === 'widen') {
        let passed = false
        try {
          passed = (await confirm()) === true
        } catch {
          passed = false
        }
        if (!passed) return
      }
      const result = await (ask.kind === 'widen' ? onWiden(ask.memory.id) : onNarrow(ask.memory.id))
      if (result.ok) setAsk(undefined)
      else setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setWorking(false)
    }
  }

  const name = agentName
  const memory = ask?.memory.name ?? ''
  return (
    <View style={styles.screen} testID={testIdWithKey('ChangeMemories')}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <ThemedText style={styles.section}>{t('ConnectedAgents.MemoryItCanUse')}</ThemedText>
        <MemoryPicker memories={known()} selected={current} onToggle={toggle} onCreate={create} />
      </ScrollView>
      {ask ? (
        <View style={styles.sheet} testID={testIdWithKey('ChangeMemoriesSheet')} accessibilityViewIsModal>
          <ThemedText style={styles.title} accessibilityRole="header">
            {ask.kind === 'widen'
              ? t('ConnectedAgents.WidenTitle', { name, memory })
              : t('ConnectedAgents.NarrowTitle', { name, memory })}
          </ThemedText>
          <ThemedText style={styles.line}>
            {ask.kind === 'widen' ? t('ConnectedAgents.WidenBody') : t('ConnectedAgents.NarrowBody', { memory })}
          </ThemedText>
          {failed ? (
            // TODO: proposed words for a change the VTA did not make (PROPOSED_COPY); not in the plan yet.
            <ConnectNotice
              text={t('ConnectedAgents.MemoryChangeFailed')}
              testID={testIdWithKey('ChangeMemoriesFailed')}
            />
          ) : null}
          <Button
            title={ask.kind === 'widen' ? t('ConnectedAgents.Allow') : t('ConnectedAgents.StopUsing')}
            buttonType={ask.kind === 'widen' ? ButtonType.Primary : ButtonType.Critical}
            onPress={() => answer(true)}
            disabled={working}
            testID={testIdWithKey('ChangeMemoriesYes')}
            accessibilityLabel={ask.kind === 'widen' ? t('ConnectedAgents.Allow') : t('ConnectedAgents.StopUsing')}
          />
          <Button
            title={ask.kind === 'widen' ? t('Global.NotNow') : t('ConnectedAgents.Keep')}
            buttonType={ButtonType.Secondary}
            onPress={() => answer(false)}
            disabled={working}
            testID={testIdWithKey('ChangeMemoriesNo')}
            accessibilityLabel={ask.kind === 'widen' ? t('Global.NotNow') : t('ConnectedAgents.Keep')}
          />
        </View>
      ) : null}
    </View>
  )
}

export default ChangeMemoriesView
