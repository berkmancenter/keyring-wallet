import { FATAL_UNRECOVERABLE_ERROR_STATUS_CODE, UNKNOWN_APP_ERROR_STATUS_CODE } from '@/constants'
import { AppEventCode } from '../events/appEventCode'

/**
 * Error severity levels for categorization
 */
export enum ErrorSeverity {
  /** Informational - user action may be needed but no error occurred */
  INFO = 'info',
  /** Warning - something unexpected happened but operation can continue */
  WARNING = 'warning',
  /** Error - operation failed, user needs to take action */
  ERROR = 'error',
  /** Critical - app functionality is compromised */
  CRITICAL = 'critical',
}

/**
 * Error category for grouping related errors
 */
export enum ErrorCategory {
  CAMERA = 'camera',
  NETWORK = 'network',
  CREDENTIAL = 'credential',
  PROOF = 'proof',
  CONNECTION = 'connection',
  WALLET = 'wallet',
  VERIFICATION = 'verification',
  DEVICE = 'device',
  STORAGE = 'storage',
  GENERAL = 'general',
  UNKNOWN = 'unknown',
}

/**
 * Error definition containing all metadata for an error type
 */
export interface ErrorDefinition {
  /** Unique error status code (for support reference) */
  statusCode: number
  /** App event code */
  appEvent: AppEventCode
  /** Error severity */
  severity: ErrorSeverity
  /** Error category */
  category: ErrorCategory
  /** Human-readable error message (technical, not user-facing — UI strings come from i18n) */
  message: string
}

/**
 * Master registry of Keyring app errors.
 *
 * Ported from bc-wallet-mobile and trimmed to the codes Keyring uses (upstream
 * also carries BCSC/IAS account, token and native-module bands). The code
 * ranges are kept aligned with upstream so support references stay comparable:
 *
 *   2000-2099: Camera/Scanning errors
 *   2100-2199: Network errors
 *   2900-2999: Wallet/Agent errors
 *   3000-3099: Connection/Invitation errors
 *   3100-3199: Attestation errors
 *
 * Special codes:
 *   9999: Reserved for unknown/unmapped errors
 *   9998: Reserved for fatal unrecoverable errors
 */
export const ErrorRegistry = {
  // ============================================
  // Special Errors
  // ============================================
  UNKNOWN_ERROR: {
    statusCode: UNKNOWN_APP_ERROR_STATUS_CODE, // 9999
    appEvent: AppEventCode.UNKNOWN_APP_ERROR,
    severity: ErrorSeverity.ERROR,
    category: ErrorCategory.UNKNOWN,
    message: 'An unknown error occurred',
  },
  FATAL_ERROR: {
    statusCode: FATAL_UNRECOVERABLE_ERROR_STATUS_CODE, // 9998
    appEvent: AppEventCode.FATAL_UNRECOVERABLE_ERROR,
    severity: ErrorSeverity.CRITICAL,
    category: ErrorCategory.UNKNOWN,
    message: 'A fatal error occurred — app functionality may be compromised',
  },

  // ============================================
  // Camera/Scanning Errors (2000-2099)
  // ============================================
  CAMERA_BROKEN: {
    statusCode: 2000,
    appEvent: AppEventCode.CAMERA_BROKEN,
    severity: ErrorSeverity.ERROR,
    category: ErrorCategory.CAMERA,
    message: 'Camera hardware unavailable or failed to initialize',
  },
  INVALID_QR_CODE: {
    statusCode: 2001,
    appEvent: AppEventCode.INVALID_QR_CODE,
    severity: ErrorSeverity.WARNING,
    category: ErrorCategory.CAMERA,
    message: 'Scanned QR code could not be parsed or contains invalid data',
  },

  // ============================================
  // Network Errors (2100-2199)
  // ============================================
  NO_INTERNET: {
    statusCode: 2100,
    appEvent: AppEventCode.NO_INTERNET,
    severity: ErrorSeverity.ERROR,
    category: ErrorCategory.NETWORK,
    // NOTE: covers any transport-layer failure with no HTTP response — device
    // offline, DNS failure, TLS error, or connection reset on the target host.
    message:
      'Network request failed before a response was received — device offline, or DNS/TLS/connection error on the target host',
  },
  SERVER_ERROR: {
    statusCode: 2101,
    appEvent: AppEventCode.SERVER_ERROR,
    severity: ErrorSeverity.ERROR,
    category: ErrorCategory.NETWORK,
    message: 'Server returned a 5xx response',
  },
  SERVER_TIMEOUT: {
    statusCode: 2102,
    appEvent: AppEventCode.SERVER_TIMEOUT,
    severity: ErrorSeverity.ERROR,
    category: ErrorCategory.NETWORK,
    message: 'HTTP request exceeded timeout threshold — no response received',
  },
  UNSECURED_NETWORK: {
    statusCode: 2103,
    appEvent: AppEventCode.UNSECURED_NETWORK,
    severity: ErrorSeverity.WARNING,
    category: ErrorCategory.NETWORK,
    message: 'TLS/SSL validation failed — connection is not secure',
  },
  PROBLEM_WITH_CONNECTION: {
    statusCode: 2104,
    appEvent: AppEventCode.PROBLEM_WITH_CONNECTION,
    severity: ErrorSeverity.ERROR,
    category: ErrorCategory.NETWORK,
    message: 'Network connection dropped or reset during request',
  },
  UNKNOWN_SERVER_ERROR: {
    statusCode: 2111,
    appEvent: AppEventCode.UNKNOWN_SERVER_ERROR,
    severity: ErrorSeverity.ERROR,
    category: ErrorCategory.NETWORK,
    message: 'Server returned an unrecognized error response — could not map to a known error code',
  },
  NOT_FOUND: {
    statusCode: 2113,
    appEvent: AppEventCode.NOT_FOUND,
    severity: ErrorSeverity.ERROR,
    category: ErrorCategory.NETWORK,
    message: 'Server returned 404 — requested resource or endpoint was not found',
  },

  // ============================================
  // Wallet/Agent Errors (2900-2999)
  // ============================================
  STATE_LOAD_ERROR: {
    statusCode: 2900,
    appEvent: AppEventCode.STATE_LOAD_ERROR,
    severity: ErrorSeverity.ERROR,
    category: ErrorCategory.WALLET,
    message: 'Wallet state deserialization from persistent storage failed',
  },
  AGENT_INITIALIZATION_ERROR: {
    statusCode: 2901,
    appEvent: AppEventCode.AGENT_INITIALIZATION_ERROR,
    severity: ErrorSeverity.CRITICAL,
    category: ErrorCategory.WALLET,
    message: 'Aries agent initialization failed — check wallet key, mediator config, and ledger connectivity',
  },
  WALLET_SECRET_NOT_FOUND: {
    statusCode: 2902,
    appEvent: AppEventCode.WALLET_SECRET_NOT_FOUND,
    severity: ErrorSeverity.CRITICAL,
    category: ErrorCategory.WALLET,
    message: 'Wallet secret not found in secure storage — wallet may need to be re-created',
  },

  // ============================================
  // Connection/Invitation Errors (3000-3099)
  // ============================================
  PARSE_INVITATION_ERROR: {
    statusCode: 3000,
    appEvent: AppEventCode.PARSE_INVITATION_ERROR,
    severity: ErrorSeverity.ERROR,
    category: ErrorCategory.CONNECTION,
    message: 'Connection invitation URL/payload could not be parsed — invalid format',
  },
  RECEIVE_INVITATION_ERROR: {
    statusCode: 3001,
    appEvent: AppEventCode.RECEIVE_INVITATION_ERROR,
    severity: ErrorSeverity.ERROR,
    category: ErrorCategory.CONNECTION,
    message: 'Agent failed to process and accept the connection invitation',
  },
  LEGACY_DID_ERROR: {
    statusCode: 3002,
    appEvent: AppEventCode.LEGACY_DID_ERROR,
    severity: ErrorSeverity.ERROR,
    category: ErrorCategory.CONNECTION,
    message: 'Legacy DID resolution or conversion failed — unsupported DID method',
  },
  APP_TO_APP_URL_ERROR: {
    statusCode: 3003,
    appEvent: AppEventCode.APP_TO_APP_URL_ERROR,
    severity: ErrorSeverity.ERROR,
    category: ErrorCategory.CONNECTION,
    message: 'App-to-app deep link URL is malformed or missing required parameters',
  },

  // ============================================
  // Attestation Errors (3100-3199)
  // ============================================
  ATTESTATION_BAD_INVITATION: {
    statusCode: 3100,
    appEvent: AppEventCode.ATTESTATION_BAD_INVITATION,
    severity: ErrorSeverity.ERROR,
    category: ErrorCategory.VERIFICATION,
    message: 'Attestation invitation failed validation — malformed or expired',
  },
  ATTESTATION_CONNECTION_ERROR: {
    statusCode: 3101,
    appEvent: AppEventCode.ATTESTATION_CONNECTION_ERROR,
    severity: ErrorSeverity.ERROR,
    category: ErrorCategory.VERIFICATION,
    message: 'Failed to establish agent connection for attestation exchange',
  },
  ATTESTATION_NONCE_ERROR: {
    statusCode: 3102,
    appEvent: AppEventCode.ATTESTATION_NONCE_ERROR,
    severity: ErrorSeverity.ERROR,
    category: ErrorCategory.VERIFICATION,
    message: 'Attestation nonce generation or validation failed',
  },
  ATTESTATION_GENERATION_ERROR: {
    statusCode: 3103,
    appEvent: AppEventCode.ATTESTATION_GENERATION_ERROR,
    severity: ErrorSeverity.ERROR,
    category: ErrorCategory.VERIFICATION,
    message: 'Platform attestation generation failed — Play Integrity or App Attest error',
  },
  ATTESTATION_VALIDATION_ERROR: {
    statusCode: 3104,
    appEvent: AppEventCode.ATTESTATION_VALIDATION_ERROR,
    severity: ErrorSeverity.ERROR,
    category: ErrorCategory.VERIFICATION,
    message: 'Server-side attestation validation rejected the token',
  },
  ATTESTATION_AGENT_UNDEFINED: {
    statusCode: 3105,
    appEvent: AppEventCode.ATTESTATION_AGENT_UNDEFINED,
    severity: ErrorSeverity.CRITICAL,
    category: ErrorCategory.VERIFICATION,
    message: 'Attestation requires an initialized agent but agent reference is undefined',
  },
  ATTESTATION_INTEGRITY_UNAVAILABLE: {
    statusCode: 3106,
    appEvent: AppEventCode.ATTESTATION_INTEGRITY_UNAVAILABLE,
    severity: ErrorSeverity.ERROR,
    category: ErrorCategory.VERIFICATION,
    message: 'Platform integrity API (Play Integrity / App Attest) is not available on this device',
  },
  ATTESTATION_GENERAL_PROOF_ERROR: {
    statusCode: 3107,
    appEvent: AppEventCode.ATTESTATION_GENERAL_PROOF_ERROR,
    severity: ErrorSeverity.ERROR,
    category: ErrorCategory.VERIFICATION,
    message: 'Attestation proof presentation failed — agent could not construct or send proof',
  },
  ATTESTATION_REQUEST_ERROR: {
    statusCode: 3108,
    appEvent: AppEventCode.ATTESTATION_REQUEST_ERROR,
    severity: ErrorSeverity.ERROR,
    category: ErrorCategory.VERIFICATION,
    message: 'Attestation request to verification service failed — network or server error',
  },
  ATTESTATION_UNSUPPORTED_PLATFORM: {
    statusCode: 3109,
    appEvent: AppEventCode.ATTESTATION_UNSUPPORTED_PLATFORM,
    severity: ErrorSeverity.ERROR,
    category: ErrorCategory.DEVICE,
    message: 'Current platform does not support attestation — requires iOS 14+ or Android with Play Services',
  },
} as const satisfies Record<string, ErrorDefinition>

export const ErrorRegistryAppEventMap = new Map<AppEventCode, ErrorDefinition>(
  Object.values(ErrorRegistry).map((definition) => [definition.appEvent, definition])
)

export type ErrorRegistryKey = keyof typeof ErrorRegistry
