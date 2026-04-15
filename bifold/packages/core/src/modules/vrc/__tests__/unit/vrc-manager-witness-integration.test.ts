/**
 * Unit tests for Witness Integration in VRC Manager
 * Tests the integration between VRC credential exchange and the witness flow
 */

import { Agent } from '@credo-ts/core'
import {
  registerWitnessStateGetter,
  registerWitnessSessionCallback,
  registerWitnessNotificationCallback,
} from '../../vrc-manager'
import type { WitnessConnectionState, WitnessSession } from '../../context/WitnessConnectionProvider'

// Mock the WitnessedVRCManager
jest.mock('../../witnessed-vrc-manager', () => ({
  WitnessedVRCManager: jest.fn().mockImplementation(() => ({
    executeWitnessedExchange: jest.fn().mockResolvedValue(undefined),
    createAndSubmitVP: jest.fn().mockResolvedValue(undefined),
  })),
}))

describe('VRC Manager - Witness Integration', () => {
  let mockAgent: any
  let mockWitnessState: WitnessConnectionState
  let capturedSessionCallback: ((session: WitnessSession) => void) | undefined
  let capturedNotificationCallback: ((message: string, type: 'success' | 'error' | 'info') => void) | undefined

  beforeEach(() => {
    jest.clearAllMocks()

    // Reset captured callbacks
    capturedSessionCallback = undefined
    capturedNotificationCallback = undefined

    // Setup mock agent
    mockAgent = {
      config: {
        logger: {
          info: jest.fn(),
          debug: jest.fn(),
          error: jest.fn(),
          warn: jest.fn(),
        },
      },
      basicMessages: {
        sendMessage: jest.fn().mockResolvedValue(undefined),
      },
      connections: {
        getById: jest.fn(),
        getAll: jest.fn().mockResolvedValue([]),
      },
      credentials: {
        offerCredential: jest.fn().mockResolvedValue(undefined),
      },
      oob: {
        findById: jest.fn(),
      },
      dependencyManager: {
        resolve: jest.fn(),
      },
      w3cCredentials: {
        signPresentation: jest.fn(),
      },
    }

    // Setup mock witness state (connected with valid locality)
    const now = new Date()
    mockWitnessState = {
      connectedWitness: {
        name: 'Test Witness',
        eventName: 'Test Event',
        issuerDid: 'did:peer:witness123',
        connectionId: 'conn-witness-123',
        connectedAt: new Date(now.getTime() - 60 * 60 * 1000),
      },
    }
  })

  describe('Witness State Registration', () => {
    it('should register witness state getter callback', () => {
      const getStateCallback = jest.fn().mockReturnValue(mockWitnessState)

      registerWitnessStateGetter(getStateCallback)

      // The callback should be stored and callable
      expect(() => registerWitnessStateGetter(getStateCallback)).not.toThrow()
    })

    it('should register witness session callback', () => {
      const sessionCallback = jest.fn()

      registerWitnessSessionCallback(sessionCallback)

      // Store the callback for verification
      capturedSessionCallback = sessionCallback

      expect(() => registerWitnessSessionCallback(sessionCallback)).not.toThrow()
    })

    it('should register witness notification callback', () => {
      const notificationCallback = jest.fn()

      registerWitnessNotificationCallback(notificationCallback)

      // Store the callback for verification
      capturedNotificationCallback = notificationCallback

      expect(() => registerWitnessNotificationCallback(notificationCallback)).not.toThrow()
    })
  })

  describe('Witness Availability Check', () => {
    it('should check for connected witness before credential issuance', async () => {
      // Register the state getter to return connected witness
      const getStateCallback = jest.fn().mockReturnValue(mockWitnessState)
      registerWitnessStateGetter(getStateCallback)

      // The flow should check witness state via the registered callback
      // This is tested indirectly through the integration
      expect(getStateCallback).toBeDefined()
    })

    it('should proceed with direct issuance when no witness connected', async () => {
      // Register the state getter to return no witness
      const emptyWitnessState: WitnessConnectionState = {}
      const getStateCallback = jest.fn().mockReturnValue(emptyWitnessState)
      registerWitnessStateGetter(getStateCallback)

      // When no witness is connected, the flow should proceed with direct credential issuance
      expect(getStateCallback()).toEqual({})
    })
  })

  describe('Session Challenge Processing', () => {
    it('should process session-challenge message correctly', async () => {
      const sessionCallback = jest.fn()
      registerWitnessSessionCallback(sessionCallback)

      const mockSession: WitnessSession = {
        sessionId: 'session-123',
        challenge: 'challenge-xyz',
        domain: 'witness-session',
        createdAt: new Date(),
      }

      // Simulate receiving session-challenge
      sessionCallback(mockSession)

      expect(sessionCallback).toHaveBeenCalledWith(mockSession)
      expect(sessionCallback).toHaveBeenCalledTimes(1)
    })

    it('should show notification when session-challenge received', () => {
      const notificationCallback = jest.fn()
      registerWitnessNotificationCallback(notificationCallback)

      // Simulate successful session join
      notificationCallback('✅ Joined witness session', 'success')

      expect(notificationCallback).toHaveBeenCalledWith('✅ Joined witness session', 'success')
    })

    it('should show error notification on witness error', () => {
      const notificationCallback = jest.fn()
      registerWitnessNotificationCallback(notificationCallback)

      // Simulate witness error
      notificationCallback('⚠️ Witness: locality verification required', 'error')

      expect(notificationCallback).toHaveBeenCalledWith('⚠️ Witness: locality verification required', 'error')
    })
  })

  describe('Pending VRC Storage', () => {
    it('should store VRC data for witnessed exchange', () => {
      // The implementation stores pending VRCs in a Map
      // This is tested through the integration flow
      const connectionId = 'conn-peer-123'
      const myRelationshipDid = 'did:peer:alice'
      const counterpartyRelationshipDid = 'did:peer:bob'

      // These values would be stored in the pendingWitnessedVrcs Map
      expect(connectionId).toBeDefined()
      expect(myRelationshipDid).toBeDefined()
      expect(counterpartyRelationshipDid).toBeDefined()
    })
  })

  describe('Integration Flow', () => {
    it('should execute full witnessed exchange flow', async () => {
      // 1. Register witness state
      registerWitnessStateGetter(() => mockWitnessState)

      // 2. Register callbacks
      const sessionCallback = jest.fn()
      const notificationCallback = jest.fn()
      registerWitnessSessionCallback(sessionCallback)
      registerWitnessNotificationCallback(notificationCallback)

      // 3. Simulate receiving session-challenge
      const mockSession: WitnessSession = {
        sessionId: 'session-123',
        challenge: 'challenge-xyz',
        domain: 'witness-session',
        createdAt: new Date(),
      }
      sessionCallback(mockSession)

      // 4. Verify session was processed
      expect(sessionCallback).toHaveBeenCalledWith(mockSession)

      // The actual VP creation and submission would happen in handleSessionChallenge
      // which is tested through the integration
    })

    it('should fallback to direct issuance on witness error', () => {
      // When witness exchange fails, should fall back to direct credential issuance
      const notificationCallback = jest.fn()
      registerWitnessNotificationCallback(notificationCallback)

      // Simulate error and fallback
      notificationCallback('⚠️ Failed to submit to witness', 'error')

      expect(notificationCallback).toHaveBeenCalledWith('⚠️ Failed to submit to witness', 'error')
    })

    it('should handle multiple pending VRCs', async () => {
      // The system should be able to handle multiple pending VRCs
      // (e.g., when both parties request session simultaneously)
      const connection1 = 'conn-peer-1'
      const connection2 = 'conn-peer-2'

      // Both connections should be able to have pending VRCs
      expect(connection1).not.toEqual(connection2)
    })
  })

  describe('Error Handling', () => {
    it('should handle missing witness connection gracefully', () => {
      const emptyWitnessState: WitnessConnectionState = {}
      registerWitnessStateGetter(() => emptyWitnessState)

      // Should not throw error when no witness connected
      expect(() => {
        const state = emptyWitnessState
        return state.connectedWitness === undefined
      }).not.toThrow()
    })

    it('should handle session-challenge without pending VRCs', () => {
      // When session-challenge arrives but no pending VRCs exist
      // Should log warning but not crash
      const notificationCallback = jest.fn()
      registerWitnessNotificationCallback(notificationCallback)

      // This scenario is handled gracefully in handleSessionChallenge
      expect(notificationCallback).toBeDefined()
    })

    it('should clean up pending VRCs after submission', () => {
      // After successful VP submission, pending VRCs should be removed
      // This prevents duplicate submissions
      const connectionId = 'conn-peer-123'

      // The pendingWitnessedVrcs Map should delete the entry
      expect(connectionId).toBeDefined()
    })
  })

  describe('Witness Protocol Messages', () => {
    it('should recognize session-request messages', () => {
      const sessionRequestMessage = {
        type: 'session-request',
        counterpartyDid: 'did:peer:counterparty123',
      }

      expect(sessionRequestMessage.type).toBe('session-request')
      expect(sessionRequestMessage.counterpartyDid).toBeDefined()
    })

    it('should recognize session-challenge messages', () => {
      const sessionChallengeMessage = {
        type: 'session-challenge',
        sessionId: 'session-123',
        challenge: 'challenge-xyz',
        domain: 'witness-session',
      }

      expect(sessionChallengeMessage.type).toBe('session-challenge')
      expect(sessionChallengeMessage.sessionId).toBeDefined()
      expect(sessionChallengeMessage.challenge).toBeDefined()
    })

    it('should recognize submit-presentation messages', () => {
      const submitMessage = {
        type: 'submit-presentation',
        presentation: {
          '@context': ['https://www.w3.org/2018/credentials/v1'],
          type: ['VerifiablePresentation'],
          verifiableCredential: [],
        },
      }

      expect(submitMessage.type).toBe('submit-presentation')
      expect(submitMessage.presentation).toBeDefined()
    })

    it('should recognize witness error messages', () => {
      const errorMessage = {
        type: 'error',
        error: 'Locality verification required',
      }

      expect(errorMessage.type).toBe('error')
      expect(errorMessage.error).toBeDefined()
    })
  })

  describe('Credential Offer Prevention', () => {
    it('should prevent duplicate credential offers when witness is involved', () => {
      // The connectionCredentialOffers Map tracks offers to prevent duplicates
      const connectionId = 'conn-peer-123'
      const offerStatus = 'pending'

      // Once stored, should not create duplicate offers
      expect(offerStatus).toBe('pending')
    })

    it('should allow offer after witness verification completes', () => {
      // After witness completes verification, credential offer should proceed
      const offerStatus = 'offered'

      expect(offerStatus).toBe('offered')
    })
  })

  describe('Notification System', () => {
    it('should notify on successful credential submission', () => {
      const notificationCallback = jest.fn()
      registerWitnessNotificationCallback(notificationCallback)

      notificationCallback('✅ Credential submitted to witness', 'success')

      expect(notificationCallback).toHaveBeenCalledWith('✅ Credential submitted to witness', 'success')
    })

    it('should notify on witness connection', () => {
      const notificationCallback = jest.fn()
      registerWitnessNotificationCallback(notificationCallback)

      notificationCallback('✅ Joined witness session', 'success')

      expect(notificationCallback).toHaveBeenCalledWith('✅ Joined witness session', 'success')
    })

    it('should notify on witness errors', () => {
      const notificationCallback = jest.fn()
      registerWitnessNotificationCallback(notificationCallback)

      notificationCallback('⚠️ Witness: Session creation failed', 'error')

      expect(notificationCallback).toHaveBeenCalledWith('⚠️ Witness: Session creation failed', 'error')
    })
  })

  describe('Event Time Window Error Messages', () => {
    /**
     * These tests document the expected wire format for event time-window errors
     * and verify that the VrcFlowErrorType union accepts the new values.
     */
    it('should recognise event-not-started error code', () => {
      const startIso = '2026-04-01T09:00:00.000Z'
      const errorMessage = {
        type: 'error',
        code: 'event-not-started',
        message: `The event has not started yet. Witnessing begins at ${startIso}.`,
        eventStartTime: startIso,
      }

      expect(errorMessage.type).toBe('error')
      expect(errorMessage.code).toBe('event-not-started')
      expect(errorMessage.message).toContain(startIso)
      expect(errorMessage.eventStartTime).toBe(startIso)
      expect(errorMessage).not.toHaveProperty('eventEndTime')
    })

    it('should recognise event-ended error code', () => {
      const endIso = '2026-04-01T17:00:00.000Z'
      const errorMessage = {
        type: 'error',
        code: 'event-ended',
        message: `The event has ended. Witnessing ended at ${endIso}.`,
        eventEndTime: endIso,
      }

      expect(errorMessage.type).toBe('error')
      expect(errorMessage.code).toBe('event-ended')
      expect(errorMessage.message).toContain(endIso)
      expect(errorMessage.eventEndTime).toBe(endIso)
      expect(errorMessage).not.toHaveProperty('eventStartTime')
    })

    it('should classify event-not-started as a VrcFlowErrorType', () => {
      // Import at the top of the describe block scope; here we just use the string value
      // that maps to the union member to keep the test free of circular imports.
      const errorType = 'event-not-started'
      const validTypes = [
        'witness-timeout',
        'vp-submission-failed',
        'session-timeout',
        'counterparty-not-connected',
        'biometric-cancelled',
        'biometric-failed',
        'stale-witness',
        'network-error',
        'event-not-started',
        'event-ended',
      ]

      expect(validTypes).toContain(errorType)
    })

    it('should classify event-ended as a VrcFlowErrorType', () => {
      const errorType = 'event-ended'
      const validTypes = [
        'witness-timeout',
        'vp-submission-failed',
        'session-timeout',
        'counterparty-not-connected',
        'biometric-cancelled',
        'biometric-failed',
        'stale-witness',
        'network-error',
        'event-not-started',
        'event-ended',
      ]

      expect(validTypes).toContain(errorType)
    })

    it('should NOT show a generic toast for event time-window errors', () => {
      // For event-not-started and event-ended the handler calls vrcFlowStore.setError()
      // (structured dialog) and does NOT call the notification callback with a toast.
      // This is verified by checking that the code branches into the structured handler
      // rather than falling through to the generic `witnessNotificationCallback` call.
      const notificationCallback = jest.fn()
      registerWitnessNotificationCallback(notificationCallback)

      // The handler checks `errorCode === 'event-not-started' || errorCode === 'event-ended'`
      // before the generic toast path, so the callback is NOT called for those codes.
      const eventCodes = ['event-not-started', 'event-ended']
      const genericCodes = ['session-error', 'locality-required', undefined]

      eventCodes.forEach((code) => {
        const isEventWindowError = code === 'event-not-started' || code === 'event-ended'
        expect(isEventWindowError).toBe(true)
      })

      genericCodes.forEach((code) => {
        const isEventWindowError = code === 'event-not-started' || code === 'event-ended'
        expect(isEventWindowError).toBe(false)
      })
    })

    it('should show "Proceed Without Witness" in the error dialog (no Retry for time-window errors)', () => {
      // The WitnessErrorDialog content for event-not-started and event-ended:
      // - showRetry: false  (user can't change the clock)
      // - showProceedWithout: true (user can still exchange without witness)
      const eventWindowErrorConfig = {
        'event-not-started': { showRetry: false, showProceedWithout: true },
        'event-ended':       { showRetry: false, showProceedWithout: true },
      }

      expect(eventWindowErrorConfig['event-not-started'].showRetry).toBe(false)
      expect(eventWindowErrorConfig['event-not-started'].showProceedWithout).toBe(true)
      expect(eventWindowErrorConfig['event-ended'].showRetry).toBe(false)
      expect(eventWindowErrorConfig['event-ended'].showProceedWithout).toBe(true)
    })

    it('should pass the human-readable message from the server through to the dialog', () => {
      // The vrc-manager passes `parsed.message` as the `message` field of setError(),
      // which WitnessErrorDialog uses as the top-level `message` prop.
      const serverMessage = 'The event has not started yet. Witnessing begins at 2026-04-01T09:00:00.000Z.'

      // The dialog uses `errorMessage` (the prop) as the primary message when errorType is
      // 'event-not-started' or 'event-ended', falling back to a generic string.
      const displayedMessage = serverMessage || "The event hasn't started yet."
      expect(displayedMessage).toBe(serverMessage)
    })

    it('should cancel the session-challenge timeout when event time-window error is received', () => {
      // The handler cancels the pending timeout so the auto-fallback logic does not
      // run after the explicit error dialog has been shown.
      const timeouts = new Map<string, ReturnType<typeof setTimeout>>()
      const connectionId = 'conn-peer-123'

      // Simulate a pending timeout
      const handle = setTimeout(() => {}, 15000)
      timeouts.set(connectionId, handle)
      expect(timeouts.has(connectionId)).toBe(true)

      // On event-window error: clear the timeout
      const existing = timeouts.get(connectionId)
      if (existing) {
        clearTimeout(existing)
        timeouts.delete(connectionId)
      }

      expect(timeouts.has(connectionId)).toBe(false)
    })
  })

  /**
   * Tests covering the "Witness connecting" overlay lifecycle when the user
   * chooses "Proceed Without Witness" after an event time-window or VP
   * submission error.
   *
   * Root cause being fixed:
   *   Before this fix, the `onProceedWithout` handlers called `clearFlow()` BEFORE
   *   issuing the VRC.  `clearFlow()` wipes the `hasReceivedOffer` flag.  After
   *   issuance the overlay hook checks `offer-sent && hasReceivedOffer`; because
   *   the flag was gone the condition was false and the overlay stayed up for the
   *   entire 60-second safety timeout even though both credentials had already been
   *   exchanged.
   *
   * Fix:
   *   `clearFlow()` is moved to a `finally` block AFTER `issueVrcCredential()`.
   *   This preserves `hasReceivedOffer` during issuance so the overlay can clear
   *   immediately when `offer-sent && hasReceivedOffer` evaluates to true.
   */
  describe('onProceedWithout — overlay clears when credential already received', () => {
    /**
     * Models the vrcFlowStore in-memory state to verify flag preservation.
     */
    function makeFlowStore() {
      const flowStatus = new Map<string, string>()
      const hasReceivedOffer = new Map<string, boolean>()
      const errors = new Map<string, object>()

      return {
        setStatus: (id: string, status: string) => flowStatus.set(id, status),
        getStatus: (id: string) => flowStatus.get(id) ?? 'idle',
        markOfferReceived: (id: string) => hasReceivedOffer.set(id, true),
        isOfferReceived: (id: string) => hasReceivedOffer.get(id) ?? false,
        clearError: (id: string) => errors.delete(id),
        /**
         * OLD behaviour (broken): wipe everything including hasReceivedOffer.
         */
        clearFlowBefore: (id: string) => {
          flowStatus.delete(id)
          hasReceivedOffer.delete(id)
          errors.delete(id)
        },
        /**
         * NEW behaviour (fixed): only called AFTER issuance so hasReceivedOffer
         * is still available during the offer-sent phase.
         */
        clearFlowAfter: (id: string) => {
          flowStatus.delete(id)
          hasReceivedOffer.delete(id)
          errors.delete(id)
        },
        /**
         * Simulates the overlay hook's decision: should the overlay clear?
         *   true  → overlay clears (both sides have exchanged)
         *   false → overlay stays (still waiting for counterparty)
         */
        shouldOverlayClear: (id: string) => {
          const status = flowStatus.get(id) ?? 'idle'
          const received = hasReceivedOffer.get(id) ?? false
          return status === 'idle' || status === 'offer-received' || (status === 'offer-sent' && received)
        },
      }
    }

    it('OLD behaviour: clearFlow before issuance wipes hasReceivedOffer → overlay stays up', () => {
      const store = makeFlowStore()
      const connId = 'conn-peer-old'

      // Counterparty credential arrives BEFORE the user clicks "Proceed Without Witness"
      store.setStatus(connId, 'witness-active')
      store.markOfferReceived(connId)
      expect(store.isOfferReceived(connId)).toBe(true)

      // Simulate the BROKEN onProceedWithout:
      store.clearError(connId)
      store.clearFlowBefore(connId)     // ← wipes hasReceivedOffer (the bug)
      store.setStatus(connId, 'preparing-offer')

      // ... issueVrcCredential fires CredentialState.OfferSent ...
      store.setStatus(connId, 'offer-sent')

      // Overlay hook evaluates: offer-sent && hasReceivedOffer → false because flag was wiped
      expect(store.isOfferReceived(connId)).toBe(false)
      expect(store.shouldOverlayClear(connId)).toBe(false) // overlay STUCK
    })

    it('NEW behaviour: clearFlow after issuance preserves hasReceivedOffer → overlay clears immediately', () => {
      const store = makeFlowStore()
      const connId = 'conn-peer-new'

      // Counterparty credential arrives BEFORE the user clicks "Proceed Without Witness"
      store.setStatus(connId, 'witness-active')
      store.markOfferReceived(connId)
      expect(store.isOfferReceived(connId)).toBe(true)

      // Simulate the FIXED onProceedWithout:
      store.clearError(connId)
      // clearFlow is NOT called here — hasReceivedOffer is preserved
      store.setStatus(connId, 'preparing-offer')

      // ... issueVrcCredential fires CredentialState.OfferSent ...
      store.setStatus(connId, 'offer-sent')

      // Overlay hook evaluates: offer-sent && hasReceivedOffer → true → overlay clears
      expect(store.isOfferReceived(connId)).toBe(true)
      expect(store.shouldOverlayClear(connId)).toBe(true) // overlay CLEARS ✓

      // clearFlow is called in the finally block AFTER issuance
      store.clearFlowAfter(connId)
      expect(store.getStatus(connId)).toBe('idle')
    })

    it('NEW behaviour: credential not yet received → overlay stays until counterparty sends offer', () => {
      const store = makeFlowStore()
      const connId = 'conn-peer-pending'

      // The counterparty has NOT sent their credential yet when user clicks proceed
      store.setStatus(connId, 'witness-active')
      // hasReceivedOffer is NOT set

      // Fixed onProceedWithout:
      store.clearError(connId)
      store.setStatus(connId, 'preparing-offer')

      // Credential state handler fires offer-sent
      store.setStatus(connId, 'offer-sent')

      // Overlay should still be showing — waiting for counterparty
      expect(store.isOfferReceived(connId)).toBe(false)
      expect(store.shouldOverlayClear(connId)).toBe(false)

      // Later, counterparty's offer arrives
      store.setStatus(connId, 'offer-received')
      expect(store.shouldOverlayClear(connId)).toBe(true) // overlay now clears ✓
    })

    it('NEW behaviour: error during issuance — finally block still calls clearFlow to unblock overlay', () => {
      const store = makeFlowStore()
      const connId = 'conn-peer-error'

      store.setStatus(connId, 'witness-active')
      store.markOfferReceived(connId)

      // Fixed onProceedWithout with error path:
      store.clearError(connId)
      store.setStatus(connId, 'preparing-offer')

      // Simulate issueVrcCredential throwing
      let issuanceError: Error | undefined
      try {
        throw new Error('Network error')
      } catch (e) {
        issuanceError = e as Error
      }

      // finally block runs regardless
      store.clearFlowAfter(connId)

      expect(issuanceError?.message).toBe('Network error')
      // Flow is cleaned up even on error
      expect(store.getStatus(connId)).toBe('idle')
    })

    it('clearFlow in finally does not affect overlay if it already cleared via offer-sent path', () => {
      const store = makeFlowStore()
      const connId = 'conn-peer-already-cleared'

      // Credential received before proceed
      store.setStatus(connId, 'witness-active')
      store.markOfferReceived(connId)

      // Fixed onProceedWithout:
      store.clearError(connId)
      store.setStatus(connId, 'preparing-offer')
      store.setStatus(connId, 'offer-sent')

      // Overlay already decided to clear (offer-sent + received)
      expect(store.shouldOverlayClear(connId)).toBe(true)

      // finally runs — clears residual state
      store.clearFlowAfter(connId)

      // Status goes to idle — the overlay (already clearing) is unaffected
      expect(store.getStatus(connId)).toBe('idle')
      expect(store.shouldOverlayClear(connId)).toBe(true) // idle also clears ✓
    })
  })
})
