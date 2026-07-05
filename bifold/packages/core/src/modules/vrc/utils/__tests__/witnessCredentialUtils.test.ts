/**
 * Unit tests for witnessCredentialUtils - extractWitnessInfo function
 *
 * Tests the extraction of witness information from Verifiable Witness Credentials (VWCs),
 * including handling of witnessContext in different locations and issuer name extraction.
 */

import { W3cCredentialRecord } from '@credo-ts/core'
import { extractWitnessInfo } from '../witnessCredentialUtils'

describe('witnessCredentialUtils', () => {
  describe('extractWitnessInfo', () => {
    describe('witnessContext extraction from claims', () => {
      it('should extract witnessContext from credentialSubject.claims', () => {
        const mockCredential = {
          id: 'credential-claims-001',
          credential: {
            type: ['VerifiableCredential', 'DTGCredential', 'WitnessCredential'],
            issuer: {
              id: 'did:example:witness123',
              name: 'Claims Test Witness',
            },
            validFrom: '2026-02-13T10:00:00Z',
            credentialSubject: {
              id: 'did:example:subject456',
              claims: {
                witnessContext: {
                  event: 'First Person Summit 2026',
                  method: 'session-based-challenge',
                  sessionId: 'claims-session-xyz',
                  localityVerification: {
                    type: 'proximity',
                    confirmed: true,
                    details: 'BLE proximity verified',
                  },
                },
              },
            },
          },
        } as unknown as W3cCredentialRecord

        const result = extractWitnessInfo(mockCredential)

        expect(result).not.toBeNull()
        expect(result?.event).toBe('First Person Summit 2026')
        expect(result?.method).toBe('session-based-challenge')
        expect(result?.sessionId).toBe('claims-session-xyz')
        expect(result?.witnessDid).toBe('did:example:witness123')
        expect(result?.witnessName).toBe('Claims Test Witness')
        expect(result?.issuanceDate).toBe('2026-02-13T10:00:00Z')
        expect(result?.credentialId).toBe('credential-claims-001')
        expect(result?.localityVerification).toEqual({
          type: 'proximity',
          confirmed: true,
          details: 'BLE proximity verified',
        })
      })

      it('should prioritize direct witnessContext over claims.witnessContext', () => {
        const mockCredential = {
          id: 'credential-priority-001',
          credential: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: 'did:example:witness',
            credentialSubject: {
              id: 'did:example:subject',
              // Direct witnessContext should take precedence
              witnessContext: {
                event: 'Direct Event',
                method: 'direct-method',
              },
              // This should be ignored
              claims: {
                witnessContext: {
                  event: 'Claims Event',
                  method: 'claims-method',
                },
              },
            },
          },
        } as unknown as W3cCredentialRecord

        const result = extractWitnessInfo(mockCredential)

        expect(result).not.toBeNull()
        expect(result?.event).toBe('Direct Event')
        expect(result?.method).toBe('direct-method')
      })

      it('should fall back to claims.witnessContext when direct witnessContext is missing', () => {
        const mockCredential = {
          id: 'credential-fallback-001',
          credential: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: 'did:example:witness',
            credentialSubject: {
              id: 'did:example:subject',
              // No direct witnessContext
              claims: {
                witnessContext: {
                  event: 'Fallback Event',
                  sessionId: 'fallback-session',
                },
              },
            },
          },
        } as unknown as W3cCredentialRecord

        const result = extractWitnessInfo(mockCredential)

        expect(result).not.toBeNull()
        expect(result?.event).toBe('Fallback Event')
        expect(result?.sessionId).toBe('fallback-session')
      })

      it('should handle claims object without witnessContext', () => {
        const mockCredential = {
          id: 'credential-no-witness-context',
          credential: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: 'did:example:witness',
            credentialSubject: {
              id: 'did:example:subject',
              claims: {
                // claims present but no witnessContext
                someOtherClaim: 'value',
              },
            },
          },
        } as unknown as W3cCredentialRecord

        const result = extractWitnessInfo(mockCredential)

        expect(result).not.toBeNull()
        expect(result?.event).toBeUndefined()
        expect(result?.method).toBeUndefined()
        expect(result?.sessionId).toBeUndefined()
      })
    })

    describe('missing witnessContext handling', () => {
      it('should handle missing witnessContext gracefully', () => {
        const mockCredential = {
          id: 'credential-no-context',
          credential: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: {
              id: 'did:example:witness',
              name: 'Test Witness',
            },
            credentialSubject: {
              id: 'did:example:subject',
              // No witnessContext at all
            },
          },
        } as unknown as W3cCredentialRecord

        const result = extractWitnessInfo(mockCredential)

        expect(result).not.toBeNull()
        expect(result?.witnessDid).toBe('did:example:witness')
        expect(result?.witnessName).toBe('Test Witness')
        expect(result?.event).toBeUndefined()
        expect(result?.method).toBeUndefined()
        expect(result?.sessionId).toBeUndefined()
        expect(result?.localityVerification).toBeUndefined()
      })

      it('should handle null witnessContext', () => {
        const mockCredential = {
          id: 'credential-null-context',
          credential: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: 'did:example:witness',
            credentialSubject: {
              id: 'did:example:subject',
              witnessContext: null,
            },
          },
        } as unknown as W3cCredentialRecord

        const result = extractWitnessInfo(mockCredential)

        expect(result).not.toBeNull()
        expect(result?.event).toBeUndefined()
      })

      it('should handle empty witnessContext object', () => {
        const mockCredential = {
          id: 'credential-empty-context',
          credential: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: 'did:example:witness',
            credentialSubject: {
              id: 'did:example:subject',
              witnessContext: {},
            },
          },
        } as unknown as W3cCredentialRecord

        const result = extractWitnessInfo(mockCredential)

        expect(result).not.toBeNull()
        expect(result?.event).toBeUndefined()
        expect(result?.method).toBeUndefined()
        expect(result?.sessionId).toBeUndefined()
      })

      it('should handle witnessContext as non-object type', () => {
        const mockCredential = {
          id: 'credential-string-context',
          credential: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: 'did:example:witness',
            credentialSubject: {
              id: 'did:example:subject',
              witnessContext: 'invalid-string-value',
            },
          },
        } as unknown as W3cCredentialRecord

        const result = extractWitnessInfo(mockCredential)

        expect(result).not.toBeNull()
        // Should still return basic info, just no witnessContext fields
        expect(result?.witnessDid).toBe('did:example:witness')
        expect(result?.event).toBeUndefined()
      })

      it('should handle missing credentialSubject', () => {
        const mockCredential = {
          id: 'credential-no-subject',
          credential: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: 'did:example:witness',
            // No credentialSubject
          },
        } as unknown as W3cCredentialRecord

        const result = extractWitnessInfo(mockCredential)

        expect(result).not.toBeNull()
        expect(result?.witnessDid).toBe('did:example:witness')
        expect(result?.event).toBeUndefined()
      })
    })

    describe('issuer name extraction', () => {
      it('should extract issuer name from object issuer', () => {
        const mockCredential = {
          id: 'credential-issuer-object',
          credential: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: {
              id: 'did:example:witness-server',
              name: 'EthDenver Witness Server',
            },
            credentialSubject: {
              id: 'did:example:subject',
            },
          },
        } as unknown as W3cCredentialRecord

        const result = extractWitnessInfo(mockCredential)

        expect(result).not.toBeNull()
        expect(result?.witnessDid).toBe('did:example:witness-server')
        expect(result?.witnessName).toBe('EthDenver Witness Server')
      })

      it('should use default "Witness" name when issuer is a string', () => {
        const mockCredential = {
          id: 'credential-issuer-string',
          credential: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: 'did:example:simple-witness',
            credentialSubject: {
              id: 'did:example:subject',
            },
          },
        } as unknown as W3cCredentialRecord

        const result = extractWitnessInfo(mockCredential)

        expect(result).not.toBeNull()
        expect(result?.witnessDid).toBe('did:example:simple-witness')
        expect(result?.witnessName).toBe('Witness')
      })

      it('should use default "Witness" name when issuer object has no name', () => {
        const mockCredential = {
          id: 'credential-issuer-no-name',
          credential: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: {
              id: 'did:example:nameless-witness',
              // No name property
            },
            credentialSubject: {
              id: 'did:example:subject',
            },
          },
        } as unknown as W3cCredentialRecord

        const result = extractWitnessInfo(mockCredential)

        expect(result).not.toBeNull()
        expect(result?.witnessDid).toBe('did:example:nameless-witness')
        expect(result?.witnessName).toBe('Witness')
      })

      it('should return null when issuer is missing entirely', () => {
        const mockCredential = {
          id: 'credential-no-issuer',
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

      it('should return null when issuer object has no id', () => {
        const mockCredential = {
          id: 'credential-issuer-no-id',
          credential: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: {
              name: 'Witness With No ID',
              // No id property
            },
            credentialSubject: {
              id: 'did:example:subject',
            },
          },
        } as unknown as W3cCredentialRecord

        const result = extractWitnessInfo(mockCredential)

        expect(result).toBeNull()
      })
    })

    describe('localityVerification extraction', () => {
      it('should extract complete localityVerification from witnessContext', () => {
        const mockCredential = {
          id: 'credential-locality-full',
          credential: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: 'did:example:witness',
            credentialSubject: {
              id: 'did:example:subject',
              witnessContext: {
                event: 'Summit',
                localityVerification: {
                  type: 'gps',
                  confirmed: true,
                  details: 'Location: Denver, CO',
                },
              },
            },
          },
        } as unknown as W3cCredentialRecord

        const result = extractWitnessInfo(mockCredential)

        expect(result).not.toBeNull()
        expect(result?.localityVerification).toBeDefined()
        expect(result?.localityVerification?.type).toBe('gps')
        expect(result?.localityVerification?.confirmed).toBe(true)
        expect(result?.localityVerification?.details).toBe('Location: Denver, CO')
      })

      it('should handle partial localityVerification', () => {
        const mockCredential = {
          id: 'credential-locality-partial',
          credential: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: 'did:example:witness',
            credentialSubject: {
              id: 'did:example:subject',
              witnessContext: {
                event: 'Event',
                localityVerification: {
                  type: 'proximity',
                  // No confirmed or details
                },
              },
            },
          },
        } as unknown as W3cCredentialRecord

        const result = extractWitnessInfo(mockCredential)

        expect(result).not.toBeNull()
        expect(result?.localityVerification?.type).toBe('proximity')
        expect(result?.localityVerification?.confirmed).toBeUndefined()
        expect(result?.localityVerification?.details).toBeUndefined()
      })

      it('should handle missing localityVerification', () => {
        const mockCredential = {
          id: 'credential-no-locality',
          credential: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: 'did:example:witness',
            credentialSubject: {
              id: 'did:example:subject',
              witnessContext: {
                event: 'Event',
                // No localityVerification
              },
            },
          },
        } as unknown as W3cCredentialRecord

        const result = extractWitnessInfo(mockCredential)

        expect(result).not.toBeNull()
        expect(result?.localityVerification).toBeUndefined()
      })
    })

    describe('credential date handling', () => {
      it('should prefer validFrom over issuanceDate', () => {
        const mockCredential = {
          id: 'credential-dates',
          credential: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: 'did:example:witness',
            validFrom: '2026-02-13T12:00:00Z',
            issuanceDate: '2026-02-12T12:00:00Z',
            credentialSubject: {
              id: 'did:example:subject',
            },
          },
        } as unknown as W3cCredentialRecord

        const result = extractWitnessInfo(mockCredential)

        expect(result).not.toBeNull()
        expect(result?.issuanceDate).toBe('2026-02-13T12:00:00Z')
      })

      it('should fall back to issuanceDate when validFrom is missing', () => {
        const mockCredential = {
          id: 'credential-issuance-date',
          credential: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: 'did:example:witness',
            issuanceDate: '2026-01-15T08:00:00Z',
            credentialSubject: {
              id: 'did:example:subject',
            },
          },
        } as unknown as W3cCredentialRecord

        const result = extractWitnessInfo(mockCredential)

        expect(result).not.toBeNull()
        expect(result?.issuanceDate).toBe('2026-01-15T08:00:00Z')
      })
    })

    describe('credentialSubject array handling', () => {
      it('should handle credentialSubject as array and use first element', () => {
        const mockCredential = {
          id: 'credential-array-subject',
          credential: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: 'did:example:witness',
            credentialSubject: [
              {
                id: 'did:example:first-subject',
                witnessContext: {
                  event: 'Array Test Event',
                  sessionId: 'array-session',
                },
              },
              {
                id: 'did:example:second-subject',
                witnessContext: {
                  event: 'Should Be Ignored',
                },
              },
            ],
          },
        } as unknown as W3cCredentialRecord

        const result = extractWitnessInfo(mockCredential)

        expect(result).not.toBeNull()
        expect(result?.event).toBe('Array Test Event')
        expect(result?.sessionId).toBe('array-session')
      })
    })

    describe('error handling', () => {
      it('should return null for null credential', () => {
        const mockCredential = {
          id: 'credential-null',
          credential: null,
        } as unknown as W3cCredentialRecord

        const result = extractWitnessInfo(mockCredential)

        expect(result).toBeNull()
      })

      it('should return null for array credential', () => {
        const mockCredential = {
          id: 'credential-array',
          credential: [],
        } as unknown as W3cCredentialRecord

        const result = extractWitnessInfo(mockCredential)

        expect(result).toBeNull()
      })

      it('should return null for non-object credential', () => {
        const mockCredential = {
          id: 'credential-string',
          credential: 'not-an-object',
        } as unknown as W3cCredentialRecord

        const result = extractWitnessInfo(mockCredential)

        expect(result).toBeNull()
      })
    })

    describe('toJSON method handling', () => {
      it('should handle credential with toJSON method', () => {
        const rawData = {
          type: ['VerifiableCredential', 'WitnessCredential'],
          issuer: {
            id: 'did:example:witness-with-tojson',
            name: 'JSON Witness',
          },
          validFrom: '2026-02-13T15:00:00Z',
          credentialSubject: {
            id: 'did:example:subject',
            witnessContext: {
              event: 'ToJSON Test',
              method: 'challenge-response',
            },
          },
        }

        const mockCredential = {
          id: 'credential-tojson',
          credential: {
            ...rawData,
            toJSON: () => rawData,
          },
        } as unknown as W3cCredentialRecord

        const result = extractWitnessInfo(mockCredential)

        expect(result).not.toBeNull()
        expect(result?.event).toBe('ToJSON Test')
        expect(result?.witnessName).toBe('JSON Witness')
      })
    })
  })
})
