import { DeviceEventEmitter } from 'react-native'
import { logger } from 'react-native-logs'

// Mock all external dependencies at the top level
jest.mock('react-native', () => ({
  DeviceEventEmitter: {
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    emit: jest.fn(),
  },
}))

jest.mock('react-native-logs', () => ({
  logger: {
    createLogger: jest.fn(() => ({
      test: jest.fn(),
      trace: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      fatal: jest.fn(),
    })),
  },
}))

jest.mock('@credo-ts/core', () => ({
  // 0.7 renamed the members to PascalCase; the values are unchanged.
  LogLevel: {
    Test: 0,
    Trace: 1,
    Debug: 2,
    Info: 3,
    Warn: 4,
    Error: 5,
    Fatal: 6,
    Off: 7,
  },
}))

jest.mock(
  '@bifold/core',
  () => ({
    BifoldLogger: class BifoldLogger {},
    AbstractBifoldLogger: class AbstractBifoldLogger {
      public logLevel = 2 // LogLevel.Debug
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      protected _log: any
      protected _config = {
        levels: {
          test: 0,
          trace: 0,
          debug: 0,
          info: 1,
          warn: 2,
          error: 3,
          fatal: 4,
        },
        severity: 'debug',
        async: true,
        dateFormat: 'time',
        printDate: false,
      }

      public isEnabled(logLevel: number): boolean {
        return logLevel >= this.logLevel
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
      public report(_bifoldError: any): void {
        // Mock implementation
      }
    },
    BifoldError: class BifoldError {
      title: string
      description: string
      code: number
      message: string

      constructor(title: string, description: string, message: string, code: number) {
        this.title = title
        this.description = description
        this.code = code
        this.message = message
      }
    },
  }),
  { virtual: true }
)

jest.mock('../transports', () => ({
  lokiTransport: jest.fn(),
  consoleTransport: jest.fn(),
}))

// Import after mocks to ensure they're applied
import { LogLevel } from '@credo-ts/core'

import { RemoteLogger, RemoteLoggerEventTypes } from '../logger'
import { lokiTransport } from '../transports'
import { BifoldError } from '@bifold/core'

describe('RemoteLogger', () => {
  // Mock references for better test readability
  let mockCreateLogger: jest.Mock
  let mockLokiTransport: jest.Mock
  let mockDeviceEventEmitter: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()

    // Setup mocks with proper typing
    mockCreateLogger = logger.createLogger as jest.Mock
    mockLokiTransport = lokiTransport as jest.Mock
    mockDeviceEventEmitter = DeviceEventEmitter.addListener as jest.Mock
  })

  describe('Constructor and Initialization', () => {
    it('should initialize with default values when no options provided', () => {
      const remoteLogger = new RemoteLogger({})

      expect(remoteLogger.remoteLoggingEnabled).toBe(false)
      expect(remoteLogger.autoDisableRemoteLoggingIntervalInMinutes).toBe(0)
      expect(mockCreateLogger).toHaveBeenCalledTimes(1)
    })

    it('should initialize with provided configuration options', () => {
      const options = {
        lokiUrl: 'http://localhost:3100',
        lokiLabels: { app: 'test-app', version: '1.0.0' },
        autoDisableRemoteLoggingIntervalInMinutes: 30,
      }

      const remoteLogger = new RemoteLogger(options)

      expect(remoteLogger.autoDisableRemoteLoggingIntervalInMinutes).toBe(30)
      expect(mockCreateLogger).toHaveBeenCalledTimes(1)

      // Verify logger configuration
      const createLoggerCall = mockCreateLogger.mock.calls[0][0]
      expect(createLoggerCall).toHaveProperty('transport')
      expect(createLoggerCall).toHaveProperty('transportOptions')
    })
  })

  describe('Session ID Management', () => {
    it('should return 0 before remote logging is enabled', () => {
      const remoteLogger = new RemoteLogger({})
      expect(remoteLogger.sessionId).toBe(0)
    })

    it('should generate a 6-digit session ID when remote logging first enabled', () => {
      const remoteLogger = new RemoteLogger({})
      remoteLogger.remoteLoggingEnabled = true
      const sessionId = remoteLogger.sessionId
      expect(sessionId).toBeGreaterThanOrEqual(100000)
      expect(sessionId).toBeLessThanOrEqual(999999)
      expect(Number.isInteger(sessionId)).toBe(true)
    })

    it('should persist the session ID while remote logging remains enabled', () => {
      const remoteLogger = new RemoteLogger({})
      remoteLogger.remoteLoggingEnabled = true
      const sessionId1 = remoteLogger.sessionId
      const sessionId2 = remoteLogger.sessionId
      expect(sessionId1).toBe(sessionId2)
    })

    it('should allow setting a custom session ID and reconfigure logger', () => {
      const remoteLogger = new RemoteLogger({})
      const customSessionId = 123456
      remoteLogger.sessionId = customSessionId
      expect(remoteLogger.sessionId).toBe(customSessionId)
      expect(mockCreateLogger).toHaveBeenCalledTimes(2) // Constructor + setter
    })
  })

  describe('remoteLoggingEnabled', () => {
    it('should start disabled by default', () => {
      const remoteLogger = new RemoteLogger({})

      expect(remoteLogger.remoteLoggingEnabled).toBe(false)
    })

    it('should reconfigure logger when enabled', () => {
      const remoteLogger = new RemoteLogger({
        lokiUrl: 'http://localhost:3100',
      })

      remoteLogger.remoteLoggingEnabled = true

      expect(remoteLogger.remoteLoggingEnabled).toBe(true)
      expect(mockCreateLogger).toHaveBeenCalledTimes(2) // Once in constructor, once when enabling
    })

    it('should clear sessionId when disabled (returning 0)', () => {
      const remoteLogger = new RemoteLogger({})
      remoteLogger.remoteLoggingEnabled = true
      expect(remoteLogger.sessionId).toBeGreaterThanOrEqual(100000)
      remoteLogger.remoteLoggingEnabled = false
      expect(remoteLogger.sessionId).toBe(0)
    })

    it('should set up auto-disable timer when enabled with interval', (done) => {
      const remoteLogger = new RemoteLogger({
        lokiUrl: 'http://localhost:3100',
        autoDisableRemoteLoggingIntervalInMinutes: 0.001, // 0.06 seconds for testing
      })

      remoteLogger.remoteLoggingEnabled = true
      expect(remoteLogger.remoteLoggingEnabled).toBe(true)

      // Wait for auto-disable to trigger
      setTimeout(() => {
        expect(remoteLogger.remoteLoggingEnabled).toBe(false)
        done()
      }, 100)
    })
  })

  describe('event listeners', () => {
    it('should start event listeners', () => {
      const remoteLogger = new RemoteLogger({})

      remoteLogger.startEventListeners()

      expect(mockDeviceEventEmitter).toHaveBeenCalledWith(
        RemoteLoggerEventTypes.ENABLE_REMOTE_LOGGING,
        expect.any(Function)
      )
    })

    it('should stop event listeners', () => {
      const remoteLogger = new RemoteLogger({})

      remoteLogger.startEventListeners()
      remoteLogger.stopEventListeners()

      // Verify that the listener is cleared (implementation sets to undefined)
      expect(remoteLogger['eventListener']).toBeUndefined()
    })

    it('should handle remote logging enable event', () => {
      const remoteLogger = new RemoteLogger({
        lokiUrl: 'http://localhost:3100',
      })
      let eventCallback: (value: boolean) => void

      mockDeviceEventEmitter.mockImplementation((event, callback) => {
        eventCallback = callback
        return { remove: jest.fn() }
      })

      remoteLogger.startEventListeners()
      eventCallback!(true)

      expect(remoteLogger.remoteLoggingEnabled).toBe(true)
    })
  })

  describe('overrideCurrentAutoDisableExpiration', () => {
    it('should do nothing for non-positive values', () => {
      const remoteLogger = new RemoteLogger({})

      // Should not throw or set any timers
      remoteLogger.overrideCurrentAutoDisableExpiration(0)
      remoteLogger.overrideCurrentAutoDisableExpiration(-1)

      expect(remoteLogger.remoteLoggingEnabled).toBe(false)
    })

    it('should set new auto-disable timer', (done) => {
      const remoteLogger = new RemoteLogger({
        lokiUrl: 'http://localhost:3100',
      })
      remoteLogger.remoteLoggingEnabled = true

      remoteLogger.overrideCurrentAutoDisableExpiration(0.001) // 0.06 seconds

      setTimeout(() => {
        expect(remoteLogger.remoteLoggingEnabled).toBe(false)
        done()
      }, 100)
    })
  })

  describe('logging methods', () => {
    let remoteLogger: RemoteLogger
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockLogInstance: any

    beforeEach(() => {
      mockLogInstance = {
        test: jest.fn(),
        trace: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        fatal: jest.fn(),
      }
      mockCreateLogger.mockReturnValue(mockLogInstance)
      remoteLogger = new RemoteLogger({})
    })

    // Regression guard: an arrow-function class field (`public info = (...) => {...}`)
    // becomes an OWN property that shadows AbstractBifoldLogger's prototype method of
    // the same name. That shadowing form was observed, on this codebase's Metro/Hermes
    // toolchain (not reproducible under Jest, which never compiles through Hermes), to
    // silently no-op on every call — no exception, no output — while the identical
    // logic reached as a plain prototype method worked. See the
    // remotelogger-info-silently-broken session notes. This test can't catch the Hermes
    // behavior itself, but it does catch the one thing that's under our control and
    // known to correlate with it: don't let these regress back to class fields.
    it.each(['test', 'trace', 'debug', 'info', 'warn', 'error', 'fatal'])(
      '%s is inherited from the prototype chain, not own',
      (method) => {
        expect(Object.prototype.hasOwnProperty.call(remoteLogger, method)).toBe(false)
        expect(typeof (remoteLogger as unknown as Record<string, unknown>)[method]).toBe('function')
      }
    )

    it('should call test method', () => {
      remoteLogger.test('test message', { key: 'value' })

      expect(mockLogInstance.test).toHaveBeenCalledWith({
        message: 'test message',
        data: { key: 'value' },
      })
    })

    it('should call trace method', () => {
      remoteLogger.trace('trace message')

      expect(mockLogInstance.trace).toHaveBeenCalledWith({
        message: 'trace message',
        data: undefined,
      })
    })

    it('should call debug method', () => {
      remoteLogger.debug('debug message', { debug: true })

      expect(mockLogInstance.debug).toHaveBeenCalledWith({
        message: 'debug message',
        data: { debug: true },
      })
    })

    it('should call info method', () => {
      remoteLogger.info('info message')

      expect(mockLogInstance.info).toHaveBeenCalledWith({
        message: 'info message',
        data: undefined,
      })
    })

    it('should call warn method', () => {
      remoteLogger.warn('warn message', { warning: true })

      expect(mockLogInstance.warn).toHaveBeenCalledWith({
        message: 'warn message',
        data: { warning: true },
      })
    })

    describe('error method overloads', () => {
      it('should handle message only', () => {
        remoteLogger.error('error message')

        expect(mockLogInstance.error).toHaveBeenCalledWith({
          message: 'error message',
          data: undefined,
          error: undefined,
        })
      })

      it('should handle message and data', () => {
        remoteLogger.error('error message', { errorData: true })

        expect(mockLogInstance.error).toHaveBeenCalledWith({
          message: 'error message',
          data: { errorData: true },
          error: undefined,
        })
      })

      it('should handle message and error', () => {
        const error = new Error('test error')
        remoteLogger.error('error message', error)

        expect(mockLogInstance.error).toHaveBeenCalledWith({
          message: 'error message',
          data: undefined,
          error: error,
        })
      })

      it('should handle message, data, and error', () => {
        const error = new Error('test error')
        remoteLogger.error('error message', { errorData: true }, error)

        expect(mockLogInstance.error).toHaveBeenCalledWith({
          message: 'error message',
          data: { errorData: true },
          error: error,
        })
      })
    })

    describe('fatal method overloads', () => {
      it('should handle message only', () => {
        remoteLogger.fatal('fatal message')

        expect(mockLogInstance.fatal).toHaveBeenCalledWith({
          message: 'fatal message',
          data: undefined,
          error: undefined,
        })
      })

      it('should handle message and data', () => {
        remoteLogger.fatal('fatal message', { fatalData: true })

        expect(mockLogInstance.fatal).toHaveBeenCalledWith({
          message: 'fatal message',
          data: { fatalData: true },
          error: undefined,
        })
      })

      it('should handle message and error', () => {
        const error = new Error('fatal error')
        remoteLogger.fatal('fatal message', error)

        expect(mockLogInstance.fatal).toHaveBeenCalledWith({
          message: 'fatal message',
          data: undefined,
          error: error,
        })
      })

      it('should handle message, data, and error', () => {
        const error = new Error('fatal error')
        remoteLogger.fatal('fatal message', { fatalData: true }, error)

        expect(mockLogInstance.fatal).toHaveBeenCalledWith({
          message: 'fatal message',
          data: { fatalData: true },
          error: error,
        })
      })
    })
  })

  describe('report method', () => {
    let remoteLogger: RemoteLogger
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockLogInstance: any

    beforeEach(() => {
      mockLogInstance = {
        info: jest.fn(),
      }
      mockCreateLogger.mockReturnValue(mockLogInstance)
      remoteLogger = new RemoteLogger({
        lokiUrl: 'http://localhost:3100',
        lokiLabels: { app: 'test' },
      })
    })

    it('should send incident report to Loki', () => {
      const bifoldError = new BifoldError('Error Title', 'Error Description', 'Error Message', 1001)

      remoteLogger.report(bifoldError)

      expect(mockLogInstance.info).toHaveBeenCalledWith({
        message: 'Sending Loki report',
      })

      expect(mockLokiTransport).toHaveBeenCalledWith({
        msg: 'Error Title',
        rawMsg: [
          {
            message: 'Error Title',
            data: {
              title: 'Error Title',
              description: 'Error Description',
              code: 1001,
              message: 'Error Message',
            },
          },
        ],
        level: { severity: 3, text: 'error' },
        options: {
          lokiUrl: 'http://localhost:3100',
          lokiLabels: { app: 'test' },
          job: 'incident-report',
        },
      })
    })
  })

  describe('configuration', () => {
    it('should configure logger with console transport only when remote logging disabled', () => {
      new RemoteLogger({})
      expect(mockCreateLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: [expect.any(Function)],
          transportOptions: {}, // current implementation provides empty transportOptions
        })
      )
    })

    it('should configure logger with both transports when remote logging enabled', () => {
      const remoteLogger = new RemoteLogger({ lokiUrl: 'http://localhost:3100', lokiLabels: { app: 'test' } })
      remoteLogger.remoteLoggingEnabled = true
      expect(mockCreateLogger).toHaveBeenLastCalledWith(
        expect.objectContaining({
          transport: [expect.any(Function), expect.any(Function)],
          transportOptions: {
            lokiUrl: 'http://localhost:3100',
            lokiLabels: { app: 'test', session_id: expect.any(String) },
          },
        })
      )
    })
  })

  describe('setLogLevel', () => {
    it('applies the new level immediately when remote logging is off', () => {
      const remoteLogger = new RemoteLogger({})

      remoteLogger.setLogLevel(LogLevel.Warn)

      expect(remoteLogger.logLevel).toBe(LogLevel.Warn)
    })

    it('keeps the forced debug level while remote logging is on, and remembers the new base', () => {
      const remoteLogger = new RemoteLogger({})
      remoteLogger.remoteLoggingEnabled = true

      remoteLogger.setLogLevel(LogLevel.Error)

      // Remote logging pins the level to Debug; the requested level is the base
      // to fall back to, not the level in force.
      expect(remoteLogger.logLevel).toBe(LogLevel.Debug)

      remoteLogger.remoteLoggingEnabled = false
      expect(remoteLogger.logLevel).toBe(LogLevel.Error)
    })

    it('reconfigures the underlying transport', () => {
      const remoteLogger = new RemoteLogger({})
      mockCreateLogger.mockClear()

      remoteLogger.setLogLevel(LogLevel.Info)

      expect(mockCreateLogger).toHaveBeenCalled()
    })
  })

  describe('dispose', () => {
    it('removes the event listener and disables remote logging', () => {
      const remove = jest.fn()
      ;(DeviceEventEmitter.addListener as jest.Mock).mockReturnValueOnce({ remove })
      const remoteLogger = new RemoteLogger({})
      remoteLogger.startEventListeners()
      remoteLogger.remoteLoggingEnabled = true

      remoteLogger.dispose()

      expect(remove).toHaveBeenCalled()
      expect(remoteLogger.remoteLoggingEnabled).toBe(false)
    })

    it('clears a pending auto-disable timer', () => {
      jest.useFakeTimers()
      try {
        // The auto-disable timer is only armed for a remote transport, so a loki url is part of the setup.
        const remoteLogger = new RemoteLogger({ lokiUrl: 'http://localhost:3100', autoDisableRemoteLoggingIntervalInMinutes: 5 })
        remoteLogger.remoteLoggingEnabled = true
        expect(jest.getTimerCount()).toBeGreaterThan(0)

        remoteLogger.dispose()

        expect(jest.getTimerCount()).toBe(0)
      } finally {
        jest.useRealTimers()
      }
    })

    it('is safe to call when nothing was started', () => {
      const remoteLogger = new RemoteLogger({})

      expect(() => remoteLogger.dispose()).not.toThrow()
    })
  })

  describe('overrideCurrentAutoDisableExpiration', () => {
    it('ignores a non-positive expiration', () => {
      jest.useFakeTimers()
      try {
        const remoteLogger = new RemoteLogger({})
        remoteLogger.overrideCurrentAutoDisableExpiration(0)

        expect(jest.getTimerCount()).toBe(0)
      } finally {
        jest.useRealTimers()
      }
    })

    it('replaces a pending timer and disables remote logging when it fires', () => {
      jest.useFakeTimers()
      try {
        const remoteLogger = new RemoteLogger({ lokiUrl: 'http://localhost:3100', autoDisableRemoteLoggingIntervalInMinutes: 60 })
        remoteLogger.remoteLoggingEnabled = true

        remoteLogger.overrideCurrentAutoDisableExpiration(1)
        expect(jest.getTimerCount()).toBe(1)

        jest.advanceTimersByTime(60000)
        expect(remoteLogger.remoteLoggingEnabled).toBe(false)
      } finally {
        jest.useRealTimers()
      }
    })
  })
})
