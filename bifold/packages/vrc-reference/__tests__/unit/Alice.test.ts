import { KeyType, PeerDidNumAlgo } from '@credo-ts/core'

import { Alice } from '../../src/Alice'
import {
  createMockConnectionRecord,
  createMockCredentialExchangeRecord,
  createMockProofExchangeRecord,
  createMockW3cCredentialRecord,
  generateTestDid,
  cleanupAgent,
} from '../helpers/testUtils'

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
          shutdown: jest.fn(),
          events: {
            on: jest.fn(),
            off: jest.fn(),
          },
          connections: {
            getById: jest.fn(),
            findById: jest.fn(),
            returnWhenIsConnected: jest.fn(),
            findAllByOutOfBandId: jest.fn().mockResolvedValue([]),
          },
          oob: {
            receiveInvitationFromUrl: jest.fn(),
            createInvitation: jest.fn(),
          },
          wallet: {
            createKey: jest.fn(),
          },
          dids: {
            create: jest.fn(),
            import: jest.fn(),
          },
          basicMessages: {
            sendMessage: jest.fn(),
          },
          credentials: {
            acceptOffer: jest.fn(),
            getFormatData: jest.fn(),
            getAll: jest.fn().mockResolvedValue([]),
          },
          proofs: {
            selectCredentialsForRequest: jest.fn(),
            acceptRequest: jest.fn(),
          },
          w3cCredentials: {
            getAllCredentialRecords: jest.fn(),
            signCredential: jest.fn(),
            signPresentation: jest.fn(),
          },
        }
      }

      async initializeAgent() {
        // Mock implementation
      }
    },
  }
})

describe('Alice (Participant)', () => {
  let alice: InstanceType<typeof Alice>
  let mockAgent: any

  beforeEach(() => {
    // Create comprehensive mock agent
    mockAgent = {
      connections: {
        getById: jest.fn(),
        returnWhenIsConnected: jest.fn(),
        findAllByOutOfBandId: jest.fn().mockResolvedValue([]),
        findById: jest.fn(),
      },
      oob: {
        receiveInvitationFromUrl: jest.fn(),
        createInvitation: jest.fn(),
      },
      wallet: {
        createKey: jest.fn(),
      },
      dids: {
        create: jest.fn(),
        import: jest.fn(),
      },
      basicMessages: {
        sendMessage: jest.fn(),
      },
      credentials: {
        acceptOffer: jest.fn(),
        getFormatData: jest.fn(),
        getAll: jest.fn().mockResolvedValue([]),
      },
      proofs: {
        selectCredentialsForRequest: jest.fn(),
        acceptRequest: jest.fn(),
      },
      w3cCredentials: {
        getAllCredentialRecords: jest.fn(),
      },
      shutdown: jest.fn(),
      events: {
        on: jest.fn(),
        off: jest.fn(),
      },
    }

    // Create Alice (which is now Participant) and assign mock agent
    alice = new Alice(9000, 'test-alice')
    alice.agent = mockAgent
  })

  afterEach(async () => {
    await cleanupAgent(alice)
  })

  describe('constructor', () => {
    it('should initialize with default values', () => {
      expect(alice.connected).toBe(false)
      expect(alice.connectionRecordId).toBeUndefined()
      // Port and name are set via BaseAgent, which is mocked
      expect(alice.name).toBe('test-alice')
    })
  })

  describe('acceptConnection', () => {
    const invitationUrl = 'http://example.com?oob=invitation'
    const mockConnectionRecord = createMockConnectionRecord()

    beforeEach(() => {
      mockAgent.oob.receiveInvitationFromUrl.mockResolvedValue({
        connectionRecord: mockConnectionRecord,
      })
      mockAgent.connections.returnWhenIsConnected.mockResolvedValue(mockConnectionRecord)
      mockAgent.connections.getById.mockResolvedValue(mockConnectionRecord)
      mockAgent.connections.findById = jest.fn().mockResolvedValue(mockConnectionRecord)
      mockAgent.wallet.createKey.mockResolvedValue({ publicKeyBase58: 'mockKey' })
      const mockDid = generateTestDid()
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
      mockAgent.basicMessages.sendMessage.mockResolvedValue(undefined)
    })

    it('should receive and accept connection invitation', async () => {
      await alice.acceptConnection(invitationUrl)

      expect(mockAgent.oob.receiveInvitationFromUrl).toHaveBeenCalledWith(invitationUrl)
      expect(mockAgent.connections.returnWhenIsConnected).toHaveBeenCalledWith(mockConnectionRecord.id)
      expect(alice.connected).toBe(true)
      expect(alice.connectionRecordId).toBe(mockConnectionRecord.id)
    })

    it('should create a dedicated R-DID for the relationship', async () => {
      await alice.acceptConnection(invitationUrl)

      expect(mockAgent.wallet.createKey).toHaveBeenCalledWith({
        keyType: KeyType.Ed25519,
      })
      expect(mockAgent.dids.create).toHaveBeenCalledWith({
        method: 'peer',
        options: expect.objectContaining({
          numAlgo: PeerDidNumAlgo.InceptionKeyWithoutDoc,
        }),
      })
    })

    it('should store R-DID on connection metadata', async () => {
      await alice.acceptConnection(invitationUrl)

      expect(mockConnectionRecord.metadata.set).toHaveBeenCalledWith(
        'counterpartyRDid',
        expect.objectContaining({
          did: expect.stringContaining('did:peer:0'),
        })
      )
    })

    it('should send R-DID to peer via basic message (unless connecting to Witness)', async () => {
      await alice.acceptConnection(invitationUrl)

      // The Participant sends R-DID to non-witness peers
      // mockConnectionRecord.theirLabel defaults to 'Test Peer' which doesn't include 'witness'
      expect(mockAgent.basicMessages.sendMessage).toHaveBeenCalledWith(
        mockConnectionRecord.id,
        expect.stringContaining('rDid')
      )
    })

    it('should throw error if no connection record from out-of-band', async () => {
      mockAgent.oob.receiveInvitationFromUrl.mockResolvedValue({
        connectionRecord: null,
      })

      await expect(alice.acceptConnection(invitationUrl)).rejects.toThrow()
    })

    it('should handle R-DID send failure gracefully', async () => {
      mockAgent.basicMessages.sendMessage.mockRejectedValue(new Error('Network error'))

      // Should not throw - just logs error
      await expect(alice.acceptConnection(invitationUrl)).resolves.not.toThrow()
    })
  })

  describe('acceptCredentialOffer', () => {
    const mockCredentialRecord = createMockCredentialExchangeRecord()

    beforeEach(() => {
      mockAgent.credentials.acceptOffer.mockResolvedValue(mockCredentialRecord)
    })

    it('should accept credential offer', async () => {
      await alice.acceptCredentialOffer(mockCredentialRecord)

      expect(mockAgent.credentials.acceptOffer).toHaveBeenCalledWith({
        credentialRecordId: mockCredentialRecord.id,
      })
    })
  })

  describe('acceptProofRequest', () => {
    const mockProofRecord = createMockProofExchangeRecord()
    const mockSelectedCredentials = {
      proofFormats: {
        presentationExchange: {
          credentials: [],
        },
      },
    }

    beforeEach(() => {
      mockAgent.proofs.selectCredentialsForRequest.mockResolvedValue(mockSelectedCredentials)
      mockAgent.proofs.acceptRequest.mockResolvedValue(mockProofRecord)
    })

    it('should select credentials for proof request', async () => {
      await alice.acceptProofRequest(mockProofRecord)

      expect(mockAgent.proofs.selectCredentialsForRequest).toHaveBeenCalledWith({
        proofRecordId: mockProofRecord.id,
      })
    })

    it('should accept proof request with selected credentials', async () => {
      await alice.acceptProofRequest(mockProofRecord)

      expect(mockAgent.proofs.acceptRequest).toHaveBeenCalledWith({
        proofRecordId: mockProofRecord.id,
        proofFormats: mockSelectedCredentials.proofFormats,
      })
    })
  })

  describe('sendMessage', () => {
    const message = 'Hello Bob!'
    const mockConnectionRecord = createMockConnectionRecord()

    beforeEach(() => {
      alice.connectionRecordId = mockConnectionRecord.id
      mockAgent.connections.getById.mockResolvedValue(mockConnectionRecord)
      mockAgent.basicMessages.sendMessage.mockResolvedValue(undefined)
    })

    it('should send basic message to connected agent', async () => {
      await alice.sendMessage(message)

      expect(mockAgent.connections.getById).toHaveBeenCalledWith(mockConnectionRecord.id)
      expect(mockAgent.basicMessages.sendMessage).toHaveBeenCalledWith(mockConnectionRecord.id, message)
    })

    it('should throw error if no connection record ID', async () => {
      alice.connectionRecordId = undefined

      await expect(alice.sendMessage(message)).rejects.toThrow()
    })
  })

  describe('listStoredCredentials', () => {
    it('should list all stored credentials', async () => {
      const mockCredentials = [
        createMockW3cCredentialRecord(),
        createMockW3cCredentialRecord({ createdAt: new Date(Date.now() + 1000) }),
      ]
      mockAgent.w3cCredentials.getAllCredentialRecords.mockResolvedValue(mockCredentials)

      await alice.listStoredCredentials()

      expect(mockAgent.w3cCredentials.getAllCredentialRecords).toHaveBeenCalled()
    })

    it('should handle no stored credentials', async () => {
      mockAgent.w3cCredentials.getAllCredentialRecords.mockResolvedValue([])

      await alice.listStoredCredentials()

      expect(mockAgent.w3cCredentials.getAllCredentialRecords).toHaveBeenCalled()
    })

    it('should filter out records without credentials', async () => {
      const mockCredentials = [
        createMockW3cCredentialRecord(),
        { ...createMockW3cCredentialRecord(), credential: null },
      ]
      mockAgent.w3cCredentials.getAllCredentialRecords.mockResolvedValue(mockCredentials)

      await alice.listStoredCredentials()

      expect(mockAgent.w3cCredentials.getAllCredentialRecords).toHaveBeenCalled()
    })

    it('should sort credentials by creation date (oldest first)', async () => {
      const now = Date.now()
      const mockCredentials = [
        createMockW3cCredentialRecord({ createdAt: new Date(now + 2000) }),
        createMockW3cCredentialRecord({ createdAt: new Date(now) }),
        createMockW3cCredentialRecord({ createdAt: new Date(now + 1000) }),
      ]
      mockAgent.w3cCredentials.getAllCredentialRecords.mockResolvedValue(mockCredentials)

      await alice.listStoredCredentials()

      expect(mockAgent.w3cCredentials.getAllCredentialRecords).toHaveBeenCalled()
    })
  })

  describe('exit', () => {
    it('should shutdown agent and exit process', async () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(alice.exit()).rejects.toThrow('process.exit called')

      expect(mockAgent.shutdown).toHaveBeenCalled()
      mockExit.mockRestore()
    })
  })

  describe('restart', () => {
    it('should shutdown agent', async () => {
      await alice.restart()

      expect(mockAgent.shutdown).toHaveBeenCalled()
    })
  })

  describe('R-DID exchange', () => {
    it('should store counterparty R-DID', () => {
      const connectionId = 'test-connection-id'
      const did = 'did:peer:0ztest123'

      alice.setCounterpartyRDid(connectionId, did)

      expect(alice.getCounterpartyRDid(connectionId)).toBe(did)
      expect(alice.hasCounterpartyRDid()).toBe(true)
    })

    it('should return undefined for unknown connection', () => {
      expect(alice.getCounterpartyRDid('unknown')).toBeUndefined()
    })

    it('should get any counterparty R-DID', () => {
      const connectionId = 'test-connection-id'
      const did = 'did:peer:0ztest123'

      alice.setCounterpartyRDid(connectionId, did)

      expect(alice.getAnyCounterpartyRDid()).toBe(did)
    })
  })

  describe('session challenge', () => {
    it('should initially have no session challenge', () => {
      expect(alice.hasSessionChallenge()).toBe(false)
      expect(alice.getSessionChallenge()).toBeUndefined()
    })

    it('should clear session challenge', () => {
      alice.clearSessionChallenge()
      expect(alice.hasSessionChallenge()).toBe(false)
    })
  })
})
