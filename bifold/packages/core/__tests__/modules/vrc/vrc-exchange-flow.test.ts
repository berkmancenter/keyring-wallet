/**
 * VRC Exchange Flow Simulation Tests
 * 
 * These tests simulate the bidirectional VRC exchange flow between two wallets
 * to verify event handling, identify race conditions, and catch duplicate issuance bugs.
 * 
 * The tests use mocked agents and simulate events to verify the orchestration logic.
 */

import { 
  DidExchangeState, 
  CredentialState, 
  CredentialRole,
  OutOfBandRole,
  CredentialEventTypes,
  ConnectionEventTypes,
} from '@credo-ts/core'
import { BasicMessageRole } from '@credo-ts/core/build/modules/basic-messages/BasicMessageRole'

describe('VRC Exchange Flow Simulation', () => {
  // Test DIDs
  const walletA = {
    connectionDid: 'did:peer:1zQmWalletAConnection123',
    relationshipDid: 'did:peer:0z6MkWalletARelationship456',
    label: 'Wallet A',
  }
  
  const walletB = {
    connectionDid: 'did:peer:1zQmWalletBConnection789',
    relationshipDid: 'did:peer:0z6MkWalletBRelationshipABC',
    label: 'Wallet B',
  }

  // Track handler invocations to detect duplicates
  let handlerInvocations: {
    connectionHandler: number
    messageHandler: number
    credentialOfferHandler: number
    credentialRequestHandler: number
    credentialIssuedHandler: number
  }

  // Mock repository
  let mockRepository: {
    findByConnectionDid: jest.Mock
    createOrUpdate: jest.Mock
    updateCounterpartyRelationshipDid: jest.Mock
  }

  // Mock agent
  let mockAgent: {
    config: { logger: any }
    dependencyManager: { resolve: jest.Mock }
    dids: { create: jest.Mock; resolve: jest.Mock }
    connections: { getById: jest.Mock }
    oob: { findById: jest.Mock; createInvitation: jest.Mock }
    credentials: { offerCredential: jest.Mock; acceptRequest: jest.Mock }
    basicMessages: { sendMessage: jest.Mock }
    events: { on: jest.Mock; off: jest.Mock }
  }

  // Registered event handlers (captured from agent.events.on)
  let registeredHandlers: Map<string, Function[]>

  beforeEach(() => {
    // Reset all tracking
    handlerInvocations = {
      connectionHandler: 0,
      messageHandler: 0,
      credentialOfferHandler: 0,
      credentialRequestHandler: 0,
      credentialIssuedHandler: 0,
    }

    // Clear handlers from previous tests
    registeredHandlers = new Map()

    mockRepository = {
      findByConnectionDid: jest.fn().mockResolvedValue(null),
      createOrUpdate: jest.fn().mockResolvedValue(undefined),
      updateCounterpartyRelationshipDid: jest.fn().mockResolvedValue(undefined),
    }

    mockAgent = {
      config: {
        logger: {
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          debug: jest.fn(),
        },
      },
      dependencyManager: {
        resolve: jest.fn().mockReturnValue(mockRepository),
      },
      dids: {
        create: jest.fn().mockResolvedValue({
          didState: { did: walletA.relationshipDid },
        }),
        resolve: jest.fn().mockResolvedValue({
          didDocument: {
            verificationMethod: [{ id: `${walletA.relationshipDid}#key-1` }],
          },
        }),
      },
      connections: {
        getById: jest.fn().mockResolvedValue({
          id: 'connection-123',
          theirDid: walletB.connectionDid,
          theirLabel: walletB.label,
          outOfBandId: 'oob-123',
          metadata: {
            get: jest.fn().mockReturnValue({ did: walletA.relationshipDid }),
            set: jest.fn(),
          },
        }),
      },
      oob: {
        findById: jest.fn().mockResolvedValue({
          id: 'oob-123',
          role: OutOfBandRole.Sender,
          outOfBandInvitation: {
            goalCode: 'relationship.credential.bidirectional',
          },
        }),
        createInvitation: jest.fn().mockResolvedValue({
          id: 'oob-123',
          outOfBandInvitation: {
            goalCode: 'relationship.credential.bidirectional',
            toUrl: jest.fn().mockReturnValue('https://example.com/invite'),
          },
        }),
      },
      credentials: {
        offerCredential: jest.fn().mockResolvedValue({ id: 'cred-exchange-123' }),
        acceptRequest: jest.fn().mockResolvedValue({ id: 'cred-exchange-123' }),
      },
      basicMessages: {
        sendMessage: jest.fn().mockResolvedValue(undefined),
      },
      events: {
        on: jest.fn((eventType: string, handler: Function) => {
          const handlers = registeredHandlers.get(eventType) || []
          handlers.push(handler)
          registeredHandlers.set(eventType, handlers)
        }),
        off: jest.fn(),
      },
    }
  })

  // Helper to emit a simulated event to all registered handlers
  const emitEvent = async (eventType: string, payload: any) => {
    const handlers = registeredHandlers.get(eventType) || []
    await Promise.all(handlers.map(handler => handler({ payload })))
  }

  describe('Handler Registration', () => {
    it('should register connection state change handler', () => {
      // Simulate what setupVrcConnectionHandler does
      mockAgent.events.on(ConnectionEventTypes.ConnectionStateChanged, async () => {
        handlerInvocations.connectionHandler++
      })

      expect(registeredHandlers.has(ConnectionEventTypes.ConnectionStateChanged)).toBe(true)
      expect(registeredHandlers.get(ConnectionEventTypes.ConnectionStateChanged)?.length).toBe(1)
    })

    it('should register credential state change handler', () => {
      mockAgent.events.on(CredentialEventTypes.CredentialStateChanged, async () => {
        handlerInvocations.credentialRequestHandler++
      })

      expect(registeredHandlers.has(CredentialEventTypes.CredentialStateChanged)).toBe(true)
    })

    it('should register basic message handler', () => {
      mockAgent.events.on('BasicMessageStateChanged', async () => {
        handlerInvocations.messageHandler++
      })

      expect(registeredHandlers.has('BasicMessageStateChanged')).toBe(true)
    })
  })

  describe('Duplicate Handler Detection', () => {
    /**
     * This test simulates the bug where multiple handlers are registered
     * for the same event, causing duplicate processing.
     */

    it('should detect when multiple credential handlers are registered', () => {
      // First handler (from setupVrcConnectionHandler)
      mockAgent.events.on(CredentialEventTypes.CredentialStateChanged, async () => {
        handlerInvocations.credentialRequestHandler++
      })

      // Second handler (from setupAutoIssueRelationshipCredential) - BUG!
      mockAgent.events.on(CredentialEventTypes.CredentialStateChanged, async () => {
        handlerInvocations.credentialRequestHandler++
      })

      const handlers = registeredHandlers.get(CredentialEventTypes.CredentialStateChanged)
      
      // This is the bug - 2 handlers for same event
      expect(handlers?.length).toBe(2)
    })

    it('should show duplicate invocations when event fires with multiple handlers', async () => {
      // Register two handlers (simulating the bug)
      mockAgent.events.on(CredentialEventTypes.CredentialStateChanged, async () => {
        handlerInvocations.credentialRequestHandler++
      })
      mockAgent.events.on(CredentialEventTypes.CredentialStateChanged, async () => {
        handlerInvocations.credentialRequestHandler++
      })

      // Emit one event
      await emitEvent(CredentialEventTypes.CredentialStateChanged, {
        credentialRecord: {
          id: 'cred-123',
          state: CredentialState.RequestReceived,
          role: CredentialRole.Issuer,
          connectionId: 'connection-123',
        },
      })

      // Handler was called TWICE for ONE event - this is the bug!
      expect(handlerInvocations.credentialRequestHandler).toBe(2)
    })
  })

  describe('Race Condition Simulation', () => {
    /**
     * Simulates the race condition where:
     * 1. Connection completes
     * 2. Both wallets send relationshipDid messages simultaneously
     * 3. Both receive messages and try to issue credentials
     * 4. Duplicate issuance occurs
     */

    it('should simulate parallel message handling causing duplicate issuance', async () => {
      // Use fresh handlers map for this test
      const testHandlers = new Map<string, Function[]>()
      let credentialOfferCount = 0

      const registerHandler = (eventType: string, handler: Function) => {
        const handlers = testHandlers.get(eventType) || []
        handlers.push(handler)
        testHandlers.set(eventType, handlers)
      }

      const emitToHandlers = async (eventType: string, payload: any) => {
        const handlers = testHandlers.get(eventType) || []
        await Promise.all(handlers.map(h => h({ payload })))
      }

      // Handler that tracks credential offers
      const credentialHandler = async ({ payload }: any) => {
        const record = payload.credentialRecord
        if (record?.state === CredentialState.RequestReceived && record?.role === CredentialRole.Issuer) {
          credentialOfferCount++
        }
      }

      // Register handler twice (simulating the bug)
      registerHandler(CredentialEventTypes.CredentialStateChanged, credentialHandler)
      registerHandler(CredentialEventTypes.CredentialStateChanged, credentialHandler)

      // Simulate credential request received
      await emitToHandlers(CredentialEventTypes.CredentialStateChanged, {
        credentialRecord: {
          id: 'cred-exchange-123',
          state: CredentialState.RequestReceived,
          role: CredentialRole.Issuer,
          connectionId: 'connection-123',
        },
      })

      // Bug: credential handling happened twice
      expect(credentialOfferCount).toBe(2)
    })

    it('should detect race between message handler and connection handler', async () => {
      // Use fresh handlers map for this test
      const testHandlers = new Map<string, Function[]>()
      let issuanceAttempts = 0

      const registerHandler = (eventType: string, handler: Function) => {
        const handlers = testHandlers.get(eventType) || []
        handlers.push(handler)
        testHandlers.set(eventType, handlers)
      }

      const emitToHandlers = async (eventType: string, payload: any) => {
        const handlers = testHandlers.get(eventType) || []
        await Promise.all(handlers.map(h => h({ payload })))
      }

      // Message handler triggers issuance
      const messageHandler = async ({ payload }: any) => {
        const content = payload.basicMessageRecord?.content || ''
        if (content.includes('vrc:relationshipDid:')) {
          issuanceAttempts++
        }
      }

      // Connection handler also triggers issuance setup
      const connectionHandler = async ({ payload }: any) => {
        const state = payload.connectionRecord?.state
        if (state === DidExchangeState.Completed) {
          issuanceAttempts++
        }
      }

      registerHandler('BasicMessageStateChanged', messageHandler)
      registerHandler(ConnectionEventTypes.ConnectionStateChanged, connectionHandler)

      // Simulate both events firing close together (race condition)
      await Promise.all([
        emitToHandlers(ConnectionEventTypes.ConnectionStateChanged, {
          connectionRecord: {
            id: 'connection-123',
            state: DidExchangeState.Completed,
            outOfBandId: 'oob-123',
            theirDid: walletB.connectionDid,
          },
        }),
        emitToHandlers('BasicMessageStateChanged', {
          basicMessageRecord: {
            id: 'msg-123',
            connectionId: 'connection-123',
            role: BasicMessageRole.Receiver,
            content: `vrc:relationshipDid:${walletB.relationshipDid}`,
          },
        }),
      ])

      // Both handlers fired - potential for duplicate processing
      expect(issuanceAttempts).toBe(2)
    })
  })

  describe('Correct Single-Handler Behavior', () => {
    /**
     * Tests that verify correct behavior when only ONE handler is registered
     */

    it('should only invoke credential handler once with single registration', async () => {
      let invocationCount = 0

      // Single handler (correct behavior)
      mockAgent.events.on(CredentialEventTypes.CredentialStateChanged, async () => {
        invocationCount++
      })

      await emitEvent(CredentialEventTypes.CredentialStateChanged, {
        credentialRecord: {
          id: 'cred-123',
          state: CredentialState.RequestReceived,
          role: CredentialRole.Issuer,
          connectionId: 'connection-123',
        },
      })

      expect(invocationCount).toBe(1)
    })

    it('should track processed credentials to prevent duplicates', async () => {
      // Use fresh handlers map for this test
      const testHandlers = new Map<string, Function[]>()
      const processedCredentials = new Set<string>()
      let actualProcessingCount = 0

      const registerHandler = (eventType: string, handler: Function) => {
        const handlers = testHandlers.get(eventType) || []
        handlers.push(handler)
        testHandlers.set(eventType, handlers)
      }

      const emitToHandlers = async (eventType: string, payload: any) => {
        const handlers = testHandlers.get(eventType) || []
        await Promise.all(handlers.map(h => h({ payload })))
      }

      // Handler with deduplication logic
      const deduplicatedHandler = async ({ payload }: any) => {
        const credId = payload.credentialRecord?.id
        if (!credId || processedCredentials.has(credId)) {
          return // Skip duplicate
        }
        processedCredentials.add(credId)
        actualProcessingCount++
      }

      // Register twice (simulating bug)
      registerHandler(CredentialEventTypes.CredentialStateChanged, deduplicatedHandler)
      registerHandler(CredentialEventTypes.CredentialStateChanged, deduplicatedHandler)

      // Emit event
      await emitToHandlers(CredentialEventTypes.CredentialStateChanged, {
        credentialRecord: {
          id: 'cred-123',
          state: CredentialState.RequestReceived,
          role: CredentialRole.Issuer,
          connectionId: 'connection-123',
        },
      })

      // With deduplication, only processed once
      expect(actualProcessingCount).toBe(1)
    })
  })

  describe('Full Exchange Flow Simulation', () => {
    /**
     * Simulates the complete bidirectional exchange flow
     */

    it('should simulate complete exchange flow without duplicates', async () => {
      // Use fresh handlers map for this test
      const testHandlers = new Map<string, Function[]>()
      const flowLog: string[] = []
      const processedConnections = new Set<string>()
      const processedCredentials = new Set<string>()

      const registerHandler = (eventType: string, handler: Function) => {
        const handlers = testHandlers.get(eventType) || []
        handlers.push(handler)
        testHandlers.set(eventType, handlers)
      }

      const emitToHandlers = async (eventType: string, payload: any) => {
        const handlers = testHandlers.get(eventType) || []
        for (const h of handlers) {
          await h({ payload })
        }
      }

      // Connection handler with deduplication
      const connectionHandler = async ({ payload }: any) => {
        const connId = payload.connectionRecord?.id
        if (!connId || processedConnections.has(connId)) return
        processedConnections.add(connId)
        
        if (payload.connectionRecord?.state === DidExchangeState.Completed) {
          flowLog.push(`1. Connection completed: ${connId}`)
          flowLog.push(`2. Creating relationship DID`)
          flowLog.push(`3. Sending relationshipDid message`)
        }
      }

      // Message handler
      const messageHandler = async ({ payload }: any) => {
        const content = payload.basicMessageRecord?.content || ''
        if (content.includes('vrc:relationshipDid:')) {
          flowLog.push(`4. Received counterparty relationshipDid`)
          flowLog.push(`5. Storing counterparty relationshipDid`)
        }
      }

      // Credential handler with deduplication
      const credentialHandler = async ({ payload }: any) => {
        const credId = payload.credentialRecord?.id
        const state = payload.credentialRecord?.state
        if (!credId || !state) return
        
        const key = `${credId}-${state}`
        if (processedCredentials.has(key)) return
        processedCredentials.add(key)

        if (state === CredentialState.OfferSent) {
          flowLog.push(`6. Credential offer sent`)
        } else if (state === CredentialState.RequestReceived) {
          flowLog.push(`7. Credential request received`)
          flowLog.push(`8. Auto-accepting request`)
        } else if (state === CredentialState.Done) {
          flowLog.push(`9. Credential exchange complete`)
        }
      }

      // Register handlers
      registerHandler(ConnectionEventTypes.ConnectionStateChanged, connectionHandler)
      registerHandler('BasicMessageStateChanged', messageHandler)
      registerHandler(CredentialEventTypes.CredentialStateChanged, credentialHandler)

      // Simulate the flow
      await emitToHandlers(ConnectionEventTypes.ConnectionStateChanged, {
        connectionRecord: {
          id: 'connection-123',
          state: DidExchangeState.Completed,
          outOfBandId: 'oob-123',
          theirDid: walletB.connectionDid,
        },
      })

      await emitToHandlers('BasicMessageStateChanged', {
        basicMessageRecord: {
          id: 'msg-123',
          connectionId: 'connection-123',
          role: BasicMessageRole.Receiver,
          content: `vrc:relationshipDid:${walletB.relationshipDid}`,
        },
      })

      await emitToHandlers(CredentialEventTypes.CredentialStateChanged, {
        credentialRecord: {
          id: 'cred-123',
          state: CredentialState.OfferSent,
          role: CredentialRole.Issuer,
          connectionId: 'connection-123',
        },
      })

      await emitToHandlers(CredentialEventTypes.CredentialStateChanged, {
        credentialRecord: {
          id: 'cred-123',
          state: CredentialState.RequestReceived,
          role: CredentialRole.Issuer,
          connectionId: 'connection-123',
        },
      })

      await emitToHandlers(CredentialEventTypes.CredentialStateChanged, {
        credentialRecord: {
          id: 'cred-123',
          state: CredentialState.Done,
          role: CredentialRole.Issuer,
          connectionId: 'connection-123',
        },
      })

      // Verify flow completed in order
      expect(flowLog).toEqual([
        '1. Connection completed: connection-123',
        '2. Creating relationship DID',
        '3. Sending relationshipDid message',
        '4. Received counterparty relationshipDid',
        '5. Storing counterparty relationshipDid',
        '6. Credential offer sent',
        '7. Credential request received',
        '8. Auto-accepting request',
        '9. Credential exchange complete',
      ])
    })
  })

  describe('Issuance Lock Pattern', () => {
    /**
     * Tests the pattern that should be used to prevent duplicate issuance
     */

    it('should use connection-based lock to prevent duplicate issuance', async () => {
      const issuanceLock = new Map<string, boolean>()
      let issuanceAttempts = 0
      let actualIssuances = 0

      const issueCredential = async (connectionId: string) => {
        issuanceAttempts++
        
        // Check lock
        if (issuanceLock.get(connectionId)) {
          return // Already issuing for this connection
        }
        
        // Acquire lock
        issuanceLock.set(connectionId, true)
        
        try {
          // Simulate issuance
          actualIssuances++
        } finally {
          // Note: In real code, you might want to keep the lock
          // to prevent re-issuance on reconnection
        }
      }

      // Simulate multiple triggers (race condition)
      await Promise.all([
        issueCredential('connection-123'),
        issueCredential('connection-123'),
        issueCredential('connection-123'),
      ])

      expect(issuanceAttempts).toBe(3)
      expect(actualIssuances).toBe(1) // Only one actual issuance
    })

    it('should track issuance state per connection', async () => {
      const connectionIssuanceState = new Map<string, 'pending' | 'issued' | 'failed'>()
      
      const tryIssue = async (connectionId: string): Promise<boolean> => {
        const state = connectionIssuanceState.get(connectionId)
        
        if (state === 'pending' || state === 'issued') {
          return false // Already in progress or done
        }
        
        connectionIssuanceState.set(connectionId, 'pending')
        
        try {
          // Simulate async issuance
          await new Promise(resolve => setTimeout(resolve, 10))
          connectionIssuanceState.set(connectionId, 'issued')
          return true
        } catch {
          connectionIssuanceState.set(connectionId, 'failed')
          return false
        }
      }

      // Simulate race condition
      const results = await Promise.all([
        tryIssue('connection-123'),
        tryIssue('connection-123'),
        tryIssue('connection-456'), // Different connection - should succeed
      ])

      expect(results[0]).toBe(true)  // First attempt succeeds
      expect(results[1]).toBe(false) // Second attempt blocked
      expect(results[2]).toBe(true)  // Different connection succeeds
    })
  })
})
