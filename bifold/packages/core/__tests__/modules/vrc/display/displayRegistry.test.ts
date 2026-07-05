import {
  credentialDisplayRegistry,
  isDTGCredential,
  isRelationshipCredential,
} from '../../../../src/modules/vrc/display/displayRegistry'
import { RelationshipCredentialHandler } from '../../../../src/modules/vrc/display/handlers/RelationshipCredentialHandler'
import {
  CredentialDisplayHandler,
  W3cCredentialJson,
  CredentialButtonText,
} from '../../../../src/modules/vrc/display/types'
import { Field } from '@bifold/oca/build/legacy'

// Mock handler for testing priority
class MockHighPriorityHandler implements CredentialDisplayHandler {
  readonly credentialTypes = ['MockCredential']
  readonly priority = 200 // Higher than RelationshipCredentialHandler (100)

  canHandle(credential: W3cCredentialJson): boolean {
    const types = Array.isArray(credential.type) ? credential.type : [credential.type]
    return types.some((t) => typeof t === 'string' && t.includes('MockCredential'))
  }

  extractFields(_credential: W3cCredentialJson): Field[] {
    return []
  }

  getButtonText(): CredentialButtonText {
    return {
      accept: 'Mock.Accept',
      decline: 'Mock.Decline',
    }
  }
}

class MockLowPriorityHandler implements CredentialDisplayHandler {
  readonly credentialTypes = ['LowPriorityCredential']
  readonly priority = 10 // Lower priority

  canHandle(credential: W3cCredentialJson): boolean {
    const types = Array.isArray(credential.type) ? credential.type : [credential.type]
    return types.some((t) => typeof t === 'string' && t.includes('LowPriorityCredential'))
  }

  extractFields(_credential: W3cCredentialJson): Field[] {
    return []
  }

  getButtonText(): CredentialButtonText {
    return {
      accept: 'LowPriority.Accept',
      decline: 'LowPriority.Decline',
    }
  }
}

// Sample credential fixtures
const createSampleCredential = (types: string[]): W3cCredentialJson => ({
  '@context': ['https://www.w3.org/2018/credentials/v1'],
  type: types,
  issuer: {
    id: 'did:example:issuer123',
    name: 'Test Issuer',
  },
  issuanceDate: '2024-01-15T10:00:00Z',
  credentialSubject: {
    id: 'did:example:subject456',
  },
})

describe('CredentialDisplayRegistry', () => {
  beforeEach(() => {
    // Clear registry before each test
    credentialDisplayRegistry.clear()
  })

  describe('register', () => {
    it('should register a handler', () => {
      const handler = new RelationshipCredentialHandler()
      credentialDisplayRegistry.register(handler)

      const handlers = credentialDisplayRegistry.getRegisteredHandlers()
      expect(handlers).toHaveLength(1)
      expect(handlers[0]).toBe(handler)
    })

    it('should sort handlers by priority (highest first)', () => {
      const lowHandler = new MockLowPriorityHandler()
      const highHandler = new MockHighPriorityHandler()
      const relationshipHandler = new RelationshipCredentialHandler()

      // Register in random order
      credentialDisplayRegistry.register(lowHandler)
      credentialDisplayRegistry.register(relationshipHandler)
      credentialDisplayRegistry.register(highHandler)

      const handlers = credentialDisplayRegistry.getRegisteredHandlers()
      expect(handlers).toHaveLength(3)
      expect(handlers[0].priority).toBe(200) // MockHighPriorityHandler
      expect(handlers[1].priority).toBe(100) // RelationshipCredentialHandler
      expect(handlers[2].priority).toBe(10) // MockLowPriorityHandler
    })
  })

  describe('unregister', () => {
    it('should unregister a handler by credential types', () => {
      const handler = new RelationshipCredentialHandler()
      credentialDisplayRegistry.register(handler)

      expect(credentialDisplayRegistry.getRegisteredHandlers()).toHaveLength(1)

      credentialDisplayRegistry.unregister(['RelationshipCredential'])

      expect(credentialDisplayRegistry.getRegisteredHandlers()).toHaveLength(0)
    })
  })

  describe('findHandler', () => {
    beforeEach(() => {
      credentialDisplayRegistry.register(new RelationshipCredentialHandler())
    })

    it('should find handler for RelationshipCredential', () => {
      const credential = createSampleCredential(['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'])

      const handler = credentialDisplayRegistry.findHandler(credential)

      expect(handler).toBeDefined()
      expect(handler?.credentialTypes).toContain('RelationshipCredential')
    })

    it('should return undefined for unmatched credential type', () => {
      const credential = createSampleCredential(['VerifiableCredential', 'SomeOtherCredential'])

      const handler = credentialDisplayRegistry.findHandler(credential)

      expect(handler).toBeUndefined()
    })

    it('should match higher priority handler when multiple could match', () => {
      // Register both handlers where one has higher priority
      credentialDisplayRegistry.clear()
      credentialDisplayRegistry.register(new MockLowPriorityHandler())
      credentialDisplayRegistry.register(new MockHighPriorityHandler())

      const credential = createSampleCredential(['VerifiableCredential', 'MockCredential'])

      const handler = credentialDisplayRegistry.findHandler(credential)

      expect(handler?.priority).toBe(200)
    })
  })

  describe('getDisplayInfo', () => {
    beforeEach(() => {
      credentialDisplayRegistry.register(new RelationshipCredentialHandler())
    })

    it('should return matched=true when handler found', () => {
      const credential = createSampleCredential(['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'])

      const result = credentialDisplayRegistry.getDisplayInfo(credential)

      expect(result.matched).toBe(true)
      expect(result.fields.length).toBeGreaterThan(0)
    })

    it('should return matched=false with default buttons when no handler found', () => {
      const credential = createSampleCredential(['VerifiableCredential', 'SomeOtherCredential'])

      const result = credentialDisplayRegistry.getDisplayInfo(credential)

      expect(result.matched).toBe(false)
      expect(result.fields).toHaveLength(0)
      expect(result.buttonText.accept).toBe('Global.Accept')
      expect(result.buttonText.decline).toBe('Global.Decline')
    })

    it('should return custom button text when handler found', () => {
      const credential = createSampleCredential(['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'])

      const result = credentialDisplayRegistry.getDisplayInfo(credential)

      expect(result.buttonText.accept).toBe('Contacts.AcceptContact')
      expect(result.buttonText.decline).toBe('Contacts.DeclineContact')
    })
  })

  describe('hasHandler', () => {
    beforeEach(() => {
      credentialDisplayRegistry.register(new RelationshipCredentialHandler())
    })

    it('should return true when handler exists', () => {
      const credential = createSampleCredential(['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'])

      expect(credentialDisplayRegistry.hasHandler(credential)).toBe(true)
    })

    it('should return false when no handler exists', () => {
      const credential = createSampleCredential(['VerifiableCredential', 'SomeOtherCredential'])

      expect(credentialDisplayRegistry.hasHandler(credential)).toBe(false)
    })
  })

  describe('getButtonText', () => {
    beforeEach(() => {
      credentialDisplayRegistry.register(new RelationshipCredentialHandler())
    })

    it('should return handler button text when handler exists', () => {
      const credential = createSampleCredential(['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'])

      const buttonText = credentialDisplayRegistry.getButtonText(credential)

      expect(buttonText.accept).toBe('Contacts.AcceptContact')
      expect(buttonText.decline).toBe('Contacts.DeclineContact')
    })

    it('should return default button text when no handler exists', () => {
      const credential = createSampleCredential(['VerifiableCredential', 'SomeOtherCredential'])

      const buttonText = credentialDisplayRegistry.getButtonText(credential)

      expect(buttonText.accept).toBe('Global.Accept')
      expect(buttonText.decline).toBe('Global.Decline')
    })
  })

  describe('getFields', () => {
    beforeEach(() => {
      credentialDisplayRegistry.register(new RelationshipCredentialHandler())
    })

    it('should return fields when handler exists', () => {
      const credential = createSampleCredential(['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'])

      const fields = credentialDisplayRegistry.getFields(credential)

      expect(fields.length).toBeGreaterThan(0)
    })

    it('should return empty array when no handler exists', () => {
      const credential = createSampleCredential(['VerifiableCredential', 'SomeOtherCredential'])

      const fields = credentialDisplayRegistry.getFields(credential)

      expect(fields).toHaveLength(0)
    })
  })

  describe('clear', () => {
    it('should remove all handlers', () => {
      credentialDisplayRegistry.register(new RelationshipCredentialHandler())
      credentialDisplayRegistry.register(new MockHighPriorityHandler())

      expect(credentialDisplayRegistry.getRegisteredHandlers()).toHaveLength(2)

      credentialDisplayRegistry.clear()

      expect(credentialDisplayRegistry.getRegisteredHandlers()).toHaveLength(0)
    })
  })
})

describe('isDTGCredential', () => {
  it('should return true for DTGCredential type', () => {
    const credential = createSampleCredential(['VerifiableCredential', 'DTGCredential'])
    expect(isDTGCredential(credential)).toBe(true)
  })

  it('should return true for RelationshipCredential (which is a DTGCredential)', () => {
    const credential = createSampleCredential(['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'])
    expect(isDTGCredential(credential)).toBe(true)
  })

  it('should return false for non-DTG credential', () => {
    const credential = createSampleCredential(['VerifiableCredential', 'SomeOtherCredential'])
    expect(isDTGCredential(credential)).toBe(false)
  })
})

describe('isRelationshipCredential', () => {
  it('should return true for RelationshipCredential type', () => {
    const credential = createSampleCredential(['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'])
    expect(isRelationshipCredential(credential)).toBe(true)
  })

  it('should return false for DTGCredential without RelationshipCredential', () => {
    const credential = createSampleCredential(['VerifiableCredential', 'DTGCredential'])
    expect(isRelationshipCredential(credential)).toBe(false)
  })

  it('should return false for non-relationship credential', () => {
    const credential = createSampleCredential(['VerifiableCredential', 'SomeOtherCredential'])
    expect(isRelationshipCredential(credential)).toBe(false)
  })
})
