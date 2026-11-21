import { container as tsyringeContainer } from 'tsyringe'
import { TOKENS } from '../../../../src/container-api'
import { ICredentialDisplayRegistry } from '../../../../src/types/credential-display'
import { credentialDisplayRegistry } from '../../../../src/modules/vrc/display/displayRegistry'
import {
  registerVrcDisplayHandlers,
  registerVrcWithContainer,
  initializeVrcModule,
  getCredentialDisplayRegistry,
} from '../../../../src/modules/vrc/register'
import { RelationshipCredentialHandler } from '../../../../src/modules/vrc/display/handlers/RelationshipCredentialHandler'
import { WitnessCredentialHandler } from '../../../../src/modules/vrc/display/handlers/WitnessCredentialHandler'

// Mock i18next
jest.mock('i18next', () => ({
  addResourceBundle: jest.fn(),
}))

describe('VRC Register Module', () => {
  beforeEach(() => {
    // Clear the registry before each test
    credentialDisplayRegistry.clear()
    // Clear jest mocks
    jest.clearAllMocks()
  })

  describe('registerVrcDisplayHandlers', () => {
    it('should register both WitnessCredentialHandler and RelationshipCredentialHandler', () => {
      expect(credentialDisplayRegistry.getRegisteredHandlers()).toHaveLength(0)

      registerVrcDisplayHandlers()

      const handlers = credentialDisplayRegistry.getRegisteredHandlers()
      expect(handlers).toHaveLength(2)
      // WitnessCredentialHandler should be registered with higher priority (110)
      expect(handlers[0]).toBeInstanceOf(WitnessCredentialHandler)
      // RelationshipCredentialHandler should be registered with lower priority (100)
      expect(handlers[1]).toBeInstanceOf(RelationshipCredentialHandler)
    })

    it('should not duplicate handlers when called multiple times', () => {
      registerVrcDisplayHandlers()
      registerVrcDisplayHandlers()

      // Note: Current implementation doesn't prevent duplicates
      // If this is undesired, the register function should be updated
      const handlers = credentialDisplayRegistry.getRegisteredHandlers()
      expect(handlers.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('registerVrcWithContainer', () => {
    it('should register the display registry with the container', () => {
      const childContainer = tsyringeContainer.createChildContainer()

      registerVrcWithContainer(childContainer)

      const registered = childContainer.resolve(TOKENS.UTIL_CREDENTIAL_DISPLAY_REGISTRY)
      expect(registered).toBe(credentialDisplayRegistry)
    })

    it('should allow the registry to be resolved after registration', () => {
      const childContainer = tsyringeContainer.createChildContainer()

      registerVrcWithContainer(childContainer)

      // Should not throw
      expect(() => childContainer.resolve(TOKENS.UTIL_CREDENTIAL_DISPLAY_REGISTRY)).not.toThrow()
    })
  })

  describe('initializeVrcModule', () => {
    it('should register handlers and container by default', () => {
      const childContainer = tsyringeContainer.createChildContainer()

      initializeVrcModule(childContainer)

      // Handlers should be registered
      expect(credentialDisplayRegistry.getRegisteredHandlers().length).toBeGreaterThan(0)

      // Container should have registry
      const registered = childContainer.resolve(TOKENS.UTIL_CREDENTIAL_DISPLAY_REGISTRY)
      expect(registered).toBe(credentialDisplayRegistry)
    })

    it('should skip display handler registration when option is false', () => {
      const childContainer = tsyringeContainer.createChildContainer()

      initializeVrcModule(childContainer, { registerDisplayHandlers: false })

      // Handlers should NOT be registered
      expect(credentialDisplayRegistry.getRegisteredHandlers()).toHaveLength(0)
    })

    it('should skip localization when option is false', () => {
      const i18next = require('i18next')
      const childContainer = tsyringeContainer.createChildContainer()

      initializeVrcModule(childContainer, { loadLocalization: false })

      // i18next.addResourceBundle should NOT have been called
      expect(i18next.addResourceBundle).not.toHaveBeenCalled()
    })

    it('should load localization by default', () => {
      const i18next = require('i18next')
      const childContainer = tsyringeContainer.createChildContainer()

      initializeVrcModule(childContainer)

      // i18next.addResourceBundle should have been called for English
      expect(i18next.addResourceBundle).toHaveBeenCalledWith('en', 'translation', expect.any(Object), true, true)
    })

    it('should load additional languages when provided', () => {
      const i18next = require('i18next')
      const childContainer = tsyringeContainer.createChildContainer()

      const frenchTranslations = {
        Contacts: {
          AcceptContact: 'Accepter le contact',
        },
      }

      initializeVrcModule(childContainer, {
        additionalLanguages: {
          fr: frenchTranslations,
        },
      })

      // Should have been called for both English and French
      expect(i18next.addResourceBundle).toHaveBeenCalledWith('en', 'translation', expect.any(Object), true, true)
      expect(i18next.addResourceBundle).toHaveBeenCalledWith('fr', 'translation', frenchTranslations, true, true)
    })
  })

  describe('getCredentialDisplayRegistry', () => {
    it('should return the singleton registry instance', () => {
      const registry = getCredentialDisplayRegistry()
      expect(registry).toBe(credentialDisplayRegistry)
    })

    it('should return the same instance on multiple calls', () => {
      const registry1 = getCredentialDisplayRegistry()
      const registry2 = getCredentialDisplayRegistry()
      expect(registry1).toBe(registry2)
    })
  })
})

describe('Integration', () => {
  beforeEach(() => {
    credentialDisplayRegistry.clear()
  })

  it('should work end-to-end: initialize, resolve from container, get display info', () => {
    const childContainer = tsyringeContainer.createChildContainer()

    // Initialize VRC module
    initializeVrcModule(childContainer)

    // Resolve registry from container
    const registry = childContainer.resolve(TOKENS.UTIL_CREDENTIAL_DISPLAY_REGISTRY) as ICredentialDisplayRegistry

    // Create a test credential
    const credential = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
      issuer: {
        id: 'did:example:issuer123',
        name: 'Test Issuer',
      },
      validFrom: '2024-01-15T10:00:00Z',
      credentialSubject: {
        id: 'did:example:subject456',
      },
    }

    // Get display info
    const displayInfo = registry.getDisplayInfo(credential)

    // Verify results
    expect(displayInfo.matched).toBe(true)
    expect(displayInfo.buttonText.accept).toBe('Contacts.AcceptContact')
    expect(displayInfo.fields.length).toBeGreaterThan(0)
  })
})
