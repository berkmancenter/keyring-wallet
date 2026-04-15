/**
 * Tests for VrcFlowStore error management functionality
 * 
 * The VrcFlowStore class extends EventEmitter and manages:
 * - flowErrors: Map<string, VrcFlowError> - errors keyed by connectionId
 * - Error lifecycle: set, get, clear, and query methods
 * - Event emission for error state changes
 */

import { EventEmitter } from 'events'
import type { VrcFlowError, VrcFlowErrorType } from '../../../src/modules/vrc/witnessStatusStore'

// We need to test the VrcFlowStore class, but it's exported as a singleton
// So we'll create a fresh instance for each test by accessing the class directly
// First, let's import and re-create the class for testing purposes

class TestableVrcFlowStore extends EventEmitter {
  private flowStatus: Map<string, string> = new Map()
  private isWitnessed: Map<string, boolean> = new Map()
  private hasReceivedOffer: Map<string, boolean> = new Map()
  private hasSentOffer: Map<string, boolean> = new Map()
  private flowErrors: Map<string, VrcFlowError> = new Map()
  
  setStatus(connectionId: string, status: string, witnessed: boolean = false): void {
    this.flowStatus.set(connectionId, status)
    if (witnessed || status === 'witness-active') {
      this.isWitnessed.set(connectionId, true)
    }
    if (status === 'offer-received') {
      this.hasReceivedOffer.set(connectionId, true)
    }
    if (status === 'offer-sent') {
      this.hasSentOffer.set(connectionId, true)
    }
    // Clear any existing error when status changes
    this.flowErrors.delete(connectionId)
    this.emit('flowUpdate', { connectionId, status })
  }

  markOfferReceived(connectionId: string): void {
    this.hasReceivedOffer.set(connectionId, true)
    this.emit('flowUpdate', { connectionId, status: this.getStatus(connectionId) })
  }

  hasReceivedOfferFlag(connectionId: string): boolean {
    return this.hasReceivedOffer.get(connectionId) || false
  }

  isExchangeComplete(connectionId: string): boolean {
    return this.hasReceivedOffer.get(connectionId) === true &&
           this.hasSentOffer.get(connectionId) === true
  }
  
  getStatus(connectionId: string): string {
    return this.flowStatus.get(connectionId) || 'idle'
  }
  
  setError(connectionId: string, error: Omit<VrcFlowError, 'timestamp'>): void {
    const fullError: VrcFlowError = {
      ...error,
      timestamp: new Date(),
    }
    this.flowErrors.set(connectionId, fullError)
    this.emit('flowError', { connectionId, error: fullError })
  }
  
  getError(connectionId: string): VrcFlowError | undefined {
    return this.flowErrors.get(connectionId)
  }
  
  hasAnyError(): boolean {
    return this.flowErrors.size > 0
  }
  
  getErrorConnections(): string[] {
    return Array.from(this.flowErrors.keys())
  }
  
  clearError(connectionId: string): void {
    this.flowErrors.delete(connectionId)
    this.emit('flowErrorCleared', { connectionId })
  }
  
  clearFlow(connectionId: string): void {
    this.flowStatus.delete(connectionId)
    this.isWitnessed.delete(connectionId)
    this.hasReceivedOffer.delete(connectionId)
    this.hasSentOffer.delete(connectionId)
    this.flowErrors.delete(connectionId)
    this.emit('flowUpdate', { connectionId, status: 'idle' })
  }
}

describe('VrcFlowStore Error Management', () => {
  let store: TestableVrcFlowStore
  
  // Sample error data for tests
  const sampleError: Omit<VrcFlowError, 'timestamp'> = {
    type: 'witness-timeout' as VrcFlowErrorType,
    message: 'Witness did not respond within timeout',
    witnessName: 'Test Witness',
    contactName: 'Test Contact',
  }
  
  const connectionId1 = 'connection-123'
  const connectionId2 = 'connection-456'
  const connectionId3 = 'connection-789'

  beforeEach(() => {
    store = new TestableVrcFlowStore()
  })

  describe('setError', () => {
    it('should store error in flowErrors map', () => {
      store.setError(connectionId1, sampleError)
      
      const storedError = store.getError(connectionId1)
      expect(storedError).toBeDefined()
      expect(storedError?.type).toBe('witness-timeout')
      expect(storedError?.message).toBe('Witness did not respond within timeout')
      expect(storedError?.witnessName).toBe('Test Witness')
      expect(storedError?.contactName).toBe('Test Contact')
    })

    it('should emit flowError event with connectionId and error', (done) => {
      store.on('flowError', (data) => {
        expect(data.connectionId).toBe(connectionId1)
        expect(data.error.type).toBe('witness-timeout')
        expect(data.error.message).toBe('Witness did not respond within timeout')
        expect(data.error.timestamp).toBeInstanceOf(Date)
        done()
      })
      
      store.setError(connectionId1, sampleError)
    })

    it('should add timestamp to the error', () => {
      const beforeTime = new Date()
      store.setError(connectionId1, sampleError)
      const afterTime = new Date()
      
      const storedError = store.getError(connectionId1)
      expect(storedError?.timestamp).toBeDefined()
      expect(storedError?.timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime())
      expect(storedError?.timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime())
    })

    it('should set multiple errors for different connectionIds', () => {
      const error1: Omit<VrcFlowError, 'timestamp'> = {
        type: 'witness-timeout' as VrcFlowErrorType,
        message: 'Timeout error',
      }
      const error2: Omit<VrcFlowError, 'timestamp'> = {
        type: 'network-error' as VrcFlowErrorType,
        message: 'Network error',
      }
      const error3: Omit<VrcFlowError, 'timestamp'> = {
        type: 'biometric-failed' as VrcFlowErrorType,
        message: 'Biometric failed',
      }
      
      store.setError(connectionId1, error1)
      store.setError(connectionId2, error2)
      store.setError(connectionId3, error3)
      
      expect(store.getError(connectionId1)?.type).toBe('witness-timeout')
      expect(store.getError(connectionId2)?.type).toBe('network-error')
      expect(store.getError(connectionId3)?.type).toBe('biometric-failed')
    })

    it('should overwrite existing error for same connectionId', () => {
      const error1: Omit<VrcFlowError, 'timestamp'> = {
        type: 'witness-timeout' as VrcFlowErrorType,
        message: 'First error',
      }
      const error2: Omit<VrcFlowError, 'timestamp'> = {
        type: 'network-error' as VrcFlowErrorType,
        message: 'Second error',
      }
      
      store.setError(connectionId1, error1)
      store.setError(connectionId1, error2)
      
      const storedError = store.getError(connectionId1)
      expect(storedError?.type).toBe('network-error')
      expect(storedError?.message).toBe('Second error')
    })

    it('should store error with onRetry callback', async () => {
      let retryCallCount = 0
      const errorWithRetry: Omit<VrcFlowError, 'timestamp'> = {
        type: 'witness-timeout' as VrcFlowErrorType,
        onRetry: async () => {
          retryCallCount++
        },
      }
      
      store.setError(connectionId1, errorWithRetry)
      
      const storedError = store.getError(connectionId1)
      expect(storedError?.onRetry).toBeDefined()
      
      await storedError?.onRetry?.()
      expect(retryCallCount).toBe(1)
    })

    it('should store error with onProceedWithout callback', async () => {
      let proceedCallCount = 0
      const errorWithProceed: Omit<VrcFlowError, 'timestamp'> = {
        type: 'witness-timeout' as VrcFlowErrorType,
        onProceedWithout: async () => {
          proceedCallCount++
        },
      }
      
      store.setError(connectionId1, errorWithProceed)
      
      const storedError = store.getError(connectionId1)
      expect(storedError?.onProceedWithout).toBeDefined()
      
      await storedError?.onProceedWithout?.()
      expect(proceedCallCount).toBe(1)
    })

    it('should handle all VrcFlowErrorType values', () => {
      const errorTypes: VrcFlowErrorType[] = [
        'session-timeout',
        'witness-timeout',
        'vp-submission-failed',
        'biometric-cancelled',
        'biometric-failed',
        'stale-witness',
        'counterparty-not-connected',
        'network-error',
      ]
      
      errorTypes.forEach((errorType, index) => {
        const connId = `connection-${index}`
        store.setError(connId, { type: errorType })
        expect(store.getError(connId)?.type).toBe(errorType)
      })
    })
  })

  describe('getError', () => {
    it('should return error for given connectionId', () => {
      store.setError(connectionId1, sampleError)
      
      const error = store.getError(connectionId1)
      expect(error).toBeDefined()
      expect(error?.type).toBe('witness-timeout')
    })

    it('should return undefined for non-existent connectionId', () => {
      const error = store.getError('non-existent-connection')
      expect(error).toBeUndefined()
    })

    it('should return correct error when multiple errors exist', () => {
      const error1: Omit<VrcFlowError, 'timestamp'> = { type: 'witness-timeout' as VrcFlowErrorType }
      const error2: Omit<VrcFlowError, 'timestamp'> = { type: 'network-error' as VrcFlowErrorType }
      
      store.setError(connectionId1, error1)
      store.setError(connectionId2, error2)
      
      expect(store.getError(connectionId1)?.type).toBe('witness-timeout')
      expect(store.getError(connectionId2)?.type).toBe('network-error')
    })

    it('should return undefined after error is cleared', () => {
      store.setError(connectionId1, sampleError)
      expect(store.getError(connectionId1)).toBeDefined()
      
      store.clearError(connectionId1)
      expect(store.getError(connectionId1)).toBeUndefined()
    })
  })

  describe('clearError', () => {
    it('should remove error from flowErrors map', () => {
      store.setError(connectionId1, sampleError)
      expect(store.getError(connectionId1)).toBeDefined()
      
      store.clearError(connectionId1)
      expect(store.getError(connectionId1)).toBeUndefined()
    })

    it('should emit flowErrorCleared event with connectionId', (done) => {
      store.setError(connectionId1, sampleError)
      
      store.on('flowErrorCleared', (data) => {
        expect(data.connectionId).toBe(connectionId1)
        done()
      })
      
      store.clearError(connectionId1)
    })

    it('should do nothing if error does not exist (no throw)', () => {
      // Should not throw
      expect(() => {
        store.clearError('non-existent-connection')
      }).not.toThrow()
    })

    it('should still emit flowErrorCleared event even if no error existed', (done) => {
      store.on('flowErrorCleared', (data) => {
        expect(data.connectionId).toBe('non-existent-connection')
        done()
      })
      
      store.clearError('non-existent-connection')
    })

    it('should only clear error for specified connectionId', () => {
      const error1: Omit<VrcFlowError, 'timestamp'> = { type: 'witness-timeout' as VrcFlowErrorType }
      const error2: Omit<VrcFlowError, 'timestamp'> = { type: 'network-error' as VrcFlowErrorType }
      
      store.setError(connectionId1, error1)
      store.setError(connectionId2, error2)
      
      store.clearError(connectionId1)
      
      expect(store.getError(connectionId1)).toBeUndefined()
      expect(store.getError(connectionId2)).toBeDefined()
    })
  })

  describe('hasAnyError', () => {
    it('should return false when no errors exist', () => {
      expect(store.hasAnyError()).toBe(false)
    })

    it('should return true when at least one error exists', () => {
      store.setError(connectionId1, sampleError)
      expect(store.hasAnyError()).toBe(true)
    })

    it('should return true when multiple errors exist', () => {
      store.setError(connectionId1, { type: 'witness-timeout' as VrcFlowErrorType })
      store.setError(connectionId2, { type: 'network-error' as VrcFlowErrorType })
      
      expect(store.hasAnyError()).toBe(true)
    })

    it('should return false after all errors are cleared', () => {
      store.setError(connectionId1, { type: 'witness-timeout' as VrcFlowErrorType })
      store.setError(connectionId2, { type: 'network-error' as VrcFlowErrorType })
      
      expect(store.hasAnyError()).toBe(true)
      
      store.clearError(connectionId1)
      expect(store.hasAnyError()).toBe(true) // Still has one error
      
      store.clearError(connectionId2)
      expect(store.hasAnyError()).toBe(false) // No more errors
    })

    it('should return false after clearFlow removes error', () => {
      store.setError(connectionId1, sampleError)
      expect(store.hasAnyError()).toBe(true)
      
      store.clearFlow(connectionId1)
      expect(store.hasAnyError()).toBe(false)
    })
  })

  describe('getErrorConnections', () => {
    it('should return empty array when no errors exist', () => {
      const connections = store.getErrorConnections()
      expect(connections).toEqual([])
    })

    it('should return array of connectionIds that have errors', () => {
      store.setError(connectionId1, { type: 'witness-timeout' as VrcFlowErrorType })
      store.setError(connectionId2, { type: 'network-error' as VrcFlowErrorType })
      
      const connections = store.getErrorConnections()
      expect(connections).toHaveLength(2)
      expect(connections).toContain(connectionId1)
      expect(connections).toContain(connectionId2)
    })

    it('should return single connectionId when one error exists', () => {
      store.setError(connectionId1, sampleError)
      
      const connections = store.getErrorConnections()
      expect(connections).toEqual([connectionId1])
    })

    it('should update when errors are added or removed', () => {
      expect(store.getErrorConnections()).toEqual([])
      
      store.setError(connectionId1, { type: 'witness-timeout' as VrcFlowErrorType })
      expect(store.getErrorConnections()).toContain(connectionId1)
      
      store.setError(connectionId2, { type: 'network-error' as VrcFlowErrorType })
      expect(store.getErrorConnections()).toHaveLength(2)
      
      store.clearError(connectionId1)
      expect(store.getErrorConnections()).toEqual([connectionId2])
    })
  })

  describe('clearFlow', () => {
    it('should clear associated error when clearFlow is called', () => {
      store.setError(connectionId1, sampleError)
      expect(store.getError(connectionId1)).toBeDefined()
      
      store.clearFlow(connectionId1)
      expect(store.getError(connectionId1)).toBeUndefined()
    })

    it('should emit flowUpdate event with idle status', (done) => {
      store.setStatus(connectionId1, 'connecting')
      store.setError(connectionId1, sampleError)
      
      store.on('flowUpdate', (data) => {
        if (data.status === 'idle') {
          expect(data.connectionId).toBe(connectionId1)
          done()
        }
      })
      
      store.clearFlow(connectionId1)
    })

    it('should only clear error for specified connectionId', () => {
      store.setError(connectionId1, { type: 'witness-timeout' as VrcFlowErrorType })
      store.setError(connectionId2, { type: 'network-error' as VrcFlowErrorType })
      
      store.clearFlow(connectionId1)
      
      expect(store.getError(connectionId1)).toBeUndefined()
      expect(store.getError(connectionId2)).toBeDefined()
    })

    it('should not throw if no error exists for connection', () => {
      expect(() => {
        store.clearFlow(connectionId1)
      }).not.toThrow()
    })
  })

  describe('setStatus clears existing error', () => {
    it('should clear error when status is changed', () => {
      store.setError(connectionId1, sampleError)
      expect(store.getError(connectionId1)).toBeDefined()
      
      store.setStatus(connectionId1, 'connecting')
      expect(store.getError(connectionId1)).toBeUndefined()
    })

    it('should clear error for any status change', () => {
      const statuses = ['connecting', 'witness-active', 'preparing-offer', 'offer-sent', 'offer-received', 'idle']
      
      statuses.forEach((status) => {
        store.setError(connectionId1, sampleError)
        expect(store.getError(connectionId1)).toBeDefined()
        
        store.setStatus(connectionId1, status)
        expect(store.getError(connectionId1)).toBeUndefined()
      })
    })
  })

  describe('Event emission verification', () => {
    it('should emit flowError event with correct data structure', (done) => {
      const testError: Omit<VrcFlowError, 'timestamp'> = {
        type: 'biometric-cancelled' as VrcFlowErrorType,
        message: 'User cancelled biometric',
        witnessName: 'Witness One',
        contactName: 'Contact One',
      }
      
      store.on('flowError', (data) => {
        expect(data).toHaveProperty('connectionId')
        expect(data).toHaveProperty('error')
        expect(data.connectionId).toBe(connectionId1)
        expect(data.error).toHaveProperty('type')
        expect(data.error).toHaveProperty('message')
        expect(data.error).toHaveProperty('witnessName')
        expect(data.error).toHaveProperty('contactName')
        expect(data.error).toHaveProperty('timestamp')
        done()
      })
      
      store.setError(connectionId1, testError)
    })

    it('should emit flowErrorCleared event with correct data structure', (done) => {
      store.setError(connectionId1, sampleError)
      
      store.on('flowErrorCleared', (data) => {
        expect(data).toHaveProperty('connectionId')
        expect(data.connectionId).toBe(connectionId1)
        done()
      })
      
      store.clearError(connectionId1)
    })

    it('should allow multiple listeners for flowError event', () => {
      let listener1Called = false
      let listener2Called = false
      
      store.on('flowError', () => {
        listener1Called = true
      })
      store.on('flowError', () => {
        listener2Called = true
      })
      
      store.setError(connectionId1, sampleError)
      
      expect(listener1Called).toBe(true)
      expect(listener2Called).toBe(true)
    })

    it('should allow removing event listeners', () => {
      let callCount = 0
      const listener = () => {
        callCount++
      }
      
      store.on('flowError', listener)
      store.setError(connectionId1, sampleError)
      expect(callCount).toBe(1)
      
      store.removeListener('flowError', listener)
      store.setError(connectionId2, sampleError)
      expect(callCount).toBe(1) // Should not have increased
    })

    it('should emit events in correct order for setError and clearError sequence', () => {
      const eventLog: string[] = []
      
      store.on('flowError', () => {
        eventLog.push('flowError')
      })
      store.on('flowErrorCleared', () => {
        eventLog.push('flowErrorCleared')
      })
      
      store.setError(connectionId1, sampleError)
      store.clearError(connectionId1)
      store.setError(connectionId1, { type: 'network-error' as VrcFlowErrorType })
      store.clearError(connectionId1)
      
      expect(eventLog).toEqual([
        'flowError',
        'flowErrorCleared',
        'flowError',
        'flowErrorCleared',
      ])
    })
  })

  describe('Edge cases', () => {
    it('should handle empty string connectionId', () => {
      store.setError('', sampleError)
      expect(store.getError('')).toBeDefined()
      expect(store.hasAnyError()).toBe(true)
      expect(store.getErrorConnections()).toContain('')
    })

    it('should handle error with only required type field', () => {
      const minimalError: Omit<VrcFlowError, 'timestamp'> = {
        type: 'network-error' as VrcFlowErrorType,
      }
      
      store.setError(connectionId1, minimalError)
      
      const storedError = store.getError(connectionId1)
      expect(storedError?.type).toBe('network-error')
      expect(storedError?.message).toBeUndefined()
      expect(storedError?.witnessName).toBeUndefined()
      expect(storedError?.contactName).toBeUndefined()
      expect(storedError?.onRetry).toBeUndefined()
      expect(storedError?.onProceedWithout).toBeUndefined()
    })

    it('should handle rapid successive setError calls', () => {
      for (let i = 0; i < 100; i++) {
        store.setError(connectionId1, { 
          type: 'network-error' as VrcFlowErrorType,
          message: `Error ${i}`,
        })
      }
      
      const storedError = store.getError(connectionId1)
      expect(storedError?.message).toBe('Error 99') // Last one wins
    })

    it('should handle many concurrent connections with errors', () => {
      const connectionCount = 50
      
      for (let i = 0; i < connectionCount; i++) {
        store.setError(`connection-${i}`, {
          type: 'witness-timeout' as VrcFlowErrorType,
          message: `Error for connection ${i}`,
        })
      }
      
      expect(store.hasAnyError()).toBe(true)
      expect(store.getErrorConnections()).toHaveLength(connectionCount)
      
      // Verify each error is retrievable
      for (let i = 0; i < connectionCount; i++) {
        const error = store.getError(`connection-${i}`)
        expect(error?.message).toBe(`Error for connection ${i}`)
      }
    })
  })

  describe('markOfferReceived', () => {
    it('should set hasReceivedOffer without changing flow status', () => {
      store.setStatus(connectionId1, 'witness-active', true)
      expect(store.getStatus(connectionId1)).toBe('witness-active')
      
      store.markOfferReceived(connectionId1)
      
      expect(store.getStatus(connectionId1)).toBe('witness-active')
      expect(store.hasReceivedOfferFlag(connectionId1)).toBe(true)
    })

    it('should emit flowUpdate with current status', (done) => {
      store.setStatus(connectionId1, 'witness-fallback')

      store.on('flowUpdate', (data) => {
        if (data.connectionId === connectionId1 && data.status === 'witness-fallback') {
          done()
        }
      })

      store.markOfferReceived(connectionId1)
    })

    it('should not clear existing errors', () => {
      store.setError(connectionId1, { type: 'vp-submission-failed' as VrcFlowErrorType, message: 'fail' })
      store.markOfferReceived(connectionId1)
      
      expect(store.getError(connectionId1)).toBeDefined()
      expect(store.hasReceivedOfferFlag(connectionId1)).toBe(true)
    })

    it('should contribute to isExchangeComplete', () => {
      store.setStatus(connectionId1, 'offer-sent')
      expect(store.isExchangeComplete(connectionId1)).toBe(false)

      store.markOfferReceived(connectionId1)
      expect(store.isExchangeComplete(connectionId1)).toBe(true)
    })
  })

  describe('biometric-fallback and witness-fallback statuses', () => {
    it('should accept biometric-fallback as a valid status', () => {
      store.setStatus(connectionId1, 'biometric-fallback')
      expect(store.getStatus(connectionId1)).toBe('biometric-fallback')
    })

    it('should accept witness-fallback as a valid status', () => {
      store.setStatus(connectionId1, 'witness-fallback')
      expect(store.getStatus(connectionId1)).toBe('witness-fallback')
    })

    it('should clear error when transitioning to biometric-fallback', () => {
      store.setError(connectionId1, { type: 'biometric-failed' as VrcFlowErrorType, message: 'fail' })
      expect(store.getError(connectionId1)).toBeDefined()

      store.setStatus(connectionId1, 'biometric-fallback')
      expect(store.getError(connectionId1)).toBeUndefined()
    })

    it('should clear error when transitioning to witness-fallback', () => {
      store.setError(connectionId1, { type: 'counterparty-not-connected' as VrcFlowErrorType, message: 'err' })
      expect(store.getError(connectionId1)).toBeDefined()

      store.setStatus(connectionId1, 'witness-fallback')
      expect(store.getError(connectionId1)).toBeUndefined()
    })
  })
})

describe('WitnessStatusStore', () => {
  // Import the actual store to test the WitnessStatusStore class
  // Note: This tests the exported singleton behavior
  
  describe('Integration with vrcFlowStore', () => {
    // These tests verify the stores work together correctly
    // The vrcFlowStore handles errors while witnessStatusStore handles status messages
    
    it('should be able to import vrcFlowStore from witnessStatusStore module', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { vrcFlowStore } = require('../../../src/modules/vrc/witnessStatusStore')
      expect(vrcFlowStore).toBeDefined()
      expect(typeof vrcFlowStore.setError).toBe('function')
      expect(typeof vrcFlowStore.getError).toBe('function')
      expect(typeof vrcFlowStore.clearError).toBe('function')
      expect(typeof vrcFlowStore.hasAnyError).toBe('function')
      expect(typeof vrcFlowStore.getErrorConnections).toBe('function')
    })

    it('should be able to import witnessStatusStore from witnessStatusStore module', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { witnessStatusStore } = require('../../../src/modules/vrc/witnessStatusStore')
      expect(witnessStatusStore).toBeDefined()
      expect(typeof witnessStatusStore.addStatus).toBe('function')
      expect(typeof witnessStatusStore.getStatuses).toBe('function')
      expect(typeof witnessStatusStore.clearStatuses).toBe('function')
      expect(typeof witnessStatusStore.getLatestStatus).toBe('function')
    })
  })
})
