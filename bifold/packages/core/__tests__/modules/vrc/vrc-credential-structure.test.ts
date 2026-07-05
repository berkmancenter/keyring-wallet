/**
 * Tests for VRC Credential Structure and Type Detection
 * 
 * VRC uses W3C JSON-LD credentials with specific type markers:
 * - DTGCredential: Relationship credential (shown in Contacts, hidden from Wallet)
 * - RCardTemplate: Self-issued business card (internal use, hidden from Wallet)
 * 
 * This tests the detection logic used to:
 * 1. Filter credentials from wallet view (ListCredentials.tsx)
 * 2. Identify VRC credentials for special handling
 * 3. Distinguish between credential formats (W3C, SD-JWT, AnonCreds)
 */

import { ClaimFormat, JsonTransformer, W3cCredentialRecord } from '@credo-ts/core'
import { DTG_CONTEXT_URL, RELATIONSHIP_CONTEXT_URL } from '../../../src/modules/vrc/types/relationshipContext'

describe('VRC Credential Structure', () => {
  // Test context URLs
  const VRC_CONTEXTS = {
    W3C_V1: 'https://www.w3.org/2018/credentials/v1',
    W3C_V2: 'https://www.w3.org/ns/credentials/v2',
    DTG: DTG_CONTEXT_URL,
    RELATIONSHIP: RELATIONSHIP_CONTEXT_URL,
  }

  // Test DIDs
  const testDids = {
    issuer: 'did:peer:0z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    subject: 'did:peer:0z6MknGc3ocHs3zdPiJbnaaqDi58NGb4pk1Sp9WNhJhvaFed',
  }

  // Helper to generate UUID
  const generateUUID = () =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })

  describe('DTGCredential (RelationshipCredential) Structure', () => {
    // Create a sample DTG credential structure
    const createDTGCredentialData = (overrides: any = {}) => ({
      _tags: {
        claimFormat: ClaimFormat.LdpVc,
        contexts: [VRC_CONTEXTS.W3C_V2, VRC_CONTEXTS.DTG, VRC_CONTEXTS.RELATIONSHIP],
        types: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
        issuerId: testDids.issuer,
      },
      type: 'W3cCredentialRecord',
      id: `urn:uuid:${generateUUID()}`,
      createdAt: new Date().toISOString(),
      credential: {
        '@context': [VRC_CONTEXTS.W3C_V2, VRC_CONTEXTS.DTG, VRC_CONTEXTS.RELATIONSHIP],
        type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
        issuer: {
          id: testDids.issuer,
          name: 'Test User',
        },
        validFrom: new Date().toISOString(),
        credentialSubject: {
          id: testDids.subject,
        },
        proof: {
          type: 'Ed25519Signature2018',
          created: new Date().toISOString(),
          proofPurpose: 'assertionMethod',
          verificationMethod: `${testDids.issuer}#key-1`,
          jws: 'mock-jws-signature',
        },
        ...overrides.credential,
      },
      ...overrides,
    })

    it('should have correct @context array with W3C VC context first', () => {
      const credData = createDTGCredentialData()
      const contexts = credData.credential['@context']

      // W3C VC context must be first (required by validator)
      expect(contexts[0]).toBe(VRC_CONTEXTS.W3C_V2)
      expect(contexts).toContain(VRC_CONTEXTS.DTG)
      expect(contexts).toContain(VRC_CONTEXTS.RELATIONSHIP)
    })

    it('should have correct type array including DTGCredential and RelationshipCredential', () => {
      const credData = createDTGCredentialData()
      const types = credData.credential.type

      expect(types).toContain('VerifiableCredential')
      expect(types).toContain('DTGCredential')
      expect(types).toContain('RelationshipCredential')
    })

    it('should have issuer object with id and name', () => {
      const credData = createDTGCredentialData()
      const issuer = credData.credential.issuer

      expect(issuer.id).toBe(testDids.issuer)
      expect(issuer.name).toBe('Test User')
      expect(issuer.id).toMatch(/^did:peer:0/) // Relationship DID format
    })

    it('should have credentialSubject with counterparty relationship DID', () => {
      const credData = createDTGCredentialData()
      const subject = credData.credential.credentialSubject

      expect(subject.id).toBe(testDids.subject)
      expect(subject.id).toMatch(/^did:peer:0/) // Relationship DID format
    })

    it('should have Ed25519Signature2018 proof type', () => {
      const credData = createDTGCredentialData()
      const proof = credData.credential.proof

      expect(proof.type).toBe('Ed25519Signature2018')
      expect(proof.proofPurpose).toBe('assertionMethod')
    })

    it('should be serializable to W3cCredentialRecord', () => {
      const credData = createDTGCredentialData()
      const record = JsonTransformer.fromJSON(credData, W3cCredentialRecord)

      expect(record).toBeInstanceOf(W3cCredentialRecord)
      expect(record.id).toBe(credData.id)
    })
  })

  describe('RCardTemplate Credential Structure', () => {
    const createRCardTemplateData = () => ({
      _tags: {
        claimFormat: ClaimFormat.LdpVc,
        types: ['VerifiableCredential', 'RCardTemplate'],
        issuerId: testDids.issuer,
      },
      type: 'W3cCredentialRecord',
      id: `urn:uuid:${generateUUID()}`,
      createdAt: new Date().toISOString(),
      credential: {
        '@context': [VRC_CONTEXTS.W3C_V2],
        type: ['VerifiableCredential', 'RCardTemplate'],
        issuer: {
          id: testDids.issuer,
        },
        validFrom: new Date().toISOString(),
        credentialSubject: {
          id: testDids.issuer, // Self-issued
          jcard: ['vcard', [], ['fn', {}, 'text', 'Test User']],
        },
      },
    })

    it('should have RCardTemplate in type array', () => {
      const credData = createRCardTemplateData()

      expect(credData.credential.type).toContain('RCardTemplate')
    })

    it('should be self-issued (issuer === subject)', () => {
      const credData = createRCardTemplateData()

      expect(credData.credential.issuer.id).toBe(credData.credential.credentialSubject.id)
    })

    it('should contain jCard data in credentialSubject', () => {
      const credData = createRCardTemplateData()

      expect(credData.credential.credentialSubject.jcard).toBeDefined()
      expect(Array.isArray(credData.credential.credentialSubject.jcard)).toBe(true)
    })
  })

  describe('Credential Type Detection (shouldHideFromWallet logic)', () => {
    /**
     * This tests the detection logic used in ListCredentials.tsx
     * to filter out VRC credentials from the wallet view
     */

    // Helper that mirrors shouldHideFromWallet logic
    const shouldHideFromWallet = (credential: any): boolean => {
      try {
        const cred = credential as any

        // For W3C credentials - check if it has a 'credential' property (duck typing)
        if (cred.credential && typeof cred.credential === 'object') {
          const credentialData = cred.credential

          if ('type' in credentialData) {
            const typeValue = credentialData.type
            const types = Array.isArray(typeValue) ? typeValue : [typeValue]

            if (
              types.some(
                (type: unknown) =>
                  typeof type === 'string' && (type.includes('DTGCredential') || type.includes('RCardTemplate'))
              )
            ) {
              return true
            }
          }
        }

        // For SdJwtVc records - check compactSdJwtVc property
        if (cred.compactSdJwtVc && typeof cred.compactSdJwtVc === 'object') {
          const credentialData = cred.compactSdJwtVc
          if ('type' in credentialData) {
            const typeValue = credentialData.type
            const types = Array.isArray(typeValue) ? typeValue : [typeValue]
            if (
              types.some(
                (type: unknown) =>
                  typeof type === 'string' && (type.includes('DTGCredential') || type.includes('RCardTemplate'))
              )
            ) {
              return true
            }
          }
        }

        // For AnonCreds CredentialExchangeRecord
        if (cred.credentialAttributes && Array.isArray(cred.credentialAttributes)) {
          const typeAttribute = cred.credentialAttributes.find((attr: any) => attr && attr.name === 'type')

          if (
            typeAttribute &&
            typeAttribute.value &&
            typeof typeAttribute.value === 'string' &&
            (typeAttribute.value.includes('DTGCredential') || typeAttribute.value.includes('RCardTemplate'))
          ) {
            return true
          }
        }
      } catch {
        // Default to false
      }

      return false
    }

    describe('W3C Credential Detection', () => {
      it('should detect DTGCredential in W3C credential', () => {
        const cred = {
          credential: {
            type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
          },
        }

        expect(shouldHideFromWallet(cred)).toBe(true)
      })

      it('should detect RCardTemplate in W3C credential', () => {
        const cred = {
          credential: {
            type: ['VerifiableCredential', 'RCardTemplate'],
          },
        }

        expect(shouldHideFromWallet(cred)).toBe(true)
      })

      it('should NOT hide regular W3C credentials', () => {
        const cred = {
          credential: {
            type: ['VerifiableCredential', 'UniversityDegreeCredential'],
          },
        }

        expect(shouldHideFromWallet(cred)).toBe(false)
      })

      it('should handle single type value (not array)', () => {
        const cred = {
          credential: {
            type: 'DTGCredential',
          },
        }

        expect(shouldHideFromWallet(cred)).toBe(true)
      })

      it('should handle missing type property', () => {
        const cred = {
          credential: {
            issuer: 'did:example:123',
          },
        }

        expect(shouldHideFromWallet(cred)).toBe(false)
      })
    })

    describe('SD-JWT VC Detection', () => {
      it('should detect DTGCredential in SD-JWT VC', () => {
        const cred = {
          compactSdJwtVc: {
            type: ['VerifiableCredential', 'DTGCredential'],
          },
        }

        expect(shouldHideFromWallet(cred)).toBe(true)
      })

      it('should detect RCardTemplate in SD-JWT VC', () => {
        const cred = {
          compactSdJwtVc: {
            type: ['RCardTemplate'],
          },
        }

        expect(shouldHideFromWallet(cred)).toBe(true)
      })

      it('should NOT hide regular SD-JWT credentials', () => {
        const cred = {
          compactSdJwtVc: {
            type: ['VerifiableCredential', 'IdentityCredential'],
          },
        }

        expect(shouldHideFromWallet(cred)).toBe(false)
      })
    })

    describe('AnonCreds Credential Detection', () => {
      it('should detect DTGCredential in AnonCreds attributes', () => {
        const cred = {
          credentialAttributes: [
            { name: 'name', value: 'Test User' },
            { name: 'type', value: 'DTGCredential' },
          ],
        }

        expect(shouldHideFromWallet(cred)).toBe(true)
      })

      it('should detect RCardTemplate in AnonCreds attributes', () => {
        const cred = {
          credentialAttributes: [
            { name: 'type', value: 'RCardTemplate' },
          ],
        }

        expect(shouldHideFromWallet(cred)).toBe(true)
      })

      it('should NOT hide regular AnonCreds credentials', () => {
        const cred = {
          credentialAttributes: [
            { name: 'type', value: 'DriversLicense' },
            { name: 'name', value: 'John Doe' },
          ],
        }

        expect(shouldHideFromWallet(cred)).toBe(false)
      })

      it('should handle credentials without type attribute', () => {
        const cred = {
          credentialAttributes: [
            { name: 'name', value: 'Test User' },
            { name: 'degree', value: 'Bachelor' },
          ],
        }

        expect(shouldHideFromWallet(cred)).toBe(false)
      })
    })

    describe('Edge Cases', () => {
      it('should handle null credential', () => {
        expect(shouldHideFromWallet(null)).toBe(false)
      })

      it('should handle undefined credential', () => {
        expect(shouldHideFromWallet(undefined)).toBe(false)
      })

      it('should handle empty object', () => {
        expect(shouldHideFromWallet({})).toBe(false)
      })

      it('should handle malformed credential object', () => {
        const cred = {
          credential: 'not-an-object',
        }

        expect(shouldHideFromWallet(cred)).toBe(false)
      })

      it('should handle partial type match (substring)', () => {
        // Should match because includes() is used
        const cred = {
          credential: {
            type: ['VerifiableCredential', 'MyDTGCredentialExtension'],
          },
        }

        expect(shouldHideFromWallet(cred)).toBe(true)
      })
    })
  })

  describe('VRC Goal Code Detection', () => {
    /**
     * VRC connections are identified by goalCode in OOB invitations
     */

    const isVrcConnection = (goalCode: string | undefined): boolean => {
      return goalCode === 'relationship.credential' || goalCode === 'relationship.credential.bidirectional'
    }

    it('should identify bidirectional VRC connection', () => {
      expect(isVrcConnection('relationship.credential.bidirectional')).toBe(true)
    })

    it('should identify unidirectional VRC connection', () => {
      expect(isVrcConnection('relationship.credential')).toBe(true)
    })

    it('should NOT identify regular connections', () => {
      expect(isVrcConnection('aries.vc.issue')).toBe(false)
      expect(isVrcConnection('aries.vc.verify')).toBe(false)
      expect(isVrcConnection(undefined)).toBe(false)
    })
  })

  describe('VRC Credential Content Validation', () => {
    /**
     * Tests for validating VRC credential content structure
     */

    const validateVrcCredential = (credential: any): { valid: boolean; errors: string[] } => {
      const errors: string[] = []

      if (!credential) {
        errors.push('Credential is required')
        return { valid: false, errors }
      }

      // Check context
      const contexts = credential['@context']
      if (!contexts || !Array.isArray(contexts)) {
        errors.push('@context must be an array')
      } else {
        if (!contexts[0]?.includes('w3.org')) {
          errors.push('First context must be W3C VC context')
        }
      }

      // Check type
      const types = credential.type
      if (!types || !Array.isArray(types)) {
        errors.push('type must be an array')
      } else {
        if (!types.includes('VerifiableCredential')) {
          errors.push('type must include VerifiableCredential')
        }
        if (!types.includes('DTGCredential')) {
          errors.push('type must include DTGCredential')
        }
      }

      // Check issuer
      const issuer = credential.issuer
      if (!issuer || typeof issuer !== 'object') {
        errors.push('issuer must be an object')
      } else {
        if (!issuer.id) {
          errors.push('issuer.id is required')
        } else if (!issuer.id.startsWith('did:')) {
          errors.push('issuer.id must be a DID')
        }
      }

      // Check credentialSubject
      const subject = credential.credentialSubject
      if (!subject || typeof subject !== 'object') {
        errors.push('credentialSubject must be an object')
      } else {
        if (!subject.id) {
          errors.push('credentialSubject.id is required')
        } else if (!subject.id.startsWith('did:')) {
          errors.push('credentialSubject.id must be a DID')
        }
      }

      return { valid: errors.length === 0, errors }
    }

    it('should validate a correct VRC credential', () => {
      const credential = {
        '@context': [VRC_CONTEXTS.W3C_V2, VRC_CONTEXTS.DTG],
        type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
        issuer: { id: testDids.issuer, name: 'Test User' },
        credentialSubject: { id: testDids.subject },
      }

      const result = validateVrcCredential(credential)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject credential missing @context', () => {
      const credential = {
        type: ['VerifiableCredential', 'DTGCredential'],
        issuer: { id: testDids.issuer },
        credentialSubject: { id: testDids.subject },
      }

      const result = validateVrcCredential(credential)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('@context must be an array')
    })

    it('should reject credential with wrong first context', () => {
      const credential = {
        '@context': [VRC_CONTEXTS.DTG, VRC_CONTEXTS.W3C_V2],
        type: ['VerifiableCredential', 'DTGCredential'],
        issuer: { id: testDids.issuer },
        credentialSubject: { id: testDids.subject },
      }

      const result = validateVrcCredential(credential)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('First context must be W3C VC context')
    })

    it('should reject credential missing DTGCredential type', () => {
      const credential = {
        '@context': [VRC_CONTEXTS.W3C_V2],
        type: ['VerifiableCredential'],
        issuer: { id: testDids.issuer },
        credentialSubject: { id: testDids.subject },
      }

      const result = validateVrcCredential(credential)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('type must include DTGCredential')
    })

    it('should reject credential with non-DID issuer', () => {
      const credential = {
        '@context': [VRC_CONTEXTS.W3C_V2],
        type: ['VerifiableCredential', 'DTGCredential'],
        issuer: { id: 'not-a-did', name: 'Test' },
        credentialSubject: { id: testDids.subject },
      }

      const result = validateVrcCredential(credential)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('issuer.id must be a DID')
    })

    it('should reject credential with non-DID subject', () => {
      const credential = {
        '@context': [VRC_CONTEXTS.W3C_V2],
        type: ['VerifiableCredential', 'DTGCredential'],
        issuer: { id: testDids.issuer },
        credentialSubject: { id: 'not-a-did' },
      }

      const result = validateVrcCredential(credential)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('credentialSubject.id must be a DID')
    })
  })

  describe('Context URL Constants', () => {
    it('should have correct DTG context URL', () => {
      expect(VRC_CONTEXTS.DTG).toBe(DTG_CONTEXT_URL)
      expect(DTG_CONTEXT_URL).toMatch(/^https:\/\//)
    })

    it('should have correct Relationship context URL', () => {
      expect(VRC_CONTEXTS.RELATIONSHIP).toBe(RELATIONSHIP_CONTEXT_URL)
      expect(RELATIONSHIP_CONTEXT_URL).toMatch(/^https:\/\//)
    })
  })
})
