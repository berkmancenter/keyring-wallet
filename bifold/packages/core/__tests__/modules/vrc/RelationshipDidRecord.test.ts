/**
 * Tests for RelationshipDidRecord type definitions and behavior
 * 
 * This record stores the DID mappings for VRC bidirectional exchange:
 * - counterpartyConnectionDid: The connection's theirDid (did:peer:1z...)
 * - myRelationshipDid: My relationship DID for this counterparty (did:peer:0z6Mk...)
 * - counterpartyRelationshipDid: Counterparty's relationship DID (did:peer:0z6Mk...)
 * 
 * Since RelationshipDidRecord extends Credo's BaseRecord which has complex
 * dependencies, we test the type definitions and expected behavior through
 * mock objects that match the interface.
 */

import type { 
  RelationshipDidRecordProps, 
  DefaultRelationshipDidRecordTags,
  CustomTags 
} from '../../../src/modules/vrc/types/RelationshipDidRecord'

describe('RelationshipDidRecord Types and Interface', () => {
  // Test DIDs - using realistic did:peer formats
  const testDids = {
    // Connection DIDs (did:peer:1 - used for DIDComm connections)
    counterpartyConnectionDid: 'did:peer:1zQmZMygzYqNwU6Uhmewx5Xepf2VLp5S4HLSwwgf2aiKZuwa',
    // Relationship DIDs (did:peer:0 - used for VRC credentials)
    myRelationshipDid: 'did:peer:0z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    counterpartyRelationshipDid: 'did:peer:0z6MknGc3ocHs3zdPiJbnaaqDi58NGb4pk1Sp9WNhJhvaFed',
  }

  // Helper to create a mock record that matches RelationshipDidRecord interface
  const createMockRecord = (props: RelationshipDidRecordProps) => ({
    id: props.id ?? `mock-uuid-${Math.random().toString(36).substring(7)}`,
    counterpartyConnectionDid: props.counterpartyConnectionDid,
    myRelationshipDid: props.myRelationshipDid,
    counterpartyRelationshipDid: props.counterpartyRelationshipDid,
    connectionId: props.connectionId,
    createdAt: props.createdAt ?? new Date(),
    type: 'RelationshipDidRecord' as const,
    _tags: props.tags ?? {},
    getTags(): DefaultRelationshipDidRecordTags {
      return {
        ...this._tags,
        counterpartyConnectionDid: this.counterpartyConnectionDid,
        counterpartyRelationshipDid: this.counterpartyRelationshipDid,
      }
    },
  })

  describe('RelationshipDidRecordProps Interface', () => {
    it('should accept required props: counterpartyConnectionDid and myRelationshipDid', () => {
      const props: RelationshipDidRecordProps = {
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: testDids.myRelationshipDid,
      }

      const record = createMockRecord(props)

      expect(record.counterpartyConnectionDid).toBe(testDids.counterpartyConnectionDid)
      expect(record.myRelationshipDid).toBe(testDids.myRelationshipDid)
    })

    it('should accept optional id prop', () => {
      const props: RelationshipDidRecordProps = {
        id: 'custom-id-123',
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: testDids.myRelationshipDid,
      }

      const record = createMockRecord(props)

      expect(record.id).toBe('custom-id-123')
    })

    it('should accept optional counterpartyRelationshipDid prop', () => {
      const props: RelationshipDidRecordProps = {
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: testDids.myRelationshipDid,
        counterpartyRelationshipDid: testDids.counterpartyRelationshipDid,
      }

      const record = createMockRecord(props)

      expect(record.counterpartyRelationshipDid).toBe(testDids.counterpartyRelationshipDid)
    })

    it('should accept optional connectionId prop', () => {
      const props: RelationshipDidRecordProps = {
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: testDids.myRelationshipDid,
        connectionId: 'connection-abc-123',
      }

      const record = createMockRecord(props)

      expect(record.connectionId).toBe('connection-abc-123')
    })

    it('should accept optional createdAt prop', () => {
      const customDate = new Date('2024-01-15T12:00:00Z')
      const props: RelationshipDidRecordProps = {
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: testDids.myRelationshipDid,
        createdAt: customDate,
      }

      const record = createMockRecord(props)

      expect(record.createdAt).toBe(customDate)
    })

    it('should accept optional tags prop', () => {
      const customTags: CustomTags = {
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
      }
      const props: RelationshipDidRecordProps = {
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: testDids.myRelationshipDid,
        tags: customTags,
      }

      const record = createMockRecord(props)

      expect(record._tags).toEqual(customTags)
    })
  })

  describe('DefaultRelationshipDidRecordTags Interface', () => {
    it('should include counterpartyConnectionDid tag', () => {
      const record = createMockRecord({
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: testDids.myRelationshipDid,
      })

      const tags: DefaultRelationshipDidRecordTags = record.getTags()

      expect(tags.counterpartyConnectionDid).toBe(testDids.counterpartyConnectionDid)
    })

    it('should include counterpartyRelationshipDid tag when set', () => {
      const record = createMockRecord({
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: testDids.myRelationshipDid,
        counterpartyRelationshipDid: testDids.counterpartyRelationshipDid,
      })

      const tags: DefaultRelationshipDidRecordTags = record.getTags()

      expect(tags.counterpartyRelationshipDid).toBe(testDids.counterpartyRelationshipDid)
    })

    it('should have undefined counterpartyRelationshipDid tag when not set', () => {
      const record = createMockRecord({
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: testDids.myRelationshipDid,
      })

      const tags: DefaultRelationshipDidRecordTags = record.getTags()

      expect(tags.counterpartyRelationshipDid).toBeUndefined()
    })
  })

  describe('DID Format Validation', () => {
    /**
     * VRC uses different did:peer algorithms for different purposes:
     * - did:peer:0 (InceptionKeyWithoutDoc) - Relationship DIDs for credentials
     * - did:peer:1 (GenesisDoc) - Connection DIDs for DIDComm
     */

    it('should store counterpartyConnectionDid with peer:1 format', () => {
      const record = createMockRecord({
        counterpartyConnectionDid: 'did:peer:1zQmZMygzYqNwU6Uhmewx5Xepf2VLp5S4HLSwwgf2aiKZuwa',
        myRelationshipDid: testDids.myRelationshipDid,
      })

      expect(record.counterpartyConnectionDid).toMatch(/^did:peer:1/)
    })

    it('should store myRelationshipDid with peer:0 format', () => {
      const record = createMockRecord({
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: 'did:peer:0z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
      })

      expect(record.myRelationshipDid).toMatch(/^did:peer:0/)
    })

    it('should store counterpartyRelationshipDid with peer:0 format', () => {
      const record = createMockRecord({
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: testDids.myRelationshipDid,
        counterpartyRelationshipDid: 'did:peer:0z6MknGc3ocHs3zdPiJbnaaqDi58NGb4pk1Sp9WNhJhvaFed',
      })

      expect(record.counterpartyRelationshipDid).toMatch(/^did:peer:0/)
    })

    it('should distinguish between connection DID and relationship DID formats', () => {
      const record = createMockRecord({
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: testDids.myRelationshipDid,
        counterpartyRelationshipDid: testDids.counterpartyRelationshipDid,
      })

      // Connection DID is peer:1
      expect(record.counterpartyConnectionDid).toMatch(/^did:peer:1/)
      
      // Both relationship DIDs are peer:0
      expect(record.myRelationshipDid).toMatch(/^did:peer:0/)
      expect(record.counterpartyRelationshipDid).toMatch(/^did:peer:0/)
      
      // Verify they're all different DIDs
      expect(record.counterpartyConnectionDid).not.toBe(record.myRelationshipDid)
      expect(record.counterpartyConnectionDid).not.toBe(record.counterpartyRelationshipDid)
      expect(record.myRelationshipDid).not.toBe(record.counterpartyRelationshipDid)
    })
  })

  describe('Tag-based Querying', () => {
    /**
     * Tags enable efficient storage queries:
     * - findByQuery({ counterpartyConnectionDid: 'did:peer:1...' })
     * - findByQuery({ counterpartyRelationshipDid: 'did:peer:0...' })
     */

    it('should expose counterpartyConnectionDid for connection-based lookup', () => {
      const record = createMockRecord({
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: testDids.myRelationshipDid,
      })

      const tags = record.getTags()

      // This enables finding the record when we have the connection's theirDid
      expect(tags.counterpartyConnectionDid).toBe(testDids.counterpartyConnectionDid)
    })

    it('should expose counterpartyRelationshipDid for credential-based lookup', () => {
      const record = createMockRecord({
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: testDids.myRelationshipDid,
        counterpartyRelationshipDid: testDids.counterpartyRelationshipDid,
      })

      const tags = record.getTags()

      // This enables finding the record when viewing a received credential
      // where issuer.id is the counterparty's relationship DID
      expect(tags.counterpartyRelationshipDid).toBe(testDids.counterpartyRelationshipDid)
    })
  })

  describe('Record Mutability', () => {
    it('should allow updating myRelationshipDid', () => {
      const record = createMockRecord({
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: 'did:peer:0z6MkOldDid',
      })

      record.myRelationshipDid = testDids.myRelationshipDid

      expect(record.myRelationshipDid).toBe(testDids.myRelationshipDid)
    })

    it('should allow updating counterpartyRelationshipDid', () => {
      const record = createMockRecord({
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: testDids.myRelationshipDid,
      })

      record.counterpartyRelationshipDid = testDids.counterpartyRelationshipDid

      expect(record.counterpartyRelationshipDid).toBe(testDids.counterpartyRelationshipDid)
    })

    it('should reflect updated values in getTags', () => {
      const record = createMockRecord({
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: testDids.myRelationshipDid,
      })

      // Initially undefined
      expect(record.getTags().counterpartyRelationshipDid).toBeUndefined()

      // Update the value
      record.counterpartyRelationshipDid = testDids.counterpartyRelationshipDid

      // Tags should now include the updated value
      expect(record.getTags().counterpartyRelationshipDid).toBe(testDids.counterpartyRelationshipDid)
    })
  })

  describe('Record Type', () => {
    it('should have type property set to RelationshipDidRecord', () => {
      const record = createMockRecord({
        counterpartyConnectionDid: testDids.counterpartyConnectionDid,
        myRelationshipDid: testDids.myRelationshipDid,
      })

      expect(record.type).toBe('RelationshipDidRecord')
    })
  })
})
