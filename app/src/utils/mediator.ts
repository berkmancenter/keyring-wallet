import { Agent } from '@credo-ts/core'
import { DidCommMediatorPickupStrategy } from '@credo-ts/didcomm'

export const batchPickup = async (agent: Agent): Promise<void> => {
  try {
    for (let i = 0; i < 2; i++) {
      agent.config.logger.debug(`Batch pickup attempt ${i + 1}`)
      agent.modules.didcomm.mediationRecipient.initiateMessagePickup(undefined, DidCommMediatorPickupStrategy.Implicit)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  } catch (error) {
    agent.config.logger.error(`Error during batch pickup: ${error}`)
  }
}

export const startPeriodicTrustPing = (agent: Agent, intervalMs: number): (() => void) => {
  const id = setInterval(async () => {
    try {
      const mediator = await agent.modules.didcomm.mediationRecipient.findDefaultMediator()
      if (!mediator) return

      await agent.modules.didcomm.connections.sendPing(mediator.connectionId, {
        responseRequested: false,
        withReturnRouting: true,
      })
    } catch (error) {
      agent.config.logger.error(`Periodic trust ping failed: ${error}`)
    }
  }, intervalMs)

  return () => clearInterval(id)
}
