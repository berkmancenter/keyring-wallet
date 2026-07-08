/**
 * Stable, machine-readable event codes attached to AppErrors.
 *
 * Ported from bc-wallet-mobile (trimmed to the codes Keyring uses — the
 * upstream file also carries ~150 BCSC/IAS-specific codes we dropped).
 * Codes are snake_case strings so they stay greppable in remote logs.
 */
export enum AppEventCode {
  // Special
  UNKNOWN_APP_ERROR = 'unknown_app_error',
  FATAL_UNRECOVERABLE_ERROR = 'fatal_unrecoverable_error',
  UNKNOWN_ERROR_BOUNDARY_ERROR = 'unknown_error_boundary_error',

  // Camera / scanning
  CAMERA_BROKEN = 'camera_broken',
  INVALID_QR_CODE = 'invalid_qr_code',

  // Network
  NO_INTERNET = 'no_internet',
  SERVER_ERROR = 'server_error',
  UNKNOWN_SERVER_ERROR = 'unknown_server_error',
  SERVER_TIMEOUT = 'server_timeout',
  UNSECURED_NETWORK = 'unsecured_network',
  PROBLEM_WITH_CONNECTION = 'problem_with_connection',
  NOT_FOUND = 'not_found',

  // Wallet / agent
  STATE_LOAD_ERROR = 'state_load_error',
  AGENT_INITIALIZATION_ERROR = 'agent_initialization_error',
  WALLET_SECRET_NOT_FOUND = 'wallet_secret_not_found',

  // Connections / invitations
  PARSE_INVITATION_ERROR = 'parse_invitation_error',
  RECEIVE_INVITATION_ERROR = 'receive_invitation_error',
  LEGACY_DID_ERROR = 'legacy_did_error',
  APP_TO_APP_URL_ERROR = 'app_to_app_url_error',

  // Attestation
  ATTESTATION_BAD_INVITATION = 'attestation_bad_invitation',
  ATTESTATION_CONNECTION_ERROR = 'attestation_connection_error',
  ATTESTATION_NONCE_ERROR = 'attestation_nonce_error',
  ATTESTATION_GENERATION_ERROR = 'attestation_generation_error',
  ATTESTATION_VALIDATION_ERROR = 'attestation_validation_error',
  ATTESTATION_AGENT_UNDEFINED = 'attestation_agent_undefined',
  ATTESTATION_INTEGRITY_UNAVAILABLE = 'attestation_integrity_unavailable',
  ATTESTATION_GENERAL_PROOF_ERROR = 'attestation_general_proof_error',
  ATTESTATION_REQUEST_ERROR = 'attestation_request_error',
  ATTESTATION_UNSUPPORTED_PLATFORM = 'attestation_unsupported_platform',
}
