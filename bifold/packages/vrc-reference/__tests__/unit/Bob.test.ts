import { Bob } from '../../src/Bob'
import { RELATIONSHIP_CONTEXT_URL } from '../../src/relationshipContext'
import { createMockConnectionRecord, generateTestDid, cleanupAgent } from '../helpers/testUtils'
import { AutoAcceptCredential } from '@credo-ts/core'

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

describe('Bob (Participant)', () => {
  let bob: InstanceType<typeof Bob>
  let mockAgent: any

  beforeEach(() => {
    // Create comprehensive mock agent
    mockAgent = {
      connections: {
        getById: jest.fn(),
        findAllByOutOfBandId: jest.fn(),
        returnWhenIsConnected: jest.fn(),
        findById: jest.fn(),
      },
      oob: {
        createInvitation: jest.fn(),
        receiveInvitationFromUrl: jest.fn(),
      },
      wallet: {
        createKey: jest.fn(),
      },
      dids: {
        create: jest.fn(),
        import: jest.fn(),
      },
      credentials: {
        offerCredential: jest.fn(),
        acceptRequest: jest.fn(),
        acceptOffer: jest.fn(),
        getAll: jest.fn().mockResolvedValue([]),
      },
      proofs: {
        requestProof: jest.fn(),
        selectCredentialsForRequest: jest.fn(),
        acceptRequest: jest.fn(),
      },
      basicMessages: {
        sendMessage: jest.fn(),
      },
      w3cCredentials: {
        getAllCredentialRecords: jest.fn(),
      },
      events: {
        on: jest.fn(),
      },
      shutdown: jest.fn(),
    }

    // Create Bob (which is now Participant) and assign mock agent
    bob = new Bob(9001, 'test-bob')
    bob.agent = mockAgent
  })

  afterEach(async () => {
    await cleanupAgent(bob)
  })

  describe('constructor', () => {
    it('should initialize with correct values', () => {
      // Port and name are set via BaseAgent, which is mocked
      expect(bob.name).toBe('test-bob')
      expect(bob.outOfBandId).toBeUndefined()
      expect(bob.ui).toBeDefined()
      expect(bob.connected).toBe(false)
    })
  })

  describe('setupConnection', () => {
    const mockOutOfBandRecord = {
      id: 'oob-123',
      outOfBandInvitation: {
        toUrl: jest.fn().mockReturnValue('http://example.com?oob=invitation'),
      },
    }
    const mockConnectionRecord = createMockConnectionRecord()

    beforeEach(() => {
      mockAgent.oob.createInvitation.mockResolvedValue(mockOutOfBandRecord)
      mockAgent.connections.findAllByOutOfBandId.mockResolvedValue([mockConnectionRecord])
      mockAgent.connections.returnWhenIsConnected.mockResolvedValue(mockConnectionRecord)
    })

    it('should create out-of-band invitation', async () => {
      await bob.setupConnection()

      expect(mockAgent.oob.createInvitation).toHaveBeenCalled()
      expect(bob.outOfBandId).toBe(mockOutOfBandRecord.id)
    })

    it('should wait for connection to complete', async () => {
      await bob.setupConnection()

      expect(mockAgent.connections.returnWhenIsConnected).toHaveBeenCalledWith(mockConnectionRecord.id)
    })

    it('should handle timeout gracefully', async () => {
      mockAgent.connections.returnWhenIsConnected.mockRejectedValue(new Error('Timeout'))

      await bob.setupConnection()

      expect(mockAgent.connections.returnWhenIsConnected).toHaveBeenCalled()
    })
  })

  describe('issueCredential', () => {
    const mockConnectionRecord = createMockConnectionRecord()
    const mockDid = generateTestDid()

    beforeEach(() => {
      bob.outOfBandId = 'oob-123'
      bob.connectionRecordId = mockConnectionRecord.id
      mockAgent.connections.findAllByOutOfBandId.mockResolvedValue([mockConnectionRecord])
      mockAgent.connections.getById.mockResolvedValue(mockConnectionRecord)
      mockAgent.wallet.createKey.mockResolvedValue({ publicKeyBase58: 'mockKey' })
      mockAgent.dids.create.mockResolvedValue({
        didState: {
          state: 'finished',
          did: mockDid,
          didDocument: {
            id: mockDid,
            verificationMethod: [
              {
                id: `${mockDid}#key-1`,
                type: 'Ed25519VerificationKey2018',
                controller: mockDid,
                publicKeyBase58: 'mockPublicKey',
              },
            ],
            assertionMethod: [`${mockDid}#key-1`],
            authentication: [`${mockDid}#key-1`],
          },
        },
      })
      mockAgent.dids.import = jest.fn().mockResolvedValue(undefined)
      mockAgent.credentials.offerCredential.mockResolvedValue({})
    })

    it('should build and offer relationship credential', async () => {
      await bob.issueCredential()

      expect(mockAgent.credentials.offerCredential).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: mockConnectionRecord.id,
          protocolVersion: 'v2',
          autoAcceptCredential: AutoAcceptCredential.Never,
          credentialFormats: {
            jsonld: expect.objectContaining({
              credential: expect.objectContaining({
                type: expect.arrayContaining(['VerifiableCredential', 'DTGCredential', 'RelationshipCredential']),
              }),
              options: {
                proofType: 'Ed25519Signature2018',
                proofPurpose: 'assertionMethod',
              },
            }),
          },
        })
      )
    })

    it('should use holder subject DID from metadata if available', async () => {
      const holderDid = generateTestDid()
      const connectionWithMetadata = {
        ...mockConnectionRecord,
        metadata: {
          get: jest.fn().mockReturnValue({ did: holderDid }),
          set: jest.fn(),
        },
      }
      mockAgent.connections.findAllByOutOfBandId.mockResolvedValue([connectionWithMetadata])
      mockAgent.connections.getById.mockResolvedValue(connectionWithMetadata)

      await bob.issueCredential()

      expect(mockAgent.credentials.offerCredential).toHaveBeenCalledWith(
        expect.objectContaining({
          credentialFormats: {
            jsonld: expect.objectContaining({
              credential: expect.objectContaining({
                credentialSubject: expect.objectContaining({
                  id: holderDid,
                }),
              }),
            }),
          },
        })
      )
    })

    it('should include relationship context in credential', async () => {
      await bob.issueCredential()

      expect(mockAgent.credentials.offerCredential).toHaveBeenCalledWith(
        expect.objectContaining({
          credentialFormats: {
            jsonld: expect.objectContaining({
              credential: expect.objectContaining({
                '@context': expect.arrayContaining([RELATIONSHIP_CONTEXT_URL]),
              }),
            }),
          },
        })
      )
    })

    it('should throw error if no connection', async () => {
      bob.outOfBandId = undefined
      bob.connectionRecordId = undefined

      await expect(bob.issueCredential()).rejects.toThrow()
    })
  })

  describe('sendProofRequest', () => {
    const mockConnectionRecord = createMockConnectionRecord()

    beforeEach(() => {
      bob.outOfBandId = 'oob-123'
      bob.connectionRecordId = mockConnectionRecord.id
      mockAgent.connections.findAllByOutOfBandId.mockResolvedValue([mockConnectionRecord])
      mockAgent.connections.getById.mockResolvedValue(mockConnectionRecord)
      mockAgent.proofs.requestProof.mockResolvedValue({})
    })

    it('should send proof request for relationship credential', async () => {
      await bob.sendProofRequest()

      expect(mockAgent.proofs.requestProof).toHaveBeenCalledWith({
        protocolVersion: 'v2',
        connectionId: mockConnectionRecord.id,
        proofFormats: {
          presentationExchange: {
            presentationDefinition: expect.objectContaining({
              input_descriptors: expect.arrayContaining([
                expect.objectContaining({
                  name: 'Relationship Credential',
                  schema: [{ uri: RELATIONSHIP_CONTEXT_URL }],
                  constraints: {
                    fields: [
                      {
                        path: ['$.type[*]'],
                        filter: {
                          type: 'string',
                          const: 'RelationshipCredential',
                        },
                      },
                    ],
                  },
                }),
              ]),
            }),
          },
        },
      })
    })

    it('should throw error if no connection', async () => {
      bob.outOfBandId = undefined
      bob.connectionRecordId = undefined

      await expect(bob.sendProofRequest()).rejects.toThrow()
    })
  })

  describe('sendMessage', () => {
    const mockConnectionRecord = createMockConnectionRecord()

    beforeEach(() => {
      bob.outOfBandId = 'oob-123'
      bob.connectionRecordId = mockConnectionRecord.id
      mockAgent.connections.findAllByOutOfBandId.mockResolvedValue([mockConnectionRecord])
      mockAgent.connections.getById.mockResolvedValue(mockConnectionRecord)
      mockAgent.basicMessages.sendMessage.mockResolvedValue(undefined)
    })

    it('should send basic message', async () => {
      const message = 'Hello Alice!'

      await bob.sendMessage(message)

      expect(mockAgent.basicMessages.sendMessage).toHaveBeenCalledWith(mockConnectionRecord.id, message)
    })

    it('should throw error if no connection', async () => {
      bob.outOfBandId = undefined
      bob.connectionRecordId = undefined

      await expect(bob.sendMessage('test')).rejects.toThrow()
    })
  })

  describe('R-DID exchange', () => {
    it('should store counterparty R-DID', () => {
      const connectionId = 'conn-123'
      const did = generateTestDid()

      bob.setCounterpartyRDid(connectionId, did)

      expect(bob.getCounterpartyRDid(connectionId)).toBe(did)
      expect(bob.hasCounterpartyRDid()).toBe(true)
    })

    it('should return undefined for unknown connection', () => {
      expect(bob.getCounterpartyRDid('unknown')).toBeUndefined()
    })

    it('should get any counterparty R-DID', () => {
      const connectionId = 'test-connection-id'
      const did = 'did:peer:0ztest123'

      bob.setCounterpartyRDid(connectionId, did)

      expect(bob.getAnyCounterpartyRDid()).toBe(did)
    })
  })

  describe('session challenge', () => {
    it('should initially have no session challenge', () => {
      expect(bob.hasSessionChallenge()).toBe(false)
      expect(bob.getSessionChallenge()).toBeUndefined()
    })

    it('should clear session challenge', () => {
      bob.clearSessionChallenge()
      expect(bob.hasSessionChallenge()).toBe(false)
    })
  })

  describe('exit', () => {
    it('should shutdown agent and exit process', async () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(bob.exit()).rejects.toThrow('process.exit called')

      expect(mockAgent.shutdown).toHaveBeenCalled()
      mockExit.mockRestore()
    })
  })

  describe('restart', () => {
    it('should shutdown agent', async () => {
      await bob.restart()

      expect(mockAgent.shutdown).toHaveBeenCalled()
    })
  })
})
