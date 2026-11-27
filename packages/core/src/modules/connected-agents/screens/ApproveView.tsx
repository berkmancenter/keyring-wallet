import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'
import { AgentAvatar } from '../components/AgentMark'
import { AGENT_COLORS } from '../components/agentStyle'
import ConnectNotice from '../components/ConnectNotice'
import { AgentPurpose } from '../pairing'

const PURPOSE_KEY: Record<AgentPurpose, string> = {
  personalisation: 'ConnectedAgents.PurposePersonalisation',
  taskExecution: 'ConnectedAgents.PurposeTaskExecution',
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: 16, gap: 16, paddingBottom: 28 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  title: { flex: 1, fontFamily: 'SourceSans3-Bold', fontSize: 24, lineHeight: 30, color: AGENT_COLORS.text },
  card: { backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#D9D9DE', paddingHorizontal: 14 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 12 },
  rule: { borderTopWidth: 1, borderTopColor: '#E7E7E9' },
  text: { flex: 1, fontFamily: 'SourceSans3-Regular', fontSize: 17, lineHeight: 23, color: AGENT_COLORS.text },
  purposes: { paddingVertical: 12, gap: 8 },
  purpose: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingLeft: 4 },
  bar: { padding: 16, borderTopWidth: 1, borderTopColor: '#E7E7E9' },
})

const Row: React.FC<{ icon: string; text: string; first?: boolean; testID?: string }> = ({
  icon,
  text,
  first,
  testID,
}) => (
  <View style={[styles.row, !first && styles.rule]} accessible testID={testID}>
    <Icon name={icon} size={22} color={AGENT_COLORS.primary} accessibilityElementsHidden />
    <ThemedText style={styles.text}>{text}</ThemedText>
  </View>
)

export interface ApproveViewProps {
  name: string
  /** The memories' names, in the order picked; empty for an agent with no memory. */
  memoryNames: string[]
  purposes: AgentPurpose[]
  /** The time the grant will run to, formatted for this phone; from the logic (`expiresAt`), never computed here. */
  until: string
  /** The client's own name for itself, from the pairing: a claim nothing vouches for (§3.2 step 5). */
  requester?: string
  /** Whether the terminal is on this phone's network; undefined when unknown (§3.2 step 5). */
  sameNetwork?: boolean
  /**
   * Asks the phone's face or fingerprint check; true only when it passed. Whatever this phone uses to ask (the app's
   * confirmation sheet) is passed in, so this view cannot approve on its own.
   */
  confirm: () => Promise<boolean>
  /** Called only after `confirm` resolved true. */
  onApproved: () => void
}

/**
 * Approve (§6 "Approve", HCP's checklist as it applies to the base path, D42; canvas frame 5). Every line is the
 * plan's, in its order: who runs it, chat, the memories "and no others" (or none), the purposes when there is memory,
 * 4 hours and until when, and that approving is not signing in. The room sentence is the P1 form and is left out in
 * P0. Then the warning box, and "Approve", which asks the phone's face or fingerprint check: approval is never sent
 * without it passing (the seam's condition, held by this view's test). Nothing here elects persistence.
 */
const ApproveView: React.FC<ApproveViewProps> = ({
  name,
  memoryNames,
  purposes,
  until,
  requester,
  sameNetwork,
  confirm,
  onApproved,
}) => {
  const { t } = useTranslation()
  const [asking, setAsking] = useState(false)
  // Once approved, Approve stays spent: a second press must not ask, or approve, again. Two layers: the button
  // disables (its own test fails without it, measured), and approve() returns early, a backstop no press reaches while
  // the button is disabled but the one that holds if it ever is not (both removed, the test fails, measured).
  const [done, setDone] = useState(false)

  const approve = async () => {
    if (asking || done) return
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
      onApproved()
    }
  }

  const names = memoryNames.join(', ')
  return (
    <View style={styles.screen} testID={testIdWithKey('ConnectApprove')}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.head}>
          <AgentAvatar size={56} />
          <ThemedText style={styles.title} accessibilityRole="header">
            {t('ConnectedAgents.ApproveTitle', { name })}
          </ThemedText>
        </View>
        <View style={styles.card}>
          <Row first icon="console" text={t('ConnectedAgents.ApproveRunBy')} />
          {requester ? (
            <Row
              icon="account-question-outline"
              text={t('ConnectedAgents.ApproveRequester', { requester })}
              testID={testIdWithKey('ConnectApproveRequester')}
            />
          ) : null}
          {sameNetwork === true ? (
            <Row
              icon="wifi"
              text={t('ConnectedAgents.ApproveSameNetwork')}
              testID={testIdWithKey('ConnectApproveSameNetwork')}
            />
          ) : null}
          <Row icon="message-outline" text={t('ConnectedAgents.ApproveChat')} />
          <Row
            icon="layers-outline"
            text={
              memoryNames.length > 0
                ? t('ConnectedAgents.ApproveMemories', { names })
                : t('ConnectedAgents.ApproveNoMemory')
            }
          />
          {memoryNames.length > 0 ? (
            <View style={[styles.purposes, styles.rule]} accessible testID={testIdWithKey('ConnectApprovePurposes')}>
              <ThemedText style={styles.text}>{t('ConnectedAgents.ApprovePurposes')}</ThemedText>
              {purposes.map((purpose) => (
                <View key={purpose} style={styles.purpose}>
                  <Icon name="check" size={20} color={AGENT_COLORS.primary} accessibilityElementsHidden />
                  <ThemedText style={styles.text}>{t(PURPOSE_KEY[purpose])}</ThemedText>
                </View>
              ))}
            </View>
          ) : null}
          <Row icon="clock-outline" text={t('ConnectedAgents.ApproveUntil', { time: until })} />
          <Row icon="key-outline" text={t('ConnectedAgents.ApproveNotSignIn')} />
        </View>
        {sameNetwork === false ? (
          <ConnectNotice
            tone="warn"
            text={t('ConnectedAgents.ApproveOtherNetwork')}
            testID={testIdWithKey('ConnectApproveOtherNetwork')}
          />
        ) : null}
        <ConnectNotice
          tone="warn"
          text={t('ConnectedAgents.ApproveOwnTerminal')}
          testID={testIdWithKey('ConnectApproveOwnTerminal')}
        />
      </ScrollView>
      <View style={styles.bar}>
        <Button
          title={t('ConnectedAgents.Approve')}
          buttonType={ButtonType.Primary}
          onPress={approve}
          disabled={asking || done}
          testID={testIdWithKey('ConnectApproveButton')}
          accessibilityLabel={t('ConnectedAgents.Approve')}
        />
      </View>
    </View>
  )
}

export default ApproveView
