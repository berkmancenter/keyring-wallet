import { AppEventCode } from '@/events/appEventCode'
import { AppError, isAppError, isHandledAppError } from './appError'
import { ErrorCategory, ErrorRegistry } from './errorRegistry'

describe('AppError', () => {
  describe('constructor', () => {
    it('should create an AppError with correct properties', () => {
      const identity = {
        category: ErrorCategory.GENERAL,
        appEvent: AppEventCode.UNKNOWN_SERVER_ERROR,
        statusCode: 1234,
      }
      const message = 'Detailed technical message'
      const error = new AppError(message, identity, { cause: new Error(message) })

      expect(error.message).toBe(message)
      expect(error.code).toBe('general.unknown_server_error.1234')
      expect(error.appEvent).toBe('unknown_server_error')
      expect(error.technicalMessage).toBe(message)
      expect(error.cause).toBeInstanceOf(Error)
      expect(error.timestamp).toBeDefined()
      expect(error.handled).toBe(false)
    })
  })

  describe('technicalMessage', () => {
    const identity = {
      category: ErrorCategory.GENERAL,
      appEvent: AppEventCode.UNKNOWN_SERVER_ERROR,
      statusCode: 1234,
    }

    it('should return null if there is no cause', () => {
      const error = new AppError('Something went wrong', identity)

      expect(error.technicalMessage).toBeNull()
    })

    it('should return null if cause is not an Error', () => {
      const error = new AppError('Something went wrong', identity, { cause: 'Not an error' })

      expect(error.technicalMessage).toBeNull()
    })

    it('should prefix the native error code when present on the cause', () => {
      const cause = Object.assign(new Error("Key pair with alias 'abc' not found."), { code: 'E_KEY_NOT_FOUND' })
      const error = new AppError('Something went wrong', identity, { cause })

      expect(error.technicalMessage).toBe("E_KEY_NOT_FOUND: Key pair with alias 'abc' not found.")
    })

    it('should append the server response body for AxiosErrors when it is a short string', () => {
      const axiosLike = Object.assign(new Error('Request failed with status code 400'), {
        isAxiosError: true,
        response: { data: 'email_address is invalid' },
      })
      const error = new AppError('Bad request', identity, { cause: axiosLike })

      expect(error.technicalMessage).toBe('Request failed with status code 400: email_address is invalid')
    })

    it('should not append the response body for AxiosErrors when it is not a string', () => {
      const axiosLike = Object.assign(new Error('Request failed with status code 400'), {
        isAxiosError: true,
        response: { data: { error: 'bad_request' } },
      })
      const error = new AppError('Bad request', identity, { cause: axiosLike })

      expect(error.technicalMessage).toBe('Request failed with status code 400')
    })
  })

  describe('fullMessage', () => {
    it('should include the debug code', () => {
      const error = AppError.fromErrorDefinition(ErrorRegistry.NO_INTERNET)

      expect(error.fullMessage).toContain(error.message)
      expect(error.fullMessage).toContain(`Debug: [${error.code}]`)
    })

    it('should include the technical message when a cause is present', () => {
      const error = AppError.fromErrorDefinition(ErrorRegistry.NO_INTERNET, { cause: new Error('socket hang up') })

      expect(error.fullMessage).toContain('socket hang up')
    })
  })

  describe('fromErrorDefinition', () => {
    it('should build an AppError from a registry definition', () => {
      const error = AppError.fromErrorDefinition(ErrorRegistry.AGENT_INITIALIZATION_ERROR)

      expect(error.statusCode).toBe(2901)
      expect(error.appEvent).toBe(AppEventCode.AGENT_INITIALIZATION_ERROR)
      expect(error.code).toBe('wallet.agent_initialization_error.2901')
    })
  })

  describe('toJSON', () => {
    it('should serialize without exploding the cause', () => {
      const cause = Object.assign(new Error('native failure'), { code: 'E_FAIL', userInfo: { detail: 1 } })
      const error = AppError.fromErrorDefinition(ErrorRegistry.UNKNOWN_ERROR, { cause })

      const json = error.toJSON()
      expect(json.code).toBe(error.code)
      expect(json.cause).toEqual(expect.objectContaining({ name: 'Error', message: 'native failure', code: 'E_FAIL' }))
    })
  })

  describe('isAppError / isHandledAppError', () => {
    it('should identify AppErrors', () => {
      const error = AppError.fromErrorDefinition(ErrorRegistry.UNKNOWN_ERROR)
      expect(isAppError(error)).toBe(true)
      expect(isAppError(new Error('x'))).toBe(false)
      expect(isAppError(null)).toBe(false)
    })

    it('should match on appEvent when provided', () => {
      const error = AppError.fromErrorDefinition(ErrorRegistry.NO_INTERNET)
      expect(isAppError(error, AppEventCode.NO_INTERNET)).toBe(true)
      expect(isAppError(error, AppEventCode.SERVER_ERROR)).toBe(false)
    })

    it('should identify handled AppErrors', () => {
      const error = AppError.fromErrorDefinition(ErrorRegistry.NO_INTERNET)
      expect(isHandledAppError(error)).toBe(false)
      error.handled = true
      expect(isHandledAppError(error)).toBe(true)
    })
  })
})
