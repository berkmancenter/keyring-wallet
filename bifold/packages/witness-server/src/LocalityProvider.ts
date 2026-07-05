/**
 * LocalityProvider — Interface for co-locality discovery transports
 *
 * Defines the contract that any co-locality transport must satisfy.
 * The witness server uses this interface to:
 *   1. Push the current challenge to the provider (for advertising)
 *   2. Receive proof callbacks when a nearby device proves proximity
 *
 * Current implementations:
 *   - NullLocalityProvider: No-op (for testing / when no transport is available)
 *
 * Planned implementations:
 *   - BluetoothLocalityProvider: BLE peripheral that advertises the challenge;
 *     only devices within BLE range can discover it, which is what proves proximity.
 *     (TODO — not yet implemented)
 */

/**
 * Callback invoked when the provider has determined that a device is co-located.
 *
 * @param did       - The device's DID
 * @param challenge - The challenge value the device received via the transport
 * @param signature - The device's signature over the challenge (for third-party audit)
 * @param metadata  - Optional transport-specific metadata (e.g. RSSI, IP, device name)
 */
export type ProofCallback = (
  did: string,
  challenge: string,
  signature: string,
  metadata?: Record<string, string>
) => void

export interface LocalityProvider {
  /** Human-readable name of this provider (e.g. 'bluetooth', 'null') */
  readonly name: string

  /**
   * Start the provider. Called by LocalityService after the proof callback is registered.
   * The provider should begin advertising `setChallenge()` and listening for devices.
   */
  start(): Promise<void>

  /** Stop the provider. Release any hardware resources (BLE, etc.). */
  stop(): Promise<void>

  /**
   * Push a new challenge to the provider for advertising.
   * Called by LocalityService on startup and on each challenge rotation.
   * The provider should update its advertisement so nearby devices receive the new value.
   */
  setChallenge(challenge: string): void

  /**
   * Register the callback to invoke when a device proves co-location.
   * Must be called before `start()`. Only one callback is supported at a time.
   * LocalityService registers this during start() so proofs are recorded automatically.
   */
  onProofReceived(callback: ProofCallback): void
}

/**
 * NullLocalityProvider — No-op implementation.
 *
 * Does not advertise anything and never triggers proof callbacks.
 * Used in tests and when no physical proximity transport is configured.
 */
export class NullLocalityProvider implements LocalityProvider {
  readonly name = 'null'

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  setChallenge(): void {}
  onProofReceived(): void {}
}
