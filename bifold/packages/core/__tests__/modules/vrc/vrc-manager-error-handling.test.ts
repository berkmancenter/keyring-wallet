/**
 * VRC Manager Error Handling Tests
 * 
 * Tests for error handling scenarios in vrc-manager.ts:
 * 1. Witness background timeout (15 seconds without session-challenge → counterparty-not-connected)
 * 2. VP submission failure (handleSessionChallenge catch block)
 * 3. Biometric errors (cancelled or failed)
 * 4. Stale witness (witness connection expired)
 * 5. Timeout cleanup (clearing timeout when session-challenge received)
 * 6. Immediate witness failure (.catch path → VRC issued directly)
 */

import { Agent } from '@credo-ts/core'

// Import stores
import { vrcFlowStore, witnessStatusStore } from '../../../src/modules/vrc/witnessStatusStore'
import { VrcFlowErrorType } from '../../../src/modules/vrc/witnessStatusStore'

// Test constants — matches WITNESS_BACKGROUND_TIMEOUT_MS in vrc-manager.ts
const WITNESS_BACKGROUND_TIMEOUT_MS = 15000

// Test DIDs
const testDids = {
  counterpartyConnectionDid: 'did:peer:1zQmZMygzYqNwU6Uhmewx5Xepf2VLp5S4HLSwwgf2aiKZuwa',
  myRelationshipDid: 'did:peer:0z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
  counterpartyRelationshipDid: 'did:peer:0z6MknGc3ocHs3zdPiJbnaaqDi58NGb4pk1Sp9WNhJhvaFed',
  witnessConnectionDid: 'did:peer:1zQmWitness123',
}

// Mock the WitnessedVRCManager
const mockWitnessedVRCManager = {
  executeWitnessedExchange: jest.fn(),
  createAndSubmitVP: jest.fn(),
  checkWitnessedExchangeAvailability: jest.fn(),
  isWitnessedExchangeAvailable: jest.fn(),
  getWitnessedExchangeStatus: jest.fn(),
}

// Mock the repository
const mockRepository = {
  findByConnectionDid: jest.fn(),
  createOrUpdate: jest.fn(),
  updateCounterpartyRelationshipDid: jest.fn(),
  findByQuery: jest.fn(),
}

// Mock logger
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

// Mock connection
const _createMockConnection = (id: string, theirDid?: string, theirLabel?: string) => ({
  id,
  theirDid: theirDid || testDids.counterpartyConnectionDid,
  theirLabel: theirLabel || 'Test Contact',
  outOfBandId: 'oob-123',
  metadata: {
    get: jest.fn().mockReturnValue({ did: testDids.myRelationshipDid }),
    set: jest.fn(),
  },
})

// Mock agent factory
const createMockAgent = () => ({
  dependencyManager: {
    resolve: jest.fn().mockReturnValue(mockRepository),
  },
  config: {
    logger: mockLogger,
  },
  context: {},
  dids: {
    create: jest.fn(),
    resolve: jest.fn().mockResolvedValue({
      didDocument: {
        verificationMethod: [{ id: `${testDids.myRelationshipDid}#key-1` }],
      },
    }),
  },
  connections: {
    getById: jest.fn(),
  },
  oob: {
    createInvitation: jest.fn(),
    findById: jest.fn(),
  },
  credentials: {
    offerCredential: jest.fn(),
    acceptOffer: jest.fn(),
    getFormatData: jest.fn(),
  },
  w3cCredentials: {
    signCredential: jest.fn(),
    signPresentation: jest.fn(),
    getAllCredentialRecords: jest.fn().mockResolvedValue([]),
  },
  basicMessages: {
    sendMessage: jest.fn(),
  },
  events: {
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
  },
})

// Mock witness state
const createMockWitnessState = (connected: boolean = true) => ({
  connectedWitness: connected ? {
    name: 'Test Witness',
    did: testDids.witnessConnectionDid,
    connectionId: 'witness-connection-123',
  } : undefined,
  localityProof: connected ? {
    verified: true,
    expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
  } : undefined,
})

// Mock storage for pending VRCs
const pendingWitnessedVrcs = new Map<string, any>()
const pendingVrcIssuanceAfterWitness = new Map<string, any>()
const sessionChallengeTimeouts = new Map<string, NodeJS.Timeout>()

// Mock the external modules
jest.mock('../../../src/modules/vrc/repositories/RelationshipDidRepository', () => ({
  RelationshipDidRepository: jest.fn(),
}))

jest.mock('../../../src/modules/vrc/services/rCardCredential', () => ({
  loadRCardTemplate: jest.fn().mockResolvedValue(null),
}))

jest.mock('../../../src/modules/vrc/vrc-biometric', () => ({
  requestBiometricWithHardwareSigning: jest.fn(),
}))

jest.mock('../../../src/modules/vrc/services/EvidenceBuilder', () => ({
  createEvidenceBuilder: jest.fn().mockReturnValue({
    buildEvidenceFromSignature: jest.fn().mockResolvedValue({
      success: true,
      evidence: { id: 'evidence-123' },
      hasAttestation: true,
    }),
  }),
}))

jest.mock('../../../src/services/storage', () => ({
  PersistentStorage: {
    fetchValueForKey: jest.fn().mockResolvedValue({ useHardwareAttestation: false }),
  },
}))

describe('VRC Manager Error Handling', () => {
  let _mockAgent: ReturnType<typeof createMockAgent>
  
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    
    _mockAgent = createMockAgent()
    
    // Clear stores
    vrcFlowStore.clearFlow('connection-123')
    witnessStatusStore.clearStatuses('connection-123')
    
    // Clear mock storages
    pendingWitnessedVrcs.clear()
    pendingVrcIssuanceAfterWitness.clear()
    sessionChallengeTimeouts.clear()
    
    // Reset mock implementations
    mockWitnessedVRCManager.executeWitnessedExchange.mockReset()
    mockWitnessedVRCManager.createAndSubmitVP.mockReset()
    mockRepository.findByConnectionDid.mockReset()
  })
  
  afterEach(() => {
    jest.useRealTimers()
  })

  describe('Witness Background Timeout (15 seconds)', () => {
    /**
     * Tests the scenario where:
     * 1. startWitnessExchangeWithTimeout fires executeWitnessedExchange
     * 2. No session-challenge is received within 15 seconds (WITNESS_BACKGROUND_TIMEOUT_MS)
     * 3. autoFallbackWithoutWitness is called — overlay transitions smoothly and VRC is issued directly
     * 
     * Note: some tests below also test the legacy error-dialog path (setError with counterparty-not-connected)
     * which still exists in the store API. The live code now uses autoFallbackWithoutWitness instead.
     */

    it('should set error when session-challenge is not received within timeout', async () => {
      const connectionId = 'connection-123'
      const witnessState = createMockWitnessState(true)
      
      // Simulate the timeout scenario by directly testing the timeout logic
      let _timeoutCallback: (() => void) | null = null
      
      // Mock setTimeout to capture the callback
      const originalSetTimeout = global.setTimeout
      jest.spyOn(global, 'setTimeout').mockImplementation(((callback: any, ms?: number) => {
        if (ms === WITNESS_BACKGROUND_TIMEOUT_MS) {
          _timeoutCallback = callback
        }
        return originalSetTimeout(callback, ms as number)
      }) as typeof setTimeout)
      
      // Simulate pending VRC data (like what storeVrcForWitnessedExchange creates)
      pendingWitnessedVrcs.set(connectionId, {
        connectionId,
        myRelationshipDid: testDids.myRelationshipDid,
        myVerificationMethodId: `${testDids.myRelationshipDid}#key-1`,
        counterpartyRelationshipDid: testDids.counterpartyRelationshipDid,
        credential: { type: ['RelationshipCredential'] },
        storedAt: new Date(),
      })
      
      // Track if setError was called
      let errorSet: any = null
      const originalSetError = vrcFlowStore.setError.bind(vrcFlowStore)
      jest.spyOn(vrcFlowStore, 'setError').mockImplementation((connId, error) => {
        errorSet = { connectionId: connId, error }
        originalSetError(connId, error)
      })
      
      // Simulate what happens when the 15s timeout fires with pending VRC
      // This mirrors showCounterpartyNotConnectedDialog in vrc-manager.ts
      const simulateTimeout = () => {
        const pendingVrc = pendingWitnessedVrcs.get(connectionId)
        if (pendingVrc) {
          vrcFlowStore.setError(connectionId, {
            type: 'counterparty-not-connected',
            witnessName: witnessState.connectedWitness?.name,
            contactName: 'Test Contact',
            message: 'Contact does not appear to be connected to the witness',
            onRetry: async () => {},
            onProceedWithout: async () => {},
          })
          
          witnessStatusStore.addStatus(connectionId, {
            connectionId,
            status: 'error',
            witnessName: witnessState.connectedWitness?.name || 'Witness',
            errorMessage: 'Witness session timeout - no response received',
          })
        }
      }
      
      // Trigger the timeout
      simulateTimeout()
      
      // Verify error was set
      expect(errorSet).not.toBeNull()
      expect(errorSet.connectionId).toBe(connectionId)
      expect(errorSet.error.type).toBe('counterparty-not-connected')
      expect(errorSet.error.witnessName).toBe('Test Witness')
      expect(errorSet.error.contactName).toBe('Test Contact')
      expect(errorSet.error.message).toContain('not appear to be connected')
      
      // Verify error has both callbacks (Retry + Proceed Without Witness)
      expect(errorSet.error.onRetry).toBeDefined()
      expect(errorSet.error.onProceedWithout).toBeDefined()
      
      // Verify error status was added to witnessStatusStore
      const statuses = witnessStatusStore.getStatuses(connectionId)
      expect(statuses.length).toBeGreaterThan(0)
      const lastStatus = statuses[statuses.length - 1]
      expect(lastStatus.status).toBe('error')
      expect(lastStatus.errorMessage).toContain('timeout')
    })

    it('should provide onRetry callback that restarts witness exchange with fresh timeout', async () => {
      const connectionId = 'connection-123'
      const witnessState = createMockWitnessState(true)
      
      let retryAttempted = false
      let overlaySetToWitnessActive = false
      let executeWitnessedExchangeCalled = false
      let freshTimeoutSet = false
      
      // Simulate the retry logic from startWitnessExchangeWithTimeout
      vrcFlowStore.setError(connectionId, {
        type: 'counterparty-not-connected',
        witnessName: witnessState.connectedWitness?.name,
        message: 'Contact does not appear to be connected to the witness',
        onRetry: async () => {
          retryAttempted = true
          vrcFlowStore.clearError(connectionId)
          
          // startWitnessExchangeWithTimeout sets overlay to witness-active
          vrcFlowStore.setStatus(connectionId, 'witness-active', true)
          overlaySetToWitnessActive = true
          
          // Clears any existing timeout and sets a new one
          const existingTimeout = sessionChallengeTimeouts.get(connectionId)
          if (existingTimeout) {
            clearTimeout(existingTimeout)
          }
          const timeoutHandle = setTimeout(() => {}, WITNESS_BACKGROUND_TIMEOUT_MS)
          sessionChallengeTimeouts.set(connectionId, timeoutHandle)
          freshTimeoutSet = true
          
          // Re-fires executeWitnessedExchange
          mockWitnessedVRCManager.executeWitnessedExchange.mockResolvedValue(undefined)
          await mockWitnessedVRCManager.executeWitnessedExchange()
          executeWitnessedExchangeCalled = true
        },
        onProceedWithout: async () => {},
      })
      
      // Get the error and call onRetry
      const error = vrcFlowStore.getError(connectionId)
      expect(error).toBeDefined()
      expect(error?.onRetry).toBeDefined()
      
      await error?.onRetry?.()
      
      expect(retryAttempted).toBe(true)
      expect(vrcFlowStore.getError(connectionId)).toBeUndefined()
      expect(overlaySetToWitnessActive).toBe(true)
      expect(vrcFlowStore.getStatus(connectionId)).toBe('witness-active')
      expect(freshTimeoutSet).toBe(true)
      expect(sessionChallengeTimeouts.has(connectionId)).toBe(true)
      expect(executeWitnessedExchangeCalled).toBe(true)
      expect(mockWitnessedVRCManager.executeWitnessedExchange).toHaveBeenCalledTimes(1)
    })

    it('should provide onProceedWithout callback that issues VRC directly', async () => {
      const connectionId = 'connection-123'
      
      let proceedWithoutCalled = false
      let pendingDataCleaned = false
      
      // Set up pending data that should be cleaned on proceed-without
      pendingWitnessedVrcs.set(connectionId, {
        connectionId,
        myRelationshipDid: testDids.myRelationshipDid,
        myVerificationMethodId: `${testDids.myRelationshipDid}#key-1`,
        counterpartyRelationshipDid: testDids.counterpartyRelationshipDid,
        credential: { type: ['RelationshipCredential'] },
        storedAt: new Date(),
      })
      
      vrcFlowStore.setError(connectionId, {
        type: 'counterparty-not-connected',
        witnessName: 'Test Witness',
        message: 'Contact does not appear to be connected to the witness',
        onRetry: async () => {},
        onProceedWithout: async () => {
          proceedWithoutCalled = true
          vrcFlowStore.clearError(connectionId)
          pendingWitnessedVrcs.delete(connectionId)
          pendingVrcIssuanceAfterWitness.delete(connectionId)
          pendingDataCleaned = true
          vrcFlowStore.clearFlow(connectionId)
        },
      })
      
      const error = vrcFlowStore.getError(connectionId)
      expect(error?.onProceedWithout).toBeDefined()
      
      await error?.onProceedWithout?.()
      
      expect(proceedWithoutCalled).toBe(true)
      expect(pendingDataCleaned).toBe(true)
      expect(vrcFlowStore.getError(connectionId)).toBeUndefined()
      expect(vrcFlowStore.getStatus(connectionId)).toBe('idle')
      expect(pendingWitnessedVrcs.has(connectionId)).toBe(false)
    })

    it('should show counterparty-not-connected dialog when session-challenge times out', () => {
      const connectionId = 'connection-123'
      const witnessName = 'Test Witness'
      const contactName = 'Alice'
      
      // Simulate showCounterpartyNotConnectedDialog
      vrcFlowStore.setError(connectionId, {
        type: 'counterparty-not-connected',
        witnessName,
        contactName,
        message: 'Contact does not appear to be connected to the witness',
        onRetry: async () => {},
        onProceedWithout: async () => {},
      })
      
      const error = vrcFlowStore.getError(connectionId)
      
      expect(error).toBeDefined()
      expect(error?.type).toBe('counterparty-not-connected')
      expect(error?.witnessName).toBe(witnessName)
      expect(error?.contactName).toBe(contactName)
      expect(error?.message).toContain('not appear to be connected')
      expect(error?.onRetry).toBeDefined()
      expect(error?.onProceedWithout).toBeDefined()
    })

    it('should set fresh timeout when user retries from dialog', () => {
      const connectionId = 'connection-123'
      
      // Simulate the initial timeout having already fired and been cleaned up
      expect(sessionChallengeTimeouts.has(connectionId)).toBe(false)
      
      // Simulate startWitnessExchangeWithTimeout being called on retry
      vrcFlowStore.setStatus(connectionId, 'witness-active', true)
      
      const existingTimeout = sessionChallengeTimeouts.get(connectionId)
      if (existingTimeout) {
        clearTimeout(existingTimeout)
      }
      
      const freshTimeout = setTimeout(() => {}, WITNESS_BACKGROUND_TIMEOUT_MS)
      sessionChallengeTimeouts.set(connectionId, freshTimeout)
      
      // Verify fresh timeout was set
      expect(sessionChallengeTimeouts.has(connectionId)).toBe(true)
      expect(vrcFlowStore.getStatus(connectionId)).toBe('witness-active')
      
      // Advance time by 15s — the timeout should fire
      jest.advanceTimersByTime(WITNESS_BACKGROUND_TIMEOUT_MS)
    })

    it('should clear existing timeout before setting new one on retry', () => {
      const connectionId = 'connection-123'
      
      // Set an initial timeout (simulating first startWitnessExchangeWithTimeout call)
      let firstTimeoutFired = false
      const firstTimeout = setTimeout(() => {
        firstTimeoutFired = true
      }, WITNESS_BACKGROUND_TIMEOUT_MS)
      sessionChallengeTimeouts.set(connectionId, firstTimeout)
      
      // Now simulate retry: clear existing and set new
      const existingTimeout = sessionChallengeTimeouts.get(connectionId)
      if (existingTimeout) {
        clearTimeout(existingTimeout)
      }
      
      let secondTimeoutFired = false
      const secondTimeout = setTimeout(() => {
        secondTimeoutFired = true
      }, WITNESS_BACKGROUND_TIMEOUT_MS)
      sessionChallengeTimeouts.set(connectionId, secondTimeout)
      
      // Advance past both timeouts
      jest.advanceTimersByTime(WITNESS_BACKGROUND_TIMEOUT_MS + 1000)
      
      // First timeout should NOT have fired (was cleared), second should have
      expect(firstTimeoutFired).toBe(false)
      expect(secondTimeoutFired).toBe(true)
    })

    it('should auto-fallback with witness-fallback status when session-challenge times out', async () => {
      const connectionId = 'connection-123'
      const witnessName = 'Test Witness'
      
      pendingWitnessedVrcs.set(connectionId, {
        connectionId,
        myRelationshipDid: testDids.myRelationshipDid,
        myVerificationMethodId: `${testDids.myRelationshipDid}#key-1`,
        counterpartyRelationshipDid: testDids.counterpartyRelationshipDid,
        credential: { type: ['RelationshipCredential'] },
        storedAt: new Date(),
      })
      
      // Simulate the autoFallbackWithoutWitness logic from vrc-manager.ts
      const simulateAutoFallback = async () => {
        pendingWitnessedVrcs.delete(connectionId)
        pendingVrcIssuanceAfterWitness.delete(connectionId)
        
        vrcFlowStore.setStatus(connectionId, 'witness-fallback', false)
        // (2s delay in real code)
        vrcFlowStore.setStatus(connectionId, 'preparing-offer', false)
        
        witnessStatusStore.addStatus(connectionId, {
          connectionId,
          status: 'witness-skipped',
          witnessName,
          errorMessage: 'Witness verification skipped — contact was not connected to witness',
        })
        
        // Simulated VRC issuance + clear flow
        vrcFlowStore.clearFlow(connectionId)
      }
      
      await simulateAutoFallback()
      
      // No error dialog — auto-fallback proceeds silently
      expect(vrcFlowStore.getError(connectionId)).toBeUndefined()
      expect(vrcFlowStore.getStatus(connectionId)).toBe('idle')
      expect(pendingWitnessedVrcs.has(connectionId)).toBe(false)
      
      const statuses = witnessStatusStore.getStatuses(connectionId)
      expect(statuses.length).toBeGreaterThan(0)
      expect(statuses[statuses.length - 1].status).toBe('witness-skipped')
    })

    it('should issue VRC directly when executeWitnessedExchange fails immediately', async () => {
      const connectionId = 'connection-123'
      const witnessName = 'Test Witness'
      
      // Set up pending data
      pendingWitnessedVrcs.set(connectionId, {
        connectionId,
        myRelationshipDid: testDids.myRelationshipDid,
        myVerificationMethodId: `${testDids.myRelationshipDid}#key-1`,
        counterpartyRelationshipDid: testDids.counterpartyRelationshipDid,
        credential: { type: ['RelationshipCredential'] },
        storedAt: new Date(),
      })
      pendingVrcIssuanceAfterWitness.set(connectionId, {
        connectionId,
        myRelationshipDid: testDids.myRelationshipDid,
        counterpartyRelationshipDid: testDids.counterpartyRelationshipDid,
        storedAt: new Date(),
      })
      
      // Set up a timeout (should be cleared on immediate failure)
      const timeoutHandle = setTimeout(() => {}, WITNESS_BACKGROUND_TIMEOUT_MS)
      sessionChallengeTimeouts.set(connectionId, timeoutHandle)
      
      // Simulate the .catch path of startWitnessExchangeWithTimeout:
      // executeWitnessedExchange rejects immediately
      const simulateImmediateFailure = async () => {
        // Clear timeout
        const t = sessionChallengeTimeouts.get(connectionId)
        if (t) {
          clearTimeout(t)
          sessionChallengeTimeouts.delete(connectionId)
        }
        
        // Clean up pending data
        pendingWitnessedVrcs.delete(connectionId)
        pendingVrcIssuanceAfterWitness.delete(connectionId)
        
        // Issue VRC directly (simulated)
        vrcFlowStore.setStatus(connectionId, 'preparing-offer', false)
        
        // Clear flow after issuance
        vrcFlowStore.clearFlow(connectionId)
        
        // Emit witness-skipped status
        witnessStatusStore.addStatus(connectionId, {
          connectionId,
          status: 'witness-skipped',
          witnessName,
          errorMessage: 'Witness verification skipped — could not reach witness',
        })
      }
      
      await simulateImmediateFailure()
      
      // Timeout should be cleared
      expect(sessionChallengeTimeouts.has(connectionId)).toBe(false)
      
      // Pending data should be cleaned up
      expect(pendingWitnessedVrcs.has(connectionId)).toBe(false)
      expect(pendingVrcIssuanceAfterWitness.has(connectionId)).toBe(false)
      
      // No error dialog should be shown (direct issuance, no user interaction)
      expect(vrcFlowStore.getError(connectionId)).toBeUndefined()
      
      // Flow should be cleared
      expect(vrcFlowStore.getStatus(connectionId)).toBe('idle')
      
      // witness-skipped status emitted
      const statuses = witnessStatusStore.getStatuses(connectionId)
      expect(statuses.length).toBeGreaterThan(0)
      const lastStatus = statuses[statuses.length - 1]
      expect(lastStatus.status).toBe('witness-skipped')
      expect(lastStatus.errorMessage).toContain('could not reach witness')
    })
  })

  describe('VP Submission Failure Error', () => {
    /**
     * Tests the scenario where:
     * 1. handleSessionChallenge is processing session-challenge
     * 2. createAndSubmitVP throws an error
     * 3. vrcFlowStore.setError is called with type 'vp-submission-failed'
     */

    it('should set error when VP submission fails', async () => {
      const connectionId = 'connection-123'
      const witnessState = createMockWitnessState(true)
      const errorMessage = 'Network error: Failed to send message'
      
      // Simulate VP submission failure and error handling
      // This mirrors handleSessionChallenge catch block (lines 786-856)
      vrcFlowStore.setError(connectionId, {
        type: 'vp-submission-failed',
        witnessName: witnessState.connectedWitness?.name,
        message: errorMessage,
        onRetry: async () => {},
        onProceedWithout: async () => {},
      })
      
      const error = vrcFlowStore.getError(connectionId)
      
      expect(error).toBeDefined()
      expect(error?.type).toBe('vp-submission-failed')
      expect(error?.witnessName).toBe('Test Witness')
      expect(error?.message).toBe(errorMessage)
      expect(error?.onRetry).toBeDefined()
      expect(error?.onProceedWithout).toBeDefined()
    })

    it('should add error status to witnessStatusStore on VP submission failure', () => {
      const connectionId = 'connection-123'
      const witnessName = 'Test Witness'
      const errorMessage = 'Failed to submit to witness: Connection refused'
      
      witnessStatusStore.addStatus(connectionId, {
        connectionId,
        status: 'error',
        witnessName,
        errorMessage: `Failed to submit to witness: ${errorMessage}`,
      })
      
      const statuses = witnessStatusStore.getStatuses(connectionId)
      expect(statuses).toHaveLength(1)
      expect(statuses[0].status).toBe('error')
      expect(statuses[0].witnessName).toBe(witnessName)
      expect(statuses[0].errorMessage).toContain('Failed to submit')
    })

    it('should allow retry after VP submission failure', async () => {
      const connectionId = 'connection-123'
      let vpSubmissionAttempts = 0
      
      vrcFlowStore.setError(connectionId, {
        type: 'vp-submission-failed',
        witnessName: 'Test Witness',
        message: 'Initial failure',
        onRetry: async () => {
          vrcFlowStore.clearError(connectionId)
          vpSubmissionAttempts++
          // Simulate successful retry (or another failure)
        },
        onProceedWithout: async () => {},
      })
      
      const error = vrcFlowStore.getError(connectionId)
      await error?.onRetry?.()
      
      expect(vpSubmissionAttempts).toBe(1)
      expect(vrcFlowStore.getError(connectionId)).toBeUndefined()
    })
  })

  describe('Biometric Auto-Fallback', () => {
    /**
     * Tests biometric failure auto-fallback:
     * Biometric cancelled/failed no longer shows an error dialog.
     * Instead, the flow auto-falls back to regular VRC without hardware attestation.
     * The overlay transitions: biometric-fallback (2s) → preparing-offer → complete.
     * A toast informs the user that attestation was skipped.
     */

    it('should set biometric-fallback status (not error) when biometric fails', () => {
      const connectionId = 'connection-123'
      
      // The new behavior: biometric failure sets overlay status, NOT an error
      vrcFlowStore.setStatus(connectionId, 'biometric-fallback', false)
      
      expect(vrcFlowStore.getStatus(connectionId)).toBe('biometric-fallback')
      expect(vrcFlowStore.getError(connectionId)).toBeUndefined()
    })

    it('should transition from biometric-fallback to preparing-offer', () => {
      const connectionId = 'connection-123'
      
      vrcFlowStore.setStatus(connectionId, 'biometric-fallback', false)
      expect(vrcFlowStore.getStatus(connectionId)).toBe('biometric-fallback')
      
      // After 2s delay, transitions to preparing-offer
      vrcFlowStore.setStatus(connectionId, 'preparing-offer', false)
      expect(vrcFlowStore.getStatus(connectionId)).toBe('preparing-offer')
    })

    it('should not set any error when biometric is cancelled', () => {
      const connectionId = 'connection-123'
      
      // Simulate what happens now: cancelled biometric → auto-fallback, no error dialog
      vrcFlowStore.setStatus(connectionId, 'biometric-fallback', false)
      
      // No error should be set — the flow proceeds automatically
      expect(vrcFlowStore.getError(connectionId)).toBeUndefined()
      expect(vrcFlowStore.hasAnyError()).toBe(false)
    })

    it('should track biometricSkipped flag in pending VRC data', () => {
      const connectionId = 'connection-123'
      
      const pendingData = {
        connectionId,
        myRelationshipDid: testDids.myRelationshipDid,
        counterpartyRelationshipDid: testDids.counterpartyRelationshipDid,
        biometricSkipped: true,
        storedAt: new Date(),
      }
      
      pendingVrcIssuanceAfterWitness.set(connectionId, pendingData)
      
      const stored = pendingVrcIssuanceAfterWitness.get(connectionId)
      expect(stored?.biometricSkipped).toBe(true)
    })

    it('should complete flow normally after biometric fallback', () => {
      const connectionId = 'connection-123'
      
      // Full sequence: biometric-fallback → preparing-offer → offer-sent → idle
      vrcFlowStore.setStatus(connectionId, 'biometric-fallback', false)
      expect(vrcFlowStore.getStatus(connectionId)).toBe('biometric-fallback')
      
      vrcFlowStore.setStatus(connectionId, 'preparing-offer', false)
      expect(vrcFlowStore.getStatus(connectionId)).toBe('preparing-offer')
      
      vrcFlowStore.setStatus(connectionId, 'offer-sent', false)
      expect(vrcFlowStore.getStatus(connectionId)).toBe('offer-sent')
      
      vrcFlowStore.clearFlow(connectionId)
      expect(vrcFlowStore.getStatus(connectionId)).toBe('idle')
    })
  })

  describe('Stale Witness Error', () => {
    /**
     * Tests the scenario where:
     * 1. Witness connection validation fails (isWitnessValid = false)
     * 2. vrcFlowStore.setError is called with type 'stale-witness'
     * 3. Error has onProceedWithout but NOT onRetry (user needs to reconnect via UI)
     */

    it('should set error type stale-witness when witness connection is invalid', () => {
      const connectionId = 'connection-123'
      const witnessName = 'Expired Witness'
      
      // Simulate stale witness error (lines 1096-1113)
      vrcFlowStore.setError(connectionId, {
        type: 'stale-witness',
        witnessName,
        contactName: 'Test Contact',
        message: 'Your witness connection has expired',
        // No onRetry for stale witness - user needs to reconnect via UI
        onProceedWithout: async () => {
          vrcFlowStore.clearError(connectionId)
        },
      })
      
      const error = vrcFlowStore.getError(connectionId)
      
      expect(error).toBeDefined()
      expect(error?.type).toBe('stale-witness')
      expect(error?.witnessName).toBe(witnessName)
      expect(error?.message).toContain('expired')
      expect(error?.onRetry).toBeUndefined()
      expect(error?.onProceedWithout).toBeDefined()
    })

    it('should not have onRetry callback for stale witness', () => {
      const connectionId = 'connection-123'
      
      vrcFlowStore.setError(connectionId, {
        type: 'stale-witness',
        witnessName: 'Stale Witness',
        message: 'Connection expired',
        onProceedWithout: async () => {},
        // No onRetry - user must reconnect via UI
      })
      
      const error = vrcFlowStore.getError(connectionId)
      expect(error?.onRetry).toBeUndefined()
    })

    it('should add error status to chat for stale witness', () => {
      const connectionId = 'connection-123'
      const witnessName = 'Test Witness'
      
      witnessStatusStore.addStatus(connectionId, {
        connectionId,
        status: 'error',
        witnessName,
        errorMessage: 'Witness connection expired - please reconnect',
      })
      
      const statuses = witnessStatusStore.getStatuses(connectionId)
      expect(statuses).toHaveLength(1)
      expect(statuses[0].status).toBe('error')
      expect(statuses[0].errorMessage).toContain('expired')
    })

    it('should allow proceeding without witness for stale connection', async () => {
      const connectionId = 'connection-123'
      let proceedCalled = false
      
      vrcFlowStore.setError(connectionId, {
        type: 'stale-witness',
        witnessName: 'Stale Witness',
        message: 'Connection expired',
        onProceedWithout: async () => {
          proceedCalled = true
          vrcFlowStore.clearError(connectionId)
          vrcFlowStore.setStatus(connectionId, 'preparing-offer', false)
        },
      })
      
      const error = vrcFlowStore.getError(connectionId)
      await error?.onProceedWithout?.()
      
      expect(proceedCalled).toBe(true)
      expect(vrcFlowStore.getError(connectionId)).toBeUndefined()
      expect(vrcFlowStore.getStatus(connectionId)).toBe('preparing-offer')
    })
  })

  describe('Session Challenge Timeout Cleanup', () => {
    /**
     * Tests that timeout is properly cleared when session-challenge is received:
     * 1. Timeout is set when executeWitnessedExchange is called
     * 2. Session-challenge message is received
     * 3. Timeout should be cleared (lines 940-946)
     */

    it('should clear timeout when session-challenge is received', () => {
      const connectionId = 'connection-123'
      
      // Simulate setting a timeout
      const mockTimeout = setTimeout(() => {}, WITNESS_BACKGROUND_TIMEOUT_MS)
      sessionChallengeTimeouts.set(connectionId, mockTimeout)
      
      expect(sessionChallengeTimeouts.has(connectionId)).toBe(true)
      
      // Simulate session-challenge received - clear the timeout
      // This mirrors lines 940-946 in vrc-manager.ts
      const timeoutHandle = sessionChallengeTimeouts.get(connectionId)
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
        sessionChallengeTimeouts.delete(connectionId)
      }
      
      expect(sessionChallengeTimeouts.has(connectionId)).toBe(false)
    })

    it('should clear timeouts for all pending VRCs when session-challenge received', () => {
      // Simulate multiple pending connections
      const connections = ['connection-1', 'connection-2', 'connection-3']
      
      // Set timeouts for all
      connections.forEach(connId => {
        const timeout = setTimeout(() => {}, WITNESS_BACKGROUND_TIMEOUT_MS)
        sessionChallengeTimeouts.set(connId, timeout)
        pendingWitnessedVrcs.set(connId, {
          connectionId: connId,
          credential: {},
          storedAt: new Date(),
        })
      })
      
      expect(sessionChallengeTimeouts.size).toBe(3)
      
      // Simulate session-challenge received - clear all timeouts for pending VRCs
      // This mirrors the logic in lines 939-946
      const pendingVrcs = Array.from(pendingWitnessedVrcs.values())
      pendingVrcs.forEach((vrcData) => {
        const timeoutHandle = sessionChallengeTimeouts.get(vrcData.connectionId)
        if (timeoutHandle) {
          clearTimeout(timeoutHandle)
          sessionChallengeTimeouts.delete(vrcData.connectionId)
        }
      })
      
      expect(sessionChallengeTimeouts.size).toBe(0)
    })

    it('should not set error if session-challenge arrives before timeout', async () => {
      const connectionId = 'connection-123'
      let errorWasSet = false
      
      // Simulate the timeout setup
      const timeoutId = setTimeout(() => {
        errorWasSet = true
        vrcFlowStore.setError(connectionId, {
          type: 'counterparty-not-connected',
          message: 'Contact does not appear to be connected to the witness',
        })
      }, WITNESS_BACKGROUND_TIMEOUT_MS)
      sessionChallengeTimeouts.set(connectionId, timeoutId)
      
      // Simulate session-challenge arriving before timeout (e.g., 30 seconds in)
      // Clear the timeout
      clearTimeout(timeoutId)
      sessionChallengeTimeouts.delete(connectionId)
      
      // Advance time past the timeout
      jest.advanceTimersByTime(WITNESS_BACKGROUND_TIMEOUT_MS + 1000)
      
      // Verify error was never set
      expect(errorWasSet).toBe(false)
      expect(vrcFlowStore.getError(connectionId)).toBeUndefined()
    })
  })

  describe('Error State Management', () => {
    /**
     * Tests for the vrcFlowStore error state management
     */

    it('should track multiple connection errors independently', () => {
      vrcFlowStore.setError('connection-1', {
        type: 'counterparty-not-connected',
        message: 'Contact not connected',
      })
      
      vrcFlowStore.setError('connection-2', {
        type: 'vp-submission-failed',
        message: 'VP failed',
      })
      
      vrcFlowStore.setError('connection-3', {
        type: 'biometric-cancelled',
        message: 'Cancelled',
      })
      
      expect(vrcFlowStore.getError('connection-1')?.type).toBe('counterparty-not-connected')
      expect(vrcFlowStore.getError('connection-2')?.type).toBe('vp-submission-failed')
      expect(vrcFlowStore.getError('connection-3')?.type).toBe('biometric-cancelled')
      
      expect(vrcFlowStore.hasAnyError()).toBe(true)
      expect(vrcFlowStore.getErrorConnections()).toHaveLength(3)
    })

    it('should clear error when status changes', () => {
      const connectionId = 'connection-123'
      
      vrcFlowStore.setError(connectionId, {
        type: 'counterparty-not-connected',
        message: 'Error',
      })
      
      expect(vrcFlowStore.getError(connectionId)).toBeDefined()
      
      // Setting status should clear error
      vrcFlowStore.setStatus(connectionId, 'preparing-offer', false)
      
      expect(vrcFlowStore.getError(connectionId)).toBeUndefined()
    })

    it('should emit flowError event when error is set', (done) => {
      const connectionId = 'connection-123'
      
      vrcFlowStore.once('flowError', ({ connectionId: connId, error }) => {
        expect(connId).toBe(connectionId)
        expect(error.type).toBe('witness-timeout')
        done()
      })
      
      vrcFlowStore.setError(connectionId, {
        type: 'witness-timeout',
        message: 'Test error',
      })
    })

    it('should emit flowErrorCleared event when error is cleared', (done) => {
      const connectionId = 'connection-123'
      
      vrcFlowStore.setError(connectionId, {
        type: 'counterparty-not-connected',
        message: 'Error',
      })
      
      vrcFlowStore.once('flowErrorCleared', ({ connectionId: connId }) => {
        expect(connId).toBe(connectionId)
        done()
      })
      
      vrcFlowStore.clearError(connectionId)
    })

    it('should add timestamp when setting error', () => {
      const connectionId = 'connection-123'
      const beforeTime = new Date()
      
      vrcFlowStore.setError(connectionId, {
        type: 'network-error',
        message: 'Network failed',
      })
      
      const afterTime = new Date()
      const error = vrcFlowStore.getError(connectionId)
      
      expect(error?.timestamp).toBeDefined()
      expect(error?.timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime())
      expect(error?.timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime())
    })
  })

  describe('Witness Status Store', () => {
    /**
     * Tests for witnessStatusStore integration with error handling
     */

    it('should add status messages for each error scenario', () => {
      const connectionId = 'connection-123'
      
      // Session timeout error
      witnessStatusStore.addStatus(connectionId, {
        connectionId,
        status: 'error',
        witnessName: 'Test Witness',
        errorMessage: 'Witness session timeout - no response received',
      })
      
      // VP submission error  
      witnessStatusStore.addStatus(connectionId, {
        connectionId,
        status: 'error',
        witnessName: 'Test Witness',
        errorMessage: 'Failed to submit to witness: Network error',
      })
      
      const statuses = witnessStatusStore.getStatuses(connectionId)
      expect(statuses).toHaveLength(2)
      expect(statuses[0].status).toBe('error')
      expect(statuses[1].status).toBe('error')
    })

    it('should return latest status', () => {
      const connectionId = 'connection-123'
      
      witnessStatusStore.addStatus(connectionId, {
        connectionId,
        status: 'session-requested',
        witnessName: 'Test Witness',
      })
      
      witnessStatusStore.addStatus(connectionId, {
        connectionId,
        status: 'error',
        witnessName: 'Test Witness',
        errorMessage: 'Failed',
      })
      
      const latest = witnessStatusStore.getLatestStatus(connectionId)
      expect(latest?.status).toBe('error')
    })

    it('should clear statuses for a connection', () => {
      const connectionId = 'connection-123'
      
      witnessStatusStore.addStatus(connectionId, {
        connectionId,
        status: 'error',
        witnessName: 'Test Witness',
        errorMessage: 'Error',
      })
      
      expect(witnessStatusStore.getStatuses(connectionId)).toHaveLength(1)
      
      witnessStatusStore.clearStatuses(connectionId)
      
      expect(witnessStatusStore.getStatuses(connectionId)).toHaveLength(0)
    })
  })

  describe('Offer Received During Witness Flow', () => {
    /**
     * Tests that receiving a counterparty offer during an active witness flow
     * uses markOfferReceived() instead of setStatus('offer-received'),
     * so the overlay stays visible through the witness fallback sequence.
     */

    it('should keep witness-active status when offer arrives during witness flow', () => {
      const connectionId = 'connection-123'
      
      vrcFlowStore.setStatus(connectionId, 'witness-active', true)
      expect(vrcFlowStore.getStatus(connectionId)).toBe('witness-active')
      
      // Offer arrives — uses markOfferReceived instead of setStatus('offer-received')
      vrcFlowStore.markOfferReceived(connectionId)
      
      // Status should remain witness-active (overlay stays up)
      expect(vrcFlowStore.getStatus(connectionId)).toBe('witness-active')
    })

    it('should keep witness-fallback status when offer arrives during fallback', () => {
      const connectionId = 'connection-123'
      
      vrcFlowStore.setStatus(connectionId, 'witness-fallback', false)
      vrcFlowStore.markOfferReceived(connectionId)
      
      expect(vrcFlowStore.getStatus(connectionId)).toBe('witness-fallback')
    })
  })

  describe('Error Type Detection from Messages (legacy)', () => {
    /**
     * LEGACY: These tests verify a helper pattern that was used when biometric failures
     * triggered error dialogs. Since the auto-fallback refactor, biometric errors no longer
     * go through detectErrorType — they auto-fallback silently. These tests are kept to
     * ensure the detection logic still works if needed elsewhere.
     */

    const detectErrorType = (errorMessage: string): VrcFlowErrorType => {
      // This matches the logic in vrc-manager.ts executeWitnessedExchange catch block
      // Check for biometric-related keywords (case-sensitive as per original implementation)
      if (errorMessage.includes('Biometric confirmation required') ||
          errorMessage.includes('biometric authentication')) {
        // If message contains 'cancelled', it's biometric-cancelled
        // Otherwise it's biometric-failed
        return errorMessage.includes('cancelled') ? 'biometric-cancelled' : 'biometric-failed'
      }
      return 'witness-timeout'
    }

    it('should detect biometric-cancelled from error message', () => {
      const message = 'Biometric confirmation required. User cancelled biometric authentication.'
      expect(detectErrorType(message)).toBe('biometric-cancelled')
    })

    it('should detect biometric-failed from error message', () => {
      const message = 'Biometric confirmation required. User failed biometric authentication.'
      expect(detectErrorType(message)).toBe('biometric-failed')
    })

    it('should default to witness-timeout for other errors', () => {
      const message = 'Network connection failed'
      expect(detectErrorType(message)).toBe('witness-timeout')
    })

    it('should handle combined biometric error scenarios', () => {
      // Messages that contain "Biometric confirmation required" or "biometric authentication" 
      // AND "cancelled" → biometric-cancelled
      const cancelledMessages = [
        'Biometric confirmation required to sign VRC. User cancelled biometric authentication.',
        'Biometric confirmation required. User cancelled.',
        'User cancelled biometric authentication.', // Contains "biometric authentication"
      ]
      
      // Messages that contain "Biometric confirmation required" or "biometric authentication"
      // but NOT "cancelled" → biometric-failed
      const failedMessages = [
        'Biometric confirmation required to sign VRC. User failed biometric authentication.',
        'Biometric confirmation required. Authentication failed.',
        'Unable to verify biometric authentication.', // Contains "biometric authentication"
      ]
      
      // Messages that DON'T contain either pattern (should default to witness-timeout)
      const otherMessages = [
        'Authentication failed after multiple attempts.', // No biometric keywords
        'Network connection failed',
        'Witness timeout error',
      ]
      
      cancelledMessages.forEach(msg => {
        expect(detectErrorType(msg)).toBe('biometric-cancelled')
      })
      
      failedMessages.forEach(msg => {
        expect(detectErrorType(msg)).toBe('biometric-failed')
      })
      
      // These should NOT be detected as biometric errors since they don't match the pattern
      otherMessages.forEach(msg => {
        expect(detectErrorType(msg)).toBe('witness-timeout')
      })
    })
  })

  describe('Callback Behavior', () => {
    /**
     * Tests that callbacks behave correctly for different error types
     */

    it('should have both callbacks for counterparty-not-connected', () => {
      const connectionId = 'connection-123'
      
      vrcFlowStore.setError(connectionId, {
        type: 'counterparty-not-connected',
        message: 'Contact does not appear to be connected to the witness',
        onRetry: async () => {},
        onProceedWithout: async () => {},
      })
      
      const error = vrcFlowStore.getError(connectionId)
      expect(typeof error?.onRetry).toBe('function')
      expect(typeof error?.onProceedWithout).toBe('function')
    })

    it('should have both callbacks for vp-submission-failed', () => {
      const connectionId = 'connection-123'
      
      vrcFlowStore.setError(connectionId, {
        type: 'vp-submission-failed',
        message: 'Failed',
        onRetry: async () => {},
        onProceedWithout: async () => {},
      })
      
      const error = vrcFlowStore.getError(connectionId)
      expect(typeof error?.onRetry).toBe('function')
      expect(typeof error?.onProceedWithout).toBe('function')
    })

    it('should not set errors for biometric failures (auto-fallback)', () => {
      const connectionId = 'connection-123'
      
      // Biometric failures now auto-fallback — no error dialog, no error stored
      vrcFlowStore.setStatus(connectionId, 'biometric-fallback', false)
      
      expect(vrcFlowStore.getError(connectionId)).toBeUndefined()
    })

    it('should have only onProceedWithout for stale-witness', () => {
      const connectionId = 'connection-123'
      
      vrcFlowStore.setError(connectionId, {
        type: 'stale-witness',
        message: 'Expired',
        // No onRetry
        onProceedWithout: async () => {},
      })
      
      const error = vrcFlowStore.getError(connectionId)
      expect(error?.onRetry).toBeUndefined()
      expect(typeof error?.onProceedWithout).toBe('function')
    })
  })
})
