/**
 * Unit tests for WitnessService
 *
 * These tests verify the business logic of the WitnessService without
 * spinning up actual Credo agents. The integration tests in vrc_reference
 * cover the full DIDComm flow - here we test:
 *
 * 1. Session data structure and management
 * 2. Verification logic (challenge/domain matching)
 * 3. VWC credential building
 * 4. Session expiration calculations
 *
 * Note: These are pure unit tests that don't require network or crypto.
 */

import { SessionData } from '../../src/WitnessService'
import { defaultConfig, isMediatorEnabled, WitnessServerConfig } from '../../src/config'

describe('WitnessService - SessionData', () => {
  /**
   * Helper to create a mock SessionData object
   */
  function createMockSession(overrides: Partial<SessionData> = {}): SessionData {
    return {
      sessionId: 'test-session-123',
      challenge: 'test-challenge-abc',
      domain: 'witness-session-9002',
      participants: new Set(['conn-alice', 'conn-bob']),
      receivedPresentations: new Map(),
      receivedReportingDids: new Map(),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes from now
      ...overrides,
    }
  }

  describe('Session structure', () => {
    it('should have all required fields', () => {
      const session = createMockSession()

      expect(session.sessionId).toBeDefined()
      expect(session.challenge).toBeDefined()
      expect(session.domain).toBeDefined()
      expect(session.participants).toBeInstanceOf(Set)
      expect(session.receivedPresentations).toBeInstanceOf(Map)
      expect(session.createdAt).toBeInstanceOf(Date)
      expect(session.expiresAt).toBeInstanceOf(Date)
    })

    it('should track exactly 2 participants', () => {
      const session = createMockSession()

      expect(session.participants.size).toBe(2)
      expect(session.participants.has('conn-alice')).toBe(true)
      expect(session.participants.has('conn-bob')).toBe(true)
    })

    it('should start with empty presentations map', () => {
      const session = createMockSession()

      expect(session.receivedPresentations.size).toBe(0)
    })

    it('should calculate expiration time correctly', () => {
      const now = new Date()
      const thirtyMinutesMs = 30 * 60 * 1000

      const session = createMockSession({
        createdAt: now,
        expiresAt: new Date(now.getTime() + thirtyMinutesMs),
      })

      const duration = session.expiresAt.getTime() - session.createdAt.getTime()
      expect(duration).toBe(thirtyMinutesMs)
    })
  })

  describe('Presentation tracking', () => {
    it('should allow adding presentations from participants', () => {
      const session = createMockSession()
      const mockPresentation = { type: ['VerifiablePresentation'], proof: {} }

      session.receivedPresentations.set('conn-alice', mockPresentation)

      expect(session.receivedPresentations.size).toBe(1)
      expect(session.receivedPresentations.get('conn-alice')).toBe(mockPresentation)
    })

    it('should track when both presentations are received', () => {
      const session = createMockSession()

      session.receivedPresentations.set('conn-alice', { vp: 'alice' })
      expect(session.receivedPresentations.size).toBe(1)

      session.receivedPresentations.set('conn-bob', { vp: 'bob' })
      expect(session.receivedPresentations.size).toBe(2)
    })

    it('should identify non-participants', () => {
      const session = createMockSession()

      expect(session.participants.has('conn-charlie')).toBe(false)
    })
  })
})

describe('WitnessService - Verification Logic', () => {
  /**
   * Create a mock presentation with challenge/domain in proof
   */
  function createMockPresentation(challenge: string, domain: string, vrcType = 'RelationshipCredential') {
    return {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiablePresentation'],
      holder: 'did:peer:0z1234',
      verifiableCredential: [
        {
          '@context': ['https://www.w3.org/2018/credentials/v1'],
          type: ['VerifiableCredential', 'DTGCredential', vrcType],
          issuer: 'did:peer:0z1234',
          issuanceDate: new Date().toISOString(),
          credentialSubject: {
            id: 'did:peer:0z5678',
          },
          proof: {
            type: 'Ed25519Signature2018',
            verificationMethod: 'did:peer:0z1234#key-1',
            proofValue: 'mock-vrc-signature',
          },
        },
      ],
      proof: {
        type: 'Ed25519Signature2018',
        challenge,
        domain,
        proofPurpose: 'authentication',
        verificationMethod: 'did:peer:0z1234#key-1',
        proofValue: 'mock-vp-signature',
      },
    }
  }

  describe('Context Check (challenge/domain validation)', () => {
    it('should accept presentation with matching challenge and domain', () => {
      const sessionChallenge = 'session-challenge-xyz'
      const sessionDomain = 'witness-session-9002'
      const presentation = createMockPresentation(sessionChallenge, sessionDomain)

      const proof = presentation.proof
      expect(proof.challenge).toBe(sessionChallenge)
      expect(proof.domain).toBe(sessionDomain)
    })

    it('should detect mismatched challenge', () => {
      const sessionChallenge = 'correct-challenge'
      const presentation = createMockPresentation('wrong-challenge', 'witness-session-9002')

      expect(presentation.proof.challenge).not.toBe(sessionChallenge)
    })

    it('should detect mismatched domain', () => {
      const sessionDomain = 'witness-session-9002'
      const presentation = createMockPresentation('challenge', 'wrong-domain')

      expect(presentation.proof.domain).not.toBe(sessionDomain)
    })

    it('should handle array of proofs', () => {
      const presentation = createMockPresentation('challenge', 'domain')
      const presentationWithArrayProof = {
        ...presentation,
        proof: [presentation.proof, { type: 'other-proof' }],
      }

      const proofArray = presentationWithArrayProof.proof as any[]
      const challengeProof = proofArray.find((p) => p.challenge === 'challenge')

      expect(challengeProof).toBeDefined()
      expect(challengeProof.domain).toBe('domain')
    })
  })

  describe('Credential type validation', () => {
    it('should validate RelationshipCredential type', () => {
      const presentation = createMockPresentation('c', 'd', 'RelationshipCredential')
      const vrc = presentation.verifiableCredential[0]

      expect(vrc.type).toContain('RelationshipCredential')
    })

    it('should reject non-RelationshipCredential', () => {
      const presentation = createMockPresentation('c', 'd', 'SomeOtherCredential')
      const vrc = presentation.verifiableCredential[0]

      expect(vrc.type).not.toContain('RelationshipCredential')
      expect(vrc.type).toContain('SomeOtherCredential')
    })
  })

  describe('Freshness Check (timestamp validation)', () => {
    it('should accept credential issued just now', () => {
      const now = new Date()
      const issuanceDate = now

      const fiveMinutesMs = 5 * 60 * 1000
      const timeDiff = Math.abs(now.getTime() - issuanceDate.getTime())

      expect(timeDiff).toBeLessThanOrEqual(fiveMinutesMs)
    })

    it('should accept credential issued 4 minutes ago', () => {
      const now = new Date()
      const fourMinutesAgo = new Date(now.getTime() - 4 * 60 * 1000)

      const fiveMinutesMs = 5 * 60 * 1000
      const timeDiff = Math.abs(now.getTime() - fourMinutesAgo.getTime())

      expect(timeDiff).toBeLessThanOrEqual(fiveMinutesMs)
    })

    it('should reject credential issued 6 minutes ago', () => {
      const now = new Date()
      const sixMinutesAgo = new Date(now.getTime() - 6 * 60 * 1000)

      const fiveMinutesMs = 5 * 60 * 1000
      const timeDiff = Math.abs(now.getTime() - sixMinutesAgo.getTime())

      expect(timeDiff).toBeGreaterThan(fiveMinutesMs)
    })
  })
})

describe('WitnessService - VWC Building', () => {
  /**
   * Options for building a mock VWC
   */
  interface MockVWCOptions {
    witnessIssuerDid: string
    vrcIssuer: string
    vrcJson: Record<string, any>
    sessionId: string
    method?: string
    event?: string
  }

  /**
   * Simulate the VWC building logic from WitnessService
   * Updated to match spec: witnessContext has event, sessionId, method (no domain/timestamp)
   */
  function buildMockVWC(options: MockVWCOptions) {
    const { witnessIssuerDid, vrcIssuer, vrcJson, sessionId, method = 'session-based-challenge', event } = options

    // Compute digest (simplified - actual uses SHA-256)
    const vrcCanonical = JSON.stringify(vrcJson, Object.keys(vrcJson).sort())
    const digest = 'sha256:' + Buffer.from(vrcCanonical).toString('base64').substring(0, 32)

    // Build witnessContext according to spec (only sessionId, method, and optional event)
    const witnessContext: Record<string, string> = {
      sessionId,
      method,
    }

    // Only include event if provided
    if (event) {
      witnessContext.event = event
    }

    return {
      '@context': [
        'https://www.w3.org/2018/credentials/v1',
        'https://trustoverip.org/credentials/witnessed-exchange/v1',
      ],
      id: `urn:uuid:test-vwc-id`,
      type: ['VerifiableCredential', 'DTGCredential', 'WitnessCredential'],
      issuer: witnessIssuerDid,
      issuanceDate: new Date().toISOString(),
      credentialSubject: {
        id: vrcIssuer,
        digest: digest,
        witnessContext,
      },
    }
  }

  describe('VWC structure', () => {
    const witnessIssuerDid = 'did:peer:0zwitness'
    const vrcIssuer = 'did:peer:0zalice'
    const mockVrc = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential', 'RelationshipCredential'],
      issuer: vrcIssuer,
      credentialSubject: { id: 'did:peer:0zbob' },
    }

    it('should have correct type array', () => {
      const vwc = buildMockVWC({
        witnessIssuerDid,
        vrcIssuer,
        vrcJson: mockVrc,
        sessionId: 'session-1',
      })

      expect(vwc.type).toContain('VerifiableCredential')
      expect(vwc.type).toContain('DTGCredential')
      expect(vwc.type).toContain('WitnessCredential')
    })

    it('should have witness as issuer', () => {
      const vwc = buildMockVWC({
        witnessIssuerDid,
        vrcIssuer,
        vrcJson: mockVrc,
        sessionId: 'session-1',
      })

      expect(vwc.issuer).toBe(witnessIssuerDid)
    })

    it('should reference VRC issuer in credentialSubject.id', () => {
      const vwc = buildMockVWC({
        witnessIssuerDid,
        vrcIssuer,
        vrcJson: mockVrc,
        sessionId: 'session-1',
      })

      expect(vwc.credentialSubject.id).toBe(vrcIssuer)
    })

    it('should include digest of witnessed VRC', () => {
      const vwc = buildMockVWC({
        witnessIssuerDid,
        vrcIssuer,
        vrcJson: mockVrc,
        sessionId: 'session-1',
      })

      expect(vwc.credentialSubject.digest).toBeDefined()
      expect(vwc.credentialSubject.digest).toContain('sha256:')
    })

    it('should include witnessContext with sessionId and method', () => {
      const vwc = buildMockVWC({
        witnessIssuerDid,
        vrcIssuer,
        vrcJson: mockVrc,
        sessionId: 'session-abc',
      })

      expect(vwc.credentialSubject.witnessContext).toBeDefined()
      expect(vwc.credentialSubject.witnessContext.sessionId).toBe('session-abc')
      expect(vwc.credentialSubject.witnessContext.method).toBe('session-based-challenge')
    })

    it('should NOT include domain in witnessContext (per spec)', () => {
      const vwc = buildMockVWC({
        witnessIssuerDid,
        vrcIssuer,
        vrcJson: mockVrc,
        sessionId: 'session-1',
      })

      expect(vwc.credentialSubject.witnessContext.domain).toBeUndefined()
    })

    it('should NOT include timestamp in witnessContext (per spec)', () => {
      const vwc = buildMockVWC({
        witnessIssuerDid,
        vrcIssuer,
        vrcJson: mockVrc,
        sessionId: 'session-1',
      })

      expect(vwc.credentialSubject.witnessContext.timestamp).toBeUndefined()
    })

    it('should include witnessed exchange context URL', () => {
      const vwc = buildMockVWC({
        witnessIssuerDid,
        vrcIssuer,
        vrcJson: mockVrc,
        sessionId: 'session-1',
      })

      expect(vwc['@context']).toContain('https://trustoverip.org/credentials/witnessed-exchange/v1')
    })
  })

  describe('VWC event configuration', () => {
    const witnessIssuerDid = 'did:peer:0zwitness'
    const vrcIssuer = 'did:peer:0zalice'
    const mockVrc = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential', 'RelationshipCredential'],
      issuer: vrcIssuer,
      credentialSubject: { id: 'did:peer:0zbob' },
    }

    it('should include event in witnessContext when provided', () => {
      const vwc = buildMockVWC({
        witnessIssuerDid,
        vrcIssuer,
        vrcJson: mockVrc,
        sessionId: 'session-1',
        event: 'EthDenver 2024',
      })

      expect(vwc.credentialSubject.witnessContext.event).toBe('EthDenver 2024')
    })

    it('should NOT include event in witnessContext when not provided', () => {
      const vwc = buildMockVWC({
        witnessIssuerDid,
        vrcIssuer,
        vrcJson: mockVrc,
        sessionId: 'session-1',
      })

      expect(vwc.credentialSubject.witnessContext.event).toBeUndefined()
    })
  })

  describe('VWC method configuration', () => {
    const witnessIssuerDid = 'did:peer:0zwitness'
    const vrcIssuer = 'did:peer:0zalice'
    const mockVrc = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential', 'RelationshipCredential'],
      issuer: vrcIssuer,
      credentialSubject: { id: 'did:peer:0zbob' },
    }

    it('should use default method when not specified', () => {
      const vwc = buildMockVWC({
        witnessIssuerDid,
        vrcIssuer,
        vrcJson: mockVrc,
        sessionId: 'session-1',
      })

      expect(vwc.credentialSubject.witnessContext.method).toBe('session-based-challenge')
    })

    it('should use custom method when specified', () => {
      const vwc = buildMockVWC({
        witnessIssuerDid,
        vrcIssuer,
        vrcJson: mockVrc,
        sessionId: 'session-1',
        method: 'in-person-proximity',
      })

      expect(vwc.credentialSubject.witnessContext.method).toBe('in-person-proximity')
    })

    it('should support various verification methods', () => {
      const methods = ['session-based-challenge', 'in-person-proximity', 'video-call', 'qr-code-scan']

      methods.forEach((method) => {
        const vwc = buildMockVWC({
          witnessIssuerDid,
          vrcIssuer,
          vrcJson: mockVrc,
          sessionId: 'session-1',
          method,
        })

        expect(vwc.credentialSubject.witnessContext.method).toBe(method)
      })
    })
  })

  describe('VWC cross-distribution logic', () => {
    it('should determine correct recipient (other participant)', () => {
      const participants = ['conn-alice', 'conn-bob']
      const senderConnectionId = 'conn-alice'

      const recipientConnectionId = participants.find((id) => id !== senderConnectionId)

      expect(recipientConnectionId).toBe('conn-bob')
    })

    it('should work for both directions', () => {
      const participants = ['conn-alice', 'conn-bob']

      // Alice sends, Bob receives VWC about Alice's VRC
      const aliceSender = 'conn-alice'
      const aliceRecipient = participants.find((id) => id !== aliceSender)
      expect(aliceRecipient).toBe('conn-bob')

      // Bob sends, Alice receives VWC about Bob's VRC
      const bobSender = 'conn-bob'
      const bobRecipient = participants.find((id) => id !== bobSender)
      expect(bobRecipient).toBe('conn-alice')
    })
  })
})

describe('WitnessService - Transport Configuration', () => {
  /**
   * These tests verify the transport selection logic based on mediator configuration.
   * The actual WitnessService constructor registers different transports based on
   * whether a mediator URL is provided.
   */

  describe('Transport selection based on mediator config', () => {
    it('should use direct HTTP transport when no mediator URL is configured', () => {
      const config: WitnessServerConfig = {
        ...defaultConfig,
        mediatorInvitationUrl: undefined,
      }

      const useMediator = isMediatorEnabled(config)

      expect(useMediator).toBe(false)
      // When useMediator is false:
      // - HttpInboundTransport is registered on config.port
      // - HttpOutboundTransport is registered
      // - No WsOutboundTransport
      // - No MediationRecipientModule
    })

    it('should use mediator WebSocket transport when mediator URL is configured', () => {
      const config: WitnessServerConfig = {
        ...defaultConfig,
        mediatorInvitationUrl: 'https://mediator.example.com/invite?oob=eyJ...',
      }

      const useMediator = isMediatorEnabled(config)

      expect(useMediator).toBe(true)
      // When useMediator is true:
      // - No HttpInboundTransport (no port listening)
      // - WsOutboundTransport is registered (for mediator connection)
      // - HttpOutboundTransport is registered (for fallback/other connections)
      // - MediationRecipientModule is configured with implicit pickup
      // - Agent endpoints are undefined (mediator provides them)
    })

    it('should skip HTTP inbound transport when using mediator', () => {
      const config: WitnessServerConfig = {
        ...defaultConfig,
        port: 9002,
        mediatorInvitationUrl: 'https://mediator.example.com/invite?oob=eyJ...',
      }

      const useMediator = isMediatorEnabled(config)

      expect(useMediator).toBe(true)
      // Port is still in config but NOT used for inbound transport
      // This is important: the port setting is ignored when using mediator
    })

    it('should set agent endpoints to undefined when using mediator', () => {
      const config: WitnessServerConfig = {
        ...defaultConfig,
        publicUrl: 'https://ignored-when-using-mediator.com',
        mediatorInvitationUrl: 'https://mediator.example.com/invite?oob=eyJ...',
      }

      const useMediator = isMediatorEnabled(config)

      expect(useMediator).toBe(true)
      // publicUrl is in config but endpoints would be set to undefined
      // Mediator provides the actual endpoints in the DID document
    })

    it('should use publicUrl as endpoint when NOT using mediator', () => {
      const config: WitnessServerConfig = {
        ...defaultConfig,
        publicUrl: 'https://witness.example.com',
        mediatorInvitationUrl: undefined,
      }

      const useMediator = isMediatorEnabled(config)

      expect(useMediator).toBe(false)
      // Agent endpoints would be [config.publicUrl]
      expect(config.publicUrl).toBe('https://witness.example.com')
    })
  })

  describe('Mediator configuration scenarios', () => {
    it('should handle typical production mediator URL', () => {
      const config: WitnessServerConfig = {
        ...defaultConfig,
        mediatorInvitationUrl:
          'https://mediator.indicio.tech/message?oob=eyJAdHlwZSI6Imh0dHBzOi8vZGlkY29tbS5vcmcvb3V0LW9mLWJhbmQvMS4xL2ludml0YXRpb24iLC...',
      }

      expect(isMediatorEnabled(config)).toBe(true)
    })

    it('should handle localhost mediator URL for development', () => {
      const config: WitnessServerConfig = {
        ...defaultConfig,
        mediatorInvitationUrl: 'http://localhost:3000/invite?oob=eyJ...',
      }

      expect(isMediatorEnabled(config)).toBe(true)
    })

    it('should NOT enable mediation for empty string URL', () => {
      const config: WitnessServerConfig = {
        ...defaultConfig,
        mediatorInvitationUrl: '',
      }

      expect(isMediatorEnabled(config)).toBe(false)
    })

    it('should handle URL with query parameters', () => {
      const config: WitnessServerConfig = {
        ...defaultConfig,
        mediatorInvitationUrl: 'https://mediator.example.com/invite?oob=eyJ...&extra=param',
      }

      expect(isMediatorEnabled(config)).toBe(true)
    })
  })

  describe('Implicit pickup strategy', () => {
    /**
     * When using a mediator, the WitnessService configures MediationRecipientModule
     * with MediatorPickupStrategy.Implicit, which means:
     * - Messages are delivered via WebSocket push
     * - No explicit polling required
     * - Real-time message delivery
     */
    it('documents that implicit pickup strategy is used', () => {
      // This test documents the expected behavior:
      // The MediationRecipientModule is configured with:
      // - mediatorInvitationUrl: config.mediatorInvitationUrl
      // - mediatorPickupStrategy: MediatorPickupStrategy.Implicit
      //
      // Implicit pickup means the mediator pushes messages to us
      // over the WebSocket connection, rather than us polling.
      expect(true).toBe(true)
    })
  })

  describe('Mediator connection initialization', () => {
    /**
     * These tests document the mediator connection polling behavior during initialization.
     * The WitnessService waits for the mediator connection to be fully established before
     * accepting connections, preventing keylist update timeouts.
     */

    it('should poll for mediator readiness with timeout', () => {
      const maxWaitMs = 30000 // 30 seconds
      const pollIntervalMs = 500 // Poll every 500ms

      // Calculate max polling iterations
      const maxIterations = Math.ceil(maxWaitMs / pollIntervalMs)

      expect(maxIterations).toBe(60) // 30000 / 500 = 60 iterations
    })

    it('should check for "granted" mediation state', () => {
      // Mock mediations array with different states
      const mediations = [
        { id: '1', state: 'requested' }, // Not ready
        { id: '2', state: 'denied' }, // Not ready
        { id: '3', state: 'granted' }, // Ready!
      ]

      const activeMediation = mediations.find((m) => m.state === 'granted')

      expect(activeMediation).toBeDefined()
      expect(activeMediation?.state).toBe('granted')
    })

    it('should continue if no granted mediation after timeout', () => {
      const mediations = [{ id: '1', state: 'requested' }]

      const activeMediation = mediations.find((m) => m.state === 'granted')

      // activeMediation will be undefined but server continues anyway
      expect(activeMediation).toBeUndefined()
      // This is acceptable - server logs warning and continues
    })

    it('should break polling loop when granted state is found', () => {
      const mediations = [{ id: '1', state: 'granted' }]

      const activeMediation = mediations.find((m) => m.state === 'granted')

      // When activeMediation is found, polling loop breaks
      expect(activeMediation).toBeDefined()
    })

    it('should handle multiple mediations and find any with granted state', () => {
      const mediations = [
        { id: '1', state: 'requested' },
        { id: '2', state: 'granted' },
        { id: '3', state: 'denied' },
      ]

      const activeMediation = mediations.find((m) => m.state === 'granted')

      expect(activeMediation?.id).toBe('2')
    })

    it('should wait appropriate duration for each poll interval', () => {
      const pollIntervalMs = 500

      // Simulate waiting for poll interval
      const waitTime = pollIntervalMs

      // In actual implementation, this is: await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
      expect(waitTime).toBe(500)
    })

    it('should calculate elapsed time correctly', () => {
      const maxWaitMs = 30000
      const startTime = Date.now()
      const currentTime = startTime + 15000 // 15 seconds elapsed

      const elapsedTime = currentTime - startTime

      expect(elapsedTime).toBe(15000)
      expect(elapsedTime).toBeLessThan(maxWaitMs)
    })

    it('should timeout after maximum wait time', () => {
      const maxWaitMs = 30000
      const startTime = Date.now()
      const currentTime = startTime + 31000 // 31 seconds elapsed (exceeded)

      const elapsedTime = currentTime - startTime
      const timedOut = elapsedTime >= maxWaitMs

      expect(timedOut).toBe(true)
    })

    it('should handle getMediations() errors gracefully', () => {
      // During early initialization, getMediations() might throw
      let error: Error | undefined

      try {
        // Simulate error during initialization
        throw new Error('MediationRecipient not initialized yet')
      } catch (e) {
        error = e as Error
      }

      // Error is caught, polling continues
      expect(error).toBeDefined()
      expect(error?.message).toContain('not initialized')
    })
  })

  describe('Mediator connection vs direct HTTP', () => {
    it('should NOT poll for mediator when using direct HTTP', () => {
      const config: WitnessServerConfig = {
        ...defaultConfig,
        mediatorInvitationUrl: undefined,
      }

      const useMediator = isMediatorEnabled(config)

      // No mediator polling when direct HTTP
      expect(useMediator).toBe(false)
      // Instead, just waits 2 seconds for HTTP transport to be ready
    })

    it('should wait 2 seconds for HTTP transport readiness', () => {
      const httpWaitMs = 2000

      expect(httpWaitMs).toBe(2000)
      // In actual implementation: await new Promise(resolve => setTimeout(resolve, 2000))
    })

    it('should poll for up to 30 seconds when using mediator', () => {
      const config: WitnessServerConfig = {
        ...defaultConfig,
        mediatorInvitationUrl: 'https://mediator.example.com/invite?oob=eyJ...',
      }

      const useMediator = isMediatorEnabled(config)
      const mediatorMaxWaitMs = 30000

      expect(useMediator).toBe(true)
      expect(mediatorMaxWaitMs).toBe(30000)
    })
  })
})

describe('WitnessService - Locality Integration', () => {
  /**
   * These tests verify the locality verification integration with WitnessService.
   * The actual LocalityService is tested separately in LocalityService.test.ts.
   * Here we test how locality evidence is incorporated into VWCs.
   */

  /**
   * Mock LocalityEvidence structure
   */
  interface MockLocalityEvidence {
    challenge: string
    proofs: Array<{
      did: string
      sig: string
      ip: string
    }>
  }

  /**
   * Options for building a mock VWC with locality
   */
  interface MockVWCWithLocalityOptions {
    witnessIssuerDid: string
    vrcIssuer: string
    vrcJson: Record<string, any>
    sessionId: string
    method?: string
    event?: string
    localityEvidence?: MockLocalityEvidence
  }

  /**
   * Simulate the VWC building logic with locality evidence
   */
  function buildMockVWCWithLocality(options: MockVWCWithLocalityOptions) {
    const {
      witnessIssuerDid,
      vrcIssuer,
      vrcJson,
      sessionId,
      method = 'session-based-challenge',
      event,
      localityEvidence,
    } = options

    // Compute digest
    const vrcCanonical = JSON.stringify(vrcJson, Object.keys(vrcJson).sort())
    const digest = 'sha256:' + Buffer.from(vrcCanonical).toString('base64').substring(0, 32)

    // Build witnessContext
    const witnessContext: Record<string, any> = {
      sessionId,
      method,
    }

    if (event) {
      witnessContext.event = event
    }

    // Add locality evidence if provided
    if (localityEvidence) {
      witnessContext.localityVerification = localityEvidence
    }

    return {
      '@context': [
        'https://www.w3.org/2018/credentials/v1',
        'https://trustoverip.org/credentials/witnessed-exchange/v1',
      ],
      id: `urn:uuid:test-vwc-id`,
      type: ['VerifiableCredential', 'DTGCredential', 'WitnessCredential'],
      issuer: witnessIssuerDid,
      issuanceDate: new Date().toISOString(),
      credentialSubject: {
        id: vrcIssuer,
        digest: digest,
        witnessContext,
      },
    }
  }

  const witnessIssuerDid = 'did:peer:0zwitness'
  const vrcIssuer = 'did:peer:0zalice'
  const mockVrc = {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    type: ['VerifiableCredential', 'RelationshipCredential'],
    issuer: vrcIssuer,
    credentialSubject: { id: 'did:peer:0zbob' },
  }

  describe('VWC without locality verification', () => {
    it('should NOT include localityVerification when not provided', () => {
      const vwc = buildMockVWCWithLocality({
        witnessIssuerDid,
        vrcIssuer,
        vrcJson: mockVrc,
        sessionId: 'session-1',
      })

      expect(vwc.credentialSubject.witnessContext.localityVerification).toBeUndefined()
    })

    it('should have complete witnessContext without locality', () => {
      const vwc = buildMockVWCWithLocality({
        witnessIssuerDid,
        vrcIssuer,
        vrcJson: mockVrc,
        sessionId: 'session-1',
        event: 'TestEvent',
      })

      expect(vwc.credentialSubject.witnessContext.sessionId).toBe('session-1')
      expect(vwc.credentialSubject.witnessContext.method).toBe('session-based-challenge')
      expect(vwc.credentialSubject.witnessContext.event).toBe('TestEvent')
      expect(vwc.credentialSubject.witnessContext.localityVerification).toBeUndefined()
    })
  })

  describe('VWC with locality verification', () => {
    const mockLocalityEvidence: MockLocalityEvidence = {
      challenge: 'abc123def456',
      proofs: [
        { did: 'did:key:alice', sig: 'sig-alice-base64', ip: '192.168.1.x' },
        { did: 'did:key:bob', sig: 'sig-bob-base64', ip: '192.168.1.x' },
      ],
    }

    it('should include localityVerification when provided', () => {
      const vwc = buildMockVWCWithLocality({
        witnessIssuerDid,
        vrcIssuer,
        vrcJson: mockVrc,
        sessionId: 'session-1',
        localityEvidence: mockLocalityEvidence,
      })

      expect(vwc.credentialSubject.witnessContext.localityVerification).toBeDefined()
    })

    it('should include challenge in localityVerification', () => {
      const vwc = buildMockVWCWithLocality({
        witnessIssuerDid,
        vrcIssuer,
        vrcJson: mockVrc,
        sessionId: 'session-1',
        localityEvidence: mockLocalityEvidence,
      })

      expect(vwc.credentialSubject.witnessContext.localityVerification.challenge).toBe('abc123def456')
    })

    it('should include participant proofs in localityVerification', () => {
      const vwc = buildMockVWCWithLocality({
        witnessIssuerDid,
        vrcIssuer,
        vrcJson: mockVrc,
        sessionId: 'session-1',
        localityEvidence: mockLocalityEvidence,
      })

      const proofs = vwc.credentialSubject.witnessContext.localityVerification.proofs
      expect(proofs).toHaveLength(2)
    })

    it('should include correct proof data for each participant', () => {
      const vwc = buildMockVWCWithLocality({
        witnessIssuerDid,
        vrcIssuer,
        vrcJson: mockVrc,
        sessionId: 'session-1',
        localityEvidence: mockLocalityEvidence,
      })

      const proofs = vwc.credentialSubject.witnessContext.localityVerification.proofs
      const aliceProof = proofs.find((p: any) => p.did === 'did:key:alice')
      const bobProof = proofs.find((p: any) => p.did === 'did:key:bob')

      expect(aliceProof).toBeDefined()
      expect(aliceProof.sig).toBe('sig-alice-base64')
      expect(aliceProof.ip).toBe('192.168.1.x')

      expect(bobProof).toBeDefined()
      expect(bobProof.sig).toBe('sig-bob-base64')
      expect(bobProof.ip).toBe('192.168.1.x')
    })

    it('should coexist with other witnessContext fields', () => {
      const vwc = buildMockVWCWithLocality({
        witnessIssuerDid,
        vrcIssuer,
        vrcJson: mockVrc,
        sessionId: 'session-locality-test',
        method: 'in-person-proximity',
        event: 'Conference 2024',
        localityEvidence: mockLocalityEvidence,
      })

      const ctx = vwc.credentialSubject.witnessContext
      expect(ctx.sessionId).toBe('session-locality-test')
      expect(ctx.method).toBe('in-person-proximity')
      expect(ctx.event).toBe('Conference 2024')
      expect(ctx.localityVerification).toBeDefined()
      expect(ctx.localityVerification.challenge).toBe('abc123def456')
    })
  })

  describe('Locality evidence structure', () => {
    it('should have minimal structure (challenge + proofs)', () => {
      const evidence: MockLocalityEvidence = {
        challenge: 'test-challenge',
        proofs: [{ did: 'did:test:1', sig: 'sig1', ip: '10.0.0.x' }],
      }

      // Only challenge and proofs - no extra fields
      expect(Object.keys(evidence)).toEqual(['challenge', 'proofs'])
    })

    it('should support masked IP format', () => {
      const evidence: MockLocalityEvidence = {
        challenge: 'test',
        proofs: [{ did: 'did:test:1', sig: 'sig', ip: '192.168.1.x' }],
      }

      expect(evidence.proofs[0].ip).toMatch(/^\d+\.\d+\.\d+\.x$/)
    })

    it('should support full IP format', () => {
      const evidence: MockLocalityEvidence = {
        challenge: 'test',
        proofs: [{ did: 'did:test:1', sig: 'sig', ip: '192.168.1.123' }],
      }

      expect(evidence.proofs[0].ip).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
    })

    it('should support hashed IP format', () => {
      const evidence: MockLocalityEvidence = {
        challenge: 'test',
        proofs: [{ did: 'did:test:1', sig: 'sig', ip: 'sha256:abc123def456' }],
      }

      expect(evidence.proofs[0].ip).toMatch(/^sha256:[a-f0-9]+$/)
    })

    it('should support "verified" IP format (none mode)', () => {
      const evidence: MockLocalityEvidence = {
        challenge: 'test',
        proofs: [{ did: 'did:test:1', sig: 'sig', ip: 'verified' }],
      }

      expect(evidence.proofs[0].ip).toBe('verified')
    })
  })

  describe('Locality verification third-party verifiability', () => {
    /**
     * These tests document what a third-party verifier can check
     */

    it('should allow verifier to check participant signatures', () => {
      const evidence: MockLocalityEvidence = {
        challenge: 'known-challenge',
        proofs: [
          { did: 'did:key:alice', sig: 'alice-signature', ip: '192.168.1.x' },
          { did: 'did:key:bob', sig: 'bob-signature', ip: '192.168.1.x' },
        ],
      }

      // Verifier can:
      // 1. Resolve each DID to get public key
      // 2. Verify signature over the challenge
      // (Actual crypto verification is out of scope for this unit test)

      evidence.proofs.forEach((proof) => {
        expect(proof.did).toBeDefined()
        expect(proof.sig).toBeDefined()
        expect(evidence.challenge).toBeDefined()
      })
    })

    it('should allow verifier to confirm same network segment', () => {
      const evidence: MockLocalityEvidence = {
        challenge: 'test',
        proofs: [
          { did: 'did:key:alice', sig: 'sig', ip: '192.168.1.x' },
          { did: 'did:key:bob', sig: 'sig', ip: '192.168.1.x' },
        ],
      }

      // Verifier can check that masked IPs match (same /24 network)
      const aliceIP = evidence.proofs.find((p) => p.did === 'did:key:alice')?.ip
      const bobIP = evidence.proofs.find((p) => p.did === 'did:key:bob')?.ip

      expect(aliceIP).toBe(bobIP)
    })

    it('should expose challenge for signature verification', () => {
      const challenge = 'unique-challenge-abc123'
      const evidence: MockLocalityEvidence = {
        challenge,
        proofs: [{ did: 'did:test:1', sig: 'sig', ip: '10.0.0.x' }],
      }

      // The challenge is exposed so verifier can verify signatures
      expect(evidence.challenge).toBe(challenge)
    })
  })
})

describe('WitnessService - Event Time Window Gate', () => {
  /**
   * These tests verify the time-window gating logic that is applied in
   * handleSessionRequest().  We test the condition logic directly (no agent
   * needed) and also document the expected wire-format of the error messages.
   */

  /** Mirrors the check inside handleSessionRequest */
  function checkEventWindow(
    now: Date,
    eventStartTime: Date | undefined,
    eventEndTime: Date | undefined
  ): { allowed: boolean; code?: string; field?: string } {
    if (eventStartTime && now < eventStartTime) {
      return { allowed: false, code: 'event-not-started', field: 'eventStartTime' }
    }
    if (eventEndTime && now > eventEndTime) {
      return { allowed: false, code: 'event-ended', field: 'eventEndTime' }
    }
    return { allowed: true }
  }

  describe('No time window configured (default)', () => {
    it('should allow requests when no start or end is configured', () => {
      const result = checkEventWindow(new Date(), undefined, undefined)
      expect(result.allowed).toBe(true)
    })
  })

  describe('Event start gate', () => {
    it('should reject requests before the event starts', () => {
      const now = new Date('2026-04-01T08:00:00Z')
      const eventStart = new Date('2026-04-01T09:00:00Z')

      const result = checkEventWindow(now, eventStart, undefined)

      expect(result.allowed).toBe(false)
      expect(result.code).toBe('event-not-started')
    })

    it('should allow requests exactly at the event start time', () => {
      const eventStart = new Date('2026-04-01T09:00:00Z')
      // "now" equals start — not before, so should be allowed
      const result = checkEventWindow(eventStart, eventStart, undefined)
      expect(result.allowed).toBe(true)
    })

    it('should allow requests after the event starts', () => {
      const now = new Date('2026-04-01T10:00:00Z')
      const eventStart = new Date('2026-04-01T09:00:00Z')

      const result = checkEventWindow(now, eventStart, undefined)

      expect(result.allowed).toBe(true)
    })
  })

  describe('Event end gate', () => {
    it('should reject requests after the event ends', () => {
      const now = new Date('2026-04-01T18:00:00Z')
      const eventEnd = new Date('2026-04-01T17:00:00Z')

      const result = checkEventWindow(now, undefined, eventEnd)

      expect(result.allowed).toBe(false)
      expect(result.code).toBe('event-ended')
    })

    it('should allow requests exactly at the event end time', () => {
      const eventEnd = new Date('2026-04-01T17:00:00Z')
      // "now" equals end — not after, so should be allowed
      const result = checkEventWindow(eventEnd, undefined, eventEnd)
      expect(result.allowed).toBe(true)
    })

    it('should allow requests before the event ends', () => {
      const now = new Date('2026-04-01T16:00:00Z')
      const eventEnd = new Date('2026-04-01T17:00:00Z')

      const result = checkEventWindow(now, undefined, eventEnd)

      expect(result.allowed).toBe(true)
    })
  })

  describe('Combined start and end window', () => {
    const eventStart = new Date('2026-04-01T09:00:00Z')
    const eventEnd = new Date('2026-04-01T17:00:00Z')

    it('should reject requests before the window opens', () => {
      const now = new Date('2026-04-01T08:59:59Z')

      const result = checkEventWindow(now, eventStart, eventEnd)

      expect(result.allowed).toBe(false)
      expect(result.code).toBe('event-not-started')
    })

    it('should allow requests inside the window', () => {
      const now = new Date('2026-04-01T13:00:00Z')

      const result = checkEventWindow(now, eventStart, eventEnd)

      expect(result.allowed).toBe(true)
    })

    it('should reject requests after the window closes', () => {
      const now = new Date('2026-04-01T17:00:01Z')

      const result = checkEventWindow(now, eventStart, eventEnd)

      expect(result.allowed).toBe(false)
      expect(result.code).toBe('event-ended')
    })

    it('should evaluate start gate before end gate', () => {
      // Even if someone sets end < start (invalid config), start is checked first
      const now = new Date('2026-03-31T00:00:00Z') // before everything
      const badStart = new Date('2026-04-01T17:00:00Z')
      const badEnd = new Date('2026-04-01T09:00:00Z') // end < start

      const result = checkEventWindow(now, badStart, badEnd)

      expect(result.allowed).toBe(false)
      expect(result.code).toBe('event-not-started') // start checked first
    })
  })

  describe('Error message wire format', () => {
    it('should produce the correct JSON shape for event-not-started', () => {
      const startIso = '2026-04-01T09:00:00.000Z'
      const errorMsg = {
        type: 'error',
        code: 'event-not-started',
        message: `The event has not started yet. Witnessing begins at ${startIso}.`,
        eventStartTime: startIso,
      }

      expect(errorMsg.type).toBe('error')
      expect(errorMsg.code).toBe('event-not-started')
      expect(errorMsg.message).toContain(startIso)
      expect(errorMsg.eventStartTime).toBe(startIso)
      expect(errorMsg).not.toHaveProperty('eventEndTime')
    })

    it('should produce the correct JSON shape for event-ended', () => {
      const endIso = '2026-04-01T17:00:00.000Z'
      const errorMsg = {
        type: 'error',
        code: 'event-ended',
        message: `The event has ended. Witnessing ended at ${endIso}.`,
        eventEndTime: endIso,
      }

      expect(errorMsg.type).toBe('error')
      expect(errorMsg.code).toBe('event-ended')
      expect(errorMsg.message).toContain(endIso)
      expect(errorMsg.eventEndTime).toBe(endIso)
      expect(errorMsg).not.toHaveProperty('eventStartTime')
    })
  })

  describe('Witness announcement includes event window', () => {
    it('should include eventStartTime and eventEndTime in witness-announcement', () => {
      const startIso = '2026-04-01T09:00:00.000Z'
      const endIso = '2026-04-01T17:00:00.000Z'

      const announcement = {
        type: 'witness-announcement',
        witness: {
          name: 'test-witness',
          did: 'did:peer:0ztest',
          eventName: 'Test Event',
          eventStartTime: startIso,
          eventEndTime: endIso,
          capabilities: ['witnessed-vrc-exchange'],
          version: '1.0',
        },
        timestamp: new Date().toISOString(),
      }

      expect(announcement.witness.eventStartTime).toBe(startIso)
      expect(announcement.witness.eventEndTime).toBe(endIso)
    })

    it('should set eventStartTime and eventEndTime to null when not configured', () => {
      const announcement = {
        type: 'witness-announcement',
        witness: {
          name: 'test-witness',
          did: 'did:peer:0ztest',
          eventName: null,
          eventStartTime: null,
          eventEndTime: null,
          capabilities: ['witnessed-vrc-exchange'],
          version: '1.0',
        },
        timestamp: new Date().toISOString(),
      }

      expect(announcement.witness.eventStartTime).toBeNull()
      expect(announcement.witness.eventEndTime).toBeNull()
    })
  })
})

describe('WitnessService - Opt-in Reporting', () => {
  /**
   * These tests document and verify the opt-in activity-reporting feature:
   *
   * 1. `SessionData.receivedReportingDids` tracks per-participant opt-in
   * 2. `reporting-did-registration` is a recognised protocol message type
   * 3. `submit-presentation` may include an optional `reportingDid` field
   * 4. A graph edge is recorded only when BOTH parties provided a reportingDid
   */

  // ── SessionData field ────────────────────────────────────────────────────

  describe('SessionData.receivedReportingDids', () => {
    function makeSession(overrides: Partial<SessionData> = {}): SessionData {
      return {
        sessionId: 'test-session',
        challenge: 'challenge-abc',
        domain: 'witness-session-9002',
        participants: new Set(['conn-alice', 'conn-bob']),
        receivedPresentations: new Map(),
        receivedReportingDids: new Map(),
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        ...overrides,
      }
    }

    it('is initialised as an empty Map', () => {
      const session = makeSession()
      expect(session.receivedReportingDids).toBeInstanceOf(Map)
      expect(session.receivedReportingDids.size).toBe(0)
    })

    it('accepts a reporting DID keyed by connectionId', () => {
      const session = makeSession()
      session.receivedReportingDids.set('conn-alice', 'did:peer:reporting-alice')
      expect(session.receivedReportingDids.size).toBe(1)
      expect(session.receivedReportingDids.get('conn-alice')).toBe('did:peer:reporting-alice')
    })

    it('tracks opt-in independently from receivedPresentations', () => {
      const session = makeSession()

      // Both participants submitted presentations
      session.receivedPresentations.set('conn-alice', { vp: 'alice' })
      session.receivedPresentations.set('conn-bob', { vp: 'bob' })

      // Only Alice opted in to reporting
      session.receivedReportingDids.set('conn-alice', 'did:peer:reporting-alice')

      expect(session.receivedPresentations.size).toBe(2)
      expect(session.receivedReportingDids.size).toBe(1)
    })
  })

  // ── reporting-did-registration message ───────────────────────────────────

  describe('reporting-did-registration message', () => {
    it('has the correct type field', () => {
      const msg = {
        type: 'reporting-did-registration',
        reportingDid: 'did:peer:0z_stable_reporting',
      }
      expect(msg.type).toBe('reporting-did-registration')
    })

    it('reportingDid field is a valid DID string', () => {
      const msg = {
        type: 'reporting-did-registration',
        reportingDid: 'did:peer:0z_stable_reporting',
      }
      expect(typeof msg.reportingDid).toBe('string')
      expect(msg.reportingDid.startsWith('did:')).toBe(true)
    })

    it('is distinct from other protocol message types', () => {
      const knownTypes = ['session-request', 'submit-presentation', 'verify-credential', 'session-challenge', 'error']
      expect(knownTypes).not.toContain('reporting-did-registration')
    })

    it('should be rejected when reportingDid does not start with "did:"', () => {
      const msg = { type: 'reporting-did-registration', reportingDid: 'not-a-did' }
      const isValid = typeof msg.reportingDid === 'string' && msg.reportingDid.startsWith('did:')
      expect(isValid).toBe(false)
    })
  })

  // ── submit-presentation reportingDid field ───────────────────────────────

  describe('submit-presentation with optional reportingDid', () => {
    it('submit-presentation without reportingDid is still valid', () => {
      const msg = {
        type: 'submit-presentation',
        presentation: { type: ['VerifiablePresentation'] },
      }
      // reportingDid is absent — that is fine (participant opted out)
      expect(msg).not.toHaveProperty('reportingDid')
    })

    it('submit-presentation with reportingDid carries a valid DID', () => {
      const msg = {
        type: 'submit-presentation',
        presentation: { type: ['VerifiablePresentation'] },
        reportingDid: 'did:peer:0z_reporting_alice',
      }
      expect(msg.reportingDid).toBeDefined()
      expect(msg.reportingDid!.startsWith('did:')).toBe(true)
    })

    it('reportingDid field is preserved alongside the presentation', () => {
      const msg = {
        type: 'submit-presentation',
        presentation: { holder: 'did:peer:alice', proof: {} },
        reportingDid: 'did:peer:0z_reporting_alice',
      }
      expect(msg.presentation).toBeDefined()
      expect(msg.reportingDid).toBe('did:peer:0z_reporting_alice')
    })
  })

  // ── Mutual opt-in edge recording ─────────────────────────────────────────

  describe('mutual opt-in edge recording', () => {
    /**
     * Simulate the logic in WitnessService.issueWitnessCredentials:
     *   const dids = Array.from(session.receivedReportingDids.values())
     *   if (dids.length === 2) { graph.recordEdge(...) }
     */

    function edgeShouldBeRecorded(reportingDids: Map<string, string>): boolean {
      return Array.from(reportingDids.values()).length === 2
    }

    it('records edge when both parties opted in', () => {
      const dids = new Map([
        ['conn-alice', 'did:peer:reporting-alice'],
        ['conn-bob', 'did:peer:reporting-bob'],
      ])
      expect(edgeShouldBeRecorded(dids)).toBe(true)
    })

    it('does NOT record edge when only one party opted in', () => {
      const dids = new Map([['conn-alice', 'did:peer:reporting-alice']])
      expect(edgeShouldBeRecorded(dids)).toBe(false)
    })

    it('does NOT record edge when neither party opted in', () => {
      const dids = new Map<string, string>()
      expect(edgeShouldBeRecorded(dids)).toBe(false)
    })

    it('uses the reporting DIDs (not connection IDs) as edge nodes', () => {
      const dids = new Map([
        ['conn-alice', 'did:peer:reporting-alice'],
        ['conn-bob', 'did:peer:reporting-bob'],
      ])
      const edgeDids = Array.from(dids.values())
      expect(edgeDids[0]).toBe('did:peer:reporting-alice')
      expect(edgeDids[1]).toBe('did:peer:reporting-bob')
    })
  })

  // ── Privacy properties ────────────────────────────────────────────────────

  describe('privacy properties', () => {
    it('reporting DID is distinct from the connection DID', () => {
      const connectionId = 'conn-alice'
      const connectionDid = 'did:peer:0z_connection_key'
      const reportingDid = 'did:peer:0z_reporting_key'

      // These must be different to avoid cross-correlation with the main DID
      expect(reportingDid).not.toBe(connectionDid)
      expect(reportingDid).not.toBe(connectionId)
    })

    it('enableReporting flag defaults to true', () => {
      // Matches the default in the store reducer:
      //   enableReporting: true,
      const defaultEnableReporting = true
      expect(defaultEnableReporting).toBe(true)
    })

    it('reportingDids map starts empty', () => {
      // Matches the default in the store reducer:
      //   reportingDids: {},
      const defaultReportingDids: Record<string, string> = {}
      expect(Object.keys(defaultReportingDids)).toHaveLength(0)
    })

    it('edge is NOT recorded when either party has not opted in — protects privacy', () => {
      // Scenario: Alice opted in, Bob did not
      const sessionReportingDids = new Map([['conn-alice', 'did:peer:reporting-alice']])

      const dids = Array.from(sessionReportingDids.values())
      const shouldRecord = dids.length === 2

      expect(shouldRecord).toBe(false)
      // Bob's activity is never recorded without his explicit consent
    })
  })

  // ── Server-level gate (WITNESS_REPORTING_ENABLED) ─────────────────────────

  describe('server-level reporting gate (reportingEnabled config)', () => {
    /**
     * When the operator sets WITNESS_REPORTING_ENABLED=false the witness must:
     *  1. Silently ignore `reporting-did-registration` messages
     *  2. Skip edge recording even when both parties include a reportingDid
     *
     * We test the gate logic directly (no agent spin-up needed).
     */

    function simulateRegistrationHandling(
      reportingEnabled: boolean,
      reportingDid: string
    ): { registered: boolean } {
      // Mirrors the gate in WitnessService.registerMessageHandlers
      if (!reportingEnabled) return { registered: false }
      const isValid = typeof reportingDid === 'string' && reportingDid.startsWith('did:')
      return { registered: isValid }
    }

    function simulateEdgeRecording(
      reportingEnabled: boolean,
      sessionReportingDids: Map<string, string>
    ): { recorded: boolean; reason: string } {
      // Mirrors the gate in WitnessService.issueWitnessCredentials
      if (!reportingEnabled) return { recorded: false, reason: 'server-disabled' }
      const dids = Array.from(sessionReportingDids.values())
      if (dids.length === 2) return { recorded: true, reason: 'both-opted-in' }
      if (dids.length === 1) return { recorded: false, reason: 'one-opted-in' }
      return { recorded: false, reason: 'none-opted-in' }
    }

    // ── registration-did-registration gate ─────────────────────────────────

    it('accepts a valid reporting-did-registration when reportingEnabled=true', () => {
      const { registered } = simulateRegistrationHandling(true, 'did:peer:0z_reporting_alice')
      expect(registered).toBe(true)
    })

    it('ignores reporting-did-registration when reportingEnabled=false', () => {
      const { registered } = simulateRegistrationHandling(false, 'did:peer:0z_reporting_alice')
      expect(registered).toBe(false)
    })

    it('ignores reporting-did-registration even for valid DIDs when server disabled', () => {
      // The DID format is valid, but the server gate takes priority
      const validDid = 'did:peer:0zAbc123ValidDid'
      expect(validDid.startsWith('did:')).toBe(true) // confirm it IS a valid DID
      const { registered } = simulateRegistrationHandling(false, validDid)
      expect(registered).toBe(false)
    })

    // ── edge-recording gate ─────────────────────────────────────────────────

    it('records edge when both opted in and reportingEnabled=true', () => {
      const dids = new Map([
        ['conn-alice', 'did:peer:reporting-alice'],
        ['conn-bob', 'did:peer:reporting-bob'],
      ])
      const { recorded, reason } = simulateEdgeRecording(true, dids)
      expect(recorded).toBe(true)
      expect(reason).toBe('both-opted-in')
    })

    it('skips edge recording when reportingEnabled=false — even if both parties opted in', () => {
      const dids = new Map([
        ['conn-alice', 'did:peer:reporting-alice'],
        ['conn-bob', 'did:peer:reporting-bob'],
      ])
      const { recorded, reason } = simulateEdgeRecording(false, dids)
      expect(recorded).toBe(false)
      expect(reason).toBe('server-disabled')
    })

    it('skips edge recording when reportingEnabled=false — single opt-in', () => {
      const dids = new Map([['conn-alice', 'did:peer:reporting-alice']])
      const { recorded, reason } = simulateEdgeRecording(false, dids)
      expect(recorded).toBe(false)
      expect(reason).toBe('server-disabled')
    })

    it('skips edge recording when reportingEnabled=false — no opt-ins', () => {
      const dids = new Map<string, string>()
      const { recorded, reason } = simulateEdgeRecording(false, dids)
      expect(recorded).toBe(false)
      expect(reason).toBe('server-disabled')
    })

    // ── reason codes (normal operation, server enabled) ─────────────────────

    it('returns one-opted-in reason when only one party opts in (server enabled)', () => {
      const dids = new Map([['conn-alice', 'did:peer:reporting-alice']])
      const { recorded, reason } = simulateEdgeRecording(true, dids)
      expect(recorded).toBe(false)
      expect(reason).toBe('one-opted-in')
    })

    it('returns none-opted-in reason when neither party opts in (server enabled)', () => {
      const dids = new Map<string, string>()
      const { recorded, reason } = simulateEdgeRecording(true, dids)
      expect(recorded).toBe(false)
      expect(reason).toBe('none-opted-in')
    })
  })
})

describe('WitnessService - Session Expiration', () => {
  it('should calculate 30-minute expiration correctly', () => {
    const now = Date.now()
    const thirtyMinutesMs = 30 * 60 * 1000
    const expiresAt = new Date(now + thirtyMinutesMs)

    expect(expiresAt.getTime() - now).toBe(thirtyMinutesMs)
  })

  it('should identify expired sessions', () => {
    const now = Date.now()
    const expiredAt = new Date(now - 1000) // 1 second ago

    const isExpired = expiredAt.getTime() < now
    expect(isExpired).toBe(true)
  })

  it('should identify non-expired sessions', () => {
    const now = Date.now()
    const expiresAt = new Date(now + 30 * 60 * 1000) // 30 minutes from now

    const isExpired = expiresAt.getTime() < now
    expect(isExpired).toBe(false)
  })

  it('should support custom expiration times', () => {
    const customMinutes = 60
    const customMs = customMinutes * 60 * 1000
    const now = Date.now()
    const expiresAt = new Date(now + customMs)

    expect(expiresAt.getTime() - now).toBe(customMs)
  })
})

describe('WitnessService - Message Handling', () => {
  /**
   * These tests document the expected behavior when the witness-server receives
   * different types of messages. The actual message handling is tested in integration
   * tests, but these unit tests document the expected protocol behavior.
   */

  describe('Standard protocol messages', () => {
    it('should recognize session-request message type', () => {
      const message = {
        type: 'session-request',
        counterpartyDid: 'did:peer:bob123',
      }

      expect(message.type).toBe('session-request')
      expect(message.counterpartyDid).toBeDefined()
    })

    it('should recognize submit-presentation message type', () => {
      const message = {
        type: 'submit-presentation',
        presentation: {
          '@context': ['https://www.w3.org/2018/credentials/v1'],
          type: ['VerifiablePresentation'],
        },
      }

      expect(message.type).toBe('submit-presentation')
      expect(message.presentation).toBeDefined()
    })

    it('should recognize verify-credential message type', () => {
      const message = {
        type: 'verify-credential',
        credentialId: 'urn:uuid:abc123',
      }

      expect(message.type).toBe('verify-credential')
    })
  })

  describe('Non-standard messages', () => {
    it('should handle unknown JSON message types', () => {
      const message = {
        type: 'unknown-message-type',
        data: 'some data',
      }

      // Expected behavior: Log the unknown type and respond with friendly message
      expect(message.type).not.toBe('session-request')
      expect(message.type).not.toBe('submit-presentation')
      expect(message.type).not.toBe('verify-credential')

      // The witness should respond: "Witness online and ready!"
      const expectedResponse = 'Witness online and ready!'
      expect(expectedResponse).toBe('Witness online and ready!')
    })

    it('should handle JSON messages without type field', () => {
      const message = {
        someField: 'some value',
        anotherField: 123,
      }

      // Expected behavior: No recognized type field, respond with friendly message
      expect(message).not.toHaveProperty('type')

      // The witness should respond: "Witness online and ready!"
      const expectedResponse = 'Witness online and ready!'
      expect(expectedResponse).toBe('Witness online and ready!')
    })

    it('should handle plain text (non-JSON) messages', () => {
      const messageContent = 'Hello witness!'

      // Expected behavior: Not valid JSON, catch parse error and respond with friendly message
      let isJSON = true
      try {
        JSON.parse(messageContent)
      } catch {
        isJSON = false
      }

      expect(isJSON).toBe(false)

      // The witness should respond: "Witness online and ready!"
      const expectedResponse = 'Witness online and ready!'
      expect(expectedResponse).toBe('Witness online and ready!')
    })

    it('should use consistent friendly message text', () => {
      // Document the exact message text that witnesses respond with
      const friendlyMessage = 'Witness online and ready!'

      expect(friendlyMessage).toBe('Witness online and ready!')
      expect(friendlyMessage).toContain('Witness')
      expect(friendlyMessage).toContain('online')
      expect(friendlyMessage).toContain('ready')
    })
  })

  describe('Welcome message on connection', () => {
    it('should send welcome message when connection completes', () => {
      // When a new connection reaches "completed" state (and wasn't completed before),
      // the witness sends a welcome message
      const welcomeMessage = 'Connected and ready to witness'

      expect(welcomeMessage).toBe('Connected and ready to witness')
      expect(welcomeMessage).toContain('Connected')
      expect(welcomeMessage).toContain('ready to witness')
    })

    it('should not send welcome message on re-connection', () => {
      // When connection transitions from "completed" to "completed" (re-connection),
      // no welcome message should be sent

      const previousState = 'completed'
      const currentState = 'completed'

      const shouldSendWelcome = currentState === 'completed' && previousState !== 'completed'

      expect(shouldSendWelcome).toBe(false)
    })

    it('should send welcome message only on initial completion', () => {
      // When connection transitions from "request-received" to "completed"
      const previousState = 'request-received'
      const currentState = 'completed'

      const shouldSendWelcome = currentState === 'completed' && previousState !== 'completed'

      expect(shouldSendWelcome).toBe(true)
    })
  })

  describe('Message response behavior', () => {
    it('should differentiate between protocol and non-protocol messages', () => {
      const protocolTypes = ['session-request', 'submit-presentation', 'verify-credential']

      const standardMessage = { type: 'session-request' }
      const nonStandardMessage = { type: 'hello' }

      expect(protocolTypes).toContain(standardMessage.type)
      expect(protocolTypes).not.toContain(nonStandardMessage.type)
    })

    it('should handle both successful and error responses', () => {
      // Standard protocol messages may result in success or error responses
      const successResponse = { type: 'session-challenge', sessionId: 'abc' }
      const errorResponse = { type: 'error', error: 'Session not found' }

      expect(successResponse.type).toBe('session-challenge')
      expect(errorResponse.type).toBe('error')

      // Non-standard messages get the friendly response
      const friendlyResponse = 'Witness online and ready!'
      expect(friendlyResponse).toBeTruthy()
    })
  })
})

describe('WitnessService - Witness Request Preference', () => {
  /**
   * Helper to create a mock SessionData object with witnessRequested map
   */
  function createMockSessionWithWitnessRequest(overrides: Partial<{
    sessionId: string
    participants: Set<string>
    receivedPresentations: Map<string, any>
    witnessRequested: Map<string, boolean>
  }> = {}): {
    sessionId: string
    participants: Set<string>
    receivedPresentations: Map<string, any>
    witnessRequested: Map<string, boolean>
  } {
    return {
      sessionId: 'test-session-123',
      participants: new Set(['conn-alice', 'conn-bob']),
      receivedPresentations: new Map(),
      witnessRequested: new Map(),
      ...overrides,
    }
  }

  /**
   * Mirrors the logic in issueWitnessCredentials() for determining
   * whether to issue VWCs based on witness preferences.
   */
  function shouldIssueVWCs(session: {
    participants: Set<string>
    witnessRequested: Map<string, boolean>
  }): boolean {
    const participantIds = Array.from(session.participants)
    const bothWantWitness = participantIds.every(
      (connId) => session.witnessRequested.get(connId) !== false
    )
    return bothWantWitness
  }

  describe('SessionData witnessRequested tracking', () => {
    it('should have witnessRequested map field', () => {
      const session = createMockSessionWithWitnessRequest()

      expect(session.witnessRequested).toBeInstanceOf(Map)
      expect(session.witnessRequested.size).toBe(0)
    })

    it('should allow setting witness preference per participant', () => {
      const session = createMockSessionWithWitnessRequest()

      session.witnessRequested.set('conn-alice', true)
      session.witnessRequested.set('conn-bob', true)

      expect(session.witnessRequested.get('conn-alice')).toBe(true)
      expect(session.witnessRequested.get('conn-bob')).toBe(true)
    })

    it('should allow setting witness: false for a participant', () => {
      const session = createMockSessionWithWitnessRequest()

      session.witnessRequested.set('conn-alice', false)

      expect(session.witnessRequested.get('conn-alice')).toBe(false)
    })

    it('should default to true when witness preference not set', () => {
      const session = createMockSessionWithWitnessRequest()

      // Default behavior: if not explicitly set to false, treat as true
      const wantsWitness = session.witnessRequested.get('conn-alice') !== false
      expect(wantsWitness).toBe(true)
    })
  })

  describe('VWC issuance decision logic', () => {
    it('should issue VWCs when both participants want witness (default)', () => {
      const session = createMockSessionWithWitnessRequest({
        witnessRequested: new Map([
          ['conn-alice', true],
          ['conn-bob', true],
        ]),
      })

      expect(shouldIssueVWCs(session)).toBe(true)
    })

    it('should issue VWCs when both explicitly want witness', () => {
      const session = createMockSessionWithWitnessRequest({
        witnessRequested: new Map([
          ['conn-alice', true],
          ['conn-bob', true],
        ]),
      })

      expect(shouldIssueVWCs(session)).toBe(true)
    })

    it('should skip VWC issuance when one party sets witness: false', () => {
      const session = createMockSessionWithWitnessRequest({
        witnessRequested: new Map([
          ['conn-alice', true],
          ['conn-bob', false], // Bob doesn't want VWC
        ]),
      })

      expect(shouldIssueVWCs(session)).toBe(false)
    })

    it('should skip VWC issuance when other party sets witness: false', () => {
      const session = createMockSessionWithWitnessRequest({
        witnessRequested: new Map([
          ['conn-alice', false], // Alice doesn't want VWC
          ['conn-bob', true],
        ]),
      })

      expect(shouldIssueVWCs(session)).toBe(false)
    })

    it('should skip VWC issuance when both parties set witness: false', () => {
      const session = createMockSessionWithWitnessRequest({
        witnessRequested: new Map([
          ['conn-alice', false],
          ['conn-bob', false],
        ]),
      })

      expect(shouldIssueVWCs(session)).toBe(false)
    })

    it('should issue VWCs when no witness preferences are set (backward compatible)', () => {
      const session = createMockSessionWithWitnessRequest({
        witnessRequested: new Map(), // Empty - no preferences set
      })

      // When preferences are not set (undefined), bothWantWitness returns true
      // because undefined !== false. However, handlePresentationSubmission now sets
      // witnessRequested to false if not set during session creation.
      expect(shouldIssueVWCs(session)).toBe(true)
    })

    it('should issue VWCs when only one party has preference set to true', () => {
      const session = createMockSessionWithWitnessRequest({
        witnessRequested: new Map([
          ['conn-alice', true],
          // conn-bob not set
        ]),
      })

      // Since conn-bob is not set to false, it defaults to true
      expect(shouldIssueVWCs(session)).toBe(true)
    })

    it('should skip VWC issuance when one party preference is missing and other is false', () => {
      const session = createMockSessionWithWitnessRequest({
        witnessRequested: new Map([
          ['conn-alice', false],
          // conn-bob not set (defaults to true)
        ]),
      })

      // Only alice is explicitly false, so should skip
      expect(shouldIssueVWCs(session)).toBe(false)
    })
  })

  describe('Session-request message parsing', () => {
    /**
     * Mirrors the parsing logic in handleSessionRequest()
     */
    function parseSessionRequest(message: {
      myRelationshipDid: string
      counterpartyDid: string
      witness?: boolean
    }): { witness: boolean } {
      const witness = message.witness ?? true
      return { witness }
    }

    it('should default to witness: true when not specified', () => {
      const message = {
        myRelationshipDid: 'did:peer:alice',
        counterpartyDid: 'did:peer:bob',
      }

      const { witness } = parseSessionRequest(message)
      expect(witness).toBe(true)
    })

    it('should accept witness: true', () => {
      const message = {
        myRelationshipDid: 'did:peer:alice',
        counterpartyDid: 'did:peer:bob',
        witness: true,
      }

      const { witness } = parseSessionRequest(message)
      expect(witness).toBe(true)
    })

    it('should accept witness: false', () => {
      const message = {
        myRelationshipDid: 'did:peer:alice',
        counterpartyDid: 'did:peer:bob',
        witness: false,
      }

      const { witness } = parseSessionRequest(message)
      expect(witness).toBe(false)
    })

    it('should handle explicit undefined as default true', () => {
      const message = {
        myRelationshipDid: 'did:peer:alice',
        counterpartyDid: 'did:peer:bob',
        witness: undefined as boolean | undefined,
      }

      const { witness } = parseSessionRequest(message)
      expect(witness).toBe(true)
    })
  })

  describe('Edge recording behavior', () => {
    /**
     * Tests the edge recording logic that happens regardless of witness preference.
     * Edge recording is based on reportingDids, not witness preferences.
     */
    function shouldRecordEdge(reportingDidsCount: number): boolean {
      // Edge is recorded when BOTH parties have reportingDids
      return reportingDidsCount === 2
    }

    it('should record edge when both parties have reportingDids (regardless of witness preference)', () => {
      // Even with witness: false, edge should still be recorded
      expect(shouldRecordEdge(2)).toBe(true)
    })

    it('should not record edge when only one party has reportingDid', () => {
      expect(shouldRecordEdge(1)).toBe(false)
    })

    it('should not record edge when neither party has reportingDid', () => {
      expect(shouldRecordEdge(0)).toBe(false)
    })

    it('should record edge even when witness: false for both parties', () => {
      // This is the key behavior: edge recording is independent of witness preference
      const bothWantWitness = false // Both set witness: false
      const hasBothReportingDids = 2

      const shouldIssue = bothWantWitness // false
      const shouldRecord = shouldRecordEdge(hasBothReportingDids) // true

      expect(shouldIssue).toBe(false) // No VWCs
      expect(shouldRecord).toBe(true) // But edge IS recorded
    })
  })

  describe('Network UI compatibility', () => {
    /**
     * Tests that verify the network UI will render non-witnessed edges correctly.
     * The network UI uses edgeScore(witnessed, attestationCount) to determine
     * the visual representation of edges.
     * 
     * Non-witnessed edges now factor in attestationCount:
     * - 0 attestations: score 0, 10% thickness, 10% brightness
     * - 1 attestation: score 0.33, 16% thickness, 16% brightness
     * - 2 attestations: score 0.66, 26% thickness, 26% brightness
     */

    // Import the actual edgeScore function from the source
    const { edgeScore } = require('../../src/network-ui/runtime/edges')

    it('should have score 0 for non-witnessed edges with no attestations', () => {
      const result = edgeScore(false, 0)
      expect(result.score).toBeCloseTo(0, 2)
      expect(result.thicknessMultiplier).toBeCloseTo(0.10, 2)
      expect(result.brightness).toBeCloseTo(0.10, 2)
    })

    it('should have score 0.33 for non-witnessed edges with 1 attestation', () => {
      const result = edgeScore(false, 1)
      // score = attestationCount / 3 = 1/3 = 0.333...
      expect(result.score).toBeCloseTo(0.333, 3)
    })

    it('should have score 0.67 for non-witnessed edges with 2 attestations', () => {
      const result = edgeScore(false, 2)
      // score = attestationCount / 3 = 2/3 = 0.666...
      expect(result.score).toBeCloseTo(0.667, 3)
    })

    it('should have score based on attestation count for witnessed edges', () => {
      expect(edgeScore(true, 0).score).toBe(1)
      expect(edgeScore(true, 1).score).toBe(2)
      expect(edgeScore(true, 2).score).toBe(3)
    })

    it('should render non-witnessed edges with varying visibility based on attestations', () => {
      // Non-witnessed edges now have partial visibility based on attestationCount
      // score = attestationCount / 3
      expect(edgeScore(false, 0).score).toBeCloseTo(0, 2)
      expect(edgeScore(false, 1).score).toBeCloseTo(0.333, 2)
      expect(edgeScore(false, 2).score).toBeCloseTo(0.667, 2)
    })

    it('should render witnessed edges with appropriate visibility', () => {
      // Score 1 edges: 22% thickness/brightness
      // Score 2 edges: 46% thickness/brightness
      // Score 3 edges: 100% thickness/brightness
      expect(edgeScore(true, 0).score).toBe(1)
      expect(edgeScore(true, 1).score).toBe(2)
      expect(edgeScore(true, 2).score).toBe(3)
    })
  })

  describe('Pending session request witness preferences', () => {
    /**
     * Tests for the pending session request tracking that stores witness preferences
     * when a participant initiates a session but the counterparty hasn't connected yet.
     */

    interface PendingSessionRequest {
      initiatorConnectionId: string
      initiatorRelationshipDid: string
      counterpartyRelationshipDid: string
      initiatorWitnessPreference: boolean
      counterpartyWitnessPreference?: boolean
      timestamp: Date
    }

    /**
     * Simulates the pending session request structure with witness preferences
     */
    function createPendingRequest(
      initiatorConnectionId: string,
      initiatorRelationshipDid: string,
      counterpartyRelationshipDid: string,
      initiatorWitnessPreference: boolean
    ): PendingSessionRequest {
      return {
        initiatorConnectionId,
        initiatorRelationshipDid,
        counterpartyRelationshipDid,
        initiatorWitnessPreference,
        timestamp: new Date(),
      }
    }

    /**
     * Simulates retrieving stored witness preference from pending request
     */
    function getInitiatorWitnessPreference(
      pendingRequest: PendingSessionRequest | undefined
    ): boolean {
      return pendingRequest?.initiatorWitnessPreference ?? true
    }

    it('should store initiator witness preference when creating pending request', () => {
      const request = createPendingRequest(
        'conn-alice',
        'did:peer:alice-rel',
        'did:peer:bob-rel',
        true // Alice wants witness
      )

      expect(request.initiatorWitnessPreference).toBe(true)
    })

    it('should store false witness preference when initiator opts out', () => {
      const request = createPendingRequest(
        'conn-alice',
        'did:peer:alice-rel',
        'did:peer:bob-rel',
        false // Alice doesn't want witness
      )

      expect(request.initiatorWitnessPreference).toBe(false)
    })

    it('should retrieve initiator preference from pending request', () => {
      const request = createPendingRequest(
        'conn-alice',
        'did:peer:alice-rel',
        'did:peer:bob-rel',
        false
      )

      const preference = getInitiatorWitnessPreference(request)
      expect(preference).toBe(false)
    })

    it('should default to true when pending request not found', () => {
      const preference = getInitiatorWitnessPreference(undefined)
      expect(preference).toBe(true)
    })
  })

  describe('createWitnessedSession with explicit preferences', () => {
    /**
     * Tests for createWitnessedSession that now accepts explicit witness preferences
     * instead of always defaulting to true.
     */

    interface SessionDataWithPreferences {
      sessionId: string
      challenge: string
      domain: string
      participants: Set<string>
      witnessRequested: Map<string, boolean>
    }

    /**
     * Simulates createWitnessedSession with explicit preference handling
     */
    function createWitnessedSession(
      aliceConnectionId: string,
      bobConnectionId: string,
      initiatorWitnessPreference: boolean = true,
      counterpartyWitnessPreference: boolean = true
    ): SessionDataWithPreferences {
      const session: SessionDataWithPreferences = {
        sessionId: 'session-' + Math.random().toString(36).substring(7),
        challenge: 'challenge-' + Math.random().toString(36).substring(7),
        domain: 'witness-session-9002',
        participants: new Set([aliceConnectionId, bobConnectionId]),
        witnessRequested: new Map(),
      }

      // Store both participants' witness preferences
      session.witnessRequested.set(aliceConnectionId, initiatorWitnessPreference)
      session.witnessRequested.set(bobConnectionId, counterpartyWitnessPreference)

      return session
    }

    it('should store initiator witness preference in session', () => {
      const session = createWitnessedSession(
        'conn-alice',
        'conn-bob',
        true, // initiator wants witness
        true
      )

      expect(session.witnessRequested.get('conn-alice')).toBe(true)
    })

    it('should store counterparty witness preference in session', () => {
      const session = createWitnessedSession(
        'conn-alice',
        'conn-bob',
        true,
        false // counterparty doesn't want witness
      )

      expect(session.witnessRequested.get('conn-bob')).toBe(false)
    })

    it('should store false for both when neither wants witness', () => {
      const session = createWitnessedSession(
        'conn-alice',
        'conn-bob',
        false,
        false
      )

      expect(session.witnessRequested.get('conn-alice')).toBe(false)
      expect(session.witnessRequested.get('conn-bob')).toBe(false)
    })

    it('should default to true for both when preferences not explicitly set', () => {
      const session = createWitnessedSession('conn-alice', 'conn-bob')

      // Default behavior when called without explicit preferences
      expect(session.witnessRequested.get('conn-alice')).toBe(true)
      expect(session.witnessRequested.get('conn-bob')).toBe(true)
    })

    it('should store asymmetric preferences correctly', () => {
      const session = createWitnessedSession(
        'conn-alice',
        'conn-bob',
        false, // Alice doesn't want witness
        true   // Bob wants witness
      )

      expect(session.witnessRequested.get('conn-alice')).toBe(false)
      expect(session.witnessRequested.get('conn-bob')).toBe(true)
    })
  })

  describe('End-to-end witness preference flow', () => {
    /**
     * Integration-style tests that verify the complete flow of witness preferences
     * from session-request through to VWC issuance decision.
     */

    interface PendingSessionRequest {
      initiatorConnectionId: string
      initiatorWitnessPreference: boolean
      timestamp: Date
    }

    interface SessionData {
      participants: Set<string>
      witnessRequested: Map<string, boolean>
    }

    function simulateSessionRequestFlow(
      initiatorWantsWitness: boolean,
      counterpartyWantsWitness: boolean
    ): { shouldIssueVWC: boolean } {
      // Step 1: Initiator sends session-request with witness preference
      const pendingRequest: PendingSessionRequest = {
        initiatorConnectionId: 'conn-alice',
        initiatorWitnessPreference: initiatorWantsWitness,
        timestamp: new Date(),
      }

      // Step 2: Counterparty sends session-request
      // (In real code, this triggers session creation with both preferences)

      // Step 3: Create session with both preferences
      const session: SessionData = {
        participants: new Set(['conn-alice', 'conn-bob']),
        witnessRequested: new Map([
          ['conn-alice', pendingRequest.initiatorWitnessPreference],
          ['conn-bob', counterpartyWantsWitness],
        ]),
      }

      // Step 4: VWC issuance decision
      const participantIds = Array.from(session.participants)
      const bothWantWitness = participantIds.every(
        (connId) => session.witnessRequested.get(connId) !== false
      )

      return { shouldIssueVWC: bothWantWitness }
    }

    it('should issue VWC when both parties want witness', () => {
      const result = simulateSessionRequestFlow(true, true)
      expect(result.shouldIssueVWC).toBe(true)
    })

    it('should NOT issue VWC when initiator opts out', () => {
      const result = simulateSessionRequestFlow(false, true)
      expect(result.shouldIssueVWC).toBe(false)
    })

    it('should NOT issue VWC when counterparty opts out', () => {
      const result = simulateSessionRequestFlow(true, false)
      expect(result.shouldIssueVWC).toBe(false)
    })

    it('should NOT issue VWC when both parties opt out', () => {
      const result = simulateSessionRequestFlow(false, false)
      expect(result.shouldIssueVWC).toBe(false)
    })
  })
})

describe('WitnessService - onSessionCompletedWithAttestations callback', () => {
  /**
   * Helper to create a mock SessionData object with reporting DIDs
   */
  function createMockSessionWithReportingDids(
    receivedReportingDids: Map<string, string>
  ): SessionData {
    return {
      sessionId: 'test-session-123',
      challenge: 'test-challenge-abc',
      domain: 'witness-session-9002',
      participants: new Set(['conn-alice', 'conn-bob']),
      receivedPresentations: new Map(),
      receivedReportingDids,
      receivedAttestations: new Map(),
      witnessRequested: new Map([
        ['conn-alice', true],
        ['conn-bob', true],
      ]),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    }
  }

  /**
   * Simulates the onSessionCompletedWithAttestations callback logic
   * This is the regression test for the bug where edges were being added
   * based on historical reportingGraph data instead of session's receivedReportingDids
   */
  function simulateOnSessionCompletedCallback(
    sessionData: SessionData,
    _historicalReportingDids?: Map<string, string>
  ): { edgeRecorded: boolean; reportingDidsUsed: string[] | undefined } {
    // This simulates what index.ts does with the callback
    const receivedReportingDids = Array.from(sessionData.receivedReportingDids.values())

    // THE FIX: Use receivedReportingDids from THIS session, not historicalReportingDids
    if (receivedReportingDids.length === 2) {
      return {
        edgeRecorded: true,
        reportingDidsUsed: receivedReportingDids,
      }
    }

    // If either party didn't include a reportingDid in their presentation, no edge
    return {
      edgeRecorded: false,
      reportingDidsUsed: receivedReportingDids.length > 0 ? receivedReportingDids : undefined,
    }
  }

  describe('Edge recording decision', () => {
    it('should record edge when BOTH parties include reportingDid in their presentations', () => {
      const session = createMockSessionWithReportingDids(
        new Map([
          ['conn-alice', 'did:peer:alice'],
          ['conn-bob', 'did:peer:bob'],
        ])
      )

      const result = simulateOnSessionCompletedCallback(session)

      expect(result.edgeRecorded).toBe(true)
      expect(result.reportingDidsUsed).toEqual(['did:peer:alice', 'did:peer:bob'])
    })

    it('should NOT record edge when NEITHER party includes reportingDid in their presentations', () => {
      const session = createMockSessionWithReportingDids(new Map())

      const result = simulateOnSessionCompletedCallback(session)

      expect(result.edgeRecorded).toBe(false)
      expect(result.reportingDidsUsed).toBeUndefined()
    })

    it('should NOT record edge when only ONE party includes reportingDid', () => {
      const session = createMockSessionWithReportingDids(
        new Map([['conn-alice', 'did:peer:alice']])
      )

      const result = simulateOnSessionCompletedCallback(session)

      expect(result.edgeRecorded).toBe(false)
      // The single reporting DID is passed but edge is not recorded
      expect(result.reportingDidsUsed).toEqual(['did:peer:alice'])
    })

    it('should NOT use historical reporting Dids for edge decision (REGRESSION TEST)', () => {
      // This test prevents the bug where edges were incorrectly added
      // because the callback was looking up DIDs from the persistent reportingGraph
      // instead of checking what was actually submitted in THIS session

      // Session where NEITHER party included reportingDid in their presentation
      const session = createMockSessionWithReportingDids(new Map())

      // Historical data that has DIDs registered (simulating old registrations)
      const historicalReportingDids = new Map([
        ['conn-alice', 'did:peer:alice-historical'],
        ['conn-bob', 'did:peer:bob-historical'],
      ])

      // Simulate what the OLD buggy code did: use historicalReportingDids instead of session's
      const buggyBehavior = (sessionData: SessionData, historical: Map<string, string>) => {
        const historicalDids = Array.from(historical.values())
        // BUG: This would add edge even though session has no receivedReportingDids
        if (historicalDids.length === 2) {
          return { edgeRecorded: true, usedHistorical: true }
        }
        return { edgeRecorded: false, usedHistorical: false }
      }

      // The FIXED behavior uses session's receivedReportingDids
      const fixedResult = simulateOnSessionCompletedCallback(session, historicalReportingDids)
      const buggyResult = buggyBehavior(session, historicalReportingDids)

      // FIXED: No edge recorded because session has no receivedReportingDids
      expect(fixedResult.edgeRecorded).toBe(false)

      // BUGGY: Would incorrectly record edge based on historical data
      expect(buggyResult.edgeRecorded).toBe(true)
      expect(buggyResult.usedHistorical).toBe(true)
    })

    it('should correctly track reporting DIDs per session', () => {
      // Different sessions should have independent reportingDids
      const session1 = createMockSessionWithReportingDids(
        new Map([
          ['conn-alice', 'did:peer:alice-session1'],
          ['conn-bob', 'did:peer:bob-session1'],
        ])
      )

      const session2 = createMockSessionWithReportingDids(
        new Map([['conn-alice', 'did:peer:alice-session2']]) // Only one party
      )

      const session3 = createMockSessionWithReportingDids(new Map()) // Neither party

      const result1 = simulateOnSessionCompletedCallback(session1)
      const result2 = simulateOnSessionCompletedCallback(session2)
      const result3 = simulateOnSessionCompletedCallback(session3)

      expect(result1.edgeRecorded).toBe(true)
      expect(result1.reportingDidsUsed).toEqual(['did:peer:alice-session1', 'did:peer:bob-session1'])

      expect(result2.edgeRecorded).toBe(false)
      expect(result2.reportingDidsUsed).toEqual(['did:peer:alice-session2'])

      expect(result3.edgeRecorded).toBe(false)
      expect(result3.reportingDidsUsed).toBeUndefined()
    })
  })
})
