/**
 * Tests for RelationshipDidRepository
 * 
 * This repository manages the storage and retrieval of relationship DID mappings
 * for VRC bidirectional exchange. Each record maps:
 * - counterpartyConnectionDid: The connection's theirDid (did:peer:1z...) 
 * - myRelationshipDid: My relationship DID for this counterparty (did:peer:0z6Mk...)
 * - counterpartyRelationshipDid: Counterparty's relationship DID (did:peer:0z6Mk...)
 */

// Helper to create mock records with all required methods
const createMockRecord = (props: {
  id?: string
  counterpartyConnectionDid: string
  myRelationshipDid: string
  counterpartyRelationshipDid?: string
  connectionId?: string
}) => ({
  id: props.id ?? `mock-uuid-${Math.random().toString(36).substring(7)}`,
  counterpartyConnectionDid: props.counterpartyConnectionDid,
  myRelationshipDid: props.myRelationshipDid,
  counterpartyRelationshipDid: props.counterpartyRelationshipDid,
  connectionId: props.connectionId,
  createdAt: new Date(),
  type: 'RelationshipDidRecord',
  _tags: {},
  getTags() {
    return {
      counterpartyConnectionDid: this.counterpartyConnectionDid,
      counterpartyRelationshipDid: this.counterpartyRelationshipDid,
    }
  },
  clone() {
    return { ...this }
  },
})

// Mock the RelationshipDidRecord class
jest.mock('../../../src/modules/vrc/types/RelationshipDidRecord', () => ({
  RelationshipDidRecord: jest.fn().mockImplementation((props: any) => createMockRecord(props)),
}))

// Mock the Repository base class methods we need
const mockSave = jest.fn()
const mockUpdate = jest.fn()
const mockDelete = jest.fn()
const mockFindByQuery = jest.fn()

jest.mock('@credo-ts/core', () => {
  const actual = jest.requireActual('@credo-ts/core')
  return {
    ...actual,
    Repository: class MockRepository {
      protected storageService: any
      protected eventEmitter: any
      
      constructor() {
        // No-op
      }
      
      async save(_context: any, record: any) {
        mockSave(record)
      }
      
      async update(_context: any, record: any) {
        mockUpdate(record)
      }
      
      async delete(_context: any, record: any) {
        mockDelete(record)
      }
      
      async findByQuery(_context: any, query: any) {
        return mockFindByQuery(query)
      }
    },
  }
})

// Import after mocks are set up
import { RelationshipDidRepository } from '../../../src/modules/vrc/repositories/RelationshipDidRepository'

describe('RelationshipDidRepository', () => {
  let repository: RelationshipDidRepository
  let mockAgentContext: any

  // Test DIDs - using realistic did:peer formats
  const testDids = {
    // Connection DIDs (did:peer:1 - used for DIDComm connections)
    counterpartyConnectionDid: 'did:peer:1zQmZMygzYqNwU6Uhmewx5Xepf2VLp5S4HLSwwgf2aiKZuwa',
    // Relationship DIDs (did:peer:0 - used for VRC credentials)
    myRelationshipDid: 'did:peer:0z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    counterpartyRelationshipDid: 'did:peer:0z6MknGc3ocHs3zdPiJbnaaqDi58NGb4pk1Sp9WNhJhvaFed',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockAgentContext = {}
    repository = new RelationshipDidRepository({} as any, {} as any)
  })

  describe('findByConnectionDid', () => {
    it('should return record when counterpartyConnectionDid exists', async () => {
      const existingRecord = createMockRecord({
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: testDids.myRelationshipDid,
      })

      mockFindByQuery.mockResolvedValue([existingRecord])

      const result = await repository.findByConnectionDid(
        mockAgentContext,
        testDids.counterpartyConnectionDid
      )

      expect(result).toBe(existingRecord)
      expect(mockFindByQuery).toHaveBeenCalledWith(
        { counterpartyConnectionDid: testDids.counterpartyConnectionDid }
      )
    })

    it('should return null when no record found', async () => {
      mockFindByQuery.mockResolvedValue([])

      const result = await repository.findByConnectionDid(
        mockAgentContext,
        'did:peer:1zNonExistent'
      )

      expect(result).toBeNull()
    })

    it('should return first record when multiple exist (edge case)', async () => {
      const record1 = createMockRecord({
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: testDids.myRelationshipDid,
      })
      const record2 = createMockRecord({
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: 'did:peer:0z6MkDuplicate',
      })

      mockFindByQuery.mockResolvedValue([record1, record2])

      const result = await repository.findByConnectionDid(
        mockAgentContext,
        testDids.counterpartyConnectionDid
      )

      // Should return first match
      expect(result).toBe(record1)
    })
  })

  describe('findByCounterpartyRelationshipDid', () => {
    it('should return record via tag query (fast path)', async () => {
      const existingRecord = createMockRecord({
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: testDids.myRelationshipDid,
        counterpartyRelationshipDid: testDids.counterpartyRelationshipDid,
      })

      // Tag query finds the record
      mockFindByQuery.mockResolvedValue([existingRecord])

      const result = await repository.findByCounterpartyRelationshipDid(
        mockAgentContext,
        testDids.counterpartyRelationshipDid
      )

      expect(result).toBe(existingRecord)
      expect(mockFindByQuery).toHaveBeenCalledWith(
        { counterpartyRelationshipDid: testDids.counterpartyRelationshipDid }
      )
    })

    it('should return record via manual fallback for legacy records', async () => {
      const legacyRecord = createMockRecord({
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: testDids.myRelationshipDid,
        counterpartyRelationshipDid: testDids.counterpartyRelationshipDid,
      })

      // Tag query returns empty (legacy record without tag index)
      // Then getAll returns the record
      mockFindByQuery
        .mockResolvedValueOnce([]) // First call for tag query
        .mockResolvedValueOnce([legacyRecord]) // Second call for getAll

      const result = await repository.findByCounterpartyRelationshipDid(
        mockAgentContext,
        testDids.counterpartyRelationshipDid
      )

      expect(result).toBe(legacyRecord)
      // Should have called findByQuery twice (once for tag, once for getAll)
      expect(mockFindByQuery).toHaveBeenCalledTimes(2)
    })

    it('should return null when not found in tag query or manual search', async () => {
      mockFindByQuery.mockResolvedValue([])

      const result = await repository.findByCounterpartyRelationshipDid(
        mockAgentContext,
        'did:peer:0z6MkNonExistent'
      )

      expect(result).toBeNull()
    })
  })

  describe('createOrUpdate', () => {
    it('should create new record when none exists', async () => {
      mockFindByQuery.mockResolvedValue([])

      const result = await repository.createOrUpdate(
        mockAgentContext,
        testDids.counterpartyConnectionDid,
        testDids.myRelationshipDid,
        'connection-123'
      )

      expect(result.counterpartyConnectionDid).toBe(testDids.counterpartyConnectionDid)
      expect(result.myRelationshipDid).toBe(testDids.myRelationshipDid)
      expect(result.connectionId).toBe('connection-123')
      expect(mockSave).toHaveBeenCalled()
    })

    it('should update existing record when found', async () => {
      const existingRecord = createMockRecord({
        id: 'existing-id',
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: 'did:peer:0z6MkOldDid',
      })

      mockFindByQuery.mockResolvedValue([existingRecord])

      const result = await repository.createOrUpdate(
        mockAgentContext,
        testDids.counterpartyConnectionDid,
        testDids.myRelationshipDid,
        'connection-456'
      )

      expect(result.id).toBe('existing-id')
      expect(result.myRelationshipDid).toBe(testDids.myRelationshipDid)
      expect(result.connectionId).toBe('connection-456')
      expect(mockUpdate).toHaveBeenCalled()
      expect(mockSave).not.toHaveBeenCalled()
    })
  })

  describe('updateCounterpartyRelationshipDid', () => {
    it('should update counterparty relationship DID on existing record', async () => {
      const existingRecord = createMockRecord({
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: testDids.myRelationshipDid,
      })

      mockFindByQuery.mockResolvedValue([existingRecord])

      const result = await repository.updateCounterpartyRelationshipDid(
        mockAgentContext,
        testDids.counterpartyConnectionDid,
        testDids.counterpartyRelationshipDid
      )

      expect(result).not.toBeNull()
      expect(result?.counterpartyRelationshipDid).toBe(testDids.counterpartyRelationshipDid)
      expect(mockUpdate).toHaveBeenCalled()
    })

    it('should return null when record not found', async () => {
      mockFindByQuery.mockResolvedValue([])

      const result = await repository.updateCounterpartyRelationshipDid(
        mockAgentContext,
        'did:peer:1zNonExistent',
        testDids.counterpartyRelationshipDid
      )

      expect(result).toBeNull()
      expect(mockUpdate).not.toHaveBeenCalled()
    })
  })

  describe('deleteByConnectionDid', () => {
    it('should delete existing record', async () => {
      const existingRecord = createMockRecord({
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: testDids.myRelationshipDid,
      })

      mockFindByQuery.mockResolvedValue([existingRecord])

      await repository.deleteByConnectionDid(
        mockAgentContext,
        testDids.counterpartyConnectionDid
      )

      expect(mockDelete).toHaveBeenCalledWith(existingRecord)
    })

    it('should do nothing when record not found', async () => {
      mockFindByQuery.mockResolvedValue([])

      await repository.deleteByConnectionDid(
        mockAgentContext,
        'did:peer:1zNonExistent'
      )

      expect(mockDelete).not.toHaveBeenCalled()
    })
  })

  describe('getAll', () => {
    it('should return all relationship DID records', async () => {
      const records = [
        createMockRecord({
          counterpartyConnectionDid: 'did:peer:1zParty1',
          myRelationshipDid: 'did:peer:0z6MkMyDid1',
        }),
        createMockRecord({
          counterpartyConnectionDid: 'did:peer:1zParty2',
          myRelationshipDid: 'did:peer:0z6MkMyDid2',
        }),
      ]

      mockFindByQuery.mockResolvedValue(records)

      const result = await repository.getAll(mockAgentContext)

      expect(result).toHaveLength(2)
      expect(mockFindByQuery).toHaveBeenCalledWith({})
    })

    it('should return empty array when no records exist', async () => {
      mockFindByQuery.mockResolvedValue([])

      const result = await repository.getAll(mockAgentContext)

      expect(result).toHaveLength(0)
    })
  })

  describe('DID Peer Format Validation', () => {
    /**
     * These tests verify that the repository correctly handles
     * the different did:peer formats used in VRC:
     * - did:peer:0 - Relationship DIDs (standalone keys)
     * - did:peer:1 - Connection DIDs (DIDComm)
     */

    it('should store connection DID (peer:1) and relationship DID (peer:0) correctly', async () => {
      const connectionDid = 'did:peer:1zQmZMygzYqNwU6Uhmewx5Xepf2VLp5S4HLSwwgf2aiKZuwa'
      const relationshipDid = 'did:peer:0z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'

      mockFindByQuery.mockResolvedValue([])

      const result = await repository.createOrUpdate(mockAgentContext, connectionDid, relationshipDid)

      // Verify the DIDs are stored correctly
      expect(result.counterpartyConnectionDid).toBe(connectionDid)
      expect(result.myRelationshipDid).toBe(relationshipDid)
      
      // Verify format distinction
      expect(result.counterpartyConnectionDid).toMatch(/^did:peer:1/)
      expect(result.myRelationshipDid).toMatch(/^did:peer:0/)
    })

    it('should store counterpartyRelationshipDid with correct peer:0 format', async () => {
      const record = createMockRecord({
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: testDids.myRelationshipDid,
      })

      mockFindByQuery.mockResolvedValue([record])

      const result = await repository.updateCounterpartyRelationshipDid(
        mockAgentContext,
        testDids.counterpartyConnectionDid,
        testDids.counterpartyRelationshipDid
      )

      // Verify counterpartyRelationshipDid is peer:0 format
      expect(result?.counterpartyRelationshipDid).toMatch(/^did:peer:0/)
    })
  })
})
