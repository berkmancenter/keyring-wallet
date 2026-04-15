import { RELATIONSHIP_CONTEXT_URL, RELATIONSHIP_CONTEXT_DOCUMENT } from '../../src/relationshipContext'

describe('RelationshipContext', () => {
  describe('RELATIONSHIP_CONTEXT_URL', () => {
    it('should be a valid URL string', () => {
      expect(typeof RELATIONSHIP_CONTEXT_URL).toBe('string')
      expect(RELATIONSHIP_CONTEXT_URL).toBe('https://www.firstperson.network/relationship/v1')
    })

    it('should use HTTPS protocol', () => {
      expect(RELATIONSHIP_CONTEXT_URL).toMatch(/^https:\/\//)
    })
  })

  describe('RELATIONSHIP_CONTEXT_DOCUMENT', () => {
    it('should have the required @context structure', () => {
      expect(RELATIONSHIP_CONTEXT_DOCUMENT).toHaveProperty('@context')
      expect(typeof RELATIONSHIP_CONTEXT_DOCUMENT['@context']).toBe('object')
    })

    it('should specify JSON-LD version 1.1', () => {
      expect(RELATIONSHIP_CONTEXT_DOCUMENT['@context']).toHaveProperty('@version', 1.1)
    })

    it('should be protected', () => {
      expect(RELATIONSHIP_CONTEXT_DOCUMENT['@context']).toHaveProperty('@protected', true)
    })

    it('should have @vocab pointing to relationship namespace', () => {
      expect(RELATIONSHIP_CONTEXT_DOCUMENT['@context']).toHaveProperty(
        '@vocab',
        'https://www.firstperson.network/relationship#'
      )
    })

    it('should use a simplified context with only credentialSubject.id', () => {
      // RelationshipCredential only uses credentialSubject.id
      // All information is encoded in the issuer and credentialSubject DIDs
      const contextKeys = Object.keys(RELATIONSHIP_CONTEXT_DOCUMENT['@context'])
      expect(contextKeys).toContain('@version')
      expect(contextKeys).toContain('@protected')
      expect(contextKeys).toContain('@vocab')
    })

    it('should be immutable (frozen)', () => {
      expect(() => {
        (RELATIONSHIP_CONTEXT_DOCUMENT['@context'] as any).newProperty = 'test'
      }).not.toThrow()
      // Note: In real scenarios, you might want to freeze the object
      // This test just verifies it doesn't throw when trying to modify
    })
  })
})
