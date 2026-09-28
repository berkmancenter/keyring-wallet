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
} from '../../utils/witnessCredentialUtils'
import minted from '../../../trust-tasks/__tests__/fixtures/dtg-v1-minted-witness.json'

describe('witnessCredentialUtils', () => {
  describe('hasWitnessCredentialType', () => {
    it('should return true for WitnessCredential type', () => {
      const mockCredential = {
        encoded: {
          type: ['VerifiableCredential', 'DTGCredential', 'WitnessCredential'],
          issuer: 'did:example:witness',
          credentialSubject: {},
        },
      } as unknown as W3cCredentialRecord

      expect(hasWitnessCredentialType(mockCredential)).toBe(true)
    })

    it('should return true when WitnessCredential is the only type', () => {
      const mockCredential = {
        encoded: {
          type: 'WitnessCredential',
          issuer: 'did:example:witness',
          credentialSubject: {},
        },
      } as unknown as W3cCredentialRecord

      expect(hasWitnessCredentialType(mockCredential)).toBe(true)
    })

    it('should return false for non-WitnessCredential types', () => {
      const mockCredential = {
        encoded: {
          type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
          issuer: 'did:example:issuer',
          credentialSubject: {},
        },
      } as unknown as W3cCredentialRecord

      expect(hasWitnessCredentialType(mockCredential)).toBe(false)
    })

    it('should return false when credential has no type field', () => {
      const mockCredential = {
        encoded: {
          issuer: 'did:example:issuer',
          credentialSubject: {},
        },
      } as unknown as W3cCredentialRecord

      expect(hasWitnessCredentialType(mockCredential)).toBe(false)
    })

    it('should return false when credential is null or undefined', () => {
      const mockCredential = {
        encoded: null,
      } as unknown as W3cCredentialRecord

      expect(hasWitnessCredentialType(mockCredential)).toBe(false)
    })

    it('should return false when credential data is malformed', () => {
      const mockCredential = {
        encoded: 'not an object',
      } as unknown as W3cCredentialRecord

      expect(hasWitnessCredentialType(mockCredential)).toBe(false)
    })
  })

  describe('getWitnessCredentialsForSubject', () => {
    const mockSubjectDid = 'did:example:subject123'

    it('should filter VWCs by credentialSubject.id', () => {
      const credentials = [
        {
          encoded: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: 'did:example:witness',
            credentialSubject: {
              id: mockSubjectDid,
            },
          },
        },
        {
          encoded: {
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
      expect(result[0].encoded.type).toContain('WitnessCredential')
    })

    it('should return empty array when no matches', () => {
      const credentials = [
        {
          encoded: {
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
          encoded: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: 'did:example:witness1',
            credentialSubject: {
              id: mockSubjectDid,
              witnessContext: { event: 'Event 1' },
            },
          },
        },
        {
          encoded: {
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
          encoded: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: 'did:example:witness',
            credentialSubject: null,
          },
        },
        {
          encoded: {
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
        encoded: {
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
        // No locality* members and no legacy localityVerification on this
        // fixture's witnessContext — the honest read is 'not-offered', not
        // an inferred false (locality-plan.md §7.1 rule 5).
        locality: { outcome: 'not-offered' },
      })
    })

    it('should prefer credentialSubject.witnessName (spec-conforming home) over legacy issuer.name', () => {
      const mockCredential = {
        id: 'credential-witness-name',
        encoded: {
          type: ['VerifiableCredential', 'StatementCredential'],
          issuer: 'did:example:witness',
          credentialSubject: {
            id: 'did:example:subject',
            witnessName: 'VSC Witness Server',
            witnessContext: {
              sessionId: 'session-abc-123',
            },
          },
        },
      } as unknown as W3cCredentialRecord

      const result = extractWitnessInfo(mockCredential)

      expect(result?.witnessName).toBe('VSC Witness Server')
    })

    it('should handle issuer as string instead of object', () => {
      const mockCredential = {
        id: 'credential-456',
        encoded: {
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
        encoded: {
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
        encoded: {
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
        encoded: {
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
        encoded: null,
      } as unknown as W3cCredentialRecord

      const result = extractWitnessInfo(mockCredential)

      expect(result).toBeNull()
    })

    it('should return null when issuer is missing', () => {
      const mockCredential = {
        id: 'credential-404',
        encoded: {
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
        encoded: {
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

    describe('locality (locality-plan.md §7.1) — three states', () => {
      const vwcWith = (witnessContext: Record<string, unknown>) =>
        ({
          id: 'credential-locality',
          encoded: {
            type: ['VerifiableCredential', 'WitnessCredential'],
            issuer: 'did:example:witness',
            credentialSubject: { id: 'did:example:subject', witnessContext },
          },
        }) as unknown as W3cCredentialRecord

      it("reads a confirmed observation's flat members", () => {
        const result = extractWitnessInfo(
          vwcWith({
            localityConfirmed: true,
            localityMethod: 'ble-challenge-response/0.1',
            localityVenue: 'ATL, Room 2',
            localityObservedAt: '2026-08-21T00:00:00Z',
          })
        )
        expect(result?.locality).toEqual({
          outcome: 'confirmed',
          method: 'ble-challenge-response/0.1',
          reason: undefined,
          venue: 'ATL, Room 2',
          observedAt: '2026-08-21T00:00:00Z',
        })
      })

      it('distinguishes declinedByHolder (a choice) from windowLost (an interruption)', () => {
        const declined = extractWitnessInfo(
          vwcWith({ localityConfirmed: false, localityMethod: 'none', localityReason: 'declinedByHolder' })
        )
        const interrupted = extractWitnessInfo(
          vwcWith({ localityConfirmed: false, localityMethod: 'none', localityReason: 'windowLost' })
        )
        expect(declined?.locality).toEqual({
          outcome: 'declined',
          method: 'none',
          reason: 'declinedByHolder',
          venue: undefined,
          observedAt: undefined,
        })
        expect(interrupted?.locality?.reason).toBe('windowLost')
        expect(declined?.locality?.outcome).toBe(interrupted?.locality?.outcome) // both 'declined' — the DISPLAY layer reads `reason` to tell them apart
      })

      it("reads 'not-offered' from total absence of any locality member — never inferred from a false value", () => {
        const result = extractWitnessInfo(vwcWith({ event: 'EthDenver 2024', method: 'ble' }))
        expect(result?.locality).toEqual({ outcome: 'not-offered' })
      })

      it('the three outcomes are pairwise distinct', () => {
        const outcomes = [
          extractWitnessInfo(vwcWith({ localityConfirmed: true, localityMethod: 'ble-challenge-response/0.1' }))
            ?.locality?.outcome,
          extractWitnessInfo(
            vwcWith({ localityConfirmed: false, localityMethod: 'none', localityReason: 'windowLost' })
          )?.locality?.outcome,
          extractWitnessInfo(vwcWith({ event: 'no locality here' }))?.locality?.outcome,
        ]
        expect(new Set(outcomes).size).toBe(3)
      })

      it('falls back to the legacy nested shape only when no flat members exist', () => {
        const result = extractWitnessInfo(vwcWith({ localityVerification: { confirmed: true, type: 'proximity' } }))
        expect(result?.locality).toEqual({ outcome: 'confirmed' })
        expect(result?.localityVerification).toEqual({ confirmed: true, type: 'proximity', details: undefined })
      })

      it('the flat shape takes priority over a legacy nested one if both are somehow present', () => {
        const result = extractWitnessInfo(
          vwcWith({
            localityConfirmed: false,
            localityMethod: 'none',
            localityReason: 'declinedByHolder',
            localityVerification: { confirmed: true },
          })
        )
        expect(result?.locality?.outcome).toBe('declined')
      })
    })
  })
})

// 228: a witnessed/1 VWC (DTG Credentials v1). Its credentialSubject.id is
// "the issuer of the witnessed credential" (tf witness/session/submit as
// recast by #691; dtg-credentials 0.12.0 new_witnessed_vsc reads it with
// issuer_of, string or { id }). In a relationship exchange each party presents
// the VRC it issued under its relationship DID (ceremony.ts: issuer
// myRelationshipDid, as a string or { id, name }), so the VWC a counterparty
// shares names the counterparty's relationship DID: the value this lookup and
// the badge key on, as for the old shape.
describe('witnessCredentialUtils with a witnessed/1 VWC', () => {
  const record = (encoded: Record<string, unknown>, id = 'vwc-v1') =>
    ({ id, encoded }) as unknown as W3cCredentialRecord

  it("finds the crate-minted VWC under its witnessed VRC's issuer and builds the badge", () => {
    const vwc = minted.witnessStatement as Record<string, unknown>
    const vrcIssuer = minted.witnessedRelationship.issuer
    expect((vwc.credentialSubject as { id: string }).id).toBe(vrcIssuer)

    expect(hasWitnessCredentialType(record(vwc))).toBe(true)
    const found = getWitnessCredentialsForSubject([record(vwc)], vrcIssuer)
    expect(found).toHaveLength(1)
    expect(getWitnessCredentialsForSubject([record(vwc)], minted.parties.applicant)).toHaveLength(0)

    const info = extractWitnessInfo(found[0])
    expect(info).toMatchObject({
      witnessDid: vwc.issuer,
      witnessName: 'Witness',
      credentialId: 'vwc-v1',
      locality: { outcome: 'not-offered' },
    })
  })

  it("names the counterparty's relationship DID when the witnessed VRC's issuer is the { id, name } object Keyring writes", () => {
    const counterparty = 'did:peer:0zCounterpartyRel'
    // What a witness derives with issuer_of over a Keyring VRC whose issuer is
    // { id: <relationship DID>, name }, with an optional witnessContext.
    const vwc = {
      ...(minted.witnessStatement as Record<string, unknown>),
      credentialSubject: {
        id: counterparty,
        predicate: 'https://registry.trustoverip.org/dtg/vsc/witnessed/1',
        object: { digestMultibase: 'zQmXhTCPnjuGdyMqWWfdwyqNW4D6banDLjnA9x6Kxzc9ecK' },
        witnessContext: { event: 'In person', method: 'witness-server', sessionId: 'urn:uuid:s' },
      },
    }
    const found = getWitnessCredentialsForSubject([record(vwc)], counterparty)
    expect(found).toHaveLength(1)
    expect(extractWitnessInfo(found[0])).toMatchObject({
      event: 'In person',
      method: 'witness-server',
      sessionId: 'urn:uuid:s',
    })
  })
})
