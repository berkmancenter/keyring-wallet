/**
 * "Connect an agent" (agent-connect plan §3.2, §3.15, §6; backlog 2 R1): drives `useAgentPairing()` and draws one view
 * per pairing phase. A container only: it reads hooks and passes props.
 *
 * | phase | view |
 * |---|---|
 * | `idle` | `ConnectAgentForm`, guarded by `useConnectGuard()` |
 * | `awaitingScan` | `ConnectScanView`, with the app's camera |
 * | `awaitingNumber` | `ConnectNumberView` |
 * | `awaitingApproval` | `ApproveView`, confirmed by the phone's face or fingerprint check |
 * | `awaitingEnrolment` | `ConnectingView` |
 * | `confirmed` | `ConnectedView` |
 * | `failed`, `expired`, `locked` | `ConnectFailureView`, with the end the pairing reports |
 * | `cancelled`, `notFinished` | back to "AI agents" |
 *
 * Every failure has its own words (`failureCopy.ts`'s `ConnectEnd`): no generic line here. A scanned code that is not a
 * pairing code ends as `not-a-pairing-code` (an expired one as `expired`), before anything is sent.
 */
import type { StackScreenProps } from '@react-navigation/stack'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Platform } from 'react-native'
import { PERMISSIONS, RESULTS, request } from 'react-native-permissions'

import ScanCamera from '../../components/misc/ScanCamera'
import {
  useAgentPairing,
  useConnectGuard,
  useKeepConnectedOffered,
  useMemories,
  useAgentActions,
  usePersonas,
} from '../../modules/connected-agents/ConnectedAgentsProvider'
import { lineOfAction } from '../../modules/connected-agents/actionLine'
import type { AgentActionLine } from '../../modules/connected-agents/components/AgentActionNotice'
import { MATCH_NUMBER_DIGITS, aclScopeFor, pairingLinkFromTrigger } from '../../modules/connected-agents/pairing'
import ApproveView from '../../modules/connected-agents/screens/ApproveView'
import ConnectAgentForm, { type ConnectFormChoice } from '../../modules/connected-agents/screens/ConnectAgentForm'
import ConnectedView, { ConnectingView } from '../../modules/connected-agents/screens/ConnectedView'
import ConnectFailureView from '../../modules/connected-agents/screens/ConnectFailureView'
import ConnectNumberView from '../../modules/connected-agents/screens/ConnectNumberView'
import ConnectScanView from '../../modules/connected-agents/screens/ConnectScanView'
import { readTrigger } from '../../modules/trust-tasks/module/triggerLink'
import { MyAgentStackParams, Screens } from '../../types/navigators'

import { askBiometric, formatAgentTime, pickerCreate } from './AgentDetailsScreen'

type ConnectAgentScreenProps = StackScreenProps<MyAgentStackParams, Screens.ConnectAgent>

/** Why a connect ended (`failureCopy.ts`'s `ConnectEnd`), as the failure view takes it. */
type ConnectEnd = React.ComponentProps<typeof ConnectFailureView>['end']

/** The camera, once the phone allows it; without it the slot is empty and "Paste the link instead" still works. */
const AgentScanCamera: React.FC<{ onLink: (link: string) => void }> = ({ onLink }) => {
  const [allowed, setAllowed] = useState(false)
  useEffect(() => {
    let live = true
    const camera = Platform.OS === 'ios' ? PERMISSIONS.IOS.CAMERA : PERMISSIONS.ANDROID.CAMERA
    request(camera)
      .then((result) => live && setAllowed(result === RESULTS.GRANTED))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
  // One code per scan step: the camera keeps reading, and the pairing takes one scan.
  const read = useRef(false)
  const handleCodeScan = useCallback(
    async (value: string) => {
      if (read.current) return
      read.current = true
      onLink(value)
    },
    [onLink]
  )
  return allowed ? <ScanCamera handleCodeScan={handleCodeScan} /> : null
}

/** "Keep it connected" on the Connected screen: offered only when `useKeepConnectedOffered` says so (step 7.28). */
const Connected: React.FC<{ agentId: string; name: string; until: string; onSeeDetails: () => void }> = ({
  agentId,
  name,
  until,
  onSeeDetails,
}) => {
  const offered = useKeepConnectedOffered(agentId)
  const actions = useAgentActions()
  // Keep it connected's line, kept for this visit: it spends the control, and a re-read does not bring it back.
  const [keepConnectedLine, setKeepConnectedLine] = useState<AgentActionLine>()
  const keepConnected = useCallback(() => {
    void lineOfAction('keepConnected', actions.keepConnected(agentId), name).then((line) => {
      if (line) setKeepConnectedLine(line)
    })
  }, [actions, agentId, name])
  return (
    <ConnectedView
      name={name}
      until={until}
      onSeeDetails={onSeeDetails}
      onKeepConnected={offered ? keepConnected : undefined}
      keepConnectedLine={keepConnectedLine}
    />
  )
}

const ConnectAgentScreen: React.FC<ConnectAgentScreenProps> = ({ navigation }) => {
  const { t } = useTranslation()
  const pairing = useAgentPairing()
  const guard = useConnectGuard()
  const { memories, loading: memoriesLoading, create } = useMemories()
  const personas = usePersonas()
  // A scanned code the pairing cannot take, and the digits typed (kept under a wrong number, §6).
  const [refused, setRefused] = useState<ConnectEnd | undefined>()
  const [typed, setTyped] = useState('')
  const { state } = pairing

  const back = useCallback(() => navigation.navigate(Screens.AiAgents), [navigation])
  useEffect(() => {
    if (state.phase === 'cancelled' || state.phase === 'notFinished') back()
  }, [state.phase, back])

  const onContinue = useCallback(
    (choice: ConnectFormChoice) => {
      // The persona the owner acts as: the first one on this VTA (the "Acting as" row is #1101's).
      void pairing.start({ ...choice, ownerPersonaDid: personas[0]?.did ?? '' }).catch(() => undefined)
    },
    [pairing, personas]
  )

  const onLink = useCallback(
    (text: string) => {
      const trigger = readTrigger(text)
      if (trigger.outcome === 'reject') {
        setRefused(trigger.reason === 'expired' ? 'expired' : 'not-a-pairing-code')
        return
      }
      const link = pairingLinkFromTrigger(trigger)
      if (!link) {
        setRefused('not-a-pairing-code')
        return
      }
      void pairing.scan(link).catch(() => undefined)
    },
    [pairing]
  )

  const approve = useMemo(() => {
    if (state.phase !== 'awaitingApproval') return undefined
    const { choice, disclosure, requestId } = state
    const names = new Map(memories.map((m) => [m.id, m.name]))
    // The time the grant will run to, from the logic's own scope for this choice.
    const until = formatAgentTime(Date.parse(aclScopeFor(choice, Date.now()).expiresAt))
    return {
      name: choice.name,
      memoryNames: choice.memoryContexts.map((id) => names.get(id) ?? id),
      purposes: choice.purposes,
      until,
      requester: disclosure?.requester,
      sameNetwork: disclosure?.sameNetwork,
      confirm: askBiometric(choice.name, requestId, {
        title: t('ConnectedAgents.ApproveTitle', { name: choice.name }),
        description: t('ConnectedAgents.ApproveUntil', { time: until }),
      }),
    }
  }, [state, memories, t])

  if (refused)
    return (
      <ConnectFailureView
        end={refused}
        onClose={() =>
          void pairing
            .cancel()
            .catch(() => undefined)
            .finally(back)
        }
      />
    )

  switch (state.phase) {
    case 'idle':
      return (
        <ConnectAgentForm
          // Held at "checking" until a persona is known too: a choice with none would end as `invalid-choice`.
          guard={guard === 'ok' && personas.length === 0 ? 'checking' : guard}
          memories={memoriesLoading ? undefined : memories}
          onCreateMemory={pickerCreate(create)}
          onContinue={onContinue}
          onClose={back}
        />
      )
    case 'awaitingScan':
      return <ConnectScanView camera={<AgentScanCamera onLink={onLink} />} onLink={onLink} />
    case 'awaitingNumber':
      return (
        <ConnectNumberView
          cells={MATCH_NUMBER_DIGITS}
          onSubmit={(digits) => {
            setTyped(digits)
            void pairing.enterNumber(digits).catch(() => undefined)
          }}
          onCancel={() => void pairing.cancel().catch(() => undefined)}
        />
      )
    case 'awaitingApproval':
      return approve ? (
        <ApproveView {...approve} onApproved={() => void pairing.approve().catch(() => undefined)} />
      ) : null
    case 'awaitingEnrolment':
      return <ConnectingView name={state.choice.name} />
    case 'confirmed':
      return (
        <Connected
          agentId={state.agent.agentDid}
          name={state.agent.name}
          until={formatAgentTime(Date.parse(state.agent.expiresAt))}
          onSeeDetails={() =>
            navigation.replace(Screens.AgentDetails, { agentId: state.agent.agentDid, name: state.agent.name })
          }
        />
      )
    case 'failed':
      return (
        <ConnectFailureView
          end={state.reason}
          typed={state.reason === 'wrong-number' ? typed : undefined}
          cells={state.reason === 'wrong-number' ? MATCH_NUMBER_DIGITS : undefined}
          onClose={back}
        />
      )
    case 'expired':
      return <ConnectFailureView end="expired" onClose={back} />
    case 'locked':
      return <ConnectFailureView end="locked" minutesLeft={state.lockout.minutesLeft} onClose={back} />
    case 'cancelled':
    case 'notFinished':
      // Leaving for "AI agents" (the effect above).
      return null
  }
}

export default ConnectAgentScreen
