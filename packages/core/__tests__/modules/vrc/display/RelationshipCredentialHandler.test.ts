import {
  RelationshipCredentialHandler,
  relationshipCredentialHandler,
} from '../../../../src/modules/vrc/display/handlers/RelationshipCredentialHandler'
import { W3cCredentialJson, Attribute } from '../../../../src/modules/vrc/display/types'
import { contactTerminology } from '../../../../src/modules/vrc/display/terminology/defaults'

// Create test credential with various field combinations
const createRelationshipCredential = (overrides: Partial<W3cCredentialJson> = {}): W3cCredentialJson => ({
  '@context': ['https://www.w3.org/2018/credentials/v1'],
  type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
  issuer: {
    id: 'did:example:issuer123',
    name: 'Alice Smith',
    email: 'alice@example.com',
    organization: 'Example Org',
  },
  validFrom: '2024-01-15T10:30:00Z',
  credentialSubject: {
    id: 'did:example:subject456',
  },
  ...overrides,
})

describe('RelationshipCredentialHandler', () => {
  let handler: RelationshipCredentialHandler

  beforeEach(() => {
    handler = new RelationshipCredentialHandler()
  })

  describe('properties', () => {
    it('should have credentialTypes set to RelationshipCredential', () => {
      expect(handler.credentialTypes).toEqual(['RelationshipCredential'])
    })

    it('should have priority of 100', () => {
      expect(handler.priority).toBe(100)
    })
  })

  describe('canHandle', () => {
    it('should return true for RelationshipCredential type', () => {
      const credential = createRelationshipCredential()
      expect(handler.canHandle(credential)).toBe(true)
    })

    it('should return false for DTGCredential without RelationshipCredential', () => {
      const credential = createRelationshipCredential({
        type: ['VerifiableCredential', 'DTGCredential'],
      })
      expect(handler.canHandle(credential)).toBe(false)
    })

    it('should return false for non-relationship credential', () => {
      const credential = createRelationshipCredential({
        type: ['VerifiableCredential', 'SomeOtherCredential'],
      })
      expect(handler.canHandle(credential)).toBe(false)
    })
  })

  describe('extractFields', () => {
    it('should extract issuance date from validFrom', () => {
      const credential = createRelationshipCredential({
        validFrom: '2024-06-15T14:30:00Z',
      })

      const fields = handler.extractFields(credential) as Attribute[]
      const dateField = fields.find((f) => f.name === 'issuanceDate')

      expect(dateField).toBeDefined()
      expect(dateField?.value).toBeTruthy()
      // Should be formatted as a readable date
      expect(typeof dateField?.value).toBe('string')
    })

    it('should extract issuance date from issuanceDate when validFrom not present', () => {
      const credential = createRelationshipCredential({
        validFrom: undefined,
        issuanceDate: '2024-03-20T09:00:00Z',
      })

      const fields = handler.extractFields(credential) as Attribute[]
      const dateField = fields.find((f) => f.name === 'issuanceDate')

      expect(dateField).toBeDefined()
      expect(dateField?.value).toBeTruthy()
    })

    it('should extract issuer name', () => {
      const credential = createRelationshipCredential()

      const fields = handler.extractFields(credential) as Attribute[]
      const nameField = fields.find((f) => f.name === 'issuerName')

      expect(nameField).toBeDefined()
      expect(nameField?.value).toBe('Alice Smith')
      expect(nameField?.label).toBe('Issuer Name')
    })

    it('should extract issuer email when present', () => {
      const credential = createRelationshipCredential()

      const fields = handler.extractFields(credential) as Attribute[]
      const emailField = fields.find((f) => f.name === 'issuerEmail')

      expect(emailField).toBeDefined()
      expect(emailField?.value).toBe('alice@example.com')
      expect(emailField?.label).toBe('Issuer Email')
    })

    it('should not include email field when email not present', () => {
      const credential = createRelationshipCredential({
        issuer: {
          id: 'did:example:issuer123',
          name: 'Alice Smith',
          // No email
        },
      })

      const fields = handler.extractFields(credential)
      const emailField = fields.find((f) => f.name === 'issuerEmail')

      expect(emailField).toBeUndefined()
    })

    it('should extract issuer organization when present', () => {
      const credential = createRelationshipCredential()

      const fields = handler.extractFields(credential) as Attribute[]
      const orgField = fields.find((f) => f.name === 'issuerOrganization')

      expect(orgField).toBeDefined()
      expect(orgField?.value).toBe('Example Org')
      expect(orgField?.label).toBe('Issuer Organization')
    })

    it('should not include organization field when organization not present', () => {
      const credential = createRelationshipCredential({
        issuer: {
          id: 'did:example:issuer123',
          name: 'Alice Smith',
          // No organization
        },
      })

      const fields = handler.extractFields(credential) as Attribute[]
      const orgField = fields.find((f) => f.name === 'issuerOrganization')

      expect(orgField).toBeUndefined()
    })

    it('should extract issuer DID', () => {
      const credential = createRelationshipCredential()

      const fields = handler.extractFields(credential) as Attribute[]
      const didField = fields.find((f) => f.name === 'issuerDid')

      expect(didField).toBeDefined()
      expect(didField?.value).toBe('did:example:issuer123')
      expect(didField?.label).toBe('Issuer R-DID')
    })

    it('should extract recipient DID from credentialSubject.id', () => {
      const credential = createRelationshipCredential()

      const fields = handler.extractFields(credential) as Attribute[]
      const recipientField = fields.find((f) => f.name === 'recipientDid')

      expect(recipientField).toBeDefined()
      expect(recipientField?.value).toBe('did:example:subject456')
      expect(recipientField?.label).toBe('Your R-DID')
    })

    it('should handle string issuer format', () => {
      const credential = createRelationshipCredential({
        issuer: 'did:example:simple-issuer',
      })

      const fields = handler.extractFields(credential) as Attribute[]
      const didField = fields.find((f) => f.name === 'issuerDid')

      expect(didField).toBeDefined()
      expect(didField?.value).toBe('did:example:simple-issuer')
    })

    it('should handle missing credentialSubject.id', () => {
      const credential = createRelationshipCredential({
        credentialSubject: {},
      })

      const fields = handler.extractFields(credential)
      const recipientField = fields.find((f) => f.name === 'recipientDid')

      expect(recipientField).toBeUndefined()
    })

    it('should return fields in expected order', () => {
      const credential = createRelationshipCredential()

      const fields = handler.extractFields(credential)
      const fieldNames = fields.map((f) => f.name)

      // Expected order: issuanceDate, issuerName, issuerEmail, issuerOrganization, issuerDid, recipientDid
      expect(fieldNames).toEqual([
        'issuanceDate',
        'issuerName',
        'issuerEmail',
        'issuerOrganization',
        'issuerDid',
        'recipientDid',
      ])
    })
  })

  describe('getButtonText', () => {
    it('should return Contacts.AcceptContact for accept', () => {
      const buttonText = handler.getButtonText()
      expect(buttonText.accept).toBe('Contacts.AcceptContact')
    })

    it('should return Contacts.DeclineContact for decline', () => {
      const buttonText = handler.getButtonText()
      expect(buttonText.decline).toBe('Contacts.DeclineContact')
    })
  })

  describe('getTerminology', () => {
    it('should return contact terminology', () => {
      const terminology = handler.getTerminology()
      expect(terminology).toBe(contactTerminology)
    })

    it('should return terminology with contact-specific translation keys', () => {
      const terminology = handler.getTerminology()

      // Nouns
      expect(terminology.singular).toBe('Contacts.Contact')
      expect(terminology.plural).toBe('Contacts.Contacts')

      // Screen titles
      expect(terminology.offerScreenTitle).toBe('Contacts.OfferScreenTitle')
      expect(terminology.detailScreenTitle).toBe('Contacts.DetailScreenTitle')

      // Offer flow
      expect(terminology.isOfferingYou).toBe('Contacts.IsOfferingYouAContact')
      expect(terminology.declineTitle).toBe('Contacts.DeclineTitle')
      expect(terminology.confirmDecline).toBe('Contacts.ConfirmDecline')
      expect(terminology.addedToWallet).toBe('Contacts.ContactAddedToYourWallet')

      // Detail/remove flow
      expect(terminology.issuedByLabel).toBe('Contacts.ConnectedWith')
      expect(terminology.removeTitle).toBe('Contacts.RemoveTitle')
      expect(terminology.removeButtonLabel).toBe('Contacts.RemoveFromWallet')
      expect(terminology.removedConfirmation).toBe('Contacts.ContactRemoved')

      // Tour steps
      expect(terminology.tourAddTitle).toBe('Contacts.TourAddTitle')
      expect(terminology.tourAddDescription).toBe('Contacts.TourAddDescription')
    })
  })

  describe('singleton instance', () => {
    it('should export a singleton instance', () => {
      expect(relationshipCredentialHandler).toBeInstanceOf(RelationshipCredentialHandler)
    })

    it('should have the same configuration as a new instance', () => {
      expect(relationshipCredentialHandler.credentialTypes).toEqual(handler.credentialTypes)
      expect(relationshipCredentialHandler.priority).toBe(handler.priority)
    })
  })
})

describe('edge cases', () => {
  const handler = new RelationshipCredentialHandler()

  it('should handle credential with minimal fields', () => {
    const minimalCredential: W3cCredentialJson = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential', 'RelationshipCredential'],
      issuer: 'did:example:minimal',
      credentialSubject: {},
    }

    const fields = handler.extractFields(minimalCredential)

    // Should only have issuerDid
    expect(fields).toHaveLength(1)
    expect(fields[0].name).toBe('issuerDid')
  })

  it('should handle empty issuer object', () => {
    const credential = createRelationshipCredential({
      issuer: {
        id: '',
      },
    })

    const fields = handler.extractFields(credential)

    // Should not crash and should return minimal fields
    expect(Array.isArray(fields)).toBe(true)
  })

  it('should handle invalid date format gracefully', () => {
    const credential = createRelationshipCredential({
      validFrom: 'invalid-date-format',
    })

    // Should not throw
    expect(() => handler.extractFields(credential)).not.toThrow()

    const fields = handler.extractFields(credential)
    const dateField = fields.find((f) => f.name === 'issuanceDate')

    // Should still include the field (formatDateForDisplay handles invalid dates)
    expect(dateField).toBeDefined()
  })
})
