import { Agent, ConnectionRecord } from '@credo-ts/core'
import { validateRelationshipCredential } from '../../../src/modules/vrc/vrc-manager'
import { RelationshipDidRepository } from '../../../src/modules/vrc/repositories/RelationshipDidRepository'
import { RelationshipDidRecord } from '../../../src/modules/vrc/types/RelationshipDidRecord'

// Mock the vrc-logging module
jest.mock('../../../src/modules/vrc/vrc-logging', () => ({
  createVrcLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
}))

describe('validateRelationshipCredential', () => {
  let mockAgent: jest.Mocked<Agent>
  let mockRepository: jest.Mocked<RelationshipDidRepository>
  let mockConnection: Partial<ConnectionRecord>

  const connectionId = 'connection-123'
  const theirDid = 'did:peer:counterparty-connection-did'
  const myRelationshipDid = 'did:peer:my-relationship-did'
  const counterpartyRelationshipDid = 'did:peer:counterparty-relationship-did'

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks()

    // Mock connection record
    mockConnection = {
      id: connectionId,
      theirDid: theirDid,
    }

    // Mock repository
    mockRepository = {
      findByConnectionDid: jest.fn(),
    } as unknown as jest.Mocked<RelationshipDidRepository>

    // Mock agent
    mockAgent = {
      connections: {
        getById: jest.fn().mockResolvedValue(mockConnection),
      },
      dependencyManager: {
        resolve: jest.fn().mockReturnValue(mockRepository),
      },
      context: {},
      config: {
        logger: {
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
        },
      },
    } as unknown as jest.Mocked<Agent>
  })

  describe('successful validation', () => {
    it('should return valid when both DIDs match', async () => {
      // Arrange
      const mockRecord = {
        myRelationshipDid: myRelationshipDid,
        counterpartyRelationshipDid: counterpartyRelationshipDid,
      } as RelationshipDidRecord

      mockRepository.findByConnectionDid.mockResolvedValue(mockRecord)

      // Act
      const result = await validateRelationshipCredential(
        mockAgent,
        connectionId,
        counterpartyRelationshipDid, // issuer DID in credential
        myRelationshipDid // subject DID in credential
      )

      // Assert
      expect(result.isValid).toBe(true)
      expect(result.issuerDidMatches).toBe(true)
      expect(result.subjectDidMatches).toBe(true)
      expect(result.errorMessage).toBeUndefined()
    })

    it('should validate when expected DIDs are not set (first exchange)', async () => {
      // Arrange: Record exists but counterpartyRelationshipDid not yet set
      const mockRecord = {
        myRelationshipDid: myRelationshipDid,
        counterpartyRelationshipDid: undefined, // Not yet received
      } as unknown as RelationshipDidRecord

      mockRepository.findByConnectionDid.mockResolvedValue(mockRecord)

      // Act
      const result = await validateRelationshipCredential(
        mockAgent,
        connectionId,
        'did:peer:any-issuer-did',
        myRelationshipDid
      )

      // Assert
      expect(result.isValid).toBe(true)
      expect(result.issuerDidMatches).toBe(true) // Skipped because expected is undefined
      expect(result.subjectDidMatches).toBe(true)
    })
  })

  describe('validation failures', () => {
    it('should fail when issuer DID does not match', async () => {
      // Arrange
      const mockRecord = {
        myRelationshipDid: myRelationshipDid,
        counterpartyRelationshipDid: counterpartyRelationshipDid,
      } as RelationshipDidRecord

      mockRepository.findByConnectionDid.mockResolvedValue(mockRecord)
      const wrongIssuerDid = 'did:peer:wrong-issuer-did'

      // Act
      const result = await validateRelationshipCredential(
        mockAgent,
        connectionId,
        wrongIssuerDid, // Wrong issuer
        myRelationshipDid
      )

      // Assert
      expect(result.isValid).toBe(false)
      expect(result.issuerDidMatches).toBe(false)
      expect(result.subjectDidMatches).toBe(true)
      expect(result.expectedIssuerDid).toBe(counterpartyRelationshipDid)
      expect(result.actualIssuerDid).toBe(wrongIssuerDid)
      expect(result.errorMessage).toBe('Relationship DID mismatch detected')
    })

    it('should fail when subject DID does not match', async () => {
      // Arrange
      const mockRecord = {
        myRelationshipDid: myRelationshipDid,
        counterpartyRelationshipDid: counterpartyRelationshipDid,
      } as RelationshipDidRecord

      mockRepository.findByConnectionDid.mockResolvedValue(mockRecord)
      const wrongSubjectDid = 'did:peer:wrong-subject-did'

      // Act
      const result = await validateRelationshipCredential(
        mockAgent,
        connectionId,
        counterpartyRelationshipDid,
        wrongSubjectDid // Wrong subject (not my DID)
      )

      // Assert
      expect(result.isValid).toBe(false)
      expect(result.issuerDidMatches).toBe(true)
      expect(result.subjectDidMatches).toBe(false)
      expect(result.expectedSubjectDid).toBe(myRelationshipDid)
      expect(result.actualSubjectDid).toBe(wrongSubjectDid)
      expect(result.errorMessage).toBe('Relationship DID mismatch detected')
    })

    it('should fail when both DIDs do not match', async () => {
      // Arrange
      const mockRecord = {
        myRelationshipDid: myRelationshipDid,
        counterpartyRelationshipDid: counterpartyRelationshipDid,
      } as RelationshipDidRecord

      mockRepository.findByConnectionDid.mockResolvedValue(mockRecord)
      const wrongIssuerDid = 'did:peer:wrong-issuer-did'
      const wrongSubjectDid = 'did:peer:wrong-subject-did'

      // Act
      const result = await validateRelationshipCredential(mockAgent, connectionId, wrongIssuerDid, wrongSubjectDid)

      // Assert
      expect(result.isValid).toBe(false)
      expect(result.issuerDidMatches).toBe(false)
      expect(result.subjectDidMatches).toBe(false)
    })
  })

  describe('error cases', () => {
    it('should fail when connection has no theirDid', async () => {
      // Arrange
      mockConnection.theirDid = undefined
      mockAgent.connections.getById = jest.fn().mockResolvedValue(mockConnection)

      // Act
      const result = await validateRelationshipCredential(
        mockAgent,
        connectionId,
        counterpartyRelationshipDid,
        myRelationshipDid
      )

      // Assert
      expect(result.isValid).toBe(false)
      expect(result.issuerDidMatches).toBe(false)
      expect(result.subjectDidMatches).toBe(false)
      expect(result.errorMessage).toBe('Connection has no theirDid - cannot validate relationship DIDs')
    })

    it('should fail when no relationship DID record is found', async () => {
      // Arrange
      mockRepository.findByConnectionDid.mockResolvedValue(null)

      // Act
      const result = await validateRelationshipCredential(
        mockAgent,
        connectionId,
        counterpartyRelationshipDid,
        myRelationshipDid
      )

      // Assert
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('No relationship DID record found for this connection')
    })

    it('should handle errors gracefully', async () => {
      // Arrange
      mockAgent.connections.getById = jest.fn().mockRejectedValue(new Error('Connection not found'))

      // Act
      const result = await validateRelationshipCredential(
        mockAgent,
        connectionId,
        counterpartyRelationshipDid,
        myRelationshipDid
      )

      // Assert
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toContain('Validation error')
      expect(result.errorMessage).toContain('Connection not found')
    })
  })

  describe('result structure', () => {
    it('should always include actual DIDs in the result', async () => {
      // Arrange
      const mockRecord = {
        myRelationshipDid: myRelationshipDid,
        counterpartyRelationshipDid: counterpartyRelationshipDid,
      } as RelationshipDidRecord

      mockRepository.findByConnectionDid.mockResolvedValue(mockRecord)

      // Act
      const result = await validateRelationshipCredential(
        mockAgent,
        connectionId,
        counterpartyRelationshipDid,
        myRelationshipDid
      )

      // Assert
      expect(result.actualIssuerDid).toBe(counterpartyRelationshipDid)
      expect(result.actualSubjectDid).toBe(myRelationshipDid)
    })

    it('should include expected DIDs when record is found', async () => {
      // Arrange
      const mockRecord = {
        myRelationshipDid: myRelationshipDid,
        counterpartyRelationshipDid: counterpartyRelationshipDid,
      } as RelationshipDidRecord

      mockRepository.findByConnectionDid.mockResolvedValue(mockRecord)

      // Act
      const result = await validateRelationshipCredential(
        mockAgent,
        connectionId,
        counterpartyRelationshipDid,
        myRelationshipDid
      )

      // Assert
      expect(result.expectedIssuerDid).toBe(counterpartyRelationshipDid)
      expect(result.expectedSubjectDid).toBe(myRelationshipDid)
    })
  })
})
