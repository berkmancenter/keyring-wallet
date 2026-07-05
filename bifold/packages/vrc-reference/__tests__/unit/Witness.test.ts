import { Witness } from '../../src/Witness'
import { generateTestDid } from '../helpers/testUtils'
import { RELATIONSHIP_CONTEXT_URL } from '../../src/relationshipContext'
import { createHash } from 'crypto'

// Mock the BaseAgent to prevent real initialization
jest.mock('../../src/BaseAgent', () => {
  return {
    BaseAgent: class MockBaseAgent {
      public port: number
      public name: string
      public agent: any

      constructor({ port, name }: { port: number; name: string }) {
        this.port = port
        this.name = name
        this.agent = {
          events: {
            on: jest.fn(),
          },
          shutdown: jest.fn(),
        }
      }

      async initializeAgent() {
        // Mock implementation
      }
    },
  }
})

describe('Witness', () => {
  let witness: Witness
  let mockAgent: any

  beforeEach(() => {
    // Create comprehensive mock agent
    mockAgent = {
      connections: {
        getById: jest.fn(),
        findAllByOutOfBandId: jest.fn(),
        getAll: jest.fn(),
      },
      oob: {
        createInvitation: jest.fn(),
      },
      wallet: {
        createKey: jest.fn(),
      },
      dids: {
        create: jest.fn(),
      },
      credentials: {
        offerCredential: jest.fn(),
      },
      basicMessages: {
        sendMessage: jest.fn(),
      },
      w3cCredentials: {
        verifyPresentation: jest.fn(),
      },
      events: {
        on: jest.fn(),
      },
      shutdown: jest.fn(),
    }

    // Create Witness and assign mock agent
    witness = new Witness(9002, 'test-witness')
    witness.agent = mockAgent
  })

  afterEach(async () => {
    // Witness cleanup - agent is mocked so no real cleanup needed
    if (mockAgent && mockAgent.shutdown) {
      await mockAgent.shutdown()
    }
  })

  describe('constructor', () => {
    it('should initialize with correct values', () => {
      expect(witness.name).toBe('test-witness')
      expect(witness.port).toBe(9002)
      expect(witness.ui).toBeDefined()
    })

    it('should read event name from WITNESS_EVENT_NAME environment variable', () => {
      const originalEnv = process.env.WITNESS_EVENT_NAME

      // Test with event name set
      process.env.WITNESS_EVENT_NAME = 'Test Conference 2026'
      const witnessWithEvent = new Witness(9003, 'test-witness-2')
      witnessWithEvent.agent = mockAgent
      expect((witnessWithEvent as any).eventName).toBe('Test Conference 2026')

      // Test with no event name (should be undefined)
      delete process.env.WITNESS_EVENT_NAME
      const witnessNoEvent = new Witness(9004, 'test-witness-3')
      witnessNoEvent.agent = mockAgent
      expect((witnessNoEvent as any).eventName).toBeUndefined()

      // Restore original env
      if (originalEnv !== undefined) {
        process.env.WITNESS_EVENT_NAME = originalEnv
      } else {
        delete process.env.WITNESS_EVENT_NAME
      }
    })
  })

  describe('createConnectionInvitation', () => {
    const mockOutOfBandRecord = {
      id: 'oob-witness-123',
      outOfBandInvitation: {
        toUrl: jest.fn().mockReturnValue('http://localhost:9002?oob=invitation'),
      },
    }

    beforeEach(() => {
      mockAgent.oob.createInvitation.mockResolvedValue(mockOutOfBandRecord)
    })

    it('should create out-of-band invitation', async () => {
      const invitationUrl = await witness.createConnectionInvitation()

      expect(mockAgent.oob.createInvitation).toHaveBeenCalled()
      expect(invitationUrl).toBe('http://localhost:9002?oob=invitation')
    })

    it('should return invitation URL with correct domain', async () => {
      await witness.createConnectionInvitation()

      expect(mockOutOfBandRecord.outOfBandInvitation.toUrl).toHaveBeenCalledWith({
        domain: 'http://localhost:9002',
      })
    })
  })

  describe('createWitnessedSession', () => {
    const aliceConnectionId = 'conn-alice-123'
    const bobConnectionId = 'conn-bob-456'

    beforeEach(() => {
      mockAgent.basicMessages.sendMessage.mockResolvedValue(undefined)
    })

    it('should generate unique session ID and challenge', async () => {
      const { sessionId, challenge, domain } = await witness.createWitnessedSession(aliceConnectionId, bobConnectionId)

      expect(sessionId).toBeDefined()
      expect(typeof sessionId).toBe('string')
      expect(sessionId.length).toBeGreaterThan(0)
      expect(challenge).toBeDefined()
      expect(domain).toBeDefined()
    })

    it('should send challenge messages to both participants', async () => {
      await witness.createWitnessedSession(aliceConnectionId, bobConnectionId)

      expect(mockAgent.basicMessages.sendMessage).toHaveBeenCalledTimes(2)
      expect(mockAgent.basicMessages.sendMessage).toHaveBeenCalledWith(
        aliceConnectionId,
        expect.stringContaining('session-challenge')
      )
      expect(mockAgent.basicMessages.sendMessage).toHaveBeenCalledWith(
        bobConnectionId,
        expect.stringContaining('session-challenge')
      )
    })

    it('should include sessionId, challenge, and domain in messages', async () => {
      const { sessionId } = await witness.createWitnessedSession(aliceConnectionId, bobConnectionId)

      const aliceMessage = JSON.parse(mockAgent.basicMessages.sendMessage.mock.calls[0][1])
      expect(aliceMessage.type).toBe('session-challenge')
      expect(aliceMessage.sessionId).toBe(sessionId)
      expect(aliceMessage.challenge).toBeDefined()
      expect(aliceMessage.domain).toBe('witness-session-9002')
    })
  })

  describe('verifyPresentation', () => {
    let sessionId: string

    beforeEach(async () => {
      mockAgent.basicMessages.sendMessage.mockResolvedValue(undefined)
      const result = await witness.createWitnessedSession('conn-alice', 'conn-bob')
      sessionId = result.sessionId
    })

    it('should reject presentation with no proof', async () => {
      const presentationJson = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiablePresentation'],
        verifiableCredential: [],
      }

      const result = await witness.verifyPresentation('conn-alice', presentationJson)

      expect(result.verified).toBe(false)
      expect(result.error).toContain('no proof')
    })

    it('should reject presentation with incorrect challenge', async () => {
      const presentationJson = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiablePresentation'],
        proof: {
          type: 'Ed25519Signature2018',
          challenge: 'wrong-challenge',
          domain: 'witness-session-9002',
        },
        verifiableCredential: [],
      }

      const result = await witness.verifyPresentation('conn-alice', presentationJson)

      expect(result.verified).toBe(false)
      expect(result.error).toContain('does not match session challenge')
    })

    it('should reject presentation with no credentials', async () => {
      // Get the actual challenge from the session
      const sessions = (witness as any).activeSessions
      const session = sessions.get(sessionId)

      const presentationJson = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiablePresentation'],
        proof: {
          type: 'Ed25519Signature2018',
          challenge: session.challenge,
          domain: session.domain,
        },
        verifiableCredential: [],
      }

      const result = await witness.verifyPresentation('conn-alice', presentationJson)

      expect(result.verified).toBe(false)
      expect(result.error).toContain('no credentials')
    })

    it('should reject non-RelationshipCredential', async () => {
      const sessions = (witness as any).activeSessions
      const session = sessions.get(sessionId)

      const presentationJson = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiablePresentation'],
        proof: {
          type: 'Ed25519Signature2018',
          challenge: session.challenge,
          domain: session.domain,
        },
        verifiableCredential: [
          {
            '@context': ['https://www.w3.org/2018/credentials/v1'],
            type: ['VerifiableCredential', 'SomeOtherType'],
            issuer: generateTestDid(),
            issuanceDate: new Date().toISOString(),
            credentialSubject: { id: generateTestDid() },
          },
        ],
      }

      const result = await witness.verifyPresentation('conn-alice', presentationJson)

      expect(result.verified).toBe(false)
      expect(result.error).toContain('not a RelationshipCredential')
    })

    it('should reject stale credentials (>5 minutes old)', async () => {
      const sessions = (witness as any).activeSessions
      const session = sessions.get(sessionId)

      const oldDate = new Date()
      oldDate.setMinutes(oldDate.getMinutes() - 10) // 10 minutes ago

      const presentationJson = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiablePresentation'],
        proof: {
          type: 'Ed25519Signature2018',
          challenge: session.challenge,
          domain: session.domain,
        },
        verifiableCredential: [
          {
            '@context': ['https://www.w3.org/2018/credentials/v1', RELATIONSHIP_CONTEXT_URL],
            type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
            issuer: generateTestDid(),
            issuanceDate: oldDate.toISOString(),
            credentialSubject: { id: generateTestDid() },
          },
        ],
      }

      const result = await witness.verifyPresentation('conn-alice', presentationJson)

      expect(result.verified).toBe(false)
      expect(result.error).toContain('not fresh')
    })

    it('should accept valid presentation with fresh VRC', async () => {
      const sessions = (witness as any).activeSessions
      const session = sessions.get(sessionId)

      const presentationJson = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiablePresentation'],
        proof: {
          type: 'Ed25519Signature2018',
          challenge: session.challenge,
          domain: session.domain,
        },
        verifiableCredential: [
          {
            '@context': ['https://www.w3.org/2018/credentials/v1', RELATIONSHIP_CONTEXT_URL],
            type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
            issuer: generateTestDid(),
            issuanceDate: new Date().toISOString(),
            credentialSubject: { id: generateTestDid() },
          },
        ],
      }

      const result = await witness.verifyPresentation('conn-alice', presentationJson)

      expect(result.verified).toBe(true)
      expect(result.sessionId).toBe(sessionId)
    })
  })

  describe('issueWitnessCredentials', () => {
    let sessionId: string
    const aliceConnectionId = 'conn-alice'
    const bobConnectionId = 'conn-bob'

    beforeEach(async () => {
      mockAgent.basicMessages.sendMessage.mockResolvedValue(undefined)
      mockAgent.credentials.offerCredential.mockResolvedValue({})

      // Mock issuer DID
      const mockDid = generateTestDid()
      ;(witness as any).issuerDid = mockDid
      ;(witness as any).issuerVerificationMethodId = `${mockDid}#key-1`

      // Create session
      const result = await witness.createWitnessedSession(aliceConnectionId, bobConnectionId)
      sessionId = result.sessionId
    })

    it('should throw error if session not found', async () => {
      await expect(witness.issueWitnessCredentials('invalid-session')).rejects.toThrow('not found')
    })

    it('should throw error if session incomplete', async () => {
      // Session has no presentations yet
      await expect(witness.issueWitnessCredentials(sessionId)).rejects.toThrow('incomplete')
    })

    it('should issue WVCs to both participants when session complete', async () => {
      // Add two valid presentations to the session
      const sessions = (witness as any).activeSessions
      const session = sessions.get(sessionId)

      const mockPresentation1 = {
        verifiableCredential: [
          {
            '@context': ['https://www.w3.org/2018/credentials/v1', RELATIONSHIP_CONTEXT_URL],
            type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
            issuer: generateTestDid(),
            issuanceDate: new Date().toISOString(),
            credentialSubject: { id: generateTestDid() },
          },
        ],
      }

      const mockPresentation2 = {
        verifiableCredential: [
          {
            '@context': ['https://www.w3.org/2018/credentials/v1', RELATIONSHIP_CONTEXT_URL],
            type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
            issuer: generateTestDid(),
            issuanceDate: new Date().toISOString(),
            credentialSubject: { id: generateTestDid() },
          },
        ],
      }

      session.receivedPresentations.set(aliceConnectionId, mockPresentation1)
      session.receivedPresentations.set(bobConnectionId, mockPresentation2)

      await witness.issueWitnessCredentials(sessionId)

      expect(mockAgent.credentials.offerCredential).toHaveBeenCalledTimes(2)
    })

    it('should create WVC with correct structure including digest and witnessContext', async () => {
      const sessions = (witness as any).activeSessions
      const session = sessions.get(sessionId)

      const vrcIssuer = generateTestDid()
      const vrc = {
        '@context': ['https://www.w3.org/2018/credentials/v1', RELATIONSHIP_CONTEXT_URL],
        type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
        issuer: vrcIssuer,
        issuanceDate: new Date().toISOString(),
        credentialSubject: { id: generateTestDid() },
      }

      const mockPresentation = {
        verifiableCredential: [vrc],
      }

      session.receivedPresentations.set(aliceConnectionId, mockPresentation)
      session.receivedPresentations.set(bobConnectionId, mockPresentation)

      await witness.issueWitnessCredentials(sessionId)

      const firstCall = mockAgent.credentials.offerCredential.mock.calls[0][0]
      const witnessCredential = firstCall.credentialFormats.jsonld.credential

      // Check WVC structure
      expect(witnessCredential.type).toContain('WitnessCredential')
      expect(witnessCredential.credentialSubject.id).toBe(vrcIssuer)
      expect(witnessCredential.credentialSubject.digest).toMatch(/^sha256:/)
      expect(witnessCredential.credentialSubject.witnessContext).toBeDefined()
      expect(witnessCredential.credentialSubject.witnessContext.sessionId).toBe(sessionId)
      expect(witnessCredential.credentialSubject.witnessContext.method).toBe('session-based-challenge')
    })

    it('should include event name in witnessContext when WITNESS_EVENT_NAME is set', async () => {
      const originalEnv = process.env.WITNESS_EVENT_NAME
      process.env.WITNESS_EVENT_NAME = 'EthDenver 2024'

      // Create new witness with event name
      const witnessWithEvent = new Witness(9005, 'test-witness-event')
      witnessWithEvent.agent = mockAgent
      ;(witnessWithEvent as any).issuerDid = generateTestDid()
      ;(witnessWithEvent as any).issuerVerificationMethodId = 'did:example:witness#key-1'

      // Create session
      mockAgent.basicMessages.sendMessage.mockResolvedValue(undefined)
      const { sessionId: eventSessionId } = await witnessWithEvent.createWitnessedSession(
        aliceConnectionId,
        bobConnectionId
      )

      // Add presentations
      const sessions = (witnessWithEvent as any).activeSessions
      const session = sessions.get(eventSessionId)

      const vrc = {
        '@context': ['https://www.w3.org/2018/credentials/v1', RELATIONSHIP_CONTEXT_URL],
        type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
        issuer: generateTestDid(),
        issuanceDate: new Date().toISOString(),
        credentialSubject: { id: generateTestDid() },
      }

      const mockPresentation = {
        verifiableCredential: [vrc],
      }

      session.receivedPresentations.set(aliceConnectionId, mockPresentation)
      session.receivedPresentations.set(bobConnectionId, mockPresentation)

      mockAgent.credentials.offerCredential.mockResolvedValue({})
      await witnessWithEvent.issueWitnessCredentials(eventSessionId)

      const firstCall = mockAgent.credentials.offerCredential.mock.calls[0][0]
      const witnessCredential = firstCall.credentialFormats.jsonld.credential

      // Verify event is included in witnessContext
      expect(witnessCredential.credentialSubject.witnessContext.event).toBe('EthDenver 2024')

      // Restore env
      if (originalEnv !== undefined) {
        process.env.WITNESS_EVENT_NAME = originalEnv
      } else {
        delete process.env.WITNESS_EVENT_NAME
      }
    })

    it('should use default event name when WITNESS_EVENT_NAME is not set', async () => {
      const originalEnv = process.env.WITNESS_EVENT_NAME
      delete process.env.WITNESS_EVENT_NAME

      // Create new witness without event name
      const witnessNoEvent = new Witness(9006, 'test-witness-no-event')
      witnessNoEvent.agent = mockAgent
      ;(witnessNoEvent as any).issuerDid = generateTestDid()
      ;(witnessNoEvent as any).issuerVerificationMethodId = 'did:example:witness#key-1'

      // Create session
      mockAgent.basicMessages.sendMessage.mockResolvedValue(undefined)
      const { sessionId: noEventSessionId } = await witnessNoEvent.createWitnessedSession(
        aliceConnectionId,
        bobConnectionId
      )

      // Add presentations
      const sessions = (witnessNoEvent as any).activeSessions
      const session = sessions.get(noEventSessionId)

      const vrc = {
        '@context': ['https://www.w3.org/2018/credentials/v1', RELATIONSHIP_CONTEXT_URL],
        type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
        issuer: generateTestDid(),
        issuanceDate: new Date().toISOString(),
        credentialSubject: { id: generateTestDid() },
      }

      const mockPresentation = {
        verifiableCredential: [vrc],
      }

      session.receivedPresentations.set(aliceConnectionId, mockPresentation)
      session.receivedPresentations.set(bobConnectionId, mockPresentation)

      mockAgent.credentials.offerCredential.mockResolvedValue({})
      await witnessNoEvent.issueWitnessCredentials(noEventSessionId)

      const firstCall = mockAgent.credentials.offerCredential.mock.calls[0][0]
      const witnessCredential = firstCall.credentialFormats.jsonld.credential

      // Verify default event is used
      expect(witnessCredential.credentialSubject.witnessContext.event).toBe('Witnessed Exchange')

      // Restore env
      if (originalEnv !== undefined) {
        process.env.WITNESS_EVENT_NAME = originalEnv
      }
    })

    it('should compute correct SHA-256 digest of VRC', async () => {
      const sessions = (witness as any).activeSessions
      const session = sessions.get(sessionId)

      const vrc = {
        '@context': ['https://www.w3.org/2018/credentials/v1', RELATIONSHIP_CONTEXT_URL],
        type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
        issuer: generateTestDid(),
        issuanceDate: new Date().toISOString(),
        credentialSubject: { id: generateTestDid() },
      }

      const mockPresentation = {
        verifiableCredential: [vrc],
      }

      session.receivedPresentations.set(aliceConnectionId, mockPresentation)
      session.receivedPresentations.set(bobConnectionId, mockPresentation)

      await witness.issueWitnessCredentials(sessionId)

      const firstCall = mockAgent.credentials.offerCredential.mock.calls[0][0]
      const witnessCredential = firstCall.credentialFormats.jsonld.credential

      // Compute expected digest
      const vrcCanonical = JSON.stringify(vrc, Object.keys(vrc).sort())
      const expectedDigest = 'sha256:' + createHash('sha256').update(vrcCanonical).digest('hex')

      expect(witnessCredential.credentialSubject.digest).toBe(expectedDigest)
    })

    it('should clean up session after issuing credentials', async () => {
      const sessions = (witness as any).activeSessions
      const session = sessions.get(sessionId)

      const mockPresentation = {
        verifiableCredential: [
          {
            '@context': ['https://www.w3.org/2018/credentials/v1', RELATIONSHIP_CONTEXT_URL],
            type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
            issuer: generateTestDid(),
            issuanceDate: new Date().toISOString(),
            credentialSubject: { id: generateTestDid() },
          },
        ],
      }

      session.receivedPresentations.set(aliceConnectionId, mockPresentation)
      session.receivedPresentations.set(bobConnectionId, mockPresentation)

      await witness.issueWitnessCredentials(sessionId)

      expect(sessions.has(sessionId)).toBe(false)
    })
  })

  describe('listActiveSessions', () => {
    it('should handle no active sessions gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

      await witness.listActiveSessions()

      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('should list session details when sessions exist', async () => {
      mockAgent.basicMessages.sendMessage.mockResolvedValue(undefined)

      // Create a session
      await witness.createWitnessedSession('conn-alice', 'conn-bob')

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

      await witness.listActiveSessions()

      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })

  describe('sendMessage', () => {
    const connectionId = 'conn-123'
    const message = 'Test message'

    beforeEach(() => {
      mockAgent.basicMessages.sendMessage.mockResolvedValue(undefined)
    })

    it('should send message to specified connection', async () => {
      await witness.sendMessage(connectionId, message)

      expect(mockAgent.basicMessages.sendMessage).toHaveBeenCalledWith(connectionId, message)
    })
  })

  describe('exit', () => {
    it('should shutdown agent and exit process', async () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(witness.exit()).rejects.toThrow('process.exit called')

      expect(mockAgent.shutdown).toHaveBeenCalled()
      mockExit.mockRestore()
    })
  })

  describe('restart', () => {
    it('should shutdown agent', async () => {
      await witness.restart()

      expect(mockAgent.shutdown).toHaveBeenCalled()
    })
  })
})
