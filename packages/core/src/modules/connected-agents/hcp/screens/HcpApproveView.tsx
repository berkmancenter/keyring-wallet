import React, { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../../components/buttons/Button'
import { ThemedText } from '../../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../../utils/testable'
import { AgentAvatar } from '../../components/AgentMark'
import { AGENT_COLORS } from '../../components/agentStyle'
import ConnectNotice from '../../components/ConnectNotice'
import type { HcpApprovalView } from '../types'

import { useHcpCopy } from './useHcpCopy'

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: 16, gap: 16, paddingBottom: 28 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  title: { flex: 1, fontFamily: 'SourceSans3-Bold', fontSize: 24, lineHeight: 30, color: AGENT_COLORS.text },
  card: { backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#D9D9DE', paddingHorizontal: 14 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 12 },
  rule: { borderTopWidth: 1, borderTopColor: '#E7E7E9' },
  text: { flex: 1, fontFamily: 'SourceSans3-Regular', fontSize: 17, lineHeight: 23, color: AGENT_COLORS.text },
  bar: { padding: 16, borderTopWidth: 1, borderTopColor: '#E7E7E9' },
})

/**
 * The icon for each row, by position: the rows are the five effects' summaries in `HCP_EFFECT_KINDS` order (client,
 * access, use-until, term, not signing in), as frame 50 draws them. A row past the fifth (which `readHcpEffects`
 * never gives) takes a plain dot.
 */
const ROW_ICONS = ['office-building-outline', 'eye-outline', 'timer-sand', 'clock-outline', 'key-outline']

export interface HcpApproveViewProps {
  /** The name the person gave the agent (Keyring's, never the request's). */
  name: string
  view: HcpApprovalView
  /**
   * The end of the grant, formatted for this phone. Not drawn: the VTA's own term row says how long, verbatim, and the
   * view never adds a second time beside it. Kept so the flow passes one set of props to Approve and Done.
   */
  until: string
  /** The flow is approving (`approving`): Approve is disabled. */
  busy?: boolean
  /** Asks the phone's face or fingerprint check; true only when it passed (ApproveView's contract). */
  confirm: () => Promise<boolean>
  /** Called only after `confirm` resolved exactly `true`, and once. */
  onApprove: () => void
}

/**
 * HCP Approve (canvas frame 50; plan §6 "HCP lane screens"): "Connect "<name>"?", the VTA's five effect summaries as
 * rows, verbatim and in order (data, not words: drawn as plain text, never interpreted), the "Only continue if…"
 * warning box, and Approve. Approve asks the phone's face or fingerprint check and approves only when it resolves
 * exactly `true`: once while a check is open, and spent after success.
 */
const HcpApproveView: React.FC<HcpApproveViewProps> = ({ name, view, busy, confirm, onApprove }) => {
  const hcp = useHcpCopy()
  const [asking, setAsking] = useState(false)
  // Spent once approved: the button disables, and approve() returns early as a backstop (ApproveView's two layers).
  const [done, setDone] = useState(false)

  const approve = async () => {
    if (asking || done || busy) return
    setAsking(true)
    let passed = false
    try {
      passed = (await confirm()) === true
    } catch {
      passed = false
    } finally {
      setAsking(false)
    }
    if (passed) {
      setDone(true)
      onApprove()
    }
  }

  const approveWord = hcp(view.approve.key)
  return (
    <View style={styles.screen} testID={testIdWithKey('HcpApprove')}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.head}>
          <AgentAvatar size={56} />
          <ThemedText style={styles.title} accessibilityRole="header">
            {hcp(view.title.key, { name })}
          </ThemedText>
        </View>
        <View style={styles.card}>
          {view.rows.map((row, i) => (
            <View
              // The rows are a fixed list in a fixed order; the position is their identity.
              key={i}
              style={[styles.row, i > 0 && styles.rule]}
              accessible
              testID={testIdWithKey('HcpApproveRow')}
            >
              <Icon
                name={ROW_ICONS[i] ?? 'circle-small'}
                size={22}
                color={AGENT_COLORS.primary}
                accessibilityElementsHidden
              />
              <ThemedText style={styles.text}>{row}</ThemedText>
            </View>
          ))}
        </View>
        <ConnectNotice tone="warn" text={hcp(view.warning.key)} />
      </ScrollView>
      <View style={styles.bar}>
        <Button
          title={approveWord}
          buttonType={ButtonType.Primary}
          onPress={approve}
          disabled={!!busy || asking || done}
          testID={testIdWithKey('HcpApproveButton')}
          accessibilityLabel={approveWord}
        />
      </View>
    </View>
  )
}

export default HcpApproveView
