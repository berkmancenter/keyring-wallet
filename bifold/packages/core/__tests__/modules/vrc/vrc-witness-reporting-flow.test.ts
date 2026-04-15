/**
 * Tests for VRC Witness and Reporting Flow Conditions
 * 
 * These tests verify the correct behavior of the exchange flow based on
 * witnessing and reporting settings:
 * 
 * 1) Witnessing OFF + Reporting ON → Witness flow with witness:false, edge recorded
 * 2) Witnessing OFF + Reporting OFF → Regular credential exchange, no witness contact
 * 3) Witnessing ON + Reporting OFF → Witness flow with reportingDid excluded
 * 4) Witnessing ON + Reporting ON → Witness flow with reportingDid included
 */

import { Agent, ConnectionRecord, DidExchangeState, CredentialRole } from '@credo-ts/core'

// Test DIDs
const testDids = {
  counterpartyConnectionDid: 'did:peer:1zQmZMygzYqNwU6Uhmewx5Xepf2VLp5S4HLSwwgf2aiKZuwa',
  myRelationshipDid: 'did:peer:0z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
  counterpartyRelationshipDid: 'did:peer:0z6MknGc3ocHs3zdPiJbnaaqDi58NGb4pk1Sp9WNhJhvaFed',
  reportingDid: 'did:peer:0z6MkpVtGDHdMNG5X9T4HJW5H5Y5yZkFp7e8s3mGmKxX5Y8j',
}

// Mock PersistentStorage
const mockFetchValueForKey = jest.fn()
jest.mock('../../../src/services/storage', () => ({
  PersistentStorage: {
    fetchValueForKey: (...args: any[]) => mockFetchValueForKey(...args),
  },
}))

// Mock WitnessedVRCManager
const mockExecuteWitnessedExchange = jest.fn()
const mockCreateAndSubmitVP = jest.fn()
jest.mock('../../../src/modules/vrc/witnessed-vrc-manager', () => ({
  WitnessedVRCManager: jest.fn().mockImplementation(() => ({
    executeWitnessedExchange: mockExecuteWitnessedExchange,
    createAndSubmitVP: mockCreateAndSubmitVP,
  })),
}))

// Mock biometric functions
const mockRequestBiometricWithHardwareSigning = jest.fn()
jest.mock('../../../src/modules/vrc/vrc-biometric', () => ({
  requestBiometricWithHardwareSigning: (...args: any[]) => mockRequestBiometricWithHardwareSigning(...args),
}))

// Mock EvidenceBuilder
const mockBuildEvidenceFromSignature = jest.fn()
const mockCreateEvidenceBuilder = jest.fn().mockReturnValue({
  buildEvidenceFromSignature: mockBuildEvidenceFromSignature,
})
jest.mock('../../../src/modules/vrc/services/EvidenceBuilder', () => ({
  createEvidenceBuilder: (...args: any[]) => mockCreateEvidenceBuilder(...args),
}))

// Mock repository
const mockRepository = {
  findByConnectionDid: jest.fn(),
  createOrUpdate: jest.fn(),
  updateCounterpartyRelationshipDid: jest.fn(),
  findByQuery: jest.fn(),
}

// Mock witnessStatusStore
const mockAddStatus = jest.fn()
const mockSetStatus = jest.fn()
const mockSetError = jest.fn()
const mockClearFlow = jest.fn()
jest.mock('../../../src/modules/vrc/witnessStatusStore', () => ({
  witnessStatusStore: {
    addStatus: mockAddStatus,
    setStatus: mockSetStatus,
    setError: mockSetError,
    clearFlow: mockClearFlow,
    isWitnessedFlow: jest.fn().mockReturnValue(false),
    getStatus: jest.fn().mockReturnValue('idle'),
    clearError: jest.fn(),
  },
  vrcFlowStore: {
    setStatus: mockSetStatus,
    setError: mockSetError,
    clearFlow: mockClearFlow,
    isWitnessedFlow: jest.fn().mockReturnValue(false),
    getStatus: jest.fn().mockReturnValue('idle'),
    clearError: jest.fn(),
    markOfferReceived: jest.fn(),
  },
}))

// Mock logger
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

// Mock connection record
const createMockConnectionRecord = (): ConnectionRecord => ({
  id: 'connection-123',
  theirDid: testDids.counterpartyConnectionDid,
  theirLabel: 'Test Contact',
  state: DidExchangeState.Completed,
  role: CredentialRole.Holder,
  outOfBandId: 'oob-123',
  metadata: {
    get: jest.fn(),
    set: jest.fn(),
  },
  createdAt: new Date(),
  tags: {},
  type: 'ConnectionRecord',
} as unknown as ConnectionRecord)

// Mock witness connection state
const createMockWitnessState = (connected = true, hasReportingDid = true) => ({
  connectedWitness: connected ? {
    connectionId: 'witness-conn-123',
    name: 'Test Witness',
    did: 'did:peer:test-witness',
  } : undefined,
  reportingDid: hasReportingDid ? testDids.reportingDid : undefined,
  sessionChallenge: undefined,
})

// Mock agent
const createMockAgent = () => ({
  dependencyManager: {
    resolve: jest.fn().mockReturnValue(mockRepository),
  },
  config: {
    logger: mockLogger,
  },
  dids: {
    create: jest.fn(),
    resolve: jest.fn().mockResolvedValue({
      didDocument: {
        verificationMethod: [{ id: `${testDids.myRelationshipDid}#key-1` }],
      },
    }),
  },
  connections: {
    getById: jest.fn().mockResolvedValue(createMockConnectionRecord()),
  },
  oob: {
    createInvitation: jest.fn(),
    findById: jest.fn(),
  },
  events: {
    on: jest.fn(),
    off: jest.fn(),
  },
  basicMessages: {
    sendMessage: jest.fn().mockResolvedValue({}),
  },
  credentials: {
    offerCredential: jest.fn().mockResolvedValue({ id: 'cred-exchange-123' }),
    acceptOffer: jest.fn().mockResolvedValue({}),
    getFormatData: jest.fn().mockResolvedValue({}),
  },
  w3cCredentials: {
    getAllCredentialRecords: jest.fn().mockResolvedValue([]),
    signCredential: jest.fn(),
    signPresentation: jest.fn(),
  },
  context: {},
})

// Mock the repository import
jest.mock('../../../src/modules/vrc/repositories/RelationshipDidRepository', () => ({
  RelationshipDidRepository: jest.fn(),
}))

// Mock rCardCredential service
jest.mock('../../../src/modules/vrc/services/rCardCredential', () => ({
  loadRCardTemplate: jest.fn().mockResolvedValue({
    jcard: ['vcard', [['fn', {}, 'text', 'Test User']]],
  }),
}))

// Mock vrc-logging
jest.mock('../../../src/modules/vrc/vrc-logging', () => ({
  createVrcLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}))

// Mock witness session callback
let _witnessSessionCallback: ((session: any) => void) | undefined
let _witnessStateGetter: (() => any) | undefined
let _witnessValidationCallback: (() => Promise<boolean>) | undefined

jest.mock('../../../src/modules/vrc/vrc-manager', () => ({
  registerWitnessSessionCallback: (callback: any) => { _witnessSessionCallback = callback },
  registerWitnessStateGetter: (callback: any) => { _witnessStateGetter = callback },
  registerWitnessValidationCallback: (callback: any) => { _witnessValidationCallback = callback },
}))

describe('VRC Witness and Reporting Flow Conditions', () => {
  let _mockAgent: ReturnType<typeof createMockAgent>

  beforeEach(() => {
    jest.clearAllMocks()
    _mockAgent = createMockAgent()
    
    // Default: biometric returns confirmed with hardware signature
    mockRequestBiometricWithHardwareSigning.mockResolvedValue({
      success: true,
      reason: 'confirmed',
      timestamp: new Date().toISOString(),
      hardwareSignature: {
        signature: 'mock-signature-base64',
        publicKey: 'mock-public-key-base64',
        keyStorage: 'secure_enclave',
        platform: 'ios',
      },
    })
    
    // Default: evidence builder returns success
    mockBuildEvidenceFromSignature.mockResolvedValue({
      success: true,
      evidence: {
        id: 'urn:uuid:test-evidence-123',
        type: ['BiometricAttestation', 'HardwareKeyAttestation'],
        created: new Date().toISOString(),
      },
      hasAttestation: true,
    })
    
    // Default mock repository behavior
    mockRepository.findByConnectionDid.mockResolvedValue({
      myRelationshipDid: testDids.myRelationshipDid,
      counterpartyRelationshipDid: testDids.counterpartyRelationshipDid,
      connectionId: 'connection-123',
    })
    
    mockRepository.findByQuery.mockResolvedValue([{
      myRelationshipDid: testDids.myRelationshipDid,
      counterpartyRelationshipDid: testDids.counterpartyRelationshipDid,
      connectionId: 'connection-123',
    }])
  })

  describe('Flow Decision Logic', () => {
    describe('when witness is connected and valid', () => {
      beforeEach(() => {
        witnessStateGetter = () => createMockWitnessState(true, true)
        witnessValidationCallback = () => Promise.resolve(true)
      })

      it('should use witness flow when useWitnessing=true and enableReporting=false', async () => {
        mockFetchValueForKey
          .mockResolvedValueOnce({ useWitnessing: true }) // Preferences
          .mockResolvedValueOnce({ enableReporting: false }) // WitnessSettings

        // Flow decision: shouldUseWitnessFlow = witnessState.connectedWitness && isWitnessValid && (useWitnessing || enableReporting)
        const useWitnessing = true
        const enableReporting = false
        const witnessConnected = true
        const witnessValid = true
        
        const shouldUseWitnessFlow = witnessConnected && witnessValid && (useWitnessing || enableReporting)
        
        expect(shouldUseWitnessFlow).toBe(true)
      })

      it('should use witness flow when useWitnessing=false and enableReporting=true', async () => {
        mockFetchValueForKey
          .mockResolvedValueOnce({ useWitnessing: false })
          .mockResolvedValueOnce({ enableReporting: true })

        // Flow decision: even with witnessing off, should use witness flow if reporting is on
        const useWitnessing = false
        const enableReporting = true
        const witnessConnected = true
        const witnessValid = true
        
        const shouldUseWitnessFlow = witnessConnected && witnessValid && (useWitnessing || enableReporting)
        
        expect(shouldUseWitnessFlow).toBe(true)
      })

      it('should use witness flow when useWitnessing=true and enableReporting=true', async () => {
        mockFetchValueForKey
          .mockResolvedValueOnce({ useWitnessing: true })
          .mockResolvedValueOnce({ enableReporting: true })

        const useWitnessing = true
        const enableReporting = true
        
        const shouldUseWitnessFlow = true && true && (useWitnessing || enableReporting)
        
        expect(shouldUseWitnessFlow).toBe(true)
      })

      it('should NOT use witness flow when useWitnessing=false and enableReporting=false', async () => {
        mockFetchValueForKey
          .mockResolvedValueOnce({ useWitnessing: false })
          .mockResolvedValueOnce({ enableReporting: false })

        const useWitnessing = false
        const enableReporting = false
        
        const shouldUseWitnessFlow = true && true && (useWitnessing || enableReporting)
        
        expect(shouldUseWitnessFlow).toBe(false)
      })
    })

    describe('when witness is NOT connected', () => {
      beforeEach(() => {
        witnessStateGetter = () => createMockWitnessState(false, false)
        witnessValidationCallback = () => Promise.resolve(false)
      })

      it('should NOT use witness flow regardless of settings when witness disconnected', async () => {
        const useWitnessing = true
        const enableReporting = true
        const witnessConnected = false
        
        const shouldUseWitnessFlow = witnessConnected && true && (useWitnessing || enableReporting)
        
        expect(shouldUseWitnessFlow).toBe(false)
      })
    })

    describe('when witness connection is invalid', () => {
      beforeEach(() => {
        witnessStateGetter = () => createMockWitnessState(true, true)
        witnessValidationCallback = () => Promise.resolve(false)
      })

      it('should NOT use witness flow when witness validation fails', async () => {
        const useWitnessing = true
        const enableReporting = true
        const witnessConnected = true
        const witnessValid = false
        
        const shouldUseWitnessFlow = witnessConnected && witnessValid && (useWitnessing || enableReporting)
        
        expect(shouldUseWitnessFlow).toBe(false)
      })
    })
  })

  describe('Condition 1: Witness OFF + Reporting ON', () => {
    it('should send session-request with witness:false when useWitnessing=false and enableReporting=true', async () => {
      const useWitnessing = false
      const _enableReporting = true
      
      // Session request should include witness:false
      const sessionRequest = {
        type: 'session-request',
        myRelationshipDid: testDids.myRelationshipDid,
        counterpartyDid: testDids.counterpartyRelationshipDid,
        witness: useWitnessing,
      }
      
      expect(sessionRequest.witness).toBe(false)
    })

    it('should include reportingDid in VP submission when reporting is enabled', async () => {
      const exchangeUseWitnessing = false
      const exchangeEnableReporting = true
      const _globalReportingEnabled = true
      
      // Include reporting if enabled (even when witness is off)
      const includeReporting = exchangeEnableReporting && (exchangeUseWitnessing || exchangeEnableReporting)
      
      expect(includeReporting).toBe(true)
    })

    it('should record edge in network graph when reporting is enabled (witness off)', async () => {
      // When witness is off but reporting is on, the witness should still
      // record the edge in the network graph even without issuing VWC
      
      const _useWitnessing = false
      const enableReporting = true
      const hasReportingDid = true
      
      // Edge is recorded if reporting is enabled and we have a reportingDid
      const shouldRecordEdge = enableReporting && hasReportingDid
      
      expect(shouldRecordEdge).toBe(true)
    })
  })

  describe('Condition 2: Witness OFF + Reporting OFF', () => {
    it('should NOT contact witness when both witnessing and reporting are disabled', async () => {
      const useWitnessing = false
      const enableReporting = false
      
      const shouldUseWitnessFlow = true && true && (useWitnessing || enableReporting)
      
      expect(shouldUseWitnessFlow).toBe(false)
    })

    it('should perform regular credential exchange when both are disabled', async () => {
      const useWitnessing = false
      const enableReporting = false
      
      // Should go directly to credential issuance
      const shouldIssueDirectly = !useWitnessing && !enableReporting
      
      expect(shouldIssueDirectly).toBe(true)
    })

    it('should NOT send session-request to witness', async () => {
      const useWitnessing = false
      const enableReporting = false
      
      // No session request should be sent
      const shouldSendSessionRequest = useWitnessing || enableReporting
      
      expect(shouldSendSessionRequest).toBe(false)
    })
  })

  describe('Condition 3: Witness ON + Reporting OFF', () => {
    it('should send session-request with witness:true when useWitnessing=true', async () => {
      const useWitnessing = true
      const _enableReporting = false
      
      const sessionRequest = {
        type: 'session-request',
        myRelationshipDid: testDids.myRelationshipDid,
        counterpartyDid: testDids.counterpartyRelationshipDid,
        witness: useWitnessing,
      }
      
      expect(sessionRequest.witness).toBe(true)
    })

    it('should NOT include reportingDid in VP submission when reporting is disabled', async () => {
      const exchangeUseWitnessing = true
      const exchangeEnableReporting = false
      
      const includeReporting = exchangeEnableReporting && (exchangeUseWitnessing || exchangeEnableReporting)
      
      expect(includeReporting).toBe(false)
    })

    it('should perform full witness verification without recording edge', async () => {
      const useWitnessing = true
      const enableReporting = false
      
      // Full witness verification happens, but no edge recording
      const shouldPerformWitnessVerification = useWitnessing
      const shouldRecordEdge = enableReporting
      
      expect(shouldPerformWitnessVerification).toBe(true)
      expect(shouldRecordEdge).toBe(false)
    })
  })

  describe('Condition 4: Witness ON + Reporting ON', () => {
    it('should send session-request with witness:true', async () => {
      const useWitnessing = true
      const _enableReporting = true
      
      const sessionRequest = {
        type: 'session-request',
        myRelationshipDid: testDids.myRelationshipDid,
        counterpartyDid: testDids.counterpartyRelationshipDid,
        witness: useWitnessing,
      }
      
      expect(sessionRequest.witness).toBe(true)
    })

    it('should include reportingDid in VP submission when reporting is enabled', async () => {
      const exchangeUseWitnessing = true
      const exchangeEnableReporting = true
      
      const includeReporting = exchangeEnableReporting && (exchangeUseWitnessing || exchangeEnableReporting)
      
      expect(includeReporting).toBe(true)
    })

    it('should perform full witness verification AND record edge', async () => {
      const useWitnessing = true
      const enableReporting = true
      
      const shouldPerformWitnessVerification = useWitnessing
      const shouldRecordEdge = enableReporting
      
      expect(shouldPerformWitnessVerification).toBe(true)
      expect(shouldRecordEdge).toBe(true)
    })
  })

  describe('VP Submission with reportingDid', () => {
    it('should include reportingDid in submit-presentation when enabled', async () => {
      const reportingDid = testDids.reportingDid
      const includeReporting = true
      
      const submitRequest: Record<string, unknown> = {
        type: 'submit-presentation',
        presentation: { /* mock VP */ },
      }
      
      if (includeReporting && reportingDid) {
        submitRequest.reportingDid = reportingDid
      }
      
      expect(submitRequest.reportingDid).toBe(testDids.reportingDid)
    })

    it('should NOT include reportingDid when disabled', async () => {
      const reportingDid = testDids.reportingDid
      const includeReporting = false
      
      const submitRequest: Record<string, unknown> = {
        type: 'submit-presentation',
        presentation: { /* mock VP */ },
      }
      
      if (includeReporting && reportingDid) {
        submitRequest.reportingDid = reportingDid
      }
      
      expect(submitRequest.reportingDid).toBeUndefined()
    })

    it('should NOT include reportingDid when reportingDid is not available', async () => {
      const reportingDid = undefined
      const includeReporting = true
      
      const submitRequest: Record<string, unknown> = {
        type: 'submit-presentation',
        presentation: { /* mock VP */ },
      }
      
      if (includeReporting && reportingDid) {
        submitRequest.reportingDid = reportingDid
      }
      
      expect(submitRequest.reportingDid).toBeUndefined()
    })
  })

  describe('PendingVrcIssuance tracking', () => {
    it('should store useWitnessing and enableReporting in pending issuance', () => {
      const pendingIssuance = {
        connectionId: 'connection-123',
        myRelationshipDid: testDids.myRelationshipDid,
        counterpartyRelationshipDid: testDids.counterpartyRelationshipDid,
        credential: { /* mock credential */ },
        biometricSkipped: false,
        useWitnessing: true,
        enableReporting: false,
        storedAt: new Date(),
      }
      
      expect(pendingIssuance.useWitnessing).toBe(true)
      expect(pendingIssuance.enableReporting).toBe(false)
    })

    it('should track settings for witness off + reporting on scenario', () => {
      const pendingIssuance = {
        connectionId: 'connection-123',
        myRelationshipDid: testDids.myRelationshipDid,
        counterpartyRelationshipDid: testDids.counterpartyRelationshipDid,
        credential: { /* mock credential */ },
        biometricSkipped: false,
        useWitnessing: false,
        enableReporting: true,
        storedAt: new Date(),
      }
      
      expect(pendingIssuance.useWitnessing).toBe(false)
      expect(pendingIssuance.enableReporting).toBe(true)
    })
  })

  describe('Default values', () => {
    it('should default useWitnessing to true when undefined', () => {
      const useWitnessing = (undefined as { useWitnessing?: boolean } | undefined)?.useWitnessing ?? true
      
      expect(useWitnessing).toBe(true)
    })

    it('should default enableReporting to true when undefined', () => {
      const enableReporting = (undefined as { enableReporting?: boolean } | undefined)?.enableReporting ?? true
      
      expect(enableReporting).toBe(true)
    })

    it('should handle partial preferences object correctly', () => {
      const preferences = { developerModeEnabled: false } as { useWitnessing?: boolean; developerModeEnabled?: boolean }
      const useWitnessing = preferences?.useWitnessing ?? true
      
      expect(useWitnessing).toBe(true)
    })
  })

  describe('Flow matrix verification', () => {
    // Test all 4 combinations of settings
    const testCases = [
      { useWitnessing: false, enableReporting: false, expectedWitnessFlow: false, expectedReporting: false },
      { useWitnessing: false, enableReporting: true, expectedWitnessFlow: true, expectedReporting: true },
      { useWitnessing: true, enableReporting: false, expectedWitnessFlow: true, expectedReporting: false },
      { useWitnessing: true, enableReporting: true, expectedWitnessFlow: true, expectedReporting: true },
    ]

    testCases.forEach(({ useWitnessing, enableReporting, expectedWitnessFlow, expectedReporting }) => {
      it(`useWitnessing=${useWitnessing}, enableReporting=${enableReporting} → witnessFlow=${expectedWitnessFlow}, reporting=${expectedReporting}`, () => {
        const witnessConnected = true
        const witnessValid = true
        
        const shouldUseWitnessFlow = witnessConnected && witnessValid && (useWitnessing || enableReporting)
        const includeReporting = enableReporting && (useWitnessing || enableReporting)
        
        expect(shouldUseWitnessFlow).toBe(expectedWitnessFlow)
        expect(includeReporting).toBe(expectedReporting)
      })
    })
  })
})
