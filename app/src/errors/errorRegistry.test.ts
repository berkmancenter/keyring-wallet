import { ErrorCategory, ErrorRegistry, ErrorRegistryKey, ErrorSeverity } from './errorRegistry'

describe('errorRegistry', () => {
  describe('ErrorSeverity', () => {
    it('should have all expected severity levels', () => {
      expect(ErrorSeverity.INFO).toBe('info')
      expect(ErrorSeverity.WARNING).toBe('warning')
      expect(ErrorSeverity.ERROR).toBe('error')
      expect(ErrorSeverity.CRITICAL).toBe('critical')
    })
  })

  describe('ErrorCategory', () => {
    it('should have all expected categories', () => {
      expect(ErrorCategory.CAMERA).toBe('camera')
      expect(ErrorCategory.NETWORK).toBe('network')
      expect(ErrorCategory.CREDENTIAL).toBe('credential')
      expect(ErrorCategory.PROOF).toBe('proof')
      expect(ErrorCategory.CONNECTION).toBe('connection')
      expect(ErrorCategory.WALLET).toBe('wallet')
      expect(ErrorCategory.VERIFICATION).toBe('verification')
      expect(ErrorCategory.DEVICE).toBe('device')
      expect(ErrorCategory.STORAGE).toBe('storage')
      expect(ErrorCategory.GENERAL).toBe('general')
    })
  })

  describe('ErrorRegistry', () => {
    it('should contain no duplicate codes', () => {
      const codes = Object.values(ErrorRegistry).map((error) => error.statusCode)
      const uniqueCodes = new Set(codes)
      expect(uniqueCodes.size).toBe(codes.length)
    })

    it('should contain no duplicate app events', () => {
      const appEvents = Object.values(ErrorRegistry).map((error) => error.appEvent)
      const uniqueAppEvents = new Set(appEvents)
      expect(uniqueAppEvents.size).toBe(appEvents.length)
    })

    it('should contain all expected error keys', () => {
      // Camera errors
      expect(ErrorRegistry.CAMERA_BROKEN).toBeDefined()
      expect(ErrorRegistry.INVALID_QR_CODE).toBeDefined()

      // Network errors
      expect(ErrorRegistry.NO_INTERNET).toBeDefined()
      expect(ErrorRegistry.SERVER_ERROR).toBeDefined()
      expect(ErrorRegistry.SERVER_TIMEOUT).toBeDefined()

      // Wallet errors
      expect(ErrorRegistry.STATE_LOAD_ERROR).toBeDefined()
      expect(ErrorRegistry.AGENT_INITIALIZATION_ERROR).toBeDefined()
      expect(ErrorRegistry.WALLET_SECRET_NOT_FOUND).toBeDefined()

      // Connection errors
      expect(ErrorRegistry.PARSE_INVITATION_ERROR).toBeDefined()
      expect(ErrorRegistry.RECEIVE_INVITATION_ERROR).toBeDefined()

      // Attestation errors
      expect(ErrorRegistry.ATTESTATION_BAD_INVITATION).toBeDefined()
      expect(ErrorRegistry.ATTESTATION_CONNECTION_ERROR).toBeDefined()
    })

    it('should have valid error definitions with all required fields', () => {
      const errorKeys = Object.keys(ErrorRegistry) as ErrorRegistryKey[]

      errorKeys.forEach((key) => {
        const definition = ErrorRegistry[key]

        expect(definition.statusCode).toBeDefined()
        expect(typeof definition.statusCode).toBe('number')

        expect(definition.appEvent).toBeDefined()
        expect(typeof definition.appEvent).toBe('string')

        expect(definition.severity).toBeDefined()
        expect(Object.values(ErrorSeverity)).toContain(definition.severity)

        expect(definition.category).toBeDefined()
        expect(Object.values(ErrorCategory)).toContain(definition.category)

        expect(definition.message).toBeDefined()
        expect(typeof definition.message).toBe('string')
      })
    })

    it('should have error codes in correct ranges', () => {
      // Camera/Scanning Errors (2000-2099)
      expect(ErrorRegistry.CAMERA_BROKEN.statusCode).toBeGreaterThanOrEqual(2000)
      expect(ErrorRegistry.CAMERA_BROKEN.statusCode).toBeLessThan(2100)

      // Network Errors (2100-2199)
      expect(ErrorRegistry.NO_INTERNET.statusCode).toBeGreaterThanOrEqual(2100)
      expect(ErrorRegistry.NO_INTERNET.statusCode).toBeLessThan(2200)

      // Wallet/Agent Errors (2900-2999)
      expect(ErrorRegistry.STATE_LOAD_ERROR.statusCode).toBeGreaterThanOrEqual(2900)
      expect(ErrorRegistry.STATE_LOAD_ERROR.statusCode).toBeLessThan(3000)

      // Connection/Invitation Errors (3000-3099)
      expect(ErrorRegistry.PARSE_INVITATION_ERROR.statusCode).toBeGreaterThanOrEqual(3000)
      expect(ErrorRegistry.PARSE_INVITATION_ERROR.statusCode).toBeLessThan(3100)

      // Attestation Errors (3100-3199)
      expect(ErrorRegistry.ATTESTATION_BAD_INVITATION.statusCode).toBeGreaterThanOrEqual(3100)
      expect(ErrorRegistry.ATTESTATION_BAD_INVITATION.statusCode).toBeLessThan(3200)
    })
  })

  describe('ErrorRegistryKey type', () => {
    it('should allow accessing registry with valid keys', () => {
      const key: ErrorRegistryKey = 'CAMERA_BROKEN'
      const definition = ErrorRegistry[key]

      expect(definition).toBeDefined()
      expect(definition.statusCode).toBe(2000)
    })
  })
})
