import { useAgent } from '@bifold/react-hooks'
import { DidCommProofExchangeRecord } from '@credo-ts/didcomm'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Declines a proof request and, when it came over a live connection, sends a
 * problem report so the verifier knows. Ported from bc-wallet-mobile.
 */
export const useDeclineProofRequest = (proof: DidCommProofExchangeRecord) => {
  const { agent } = useAgent()
  const { t } = useTranslation()

  return useCallback(async () => {
    if (!agent) {
      return
    }
    try {
      const connectionId = proof.connectionId ?? ''
      if (connectionId) {
        const connection = await agent.modules.didcomm.connections.findById(connectionId)
        if (connection) {
          await agent.modules.didcomm.proofs.sendProblemReport({
            proofExchangeRecordId: proof.id,
            description: t('ProofRequest.Declined'),
          })
        }
      }

      await agent.modules.didcomm.proofs.declineRequest({ proofExchangeRecordId: proof.id })
    } catch (err) {
      agent.config.logger.error(`Failed to decline proof request: ${err}`)
    }
  }, [agent, proof.id, proof.connectionId, t])
}
