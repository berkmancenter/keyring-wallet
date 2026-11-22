/**
 * Mediator message-pickup: the one agent setting that decides whether a
 * mediated agent can receive anything at all.
 *
 * ## Why this file exists
 *
 * A mediated credo agent gets inbound messages one of two ways: the mediator
 * PUSHES them into an open session, or the agent PULLS them with the
 * message-pickup protocol. Which one happens is set by the pickup strategy.
 * Get it wrong and the agent still *sends* perfectly — mediation request,
 * keylist-update, every outbound message — while receiving nothing, forever,
 * with no error on either side. There is no failure mode that looks more like
 * "the network is fine" while being completely broken.
 *
 * Our mediator queues rather than pushes, so a PULL strategy is mandatory.
 * `Implicit` (push-only) receives nothing; `PickUpV2LiveMode` holds a socket
 * that dies silently behind NAT and loses live-pushed messages outright
 * (measured 2026-08-18, docs/spikes/e2e-vrc-connect-findings.md).
 *
 * ## The trap this guard exists to close
 *
 * Setting `mediatorPickupStrategy` in the agent's module config is NOT enough.
 * credo resolves the strategy as:
 *
 *   mediationRecord.pickupStrategy ?? moduleConfig.mediatorPickupStrategy
 *
 * (`DidCommMediationRecipientApi.getPickupStrategyForMediator`) — a value
 * persisted on the MediationRecord in the agent's wallet OUTRANKS the config,
 * and credo writes one there itself whenever the config leaves the strategy
 * unset. So the effective strategy depends on hidden per-wallet state: the same
 * code receives messages on one wallet and is deaf on another, which reads as
 * "works on my machine" and hides the bug for as long as nobody starts fresh.
 *
 * `startMediatorMessagePickup` closes that by passing the strategy EXPLICITLY
 * to `initiateMessagePickup`, which bypasses both the record and the config
 * (`pickupStrategy ?? await this.getPickupStrategyForMediator(...)`).
 *
 * Full diagnosis: docs/spikes/e2e-vrc-connect-findings.md ("fourth failure layer")
 */

/** credo's `DidCommMediatorPickupStrategy` values, as plain strings.
 *
 * Mirrored rather than imported so this module stays dependency-free and
 * usable from React Native, Node and test code alike. credo declares these as
 * a string enum, so the values are identical by construction; passing one of
 * these where credo wants the enum is exact, not a coercion. */
export type MediatorPickupStrategyName =
  | 'PickUpV1'
  | 'PickUpV2'
  | 'PickUpV2LiveMode'
  | 'Implicit'
  | 'None'

/**
 * The only strategy proven against our mediator. Batch polling: every delivery
 * is request/ack'd against the mediator's queue, and each poll self-heals a
 * dead socket.
 */
export const SUPPORTED_MEDIATOR_PICKUP_STRATEGY: MediatorPickupStrategyName = 'PickUpV2'

/**
 * Why each rejected strategy is rejected. These are reasons, not labels: the
 * message a developer sees is the whole point of the guard, because the
 * symptom it prevents (total inbound silence) gives them nothing to go on.
 */
const UNSUPPORTED_STRATEGIES: Partial<Record<MediatorPickupStrategyName, string>> = {
  Implicit:
    'push-only — it issues no pickup requests and waits for the mediator to push. ' +
    'Our mediator queues instead of pushing, so the agent receives NOTHING while still sending fine.',
  PickUpV2LiveMode:
    'holds a long-lived socket the mediator pushes into. Behind NAT that socket dies silently and ' +
    'the mediator pushes into the dead socket without requeueing — messages are lost outright ' +
    '(measured 2026-08-18).',
  None: 'disables pickup entirely — the agent will never receive a mediated message.',
}

/**
 * Reject a pickup strategy that cannot receive against our mediator.
 *
 * Call this wherever a strategy is chosen or read from config, so a bad value
 * fails at startup with an explanation instead of at runtime as silence.
 *
 * @param strategy the strategy about to be used
 * @param context where it came from, named in the error (e.g. 'witness-server agent config')
 */
export function assertSupportedMediatorPickupStrategy(
  strategy: MediatorPickupStrategyName | string | undefined,
  context: string
): void {
  if (strategy === undefined) {
    throw new Error(
      `[mediation] ${context}: no mediator pickup strategy set. credo will then fall back to a value ` +
        `persisted on the MediationRecord in this wallet, which makes inbound delivery depend on hidden ` +
        `per-wallet state. Pass '${SUPPORTED_MEDIATOR_PICKUP_STRATEGY}' explicitly.`
    )
  }

  const reason = UNSUPPORTED_STRATEGIES[strategy as MediatorPickupStrategyName]
  if (reason) {
    throw new Error(
      `[mediation] ${context}: pickup strategy '${strategy}' cannot receive messages from our mediator — ` +
        `${reason} Use '${SUPPORTED_MEDIATOR_PICKUP_STRATEGY}'. ` +
        `See docs/spikes/e2e-vrc-connect-findings.md`
    )
  }
}

/** The narrow slice of a credo agent this helper needs, typed structurally so
 *  this module does not depend on @credo-ts/didcomm. */
export interface MediatedAgentLike {
  modules: {
    didcomm: {
      mediationRecipient: {
        findDefaultMediator(): Promise<{ id: string; pickupStrategy?: string } | null>
        // Both params optional (never required here) so this stays assignable
        // from credo's real DidCommMediationRecipientApi: its pickupStrategy is
        // a nominal string enum, and TS only accepts a mirrored string literal
        // in that position when the parameter is optional on both sides —
        // required parameters of merely-matching string values are rejected as
        // unsound (verified empirically; enums are not structurally string).
        initiateMessagePickup(mediator?: undefined, pickupStrategy?: string): Promise<unknown>
        stopMessagePickup(): Promise<unknown>
      }
    }
  }
}

export interface StartMediatorMessagePickupResult {
  /** false when the agent has no mediator — a direct-transport agent, not an error. */
  started: boolean
  /** The strategy actually in force, or undefined when there is no mediator. */
  strategy?: MediatorPickupStrategyName
  /** Set when the wallet's MediationRecord had a different strategy pinned on it,
   *  which would have won had we not passed one explicitly. */
  overrodePersistedStrategy?: string
}

/**
 * Start message pickup with the supported strategy, explicitly.
 *
 * Call this AFTER `agent.initialize()`. Passing the strategy explicitly is what
 * makes this safe: it bypasses both the module config and any value persisted
 * on the MediationRecord, so behaviour no longer depends on which wallet the
 * agent happens to be running against.
 *
 * Idempotent in practice — credo replaces the previous pickup loop — so it is
 * safe to call after a reconnect.
 *
 * @param agent an initialized credo agent
 * @param log optional sink for the one-line summary; pass your logger to have
 *            the effective strategy show up in the agent's own log
 */
export async function startMediatorMessagePickup(
  agent: MediatedAgentLike,
  log?: (message: string) => void
): Promise<StartMediatorMessagePickupResult> {
  const mediationRecipient = agent.modules.didcomm.mediationRecipient
  const defaultMediator = await mediationRecipient.findDefaultMediator()

  if (!defaultMediator) {
    log?.('[mediation] no default mediator — direct transport, no message pickup needed')
    return { started: false }
  }

  // Report the pinned value before overriding it. A wallet carrying an
  // unsupported strategy is exactly the state that makes this bug look
  // machine-specific, so it is worth saying out loud even though we win.
  const persisted = defaultMediator.pickupStrategy
  const overrodePersistedStrategy =
    persisted && persisted !== SUPPORTED_MEDIATOR_PICKUP_STRATEGY ? persisted : undefined

  if (overrodePersistedStrategy) {
    log?.(
      `[mediation] wallet's MediationRecord pins pickup strategy '${overrodePersistedStrategy}'; ` +
        `overriding with '${SUPPORTED_MEDIATOR_PICKUP_STRATEGY}' for this session`
    )
  }

  // Stop the pickup credo already started for us during agent.initialize(). Without
  // this we end up with two concurrent pickup loops against the same mediator —
  // credo's `initiateMessagePickup` subscribes a fresh polling interval on every
  // call, it does not replace the previous one — which silently doubles every
  // wallet's request rate against shared infrastructure. Observed on 2026-08-31 as a
  // duplicated "Starting explicit pickup" line. Safe to call when nothing is
  // running, and safe before starting: the stop signal is a plain Subject, so it
  // reaches only the loops already subscribed, not the one we start next.
  await mediationRecipient.stopMessagePickup()

  await mediationRecipient.initiateMessagePickup(undefined, SUPPORTED_MEDIATOR_PICKUP_STRATEGY)

  log?.(`[mediation] message pickup started — strategy ${SUPPORTED_MEDIATOR_PICKUP_STRATEGY} (explicit)`)

  return {
    started: true,
    strategy: SUPPORTED_MEDIATOR_PICKUP_STRATEGY,
    overrodePersistedStrategy,
  }
}
