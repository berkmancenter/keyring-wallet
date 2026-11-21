/**
 * The other phone's question when a remote VRC step arrived late (IN-448; lateStep.ts): "X wants to finish your
 * relationship card now". Self-contained, mounted once at the root beside RelationshipProposalModal, the same
 * bottom-sheet pattern.
 *
 * @module vrc/components/LateStepReadyModal
 */
import { useAgent } from '@bifold/react-hooks'
import React, { useCallback, useState } from 'react'

import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import { useConnectionDisplayName } from '../../../hooks/connections'
import { answerPeerCheck } from '../lateStep'
import { useAnyPeerCheck } from '../hooks/useLateStep'
import { LateStepSheetLayout, PeerReadyCard } from './LateStepCards'

const LateStepReadyModal: React.FC = () => {
  const { agent } = useAgent()
  const check = useAnyPeerCheck()
  const name = useConnectionDisplayName(check?.connectionId ?? '')
  const [busy, setBusy] = useState(false)

  const answer = useCallback(
    async (ready: boolean) => {
      if (!agent || !check || busy) return
      setBusy(true)
      try {
        await answerPeerCheck(agent, check.connectionId, ready)
      } catch (e) {
        agent.config.logger.warn(`[VRC:LateStep] could not answer the ready-check: ${(e as Error).message}`)
      } finally {
        setBusy(false)
      }
    },
    [agent, check, busy]
  )

  if (!check) return null

  return (
    <SafeAreaModal visible transparent animationType="slide">
      <LateStepSheetLayout>
        <PeerReadyCard
          name={name}
          waitedMs={check.waitedMs + (Date.now() - check.receivedAt)}
          onReady={() => void answer(true)}
          onNotNow={() => void answer(false)}
          busy={busy}
        />
      </LateStepSheetLayout>
    </SafeAreaModal>
  )
}

export default LateStepReadyModal
