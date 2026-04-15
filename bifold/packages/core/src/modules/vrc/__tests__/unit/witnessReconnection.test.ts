/**
 * Unit tests for witness reconnection utilities
 */

import { Agent, ConnectionRecord, DidExchangeState, OutOfBandRecord, OutOfBandRole } from '@credo-ts/core'
import {
  checkExistingConnectionStatus,
  cleanupStaleRecords,
  handleWitnessReconnection,
} from '../../utils/witnessReconnection'

// Mock agent
const createMockAgent = () => {
  return {
    oob: {
      parseInvitation: jest.fn(),
      findAllByQuery: jest.fn(),
      deleteById: jest.fn(),
      receiveInvitationFromUrl: jest.fn(),
    },
    connections: {
      findAllByQuery: jest.fn(),
      deleteById: jest.fn(),
      returnWhenIsConnected: jest.fn(),
    },
  } as unknown as Agent
}

describe('witnessReconnection', () => {
  describe('checkExistingConnectionStatus', () => {
    let mockAgent: Agent

    beforeEach(() => {
      mockAgent = createMockAgent()
    })

    it('should return exists: false when invitation cannot be parsed', async () => {
      (mockAgent.oob.parseInvitation as jest.Mock).mockResolvedValue(null)

      const result = await checkExistingConnectionStatus(mockAgent, 'invalid-url')

      expect(result).toEqual({ exists: false, isActive: false })
    })

    it('should return exists: false when no OOB records found', async () => {
      const mockInvitation = { id: 'invitation-123' }
      ;(mockAgent.oob.parseInvitation as jest.Mock).mockResolvedValue(mockInvitation)
      ;(mockAgent.oob.findAllByQuery as jest.Mock).mockResolvedValue([])

      const result = await checkExistingConnectionStatus(mockAgent, 'test-url')

      expect(result).toEqual({ exists: false, isActive: false })
      expect(mockAgent.oob.findAllByQuery).toHaveBeenCalledWith({
        invitationId: 'invitation-123',
        role: OutOfBandRole.Receiver,
      })
    })

    it('should return active connection when found', async () => {
      const mockInvitation = { id: 'invitation-123' }
      const mockOobRecord = { id: 'oob-456' } as OutOfBandRecord
      const mockConnection = {
        id: 'connection-789',
        state: DidExchangeState.Completed,
      } as ConnectionRecord

      ;(mockAgent.oob.parseInvitation as jest.Mock).mockResolvedValue(mockInvitation)
      ;(mockAgent.oob.findAllByQuery as jest.Mock).mockResolvedValue([mockOobRecord])
      ;(mockAgent.connections.findAllByQuery as jest.Mock).mockResolvedValue([mockConnection])

      const result = await checkExistingConnectionStatus(mockAgent, 'test-url')

      expect(result).toEqual({
        exists: true,
        isActive: true,
        connectionRecord: mockConnection,
        oobRecord: mockOobRecord,
      })
    })

    it('should return inactive when connection is not completed', async () => {
      const mockInvitation = { id: 'invitation-123' }
      const mockOobRecord = { id: 'oob-456' } as OutOfBandRecord
      const mockConnection = {
        id: 'connection-789',
        state: DidExchangeState.InvitationReceived,
      } as ConnectionRecord

      ;(mockAgent.oob.parseInvitation as jest.Mock).mockResolvedValue(mockInvitation)
      ;(mockAgent.oob.findAllByQuery as jest.Mock).mockResolvedValue([mockOobRecord])
      ;(mockAgent.connections.findAllByQuery as jest.Mock).mockResolvedValue([mockConnection])

      const result = await checkExistingConnectionStatus(mockAgent, 'test-url')

      expect(result).toEqual({
        exists: true,
        isActive: false,
        connectionRecord: mockConnection,
        oobRecord: mockOobRecord,
      })
    })

    it('should return exists: true with no connection when OOB exists but no connection', async () => {
      const mockInvitation = { id: 'invitation-123' }
      const mockOobRecord = { id: 'oob-456' } as OutOfBandRecord

      ;(mockAgent.oob.parseInvitation as jest.Mock).mockResolvedValue(mockInvitation)
      ;(mockAgent.oob.findAllByQuery as jest.Mock).mockResolvedValue([mockOobRecord])
      ;(mockAgent.connections.findAllByQuery as jest.Mock).mockResolvedValue([])

      const result = await checkExistingConnectionStatus(mockAgent, 'test-url')

      expect(result).toEqual({
        exists: true,
        isActive: false,
        oobRecord: mockOobRecord,
      })
    })
  })

  describe('cleanupStaleRecords', () => {
    let mockAgent: Agent

    beforeEach(() => {
      mockAgent = createMockAgent()
    })

    it('should clean up OOB records and associated connections', async () => {
      const mockInvitation = { id: 'invitation-123' }
      const mockOobRecord = { id: 'oob-456' } as OutOfBandRecord
      const mockConnection = { id: 'connection-789' } as ConnectionRecord

      ;(mockAgent.oob.parseInvitation as jest.Mock).mockResolvedValue(mockInvitation)
      ;(mockAgent.oob.findAllByQuery as jest.Mock).mockResolvedValue([mockOobRecord])
      ;(mockAgent.connections.findAllByQuery as jest.Mock).mockResolvedValue([mockConnection])
      ;(mockAgent.connections.deleteById as jest.Mock).mockResolvedValue(undefined)
      ;(mockAgent.oob.deleteById as jest.Mock).mockResolvedValue(undefined)

      await cleanupStaleRecords(mockAgent, 'test-url')

      expect(mockAgent.connections.deleteById).toHaveBeenCalledWith('connection-789')
      expect(mockAgent.oob.deleteById).toHaveBeenCalledWith('oob-456')
    })

    it('should continue cleanup even if connection delete fails', async () => {
      const mockInvitation = { id: 'invitation-123' }
      const mockOobRecord = { id: 'oob-456' } as OutOfBandRecord
      const mockConnection = { id: 'connection-789' } as ConnectionRecord

      ;(mockAgent.oob.parseInvitation as jest.Mock).mockResolvedValue(mockInvitation)
      ;(mockAgent.oob.findAllByQuery as jest.Mock).mockResolvedValue([mockOobRecord])
      ;(mockAgent.connections.findAllByQuery as jest.Mock).mockResolvedValue([mockConnection])
      ;(mockAgent.connections.deleteById as jest.Mock).mockRejectedValue(new Error('Delete failed'))
      ;(mockAgent.oob.deleteById as jest.Mock).mockResolvedValue(undefined)

      await cleanupStaleRecords(mockAgent, 'test-url')

      expect(mockAgent.oob.deleteById).toHaveBeenCalledWith('oob-456')
    })

    it('should handle parse invitation failure gracefully', async () => {
      (mockAgent.oob.parseInvitation as jest.Mock).mockResolvedValue(null)

      await expect(cleanupStaleRecords(mockAgent, 'test-url')).resolves.not.toThrow()
    })
  })

  describe('handleWitnessReconnection', () => {
    let mockAgent: Agent

    beforeEach(() => {
      mockAgent = createMockAgent()
    })

    it('should succeed on first attempt when no existing records', async () => {
      const mockInvitation = { id: 'invitation-123' }
      const mockConnectionRecord = { id: 'connection-123' } as ConnectionRecord
      const mockCompletedConnection = {
        id: 'connection-123',
        state: DidExchangeState.Completed,
      } as ConnectionRecord

      // Check finds no existing records (happens inside loop before attempt 1)
      ;(mockAgent.oob.parseInvitation as jest.Mock).mockResolvedValue(mockInvitation)
      ;(mockAgent.oob.findAllByQuery as jest.Mock).mockResolvedValue([])

      // Connection succeeds
      ;(mockAgent.oob.receiveInvitationFromUrl as jest.Mock).mockResolvedValue({
        connectionRecord: mockConnectionRecord,
      })
      ;(mockAgent.connections.returnWhenIsConnected as jest.Mock).mockResolvedValue(mockCompletedConnection)

      const result = await handleWitnessReconnection(mockAgent, 'test-url')

      expect(result).toEqual({
        success: true,
        connectionRecord: mockCompletedConnection,
        strategy: 'reused',
      })
    })

    it('should reuse existing active connection when found', async () => {
      const mockInvitation = { id: 'invitation-123' }
      const mockOobRecord = { id: 'oob-456' } as OutOfBandRecord
      const mockConnection = {
        id: 'connection-789',
        state: DidExchangeState.Completed,
      } as ConnectionRecord

      // Check finds existing active connection (happens inside loop before attempt 1)
      ;(mockAgent.oob.parseInvitation as jest.Mock).mockResolvedValue(mockInvitation)
      ;(mockAgent.oob.findAllByQuery as jest.Mock).mockResolvedValue([mockOobRecord])
      ;(mockAgent.connections.findAllByQuery as jest.Mock).mockResolvedValue([mockConnection])

      const result = await handleWitnessReconnection(mockAgent, 'test-url')

      expect(result).toEqual({
        success: true,
        connectionRecord: mockConnection,
        strategy: 'reused',
      })
      // Should not attempt new connection
      expect(mockAgent.oob.receiveInvitationFromUrl).not.toHaveBeenCalled()
    })

    it('should cleanup and reconnect when stale connection exists', async () => {
      const mockInvitation = { id: 'invitation-123' }
      const mockOobRecord = { id: 'oob-456' } as OutOfBandRecord
      const mockStaleConnection = {
        id: 'connection-789',
        state: DidExchangeState.InvitationReceived,
      } as ConnectionRecord
      const mockNewConnection = { id: 'connection-new' } as ConnectionRecord
      const mockCompletedConnection = {
        id: 'connection-new',
        state: DidExchangeState.Completed,
      } as ConnectionRecord

      // Check before attempt 1 finds stale connection
      ;(mockAgent.oob.parseInvitation as jest.Mock).mockResolvedValue(mockInvitation)
      ;(mockAgent.oob.findAllByQuery as jest.Mock)
        .mockResolvedValueOnce([mockOobRecord]) // For status check
        .mockResolvedValueOnce([mockOobRecord]) // For cleanup
      ;(mockAgent.connections.findAllByQuery as jest.Mock)
        .mockResolvedValueOnce([mockStaleConnection]) // For status check
        .mockResolvedValueOnce([mockStaleConnection]) // For cleanup

      // Cleanup
      ;(mockAgent.connections.deleteById as jest.Mock).mockResolvedValue(undefined)
      ;(mockAgent.oob.deleteById as jest.Mock).mockResolvedValue(undefined)

      // New connection succeeds
      ;(mockAgent.oob.receiveInvitationFromUrl as jest.Mock).mockResolvedValue({
        connectionRecord: mockNewConnection,
      })
      ;(mockAgent.connections.returnWhenIsConnected as jest.Mock).mockResolvedValue(mockCompletedConnection)

      const result = await handleWitnessReconnection(mockAgent, 'test-url')

      expect(result).toEqual({
        success: true,
        connectionRecord: mockCompletedConnection,
        strategy: 'cleaned-retry',
      })
      expect(mockAgent.connections.deleteById).toHaveBeenCalledWith('connection-789')
      expect(mockAgent.oob.deleteById).toHaveBeenCalledWith('oob-456')
    })

    it('should return failure when cleanup fails', async () => {
      const mockInvitation = { id: 'invitation-123' }
      const mockOobRecord = { id: 'oob-456' } as OutOfBandRecord
      const mockStaleConnection = {
        id: 'connection-789',
        state: DidExchangeState.InvitationReceived,
      } as ConnectionRecord

      // Check before attempt 1 finds stale connection
      ;(mockAgent.oob.parseInvitation as jest.Mock)
        .mockResolvedValueOnce(mockInvitation) // status check
        .mockRejectedValueOnce(new Error('Cleanup failed')) // cleanup parse fails
      ;(mockAgent.oob.findAllByQuery as jest.Mock).mockResolvedValue([mockOobRecord])
      ;(mockAgent.connections.findAllByQuery as jest.Mock).mockResolvedValue([mockStaleConnection])

      const result = await handleWitnessReconnection(mockAgent, 'test-url')

      expect(result).toEqual({
        success: false,
        error: 'Cleanup failed: Cleanup failed',
        strategy: 'failed',
      })
    })

    it('should return failure on connection error', async () => {
      const mockInvitation = { id: 'invitation-123' }

      // Check before each attempt finds no existing records
      ;(mockAgent.oob.parseInvitation as jest.Mock).mockResolvedValue(mockInvitation)
      ;(mockAgent.oob.findAllByQuery as jest.Mock).mockResolvedValue([])

      // Connection fails on both attempts
      ;(mockAgent.oob.receiveInvitationFromUrl as jest.Mock).mockRejectedValue(new Error('Network timeout'))

      const result = await handleWitnessReconnection(mockAgent, 'test-url')

      expect(result.success).toBe(false)
      expect(result.strategy).toBe('failed')
      expect(result.error).toBeDefined()
      // Should have tried twice (initial + 1 default retry)
      expect(mockAgent.oob.receiveInvitationFromUrl).toHaveBeenCalledTimes(2)
      // Should have checked twice (once before each attempt)
      expect(mockAgent.oob.parseInvitation).toHaveBeenCalledTimes(2)
    })

    it('should respect maxRetries when connection fails', async () => {
      const mockInvitation = { id: 'invitation-123' }

      // Check before each attempt finds no existing records
      ;(mockAgent.oob.parseInvitation as jest.Mock).mockResolvedValue(mockInvitation)
      ;(mockAgent.oob.findAllByQuery as jest.Mock).mockResolvedValue([])

      // All connection attempts fail
      ;(mockAgent.oob.receiveInvitationFromUrl as jest.Mock).mockRejectedValue(new Error('Network timeout'))

      const result = await handleWitnessReconnection(mockAgent, 'test-url', 2)

      expect(result.success).toBe(false)
      expect(result.strategy).toBe('failed')
      // Should have tried 3 times (initial + 2 retries)
      expect(mockAgent.oob.receiveInvitationFromUrl).toHaveBeenCalledTimes(3)
      // Should have checked 3 times (once before each attempt)
      expect(mockAgent.oob.parseInvitation).toHaveBeenCalledTimes(3)
    })

    it('should return failure when connection record is not created', async () => {
      const mockInvitation = { id: 'invitation-123' }

      // Check before attempt finds no existing records
      ;(mockAgent.oob.parseInvitation as jest.Mock).mockResolvedValue(mockInvitation)
      ;(mockAgent.oob.findAllByQuery as jest.Mock).mockResolvedValue([])

      // Connection returns null
      ;(mockAgent.oob.receiveInvitationFromUrl as jest.Mock).mockResolvedValue({
        connectionRecord: null,
      })

      const result = await handleWitnessReconnection(mockAgent, 'test-url')

      expect(result).toEqual({
        success: false,
        error: 'Failed to create connection record',
        strategy: 'failed',
      })
    })
  })
})
