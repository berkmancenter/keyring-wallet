import { EventEmitter } from 'events'

/**
 * Witness Status Message Store
 *
 * Stores and emits witness status messages for display in counterparty chats.
 * Provides real-time feedback during witnessed VRC exchange.
 */

export interface WitnessStatusMessage {
  id: string
  connectionId: string // Which chat to display in
  status:
    | 'session-requested'
    | 'session-joined'
    | 'vp-submitted'
    | 'witnessed'
    | 'witness-complete'
    | 'witness-skipped'
    | 'error'
  witnessName: string
  timestamp: Date
  sessionId?: string
  errorMessage?: string // For error status
}

/**
 * Error types for VRC flow operations
 * Used by WitnessErrorDialog to show appropriate UI
 */
export type VrcFlowErrorType =
  | 'witness-timeout' // Witness didn't respond within timeout
  | 'vp-submission-failed' // Failed to submit VP to witness
  | 'session-timeout' // No session-challenge received
  | 'counterparty-not-connected' // Counterparty not on same witness
  | 'biometric-cancelled' // User cancelled biometric
  | 'biometric-failed' // Biometric authentication failed
  | 'stale-witness' // Witness connection expired
  | 'network-error' // General network error
  | 'event-not-started' // Request arrived before event start time
  | 'event-ended' // Request arrived after event end time

/**
 * Error state for a VRC flow
 */
export interface VrcFlowError {
  type: VrcFlowErrorType
  message?: string
  witnessName?: string
  contactName?: string
  timestamp: Date
  /** Callback to retry the failed operation */
  onRetry?: () => Promise<void>
  /** Callback to proceed without witness (if applicable) */
  onProceedWithout?: () => Promise<void>
}

/**
 * VRC Exchange Flow Store
 *
 * Tracks the entire VRC exchange flow for overlay display:
 * - 'connecting': DID exchange in progress
 * - 'witness-active': Witness verification in progress
 * - 'witness-fallback': Witness unavailable, falling back to direct issuance
 * - 'biometric-fallback': Biometric failed/cancelled, issuing without hardware attestation
 * - 'preparing-offer': Witness complete, preparing credential offer
 * - 'offer-sent': Credential offer sent by Issuer (overlay should clear on Inviter side)
 * - 'offer-received': Credential offer received by Holder (overlay should clear on Receiver side)
 * - 'idle': No active flow
 */
export type VrcFlowStatus =
  | 'idle'
  | 'connecting'
  | 'witness-active'
  | 'witness-fallback'
  | 'biometric-fallback'
  | 'preparing-offer'
  | 'offer-sent'
  | 'offer-received'

class VrcFlowStore extends EventEmitter {
  private flowStatus: Map<string, VrcFlowStatus> = new Map()
  private isWitnessed: Map<string, boolean> = new Map()
  private hasReceivedOffer: Map<string, boolean> = new Map()
  private hasSentOffer: Map<string, boolean> = new Map()
  private flowErrors: Map<string, VrcFlowError> = new Map()

  setStatus(connectionId: string, status: VrcFlowStatus, witnessed: boolean = false): void {
    this.flowStatus.set(connectionId, status)
    if (witnessed || status === 'witness-active') {
      this.isWitnessed.set(connectionId, true)
    }
    // Track offer sent/received for bidirectional exchange completion detection
    if (status === 'offer-received') {
      this.hasReceivedOffer.set(connectionId, true)
    }
    if (status === 'offer-sent') {
      this.hasSentOffer.set(connectionId, true)
    }
    // Clear any existing error when status changes (unless it's an error trigger)
    this.flowErrors.delete(connectionId)
    this.emit('flowUpdate', { connectionId, status })
  }

  getStatus(connectionId: string): VrcFlowStatus {
    return this.flowStatus.get(connectionId) || 'idle'
  }

  isWitnessedFlow(connectionId: string): boolean {
    return this.isWitnessed.get(connectionId) || false
  }

  /**
   * Check if the bidirectional VRC exchange is complete.
   * The exchange is complete when we've both sent AND received an offer.
   * This handles the case where parties receive offers in different orders:
   * - Party A (scanner): sends first, receives second → ends at 'offer-received'
   * - Party B (QR display): receives first, sends second → ends at 'offer-sent'
   */
  isExchangeComplete(connectionId: string): boolean {
    return this.hasReceivedOffer.get(connectionId) === true && this.hasSentOffer.get(connectionId) === true
  }

  /**
   * Mark that we received the counterparty's offer without changing flow status.
   * Used when an offer arrives during an active witness flow so the overlay stays up.
   */
  markOfferReceived(connectionId: string): void {
    this.hasReceivedOffer.set(connectionId, true)
    this.emit('flowUpdate', { connectionId, status: this.getStatus(connectionId) })
  }

  /**
   * Check if we've already received the counterparty's offer.
   * Used to determine if overlay should clear on 'offer-sent'.
   */
  hasReceivedOfferFlag(connectionId: string): boolean {
    return this.hasReceivedOffer.get(connectionId) || false
  }

  /**
   * Set an error state for a connection's VRC flow.
   * This triggers the WitnessErrorDialog to display.
   *
   * @param connectionId - The connection experiencing the error
   * @param error - Error details including type, message, and callbacks
   */
  setError(connectionId: string, error: Omit<VrcFlowError, 'timestamp'>): void {
    const fullError: VrcFlowError = {
      ...error,
      timestamp: new Date(),
    }
    this.flowErrors.set(connectionId, fullError)
    this.emit('flowError', { connectionId, error: fullError })
  }

  /**
   * Get the current error state for a connection
   */
  getError(connectionId: string): VrcFlowError | undefined {
    return this.flowErrors.get(connectionId)
  }

  /**
   * Check if there's an active error for any connection
   */
  hasAnyError(): boolean {
    return this.flowErrors.size > 0
  }

  /**
   * Get all connections with errors
   */
  getErrorConnections(): string[] {
    return Array.from(this.flowErrors.keys())
  }

  /**
   * Clear the error state for a connection
   */
  clearError(connectionId: string): void {
    this.flowErrors.delete(connectionId)
    this.emit('flowErrorCleared', { connectionId })
  }

  clearFlow(connectionId: string): void {
    this.flowStatus.delete(connectionId)
    this.isWitnessed.delete(connectionId)
    this.hasReceivedOffer.delete(connectionId)
    this.hasSentOffer.delete(connectionId)
    const hadError = this.flowErrors.has(connectionId)
    this.flowErrors.delete(connectionId)
    if (hadError) {
      this.emit('flowErrorCleared', { connectionId })
    }
    this.emit('flowUpdate', { connectionId, status: 'idle' })
  }
}

export const vrcFlowStore = new VrcFlowStore()

class WitnessStatusStore extends EventEmitter {
  private messages: Map<string, WitnessStatusMessage[]> = new Map()

  /**
   * Add a witness status message for a connection
   */
  addStatus(connectionId: string, status: Omit<WitnessStatusMessage, 'id' | 'timestamp'>): void {
    const message: WitnessStatusMessage = {
      ...status,
      id: `witness-status-${Date.now()}-${Math.random()}`,
      timestamp: new Date(),
    }

    const existing = this.messages.get(connectionId) || []
    existing.push(message)
    this.messages.set(connectionId, existing)

    this.emit('statusUpdate', { connectionId })
  }

  /**
   * Get all status messages for a connection
   */
  getStatuses(connectionId: string): WitnessStatusMessage[] {
    return this.messages.get(connectionId) || []
  }

  /**
   * Clear status messages for a connection
   */
  clearStatuses(connectionId: string): void {
    this.messages.delete(connectionId)
    this.emit('statusUpdate', { connectionId })
  }

  /**
   * Get the latest status for a connection
   */
  getLatestStatus(connectionId: string): WitnessStatusMessage | undefined {
    const statuses = this.getStatuses(connectionId)
    return statuses[statuses.length - 1]
  }
}

export const witnessStatusStore = new WitnessStatusStore()
