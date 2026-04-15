/**
 * Unit tests for witnessCredentialUtils
 *
 * Tests the helper functions for identifying, filtering, and extracting
 * information from Witness Credentials (VWCs).
 */

import { W3cCredentialRecord } from '@credo-ts/core'
import {
  hasWitnessCredentialType,
  getWitnessCredentialsForSubject,
  extractWitnessInfo,
  WitnessRecord,
} from '../../utils/witnessCredentialUtils'

describe('witnessCredentialUtils', () => {
  describe('hasWitnessCredentialType', () => {
    it('should return true for WitnessCredential type', () => {
      const mockCredential = {
        credential: {
          type: ['VerifiableCredential', 'DTGCredential', 'WitnessCredential'],
          issuer: 'did:example:witness',
          credentialSubject: {},
        },
      } as unknown as W3cCredentialRecord

      expect(hasWitnessCredentialType(mockCredential)).toBe(true)
    })

    it('should return true when WitnessCredential is the only type', () => {
      const mockCredential = {
        credential: {
          type: 'WitnessCredential',
          issuer: 'did:example:witness',
          credentialSubject: {},
        },
      } as unknown as W3cCredentialRecord

      expect(hasWitnessCredentialType(mockCredential)).toBe(true)
    })

    it('should return false for non-WitnessCredential types', () => {
      const mockCredential = {
        credential: {
          type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
          issuer: 'did:example:issuer',
          credentialSubject: {},
        },
      } as unknown as W3cCredentialRecord

      expect(hasWitnessCredentialType(mockCredential)).toBe(false)
    })

    it('should return false when credential has no type field', () => {
      const mockCredential = {
        credential: {
          issuer: 'did:example:issuer',
          credentialSubject: {},
        },
      } as unknown as W3cCredentialRecord

      expect(hasWitnessCredentialType(mockCredential)).toBe(false)
    })

    it('should return false when credential is null or undefined', () => {
      const mockCredential = {
        credential: null,
      } as unknown as W3cCredentialRecord

      expect(hasWitnessCredentialType(mockCredential)).toBe(false)
    })

    it('should return false when credential data is malformed', () => {
      const mockCredential = {
        credential: 'not an object',
      } as unknown as W3cCredentialRecord

      expect(hasWitnessCredentialType(mockCredential)).toBe(false)
    })
  })

  describe('getWitnessCredentialsForSubject', () => {
    const mockSubjectDid = 'did:example:subject123'

    it('should filter VWCs by credentialSubject.id', () => {
      const credentials = [
        {
          credential: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: 'did:example:witness',
            credentialSubject: {
              id: mockSubjectDid,
            },
          },
        },
        {
          credential: {
            type: ['VerifiableCredential', 'RelationshipCredential'],
            issuer: 'did:example:issuer',
            credentialSubject: {
              id: mockSubjectDid,
            },
          },
        },
      ] as unknown as W3cCredentialRecord[]

      const result = getWitnessCredentialsForSubject(credentials, mockSubjectDid)

      expect(result).toHaveLength(1)
      expect(result[0].credential.type).toContain('WitnessCredential')
    })

    it('should return empty array when no matches', () => {
      const credentials = [
        {
          credential: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: 'did:example:witness',
            credentialSubject: {
              id: 'did:example:different',
            },
          },
        },
      ] as unknown as W3cCredentialRecord[]

      const result = getWitnessCredentialsForSubject(credentials, mockSubjectDid)

      expect(result).toHaveLength(0)
    })

    it('should return multiple matching VWCs', () => {
      const credentials = [
        {
          credential: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: 'did:example:witness1',
            credentialSubject: {
              id: mockSubjectDid,
              witnessContext: { event: 'Event 1' },
            },
          },
        },
        {
          credential: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: 'did:example:witness2',
            credentialSubject: {
              id: mockSubjectDid,
              witnessContext: { event: 'Event 2' },
            },
          },
        },
      ] as unknown as W3cCredentialRecord[]

      const result = getWitnessCredentialsForSubject(credentials, mockSubjectDid)

      expect(result).toHaveLength(2)
    })

    it('should handle empty credential array', () => {
      const credentials: W3cCredentialRecord[] = []

      const result = getWitnessCredentialsForSubject(credentials, mockSubjectDid)

      expect(result).toHaveLength(0)
    })

    it('should filter out credentials with malformed credentialSubject', () => {
      const credentials = [
        {
          credential: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: 'did:example:witness',
            credentialSubject: null,
          },
        },
        {
          credential: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: 'did:example:witness',
            credentialSubject: {
              id: mockSubjectDid,
            },
          },
        },
      ] as unknown as W3cCredentialRecord[]

      const result = getWitnessCredentialsForSubject(credentials, mockSubjectDid)

      expect(result).toHaveLength(1)
    })
  })

  describe('extractWitnessInfo', () => {
    it('should extract all fields from complete VWC', () => {
      const mockCredential = {
        id: 'credential-123',
        credential: {
          type: ['VerifiableCredential', 'WitnessCredential'],
          issuer: {
            id: 'did:example:witness',
            name: 'Test Witness Server',
          },
          validFrom: '2026-01-21T10:00:00Z',
          credentialSubject: {
            id: 'did:example:subject',
            witnessContext: {
              event: 'EthDenver 2024',
              method: 'session-based-challenge',
              sessionId: 'session-abc-123',
            },
          },
        },
      } as unknown as W3cCredentialRecord

      const result = extractWitnessInfo(mockCredential)

      expect(result).not.toBeNull()
      expect(result).toEqual({
        event: 'EthDenver 2024',
        method: 'session-based-challenge',
        sessionId: 'session-abc-123',
        witnessDid: 'did:example:witness',
        witnessName: 'Test Witness Server',
        issuanceDate: '2026-01-21T10:00:00Z',
        credentialId: 'credential-123',
      })
    })

    it('should handle issuer as string instead of object', () => {
      const mockCredential = {
        id: 'credential-456',
        credential: {
          type: ['VerifiableCredential', 'WitnessCredential'],
          issuer: 'did:example:witness',
          credentialSubject: {
            id: 'did:example:subject',
            witnessContext: {
              event: 'Test Event',
            },
          },
        },
      } as unknown as W3cCredentialRecord

      const result = extractWitnessInfo(mockCredential)

      expect(result).not.toBeNull()
      expect(result?.witnessDid).toBe('did:example:witness')
      // When issuer is a string, we use 'Witness' as fallback display name
      expect(result?.witnessName).toBe('Witness')
    })

    it('should handle missing optional witnessContext fields', () => {
      const mockCredential = {
        id: 'credential-789',
        credential: {
          type: ['VerifiableCredential', 'WitnessCredential'],
          issuer: 'did:example:witness',
          credentialSubject: {
            id: 'did:example:subject',
            witnessContext: {
              // Only event, no method or sessionId
              event: 'Minimal Event',
            },
          },
        },
      } as unknown as W3cCredentialRecord

      const result = extractWitnessInfo(mockCredential)

      expect(result).not.toBeNull()
      expect(result?.event).toBe('Minimal Event')
      expect(result?.method).toBeUndefined()
      expect(result?.sessionId).toBeUndefined()
    })

    it('should handle issuanceDate instead of validFrom', () => {
      const mockCredential = {
        id: 'credential-101',
        credential: {
          type: ['VerifiableCredential', 'WitnessCredential'],
          issuer: 'did:example:witness',
          issuanceDate: '2026-01-15T08:30:00Z',
          credentialSubject: {
            id: 'did:example:subject',
            witnessContext: {},
          },
        },
      } as unknown as W3cCredentialRecord

      const result = extractWitnessInfo(mockCredential)

      expect(result).not.toBeNull()
      expect(result?.issuanceDate).toBe('2026-01-15T08:30:00Z')
    })

    it('should handle missing witnessContext', () => {
      const mockCredential = {
        id: 'credential-202',
        credential: {
          type: ['VerifiableCredential', 'WitnessCredential'],
          issuer: 'did:example:witness',
          credentialSubject: {
            id: 'did:example:subject',
            // No witnessContext
          },
        },
      } as unknown as W3cCredentialRecord

      const result = extractWitnessInfo(mockCredential)

      expect(result).not.toBeNull()
      expect(result?.event).toBeUndefined()
      expect(result?.method).toBeUndefined()
      expect(result?.sessionId).toBeUndefined()
    })

    it('should return null for invalid credential', () => {
      const mockCredential = {
        id: 'credential-303',
        credential: null,
      } as unknown as W3cCredentialRecord

      const result = extractWitnessInfo(mockCredential)

      expect(result).toBeNull()
    })

    it('should return null when issuer is missing', () => {
      const mockCredential = {
        id: 'credential-404',
        credential: {
          type: ['VerifiableCredential', 'WitnessCredential'],
          // No issuer
          credentialSubject: {
            id: 'did:example:subject',
          },
        },
      } as unknown as W3cCredentialRecord

      const result = extractWitnessInfo(mockCredential)

      expect(result).toBeNull()
    })

    it('should handle malformed witnessContext', () => {
      const mockCredential = {
        id: 'credential-505',
        credential: {
          type: ['VerifiableCredential', 'WitnessCredential'],
          issuer: 'did:example:witness',
          credentialSubject: {
            id: 'did:example:subject',
            witnessContext: 'not an object',
          },
        },
      } as unknown as W3cCredentialRecord

      const result = extractWitnessInfo(mockCredential)

      // Should still extract other fields even if witnessContext is malformed
      expect(result).not.toBeNull()
      expect(result?.witnessDid).toBe('did:example:witness')
      expect(result?.event).toBeUndefined()
    })
  })
})
