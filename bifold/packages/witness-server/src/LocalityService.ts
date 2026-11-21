/**
 * LocalityService - Co-Locality Challenge + Proof Management
 *
 * Manages the co-location verification lifecycle:
 *
 * 1. Challenge rotation  - Generates a rotating random challenge
 * 2. Provider bridging   - Pushes the challenge to a LocalityProvider for advertising
 * 3. Proof recording     - Receives callbacks from the provider when a device is verified
 * 4. Evidence building   - Assembles signed proofs for inclusion in VWC witnessContext
 *
 * The actual proximity transport is decoupled via the LocalityProvider interface.
 * Pass a provider to the constructor; defaults to NullLocalityProvider (no-op).
 *
 * Security properties:
 * - Challenge rotation prevents replay attacks across sessions
 * - Participant signatures enable third-party verification of the evidence
 * - Evidence is embedded in VWC witnessContext for verifier audit
 */

import { randomBytes } from 'crypto'
import { LocalityProvider, NullLocalityProvider } from './LocalityProvider'

/**
 * Configuration for the locality service
 */
export interface LocalityConfig {
  /** Whether locality verification is enabled */
  enabled: boolean
  /** How often to rotate the challenge (minutes) */
  challengeRotationMinutes: number
  /** How long locality proofs remain valid (minutes) */
  proofLifetimeMinutes: number
}

/**
 * Default locality configuration
 */
export const defaultLocalityConfig: LocalityConfig = {
  enabled: true,
  challengeRotationMinutes: 5,
  proofLifetimeMinutes: 30,
}

/**
 * A locality proof for a verified participant
 */
export interface LocalityProof {
  /** The participant's DID */
  did: string
  /** The challenge that was signed */
  challenge: string
  /** The participant's signature over the challenge */
  signature: string
  /** When the proof was verified */
  verifiedAt: Date
  /** When the proof expires */
  expiresAt: Date
}

/**
 * Locality verification evidence for inclusion in VWC
 */
export interface LocalityEvidence {
  /** The challenge that was signed */
  challenge: string
  /** Proofs from each participant */
  proofs: Array<{
    did: string
    sig: string
  }>
}

/**
 * Current challenge state
 */
interface ChallengeState {
  value: string
  createdAt: Date
  expiresAt: Date
}

/**
 * LocalityService - Manages co-locality challenge rotation and proof recording.
 *
 * Generates and rotates the challenge, pushes it to the configured LocalityProvider
 * (which handles advertising it physically — e.g. via BLE), and records proofs when
 * the provider reports that a device has been verified nearby.
 *
 * Defaults to NullLocalityProvider (no-op) when no provider is supplied.
 */
export class LocalityService {
  private config: LocalityConfig
  private readonly provider: LocalityProvider
  private currentChallenge: ChallengeState
  private verifiedProofs: Map<string, LocalityProof> = new Map()
  private rotationInterval: ReturnType<typeof setInterval> | null = null
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: LocalityConfig, provider?: LocalityProvider) {
    this.config = config
    this.provider = provider ?? new NullLocalityProvider()
    this.currentChallenge = this.generateChallenge()
  }

  /**
   * Check if locality verification is enabled
   */
  public isEnabled(): boolean {
    return this.config.enabled
  }

  /**
   * Get the current configuration
   */
  public getConfig(): LocalityConfig {
    return { ...this.config }
  }

  /**
   * Get count of currently valid proofs
   */
  public getVerifiedCount(): number {
    this.cleanupExpiredProofs()
    return this.verifiedProofs.size
  }

  /**
   * Start the locality service: wire the provider, push the first challenge, and begin
   * the rotation + cleanup intervals.
   */
  public async start(): Promise<void> {
    if (!this.config.enabled) {
      console.log('[LocalityService] Disabled - skipping start')
      return
    }

    console.log('[LocalityService] Starting co-locality verification service...')
    console.log(`[LocalityService]   Provider:          ${this.provider.name}`)
    console.log(`[LocalityService]   Challenge:         ${this.currentChallenge.value.substring(0, 16)}...`)
    console.log(`[LocalityService]   Challenge rotation: every ${this.config.challengeRotationMinutes} minutes`)
    console.log(`[LocalityService]   Proof lifetime:     ${this.config.proofLifetimeMinutes} minutes`)

    // Register proof callback so the provider can report verified devices
    this.provider.onProofReceived(this.handleProviderProof.bind(this))

    // Push initial challenge to the provider for advertising
    this.provider.setChallenge(this.currentChallenge.value)

    // Start the provider transport
    await this.provider.start()

    // Start challenge rotation
    this.rotationInterval = setInterval(() => {
      this.rotateChallenge()
    }, this.config.challengeRotationMinutes * 60 * 1000)

    // Start proof cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredProofs()
    }, 60 * 1000) // Check every minute
  }

  /**
   * Stop the locality service and the underlying provider.
   */
  public async stop(): Promise<void> {
    if (this.rotationInterval) {
      clearInterval(this.rotationInterval)
      this.rotationInterval = null
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }

    await this.provider.stop()

    console.log('[LocalityService] Stopped')
  }

  /**
   * Get the current challenge value.
   * This value should be distributed to participants via the transport layer
   * (currently a stub; Bluetooth BLE will advertise this value).
   */
  public getCurrentChallenge(): string {
    return this.currentChallenge.value
  }

  /**
   * Record a locality proof for a participant.
   *
   * Called internally via the provider callback when a device proves it received the
   * challenge over the proximity transport. The proof is validated (challenge match,
   * expiry, non-empty signature) and stored for later inclusion in VWC evidence.
   *
   * Proximity is guaranteed by the transport layer (e.g. BLE range).
   *
   * @param did       - The participant's DID
   * @param challenge - The challenge value received via the transport
   * @param signature - The participant's signature over the challenge (for third-party audit)
   * @returns The locality proof if successful
   */
  public async verifyLocality(
    did: string,
    challenge: string,
    signature: string
  ): Promise<{ success: true; proof: LocalityProof } | { success: false; error: string }> {
    // 1. Verify challenge matches current challenge
    if (challenge !== this.currentChallenge.value) {
      console.log(`[LocalityService] Rejected: challenge mismatch for ${did}`)
      return {
        success: false,
        error: 'Challenge does not match current published challenge',
      }
    }

    // 2. Verify challenge hasn't expired
    if (Date.now() > this.currentChallenge.expiresAt.getTime()) {
      console.log(`[LocalityService] Rejected: challenge expired for ${did}`)
      return {
        success: false,
        error: 'Challenge has expired',
      }
    }

    // 3. Verify signature (basic presence check; full crypto verification requires DID resolution)
    if (!signature || signature.length === 0) {
      return {
        success: false,
        error: 'Signature is required',
      }
    }

    // TODO: When Bluetooth is implemented, add transport-level proximity check here.
    // e.g. verify that the DID was discovered via a BLE scan that this server initiated.

    // Create and store the proof
    const proof: LocalityProof = {
      did,
      challenge,
      signature,
      verifiedAt: new Date(),
      expiresAt: new Date(Date.now() + this.config.proofLifetimeMinutes * 60 * 1000),
    }

    this.verifiedProofs.set(did, proof)

    console.log(`[LocalityService] ✓ Co-locality verified for ${did}`)

    return { success: true, proof }
  }

  /**
   * Get a valid locality proof for a DID
   */
  public getValidProof(did: string): LocalityProof | undefined {
    const proof = this.verifiedProofs.get(did)

    if (!proof) {
      return undefined
    }

    if (Date.now() > proof.expiresAt.getTime()) {
      this.verifiedProofs.delete(did)
      return undefined
    }

    return proof
  }

  /**
   * Check if a DID has a valid locality proof
   */
  public hasValidProof(did: string): boolean {
    return this.getValidProof(did) !== undefined
  }

  /**
   * Build locality evidence for inclusion in a VWC
   *
   * @param participantDids - The DIDs of participants to include
   * @returns Locality evidence object or undefined if not all participants have valid proofs
   */
  public buildLocalityEvidence(participantDids: string[]): LocalityEvidence | undefined {
    if (!this.config.enabled) {
      return undefined
    }

    const proofs: LocalityEvidence['proofs'] = []
    let challenge: string | undefined

    for (const did of participantDids) {
      const proof = this.getValidProof(did)
      if (!proof) {
        console.log(`[LocalityService] Cannot build evidence: no valid proof for ${did}`)
        return undefined
      }

      if (!challenge) {
        challenge = proof.challenge
      }

      proofs.push({
        did: proof.did,
        sig: proof.signature,
      })
    }

    if (!challenge) {
      return undefined
    }

    return { challenge, proofs }
  }

  /**
   * Clear a locality proof (e.g., after session completion)
   */
  public clearProof(did: string): void {
    this.verifiedProofs.delete(did)
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Generate a new challenge
   */
  private generateChallenge(): ChallengeState {
    const value = randomBytes(32).toString('hex')
    const createdAt = new Date()
    const expiresAt = new Date(Date.now() + this.config.challengeRotationMinutes * 60 * 1000)

    return { value, createdAt, expiresAt }
  }

  /**
   * Callback invoked by the LocalityProvider when it has verified a device is nearby.
   * Delegates to verifyLocality() for challenge/signature validation.
   */
  private async handleProviderProof(
    did: string,
    challenge: string,
    signature: string
  ): Promise<void> {
    const result = await this.verifyLocality(did, challenge, signature)
    if (!result.success) {
      console.log(`[LocalityService] Provider proof rejected for ${did}: ${result.error}`)
    }
  }

  /**
   * Rotate to a new challenge and push the updated value to the provider for advertising.
   */
  private rotateChallenge(): void {
    this.currentChallenge = this.generateChallenge()
    this.provider.setChallenge(this.currentChallenge.value)
    console.log(`[LocalityService] 🔄 Challenge rotated: ${this.currentChallenge.value.substring(0, 16)}...`)
  }

  /**
   * Clean up expired proofs
   */
  private cleanupExpiredProofs(): void {
    const now = Date.now()
    let cleaned = 0

    for (const [did, proof] of this.verifiedProofs.entries()) {
      if (now > proof.expiresAt.getTime()) {
        this.verifiedProofs.delete(did)
        cleaned++
      }
    }

    if (cleaned > 0) {
      console.log(`[LocalityService] 🧹 Cleaned up ${cleaned} expired proofs`)
    }
  }

}

/**
 * Load locality configuration from environment variables
 */
export function loadLocalityConfig(): LocalityConfig {
  return {
    enabled: process.env.WITNESS_LOCALITY_ENABLED !== 'false',
    challengeRotationMinutes: parseInt(process.env.WITNESS_LOCALITY_CHALLENGE_ROTATION_MINUTES || '5', 10),
    proofLifetimeMinutes: parseInt(process.env.WITNESS_LOCALITY_PROOF_LIFETIME_MINUTES || '30', 10),
  }
}
