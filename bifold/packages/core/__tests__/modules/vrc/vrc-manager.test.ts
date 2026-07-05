/**
 * Tests for VRC Manager functions
 * 
 * These functions handle the core VRC (Verifiable Relationship Credential) operations:
 * - Creating and retrieving relationship DIDs
 * - Setting relationship DID metadata on connections
 * - Creating relationship invitations with appropriate goal codes
 */

import { Agent, PeerDidNumAlgo, KeyType } from '@credo-ts/core'

// Test DIDs
const testDids = {
  // Connection DIDs (did:peer:1 - used for DIDComm connections)
  counterpartyConnectionDid: 'did:peer:1zQmZMygzYqNwU6Uhmewx5Xepf2VLp5S4HLSwwgf2aiKZuwa',
  // Relationship DIDs (did:peer:0 - used for VRC credentials)  
  myRelationshipDid: 'did:peer:0z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
  counterpartyRelationshipDid: 'did:peer:0z6MknGc3ocHs3zdPiJbnaaqDi58NGb4pk1Sp9WNhJhvaFed',
}

// Mock repository
const mockRepository = {
  findByConnectionDid: jest.fn(),
  createOrUpdate: jest.fn(),
  updateCounterpartyRelationshipDid: jest.fn(),
}

// Mock connection
const mockConnection = {
  id: 'connection-123',
  theirDid: testDids.counterpartyConnectionDid,
  metadata: {
    get: jest.fn(),
    set: jest.fn(),
  },
}

// Mock logger
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

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
    resolve: jest.fn(),
  },
  connections: {
    getById: jest.fn().mockResolvedValue(mockConnection),
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
    sendMessage: jest.fn(),
  },
  context: {},
})

// Mock the repository import
jest.mock('../../../src/modules/vrc/repositories/RelationshipDidRepository', () => ({
  RelationshipDidRepository: jest.fn(),
}))

// Mock rCardCredential service
jest.mock('../../../src/modules/vrc/services/rCardCredential', () => ({
  loadRCardTemplate: jest.fn().mockResolvedValue(null),
}))

// Import the functions to test
import {
  getOrCreateRelationshipDid,
  setRelationshipDidOnConnection,
  createRelationshipInvitation,
} from '../../../src/modules/vrc/vrc-manager'

describe('VRC Manager', () => {
  let mockAgent: ReturnType<typeof createMockAgent>

  beforeEach(() => {
    jest.clearAllMocks()
    mockAgent = createMockAgent()
  })

  describe('getOrCreateRelationshipDid', () => {
    it('should return existing relationship DID when found in repository', async () => {
      const existingRecord = {
        myRelationshipDid: testDids.myRelationshipDid,
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
      }

      mockRepository.findByConnectionDid.mockResolvedValue(existingRecord)

      const result = await getOrCreateRelationshipDid(
        mockAgent as unknown as Agent,
        testDids.counterpartyConnectionDid
      )

      expect(result).toBe(testDids.myRelationshipDid)
      expect(mockRepository.findByConnectionDid).toHaveBeenCalledWith(
        mockAgent.context,
        testDids.counterpartyConnectionDid
      )
      // Should not create a new DID
      expect(mockAgent.dids.create).not.toHaveBeenCalled()
    })

    it('should create new did:peer:0 when no existing record found', async () => {
      mockRepository.findByConnectionDid.mockResolvedValue(null)
      mockAgent.dids.create.mockResolvedValue({
        didState: {
          did: testDids.myRelationshipDid,
        },
      })

      const result = await getOrCreateRelationshipDid(
        mockAgent as unknown as Agent,
        testDids.counterpartyConnectionDid
      )

      expect(result).toBe(testDids.myRelationshipDid)
      expect(mockAgent.dids.create).toHaveBeenCalledWith({
        method: 'peer',
        options: {
          numAlgo: PeerDidNumAlgo.InceptionKeyWithoutDoc,
          keyType: KeyType.Ed25519,
        },
      })
    })

    it('should store new DID in repository', async () => {
      mockRepository.findByConnectionDid.mockResolvedValue(null)
      mockAgent.dids.create.mockResolvedValue({
        didState: {
          did: testDids.myRelationshipDid,
        },
      })

      await getOrCreateRelationshipDid(
        mockAgent as unknown as Agent,
        testDids.counterpartyConnectionDid,
        'connection-123'
      )

      expect(mockRepository.createOrUpdate).toHaveBeenCalledWith(
        mockAgent.context,
        testDids.counterpartyConnectionDid,
        testDids.myRelationshipDid,
        'connection-123'
      )
    })

    it('should throw error when DID creation fails', async () => {
      mockRepository.findByConnectionDid.mockResolvedValue(null)
      mockAgent.dids.create.mockResolvedValue({
        didState: {
          did: undefined, // DID creation failed
        },
      })

      await expect(
        getOrCreateRelationshipDid(
          mockAgent as unknown as Agent,
          testDids.counterpartyConnectionDid
        )
      ).rejects.toThrow('Failed to create relationship DID')
    })

    it('should log when reusing existing relationship DID', async () => {
      const existingRecord = {
        myRelationshipDid: testDids.myRelationshipDid,
      }
      mockRepository.findByConnectionDid.mockResolvedValue(existingRecord)

      await getOrCreateRelationshipDid(
        mockAgent as unknown as Agent,
        testDids.counterpartyConnectionDid
      )

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Reusing existing relationshipDid')
      )
    })

    it('should log when creating new relationship DID', async () => {
      mockRepository.findByConnectionDid.mockResolvedValue(null)
      mockAgent.dids.create.mockResolvedValue({
        didState: { did: testDids.myRelationshipDid },
      })

      await getOrCreateRelationshipDid(
        mockAgent as unknown as Agent,
        testDids.counterpartyConnectionDid
      )

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Creating new relationshipDid')
      )
    })
  })

  describe('setRelationshipDidOnConnection', () => {
    it('should set relationshipDid in connection metadata', async () => {
      await setRelationshipDidOnConnection(
        mockAgent as unknown as Agent,
        'connection-123',
        testDids.myRelationshipDid
      )

      expect(mockAgent.connections.getById).toHaveBeenCalledWith('connection-123')
      expect(mockConnection.metadata.set).toHaveBeenCalledWith('relationshipDid', {
        did: testDids.myRelationshipDid,
      })
    })
  })

  describe('createRelationshipInvitation', () => {
    const mockInvitationRecord = {
      id: 'oob-record-123',
      outOfBandInvitation: {
        toUrl: jest.fn().mockReturnValue('https://example.com/invite?oob=abc123'),
      },
    }

    beforeEach(() => {
      mockAgent.oob.createInvitation.mockResolvedValue(mockInvitationRecord)
    })

    it('should create OOB invitation with bidirectional goalCode by default', async () => {
      const result = await createRelationshipInvitation(
        mockAgent as unknown as Agent,
        'My Wallet'
      )

      expect(mockAgent.oob.createInvitation).toHaveBeenCalledWith({
        label: 'My Wallet',
        goalCode: 'relationship.credential.bidirectional',
        goal: 'Establish connection and exchange relationship credentials',
      })
      expect(result.record).toBe(mockInvitationRecord)
      expect(result.invitation).toBe(mockInvitationRecord.outOfBandInvitation)
    })

    it('should create OOB invitation with unidirectional goalCode when specified', async () => {
      await createRelationshipInvitation(
        mockAgent as unknown as Agent,
        'My Wallet',
        'unidirectional'
      )

      expect(mockAgent.oob.createInvitation).toHaveBeenCalledWith({
        label: 'My Wallet',
        goalCode: 'relationship.credential',
        goal: 'Establish connection and issue relationship credential',
      })
    })

    it('should return invitation URL', async () => {
      const result = await createRelationshipInvitation(
        mockAgent as unknown as Agent,
        'My Wallet'
      )

      expect(result.invitationUrl).toBe('https://example.com/invite?oob=abc123')
    })

    it('should throw error when agent is undefined', async () => {
      await expect(
        createRelationshipInvitation(undefined, 'My Wallet')
      ).rejects.toThrow('Agent not initialized')
    })

    it('should throw error when invitation creation returns null', async () => {
      mockAgent.oob.createInvitation.mockResolvedValue(null)

      await expect(
        createRelationshipInvitation(mockAgent as unknown as Agent, 'My Wallet')
      ).rejects.toThrow('Could not create relationship invitation')
    })

    it('should log invitation creation steps', async () => {
      await createRelationshipInvitation(
        mockAgent as unknown as Agent,
        'My Wallet'
      )

      // Log is called with message and optional context object
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('createRelationshipInvitation called'),
        expect.any(Object)
      )
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('OOB invitation created successfully')
      )
    })
  })

  describe('DID Format Verification', () => {
    /**
     * These tests verify that the VRC manager correctly creates
     * and uses did:peer:0 format for relationship DIDs
     */

    it('should create did:peer:0 (InceptionKeyWithoutDoc) for relationship DIDs', async () => {
      mockRepository.findByConnectionDid.mockResolvedValue(null)
      mockAgent.dids.create.mockResolvedValue({
        didState: { did: 'did:peer:0z6MknewDid123' },
      })

      const result = await getOrCreateRelationshipDid(
        mockAgent as unknown as Agent,
        testDids.counterpartyConnectionDid
      )

      // Verify we requested peer:0 format
      expect(mockAgent.dids.create).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'peer',
          options: expect.objectContaining({
            numAlgo: PeerDidNumAlgo.InceptionKeyWithoutDoc, // This is peer:0
          }),
        })
      )

      // The result should be a did:peer
      expect(result).toMatch(/^did:peer:/)
    })

    it('should use Ed25519 key type for relationship DIDs', async () => {
      mockRepository.findByConnectionDid.mockResolvedValue(null)
      mockAgent.dids.create.mockResolvedValue({
        didState: { did: testDids.myRelationshipDid },
      })

      await getOrCreateRelationshipDid(
        mockAgent as unknown as Agent,
        testDids.counterpartyConnectionDid
      )

      expect(mockAgent.dids.create).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            keyType: KeyType.Ed25519,
          }),
        })
      )
    })
  })

  describe('Goal Code Verification', () => {
    /**
     * These tests verify correct goal codes for VRC invitations
     * - 'relationship.credential.bidirectional' for two-way exchange
     * - 'relationship.credential' for one-way (issuer only)
     */

    it('should use bidirectional goal code for two-way credential exchange', async () => {
      mockAgent.oob.createInvitation.mockResolvedValue({
        id: 'oob-123',
        outOfBandInvitation: { toUrl: jest.fn().mockReturnValue('url') },
      })

      await createRelationshipInvitation(
        mockAgent as unknown as Agent,
        'Wallet',
        'bidirectional'
      )

      expect(mockAgent.oob.createInvitation).toHaveBeenCalledWith(
        expect.objectContaining({
          goalCode: 'relationship.credential.bidirectional',
        })
      )
    })

    it('should use unidirectional goal code for one-way credential issuance', async () => {
      mockAgent.oob.createInvitation.mockResolvedValue({
        id: 'oob-123',
        outOfBandInvitation: { toUrl: jest.fn().mockReturnValue('url') },
      })

      await createRelationshipInvitation(
        mockAgent as unknown as Agent,
        'Wallet',
        'unidirectional'
      )

      expect(mockAgent.oob.createInvitation).toHaveBeenCalledWith(
        expect.objectContaining({
          goalCode: 'relationship.credential',
        })
      )
    })
  })
})
