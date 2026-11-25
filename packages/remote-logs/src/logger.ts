import { BifoldError, AbstractBifoldLogger } from '@bifold/core'
import { LogLevel } from '@credo-ts/core'
import { DeviceEventEmitter, EmitterSubscription } from 'react-native'
import { logger } from 'react-native-logs'

import { RemoteLoggerOptions, lokiTransport, consoleTransport } from './transports'

export enum RemoteLoggerEventTypes {
  ENABLE_REMOTE_LOGGING = 'RemoteLogging.Enable',
}

/**
 * Session ID generation constants
 */
const SESSION_ID_RANGE = {
  MIN: 100000,
  MAX: 999999,
} as const

export class RemoteLogger extends AbstractBifoldLogger {
  private _remoteLoggingEnabled = false
  private _sessionId: number | undefined
  private _autoDisableRemoteLoggingIntervalInMinutes = 0
  private lokiUrl: string | undefined
  private lokiLabels: Record<string, string>
  private remoteLoggingAutoDisableTimer: ReturnType<typeof setTimeout> | undefined
  private eventListener: EmitterSubscription | undefined
  private _baseLogLevel: LogLevel = LogLevel.Debug

  constructor(options: RemoteLoggerOptions) {
    super()

    this.lokiUrl = options.lokiUrl ?? undefined
    this.lokiLabels = options.lokiLabels ?? {}
    this._autoDisableRemoteLoggingIntervalInMinutes = options.autoDisableRemoteLoggingIntervalInMinutes ?? 0

    if (options.logLevel !== undefined) {
      this.logLevel = options.logLevel
    }
    this._baseLogLevel = this.logLevel

    this.configureLogger()
  }

  get sessionId(): number {
    // When remote logging is disabled this will be 0; enabled path guarantees initialization
    return this._sessionId ?? 0
  }

  set sessionId(value: number) {
    this._sessionId = value

    this.configureLogger()
  }

  get autoDisableRemoteLoggingIntervalInMinutes(): number {
    return this._autoDisableRemoteLoggingIntervalInMinutes
  }

  get remoteLoggingEnabled(): boolean {
    return this._remoteLoggingEnabled
  }

  set remoteLoggingEnabled(value: boolean) {
    this._remoteLoggingEnabled = value

    if (value) {
      // Generate a new session id on first enable
      if (!this._sessionId) {
        this._sessionId = Math.floor(
          SESSION_ID_RANGE.MIN + Math.random() * (SESSION_ID_RANGE.MAX - SESSION_ID_RANGE.MIN + 1)
        )
      }
      // Override to most verbose when remote logging active
      this.logLevel = LogLevel.Debug
    } else {
      this._sessionId = undefined
      if (this.remoteLoggingAutoDisableTimer) {
        clearTimeout(this.remoteLoggingAutoDisableTimer)
        this.remoteLoggingAutoDisableTimer = undefined
      }
      // Restore base level after deactivation
      this.logLevel = this._baseLogLevel
    }

    this.configureLogger()
  }

  private configureLogger() {
    const transportOptions = {}
    const transport = [consoleTransport]
    // We rely on per-method isEnabled() gating and keep transport severity at lowest (debug)
    // so react-native-logs does not perform an additional filter layer.
    const severity = 'debug'
    const config = {
      ...this._config,
      transport,
      transportOptions,
      severity,
    }

    if (this.remoteLoggingEnabled && this.lokiUrl) {
      transport.push(lokiTransport)
      config['transportOptions'] = {
        lokiUrl: this.lokiUrl,
        lokiLabels: {
          ...this.lokiLabels,
          session_id: `${this.sessionId}`,
        },
      }

      if (this.autoDisableRemoteLoggingIntervalInMinutes && this.autoDisableRemoteLoggingIntervalInMinutes > 0) {
        this.remoteLoggingAutoDisableTimer = setTimeout(() => {
          this.remoteLoggingEnabled = false
        }, this.autoDisableRemoteLoggingIntervalInMinutes * 60000)
      }
    }

    this._log = logger.createLogger<'test' | 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'>(config)
  }

  /** Update minimum log level and reconfigure underlying transport */
  public setLogLevel(level: LogLevel) {
    this._baseLogLevel = level
    // Only apply immediately if remote logging isn't forcing
    // debug
    if (!this._remoteLoggingEnabled) {
      this.logLevel = level
    }
    this.configureLogger()
  }

  public startEventListeners() {
    this.eventListener = DeviceEventEmitter.addListener(RemoteLoggerEventTypes.ENABLE_REMOTE_LOGGING, (value) => {
      this.remoteLoggingEnabled = value
    })
  }

  public stopEventListeners() {
    this.eventListener?.remove()
    this.eventListener = undefined
  }

  public overrideCurrentAutoDisableExpiration(expirationInMinutes: number) {
    if (expirationInMinutes <= 0) {
      return
    }

    if (this.remoteLoggingAutoDisableTimer) {
      clearTimeout(this.remoteLoggingAutoDisableTimer)
    }

    this.remoteLoggingAutoDisableTimer = setTimeout(() => {
      this.remoteLoggingEnabled = false
    }, expirationInMinutes * 60000)
  }

  public report(bifoldError: BifoldError): void {
    this._log?.info?.({ message: 'Sending Loki report' })
    const { title, description, code, message } = bifoldError

    lokiTransport({
      msg: title,
      rawMsg: [{ message: title, data: { title, description, code, message } }],
      level: { severity: 3, text: 'error' },
      options: {
        lokiUrl: this.lokiUrl,
        lokiLabels: this.lokiLabels,
        job: 'incident-report',
      },
    })
  }

  // Standardized logging methods with consistent overloads.
  //
  // Declared as ordinary prototype methods, not arrow-function class fields.
  // A class-field arrow function makes `.info`/`.warn`/etc. own instance
  // properties that shadow AbstractBifoldLogger's prototype methods of the
  // same name. On this codebase's Metro/Hermes toolchain that shadowing
  // form was observed to silently no-op on every call (no exception, no
  // output) while an identical, hand-inlined sequence of the same three
  // steps (isEnabled gate -> parseLogArguments -> this._log.info(...)),
  // and the plain prototype methods reached by bypassing the instance
  // property via Object.getPrototypeOf(), both worked — see
  // remotelogger-info-silently-broken session notes. No call site here
  // detaches these methods from their instance (checked), so the switch
  // to prototype methods costs nothing.
  public test(message: string, dataOrError?: Record<string, unknown> | Error, error?: Error): void {
    if (!this.isEnabled(LogLevel.Debug)) return
    const { data, actualError } = this.parseLogArguments(dataOrError, error)
    this._log?.test?.({ message, data, error: actualError })
  }

  public trace(message: string, dataOrError?: Record<string, unknown> | Error, error?: Error): void {
    if (!this.isEnabled(LogLevel.Debug)) return
    const { data, actualError } = this.parseLogArguments(dataOrError, error)
    this._log?.trace?.({ message, data, error: actualError })
  }

  public debug(message: string, dataOrError?: Record<string, unknown> | Error, error?: Error): void {
    if (!this.isEnabled(LogLevel.Debug)) return
    const { data, actualError } = this.parseLogArguments(dataOrError, error)
    this._log?.debug?.({ message, data, error: actualError })
  }

  public info(message: string, dataOrError?: Record<string, unknown> | Error, error?: Error): void {
    if (!this.isEnabled(LogLevel.Info)) return
    const { data, actualError } = this.parseLogArguments(dataOrError, error)
    this._log?.info?.({ message, data, error: actualError })
  }

  public warn(message: string, dataOrError?: Record<string, unknown> | Error, error?: Error): void {
    if (!this.isEnabled(LogLevel.Warn)) return
    const { data, actualError } = this.parseLogArguments(dataOrError, error)
    this._log?.warn?.({ message, data, error: actualError })
  }

  public error(message: string, dataOrError?: Record<string, unknown> | Error, error?: Error): void {
    if (!this.isEnabled(LogLevel.Error)) return
    const { data, actualError } = this.parseLogArguments(dataOrError, error)
    this._log?.error?.({ message, data, error: actualError })
  }

  public fatal(message: string, dataOrError?: Record<string, unknown> | Error, error?: Error): void {
    if (!this.isEnabled(LogLevel.Fatal)) return
    const { data, actualError } = this.parseLogArguments(dataOrError, error)
    this._log?.fatal?.({ message, data, error: actualError })
  }

  /**
   * Helper method to parse logging arguments consistently across all log levels
   * @param dataOrError - Either data object or Error instance
   * @param error - Optional Error instance when first param is data
   * @returns Parsed data and error objects
   */
  private parseLogArguments(
    dataOrError?: Record<string, unknown> | Error,
    error?: Error
  ): { data: Record<string, unknown> | undefined; actualError: Error | undefined } {
    let data: Record<string, unknown> | undefined
    let actualError: Error | undefined

    if (dataOrError instanceof Error) {
      // Second parameter is an Error, so no data
      actualError = dataOrError
    } else {
      // Second parameter is data (or undefined)
      data = dataOrError
      actualError = error
    }

    return { data, actualError }
  }

  /** Dispose of timers and listeners, disable remote logging */
  public dispose() {
    this.stopEventListeners()
    this.remoteLoggingEnabled = false
    if (this.remoteLoggingAutoDisableTimer) {
      clearTimeout(this.remoteLoggingAutoDisableTimer)
      this.remoteLoggingAutoDisableTimer = undefined
    }
  }
}
