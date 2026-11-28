import React from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../../components/buttons/Button'
import { testIdWithKey } from '../../../../utils/testable'
import ConnectNotice from '../../components/ConnectNotice'
import ConnectedView from '../../screens/ConnectedView'
import ConnectNumberView from '../../screens/ConnectNumberView'
import type { HcpApproveState } from '../approveFlow'

import HcpApproveView from './HcpApproveView'
import { useHcpCopy } from './useHcpCopy'

/** HCP's match number is four digits (`hcp/matchNumber.ts`), so the base number step draws four cells. */
const HCP_NUMBER_CELLS = 4

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  body: { padding: 16, gap: 18 },
  bar: { padding: 16, borderTopWidth: 1, borderTopColor: '#E7E7E9' },
})

export interface HcpConnectFlowViewProps {
  state: HcpApproveState
  /** The name the person gave the agent. */
  name: string
  /** The end of the grant, formatted for this phone (Done's "Connected until"). */
  until: string
  /** The phone's face or fingerprint check (HcpApproveView). */
  confirm: () => Promise<boolean>
  onApprove: () => void
  /** The four digits typed, sent once (the flow's `typeNumber`). */
  onSubmitNumber: (digits: string) => void
  onCancel: () => void
  onClose: () => void
  onSeeDetails: () => void
}

/** How a connect ends when it does not connect: one notice, and "Close" (the base path's ConnectFailureView layout). */
const End: React.FC<{ text: string; onClose: () => void }> = ({ text, onClose }) => {
  const { t } = useTranslation()
  return (
    <View style={styles.screen} testID={testIdWithKey('HcpConnectEnd')}>
      <ScrollView contentContainerStyle={styles.body}>
        <ConnectNotice text={text} />
      </ScrollView>
      <View style={styles.bar}>
        <Button
          title={t('Global.Close')}
          buttonType={ButtonType.Primary}
          onPress={onClose}
          testID={testIdWithKey('HcpConnectEndClose')}
          accessibilityLabel={t('Global.Close')}
        />
      </View>
    </View>
  )
}

/**
 * The HCP approve flow (`hcp/approveFlow.ts`), one view per state (backlog Section C, U1). The number step and Done
 * reuse the base path's views; only Approve is HCP's own (frame 50). A view only: it draws the state it is given and
 * calls back, and never runs the flow itself.
 */
const HcpConnectFlowView: React.FC<HcpConnectFlowViewProps> = ({
  state,
  name,
  until,
  confirm,
  onApprove,
  onSubmitNumber,
  onCancel,
  onClose,
  onSeeDetails,
}) => {
  const hcp = useHcpCopy()
  switch (state.state) {
    case 'idle':
    case 'waiting':
      return (
        <View
          style={styles.center}
          testID={testIdWithKey('HcpConnectWaiting')}
          accessible
          accessibilityState={{ busy: true }}
        >
          <ActivityIndicator size="large" />
        </View>
      )
    case 'numberEntry':
      return <ConnectNumberView cells={HCP_NUMBER_CELLS} onSubmit={onSubmitNumber} onCancel={onCancel} />
    case 'approve':
    case 'approving':
      return (
        <HcpApproveView
          name={name}
          view={state.view}
          busy={state.state === 'approving'}
          confirm={confirm}
          onApprove={onApprove}
        />
      )
    case 'approved':
      return <ConnectedView name={name} until={until} onSeeDetails={onSeeDetails} />
    case 'expired':
    case 'wrongNumber':
      return <End text={hcp(state.message.key)} onClose={onClose} />
    case 'locked':
      return <End text={hcp(state.message.key, state.message.params)} onClose={onClose} />
    case 'failed':
      // The failure's own copy key, chosen by case in the flow (never the error text): one case, "Not recorded",
      // says the VTA did approve, which a generic "Nothing was connected." would contradict.
      return (
        <End text={hcp(state.message.key, 'params' in state.message ? state.message.params : {})} onClose={onClose} />
      )
    case 'cancelled':
      // The caller has closed the flow.
      return null
  }
}

export default HcpConnectFlowView
