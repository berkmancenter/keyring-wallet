import { Agent } from '@credo-ts/core'
import { DidCommMediatorPickupStrategy } from '@credo-ts/didcomm'

/**
 * What ActivityProvider does to mediator pickup when the app goes to the
 * background and comes back (TOKENS.UTIL_MESSAGE_PICKUP).
 *
 * The default is the polling restart this provider always did. An app that
 * picks up differently (a live WebSocket, say) registers its own, so that this
 * provider never restarts pickup with a strategy the app did not choose: a
 * hard-coded PickUpV2 restart here would silently move a live-mode phone back
 * to polling on every return to the foreground.
 */
export interface MessagePickupLifecycle {
  /** The app went to the background. */
  onBackground(agent: Agent): Promise<void>
  /** The app came back to the foreground and was not locked out. */
  onForeground(agent: Agent): Promise<void>
}

export const defaultMessagePickupLifecycle: MessagePickupLifecycle = {
  onBackground: async (agent) => {
    await agent.modules.didcomm.mediationRecipient.stopMessagePickup()
  },
  onForeground: async (agent) => {
    // Stop before starting, and name the strategy explicitly. Both matter:
    // initiateMessagePickup SUBSCRIBES A NEW polling loop rather than
    // replacing the running one, so without the stop every foreground
    // resume accumulates another loop for the life of the process; and
    // without an explicit strategy credo resolves
    // `mediationRecord.pickupStrategy ?? moduleConfig`, letting a value
    // persisted in the wallet decide whether this agent can receive at
    // all. See docs/spikes/e2e-vrc-connect-findings.md.
    await agent.modules.didcomm.mediationRecipient.stopMessagePickup()
    await agent.modules.didcomm.mediationRecipient.initiateMessagePickup(
      undefined,
      DidCommMediatorPickupStrategy.PickUpV2
    )
  },
}
