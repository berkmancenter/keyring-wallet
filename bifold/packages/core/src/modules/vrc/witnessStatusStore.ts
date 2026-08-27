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
 * - 'discovering': (trust-task dialect) capability query sent, awaiting the
 *   peer's supportedTypes — one mediated round trip, so a real wait
 * - 'proposed': (trust-task dialect) relationship proposal sent, awaiting the
 *   peer's consent — another mediated round trip. Both exist so the progress
 *   dialog can move during waits that previously sat on 'preparing-offer' for
 *   20-30s with nothing to show (device logs 2026-08-26).
 * - 'witness-active': Witness verification in progress
 * - 'witness-fallback': Witness unavailable, falling back to direct issuance
 * - 'biometric-fallback': Biometric failed/cancelled, issuing without hardware attestation
 * - 'preparing-offer': Witness complete, preparing credential offer
 * - 'sharing-witness-record': (trust-task dialect) sending the counterparty our
 *   witness-record bundle for verification (subtask step 7)
 * - 'offer-sent': Credential offer sent by Issuer (overlay should clear on Inviter side)
 * - 'offer-received': Credential offer received by Holder (overlay should clear on Receiver side)
 * - 'idle': No active flow
 */
export type VrcFlowStatus =
  | 'idle'
  | 'connecting'
  | 'discovering'
  | 'proposed'
  | 'witness-active'
  | 'witness-fallback'
  | 'biometric-fallback'
  | 'preparing-offer'
  | 'sharing-witness-record'
  | 'offer-sent'
  | 'offer-received'

/**
 * Which exchange dialect is driving a connection's flow — the overlay words
 * the same status machine differently for the Trust Task ceremony (no
 * "offers": a consent, a witness verification, a signed credential exchange,
 * a witness-record share) than for the legacy offer/accept flow.
 */
export type VrcFlowDialect = 'legacy' | 'trust-tasks'

/**
 * A pending relationship proposal awaiting the user's consent (the trust-task
 * dialect's consent moment: accepting the proposal, not each credential).
 */
export interface RelationshipProposalPrompt {
  connectionId: string
  exchangeId: string
  counterpartyLabel: string
}

class VrcFlowStore extends EventEmitter {
  private flowStatus: Map<string, VrcFlowStatus> = new Map()
  private isWitnessed: Map<string, boolean> = new Map()
  private hasReceivedOffer: Map<string, boolean> = new Map()
  private hasSentOffer: Map<string, boolean> = new Map()
  private flowErrors: Map<string, VrcFlowError> = new Map()
  private proposalPrompts: Map<string, RelationshipProposalPrompt> = new Map()
  private dialects: Map<string, VrcFlowDialect> = new Map()
  // The inbound R-Card (the peer's contact card, what names them locally).
  // Fired/tracked separately from the VRC completion flags above: the R-Card
  // is best-effort and never gates isExchangeComplete — the overlay only uses
  // this for a trailing "exchanging contact cards" beat after the VRC is done.
  private rcardReceive: Map<string, 'pending' | 'complete'> = new Map()

  /** Record which dialect drives this connection's flow (overlay wording). */
  setDialect(connectionId: string, dialect: VrcFlowDialect): void {
    this.dialects.set(connectionId, dialect)
  }

  getDialect(connectionId: string): VrcFlowDialect {
    return this.dialects.get(connectionId) ?? 'legacy'
  }

  /** Surface a relationship proposal for user consent ('proposalPrompt' event). */
  setProposalPrompt(prompt: RelationshipProposalPrompt): void {
    this.proposalPrompts.set(prompt.connectionId, prompt)
    this.emit('proposalPrompt', prompt)
  }

  getProposalPrompt(connectionId: string): RelationshipProposalPrompt | undefined {
    return this.proposalPrompts.get(connectionId)
  }

  /** The first pending prompt, if any — what a global consent modal renders. */
  getAnyProposalPrompt(): RelationshipProposalPrompt | undefined {
    return this.proposalPrompts.values().next().value
  }

  clearProposalPrompt(connectionId: string): void {
    this.proposalPrompts.delete(connectionId)
    this.emit('proposalPromptCleared', { connectionId })
  }

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
   * Has THIS side finished delivering its own credential ('offer-sent')?
   * In the trust-task dialect the counterparty's credential is auto-stored
   * with nothing for the user to act on, so its arrival must not tear the
   * progress dialog down while our own ceremony is still running — the
   * dialog would vanish and then reappear for the remaining steps (observed
   * on slower hardware, 2026-08-25). Legacy keeps clearing on 'offer-received':
   * there the user has an actionable offer and needs the dialog out of the way.
   */
  hasSentOfferFlag(connectionId: string): boolean {
    return this.hasSentOffer.get(connectionId) || false
  }

  /** An inbound R-Card offer arrived and is being auto-accepted. */
  markRcardReceivePending(connectionId: string): void {
    if (this.rcardReceive.get(connectionId) === 'complete') return
    this.rcardReceive.set(connectionId, 'pending')
    this.emit('flowUpdate', { connectionId, status: this.getStatus(connectionId) })
  }

  /** The peer's R-Card is stored — their real name is now resolvable. */
  markRcardReceiveComplete(connectionId: string): void {
    this.rcardReceive.set(connectionId, 'complete')
    this.emit('flowUpdate', { connectionId, status: this.getStatus(connectionId) })
  }

  isRcardReceiveComplete(connectionId: string): boolean {
    return this.rcardReceive.get(connectionId) === 'complete'
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
    this.dialects.delete(connectionId)
    this.hasReceivedOffer.delete(connectionId)
    this.hasSentOffer.delete(connectionId)
    this.rcardReceive.delete(connectionId)
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
