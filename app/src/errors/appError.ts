import { AppEventCode } from '@/events/appEventCode'
import { ErrorCategory, ErrorDefinition } from './errorRegistry'

// Ported from bc-wallet-mobile; the Snowplow analytics tracking upstream does in
// the constructor was dropped — Keyring reports errors to Loki via the remote
// logger at the point they are surfaced (ErrorAlertProvider / reportProblem).

export type ErrorIdentity = {
  category: ErrorCategory
  appEvent: AppEventCode
  statusCode: number
}

/**
 * Reduce a `cause` to a small, safe-to-serialize summary.
 *
 * The raw cause of an HTTP failure is often an AxiosError whose `config.data` holds the
 * full request body. Serializing it (JSON.stringify expands a Buffer to a per-byte number
 * array) can exhaust memory, so toJSON() keeps only lightweight identifying fields and
 * drops the nested chain/body. The live `cause` property is left untouched for runtime logic.
 */
const summarizeCause = (cause: unknown): unknown => {
  if (!(cause instanceof Error)) {
    return cause
  }

  const { code, status, userInfo } = cause as { code?: unknown; status?: unknown; userInfo?: unknown }
  const summary: Record<string, unknown> = { name: cause.name, message: cause.message }
  if (code !== undefined) {
    summary.code = code
  }
  if (status !== undefined) {
    summary.status = status
  }
  if (userInfo !== undefined) {
    // Native-module rejections carry small, bridge-serializable diagnostics here
    summary.userInfo = userInfo
  }
  const responseData = (cause as { response?: { data?: unknown } }).response?.data
  if (typeof responseData === 'string' && responseData.length <= 500) {
    summary.responseData = responseData
  }
  return summary
}

/**
 * Custom application error class with structured information.
 *
 * @extends {Error}
 * @class
 */
export class AppError extends Error {
  code: string // ie: network.no_internet.2100
  appEvent: AppEventCode // ie: no_internet
  statusCode: number // ie: 2100
  timestamp: string // ISO timestamp of when the error was created
  handled: boolean // Whether this error has been handled by a policy
  screen: string | undefined // Active screen name at the time the error was created
  url?: string // API endpoint URL that produced this error, if applicable
  method?: string // HTTP method of the request that produced this error, if applicable

  constructor(message: string, identity: ErrorIdentity, options?: ErrorOptions) {
    super(message, options)
    this.name = this.constructor.name

    this.code = `${identity.category}.${identity.appEvent}.${identity.statusCode}` // ie: network.no_internet.2100
    this.appEvent = identity.appEvent
    this.statusCode = identity.statusCode
    this.timestamp = new Date().toISOString()
    this.handled = false
    this.screen = undefined
    this.url = undefined
    this.method = undefined
  }

  /**
   * Get the technical message from the original error, if available.
   *
   * @returns The technical message or null if not available.
   */
  get technicalMessage(): string | null {
    if (!(this.cause instanceof Error)) {
      return null
    }

    const cause = this.cause as Error & { code?: unknown; isAxiosError?: boolean; response?: { data?: unknown } }

    // AxiosErrors have their error code written into cause.code; that value is
    // already captured in appEvent, so excluding it here keeps technicalMessage
    // as the server description
    const isAxiosError = Boolean(cause.isAxiosError) || cause.name === 'AxiosError'

    // For non-Axios errors (e.g. native module errors), cause.code is a meaningful prefix like "E_KEY_NOT_FOUND"
    const code = !isAxiosError && typeof cause.code === 'string' ? cause.code : undefined

    // Include the server's response body when it's a short plain string
    const responseData = isAxiosError ? cause.response?.data : undefined
    const serverReason = typeof responseData === 'string' && responseData.length <= 500 ? responseData : undefined

    return [code, cause.message, serverReason].filter(Boolean).join(': ')
  }

  /**
   * Get the full error message, including technical details if available.
   *
   * This is the user-facing details string (shown behind "Show details" in the error
   * modal), so it deliberately excludes the active screen and request URL — that infra
   * context could alarm users. Screen/Request are appended only to the "Report this
   * problem" payload sent to the remote logger, never shown to the user.
   *
   * @example
   * `No internet connection
   * Debug: [network.no_internet.2100] Failed to fetch resource`
   *
   * @returns The full error message string.
   */
  get fullMessage(): string {
    let formattedMessage = this.message

    formattedMessage += `\nDebug: [${this.code}]`

    if (this.technicalMessage) {
      formattedMessage += ` ${this.technicalMessage}`
    }

    return formattedMessage
  }

  /**
   * Create an AppError from an ErrorDefinition.
   *
   * @param definition - The ErrorDefinition to create the AppError from.
   * @param options - Optional ErrorOptions (e.g. cause) for additional context.
   * @returns An instance of AppError.
   */
  static fromErrorDefinition(definition: ErrorDefinition, options?: ErrorOptions): AppError {
    return new AppError(
      definition.message,
      {
        category: definition.category,
        appEvent: definition.appEvent,
        statusCode: definition.statusCode,
      },
      options
    )
  }

  /**
   * Serialize the AppError to a JSON object. Useful for logging.
   *
   * @return An object containing the serialized error details.
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      technicalMessage: this.technicalMessage,
      code: this.code,
      timestamp: this.timestamp,
      handled: this.handled,
      screen: this.screen,
      url: this.url,
      method: this.method,
      cause: summarizeCause(this.cause),
    }
  }
}

/**
 * Check if an error is an AppError that has already been handled by an error policy.
 *
 * @param error - The error to check
 * @returns True if the error is an AppError and has been handled
 */
export function isHandledAppError(error: unknown): error is AppError {
  return error instanceof AppError && error.handled
}

/**
 * Check if an error is an instance of AppError, and optionally if it matches a specific app event code.
 *
 * @param error - The error to check
 * @param appEvent - Optional app event code to match against the error's appEvent property
 * @returns True if the error is an AppError (and matches the app event code if provided)
 */
export function isAppError<TAppEventCode extends AppEventCode>(
  error: unknown,
  appEvent?: TAppEventCode
): error is AppError & { appEvent: TAppEventCode } {
  if (appEvent) {
    return error instanceof AppError && error.appEvent === appEvent
  }

  return error instanceof AppError
}
