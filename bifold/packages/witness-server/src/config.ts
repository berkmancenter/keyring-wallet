import { readFileSync, existsSync } from 'fs'

/**
 * Witness Server Configuration
 *
 * Configuration options for the witness server.
 * Can be overridden via environment variables.
 */

export interface WitnessServerConfig {
  /** Port for DIDComm HTTP transport (receiving messages from agents) */
  port: number

  /** Port for the invitation/QR code page */
  webPort: number

  /** Name/label for the witness agent */
  name: string

  /** Public URL for the witness (used in DIDComm endpoints) */
  publicUrl: string

  /** Session expiration time in minutes */
  sessionExpirationMinutes: number

  /** Enable verbose logging */
  verbose: boolean

  /** Human-readable event name (e.g., "EthDenver 2024") - included in VWC witnessContext */
  eventName?: string

  /** Event start time - witnessing requests before this time are rejected */
  eventStartTime?: Date

  /** Event end time - witnessing requests after this time are rejected */
  eventEndTime?: Date

  /** Verification method type (e.g., "in-person-proximity", "session-based-challenge") */
  verificationMethod: string

  // ============================================
  // DID Configuration
  // ============================================

  /**
   * Pre-configured witness issuer DID.
   * Supports did:key, did:web, did:peer methods (auto-detected from prefix).
   * If not provided, a random did:peer will be auto-generated.
   */
  issuerDid?: string

  /**
   * 32-byte seed in hex format for deterministic key derivation.
   * Used to derive the Ed25519 key pair for the issuer DID.
   * If issuerDid is set, the derived key must match the DID's public key.
   * If issuerDid is not set, a did:key will be derived from this seed.
   */
  issuerDidSeed?: string

  /**
   * Path to a JSON key file containing key material.
   * Alternative to issuerDidSeed for secrets management.
   * File format: { "seed": "hex-string" } or { "privateKeyHex": "hex-string" }
   */
  issuerKeyFile?: string

  /**
   * Path to save/load the OOB invitation for stable invitation URLs.
   * If the file exists, the invitation is loaded from it on startup.
   * If it doesn't exist, a new invitation is created and saved.
   * Set to empty string to disable persistence (always create fresh invitation).
   */
  invitationFile?: string

  /**
   * Directory to store opt-in reporting graph data.
   * Contains wallet pseudonyms and exchange edges for social graph features.
   * Persisted across wallet resets to maintain historical reporting data.
   * Default: .reporting
   */
  reportingDir?: string

  // ============================================
  // Mediator Configuration
  // ============================================

  /**
   * Mediator out-of-band invitation URL.
   * If set, the witness server connects through a mediator using WebSocket
   * and does not require a publicly accessible port.
   * If not set, the witness server uses direct HTTP transport.
   */
  mediatorInvitationUrl?: string

  /**
   * Timeout in milliseconds to wait for mediator connection to establish.
   * Default: 10000 (10 seconds)
   */
  mediatorConnectionTimeout: number

  // ============================================
  // TLS Configuration
  // ============================================

  /**
   * Enable TLS/HTTPS for the web server.
   * Default: true (secure by default)
   */
  tlsEnabled: boolean

  /**
   * Path to custom TLS certificate file (PEM format).
   * If not provided, certificate will be auto-generated.
   */
  tlsCertPath?: string

  /**
   * Path to custom TLS private key file (PEM format).
   * If not provided, key will be auto-generated.
   */
  tlsKeyPath?: string

  /**
   * Directory to store auto-generated TLS certificates.
   * Default: .certs
   */
  tlsCertsDir: string

  /**
   * Auto-generate self-signed certificate if not found.
   * Default: true
   */
  tlsAutoGenerate: boolean

  /**
   * Certificate validity in days for auto-generated certificates.
   * Default: 365
   */
  tlsValidityDays: number

  /**
   * Hostnames/IP addresses to include in certificate SAN.
   * Comma-separated list. Default: localhost
   */
  tlsHostnames: string[]

  // ============================================
  // Locality Verification Configuration
  // ============================================

  /**
   * Whether opt-in activity reporting is enabled at the server level.
   * When false the witness silently ignores `reporting-did-registration`
   * messages and never records graph edges, regardless of what individual
   * app users have toggled.
   * Default: true  (set WITNESS_REPORTING_ENABLED=false to turn off)
   */
  reportingEnabled: boolean

  /**
   * Whether locality verification is required during credential issuance.
   * If true, participants must have a valid co-locality proof before creating a session.
   * If false, locality verification is optional (proofs will be included in VWCs if available).
   *
   * TODO: When Bluetooth co-locality is implemented, this gate will apply to
   * the BLE-based proof once that transport is implemented.
   *
   * Default: false (disabled until Bluetooth transport is implemented)
   */
  localityVerificationRequired: boolean

  /**
   * Whether to retain basic message records in the wallet after processing.
   * When false (default), messages are deleted after being processed to preserve user privacy.
   * When true, all messages are retained in the wallet for debugging/audit purposes.
   * 
   * Note: This only affects the witness's storage - users' devices retain their own message history.
   * 
   * Default: false (messages are deleted after processing)
   */
  retainMessages: boolean

  // ============================================
  // LLM Configuration
  // ============================================

  /**
   * Enable AI-powered responses via LangChain.js + Claude.
   * When enabled, the witness will respond intelligently to user messages
   * using context from organization, event, and app capabilities files.
   * Default: false
   */
  llmEnabled: boolean

  /**
   * Anthropic API key for Claude access.
   * Required when llmEnabled is true.
   */
  anthropicApiKey?: string

  /**
   * Custom base URL for Anthropic API (e.g., for proxy usage).
   * Optional - defaults to Anthropic's official API endpoint.
   */
  anthropicBaseUrl?: string

  /**
   * Anthropic model to use for LLM responses.
   * Optional - defaults to 'claude-sonnet-4-20250514' (Claude Sonnet 4.6).
   */
  anthropicModel?: string

  /**
   * Maximum tokens for LLM responses.
   * Optional - defaults to 500 (kept concise for DIDComm messages).
   */
  anthropicMaxTokens?: number

  /**
   * Temperature for LLM responses (0-1).
   * Optional - some models don't support this parameter, so it's only set if provided.
   */
  anthropicTemperature?: number

  /**
   * Path to markdown file describing the witness organization.
   */
  llmContextOrganization?: string

  /**
   * Path to markdown file describing the specific event.
   */
  llmContextEvent?: string

  /**
   * Path to markdown file describing app capabilities and witness context.
   */
  llmContextCapabilities?: string

  /**
   * Maximum number of LLM requests per user per time window.
   * Default: 10
   */
  llmRateLimitPerUser: number

  /**
   * Time window in seconds for per-user rate limiting.
   * Default: 60 (1 minute)
   */
  llmRateLimitUserWindow: number

  /**
   * Maximum number of LLM requests across all users per time window.
   * Default: 100
   */
  llmRateLimitGlobal: number

  /**
   * Time window in seconds for global rate limiting.
   * Default: 60 (1 minute)
   */
  llmRateLimitGlobalWindow: number
}

/**
 * Key file format for importing witness keys
 */
export interface KeyFileContents {
  /** 32-byte seed in hex format */
  seed?: string
  /** Raw private key in hex format (64 chars for Ed25519) */
  privateKeyHex?: string
  /** Raw private key in base64 format */
  privateKeyBase64?: string
}

/**
 * Load key material from a key file
 */
export function loadKeyFile(path: string): KeyFileContents {
  if (!existsSync(path)) {
    throw new Error(`Key file not found: ${path}`)
  }

  try {
    const content = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(content) as KeyFileContents

    if (!parsed.seed && !parsed.privateKeyHex && !parsed.privateKeyBase64) {
      throw new Error('Key file must contain seed, privateKeyHex, or privateKeyBase64')
    }

    return parsed
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in key file: ${path}`)
    }
    throw error
  }
}

/**
 * Validate hex string format
 */
export function isValidHex(str: string, expectedLength?: number): boolean {
  if (!/^[0-9a-fA-F]+$/.test(str)) return false
  if (expectedLength && str.length !== expectedLength) return false
  return true
}

/**
 * Parse an ISO 8601 datetime string into a Date.
 * Returns undefined and logs a warning if the string is present but invalid.
 */
export function parseEventTime(envVarName: string, value: string | undefined): Date | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  if (isNaN(parsed.getTime())) {
    console.warn(`[config] Warning: ${envVarName}="${value}" is not a valid ISO 8601 datetime — ignoring`)
    return undefined
  }
  return parsed
}

/**
 * Load configuration from environment variables with defaults
 */
export function loadConfig(): WitnessServerConfig {
  const port = parseInt(process.env.WITNESS_PORT || '9002', 10)
  const webPort = parseInt(process.env.WITNESS_WEB_PORT || '9003', 10)

  // Validate issuerDidSeed if provided
  const issuerDidSeed = process.env.WITNESS_ISSUER_SEED || undefined
  if (issuerDidSeed && !isValidHex(issuerDidSeed, 64)) {
    console.warn('[config] Warning: WITNESS_ISSUER_SEED should be a 64-character hex string (32 bytes)')
  }

  // TLS Configuration (optional - only needed for web UI over HTTPS)
  const tlsEnabled = process.env.WITNESS_TLS_ENABLED === 'true' // Default: false (HTTP is fine for local networks)
  const tlsCertPath = process.env.WITNESS_TLS_CERT || undefined
  const tlsKeyPath = process.env.WITNESS_TLS_KEY || undefined
  const tlsCertsDir = process.env.WITNESS_TLS_CERTS_DIR || '.certs'
  const tlsAutoGenerate = process.env.WITNESS_TLS_AUTO_GENERATE !== 'false' // Default: true
  const tlsValidityDays = parseInt(process.env.WITNESS_TLS_VALIDITY_DAYS || '365', 10)
  const tlsHostnames = process.env.WITNESS_TLS_HOSTNAMES?.split(',').map((h) => h.trim()) || ['localhost']

  // Reporting Configuration (default: enabled)
  const reportingEnabled = process.env.WITNESS_REPORTING_ENABLED !== 'false' // Default: true

  // Locality Verification Configuration
  const localityVerificationRequired = process.env.WITNESS_LOCALITY_REQUIRED !== 'false' // Default: true (required)

  // Message Retention Configuration
  const retainMessages = process.env.WITNESS_RETAIN_MESSAGES === 'true' // Default: false (delete after processing)

  // Event time window (optional — ISO 8601 datetime strings)
  const eventStartTime = parseEventTime('WITNESS_EVENT_START', process.env.WITNESS_EVENT_START)
  const eventEndTime = parseEventTime('WITNESS_EVENT_END', process.env.WITNESS_EVENT_END)

  // Validate that start is before end when both are provided
  if (eventStartTime && eventEndTime && eventStartTime >= eventEndTime) {
    console.warn('[config] Warning: WITNESS_EVENT_START is not before WITNESS_EVENT_END — time window will always reject requests')
  }

  // LLM Configuration
  const llmEnabled = process.env.WITNESS_LLM_ENABLED === 'true' // Default: false
  const anthropicApiKey = process.env.WITNESS_ANTHROPIC_API_KEY || undefined
  const anthropicBaseUrl = process.env.WITNESS_ANTHROPIC_BASE_URL || undefined
  const anthropicModel = process.env.WITNESS_ANTHROPIC_MODEL || undefined
  const anthropicMaxTokens = process.env.WITNESS_ANTHROPIC_MAX_TOKENS ? parseInt(process.env.WITNESS_ANTHROPIC_MAX_TOKENS, 10) : undefined
  const anthropicTemperature = process.env.WITNESS_ANTHROPIC_TEMPERATURE ? parseFloat(process.env.WITNESS_ANTHROPIC_TEMPERATURE) : undefined
  const llmContextOrganization = process.env.WITNESS_CONTEXT_ORGANIZATION || undefined
  const llmContextEvent = process.env.WITNESS_CONTEXT_EVENT || undefined
  const llmContextCapabilities = process.env.WITNESS_CONTEXT_CAPABILITIES || undefined
  const llmRateLimitPerUser = parseInt(process.env.WITNESS_LLM_RATE_LIMIT_PER_USER || '10', 10)
  const llmRateLimitUserWindow = parseInt(process.env.WITNESS_LLM_RATE_LIMIT_USER_WINDOW || '60', 10)
  const llmRateLimitGlobal = parseInt(process.env.WITNESS_LLM_RATE_LIMIT_GLOBAL || '100', 10)
  const llmRateLimitGlobalWindow = parseInt(process.env.WITNESS_LLM_RATE_LIMIT_GLOBAL_WINDOW || '60', 10)

  // Validate LLM configuration if enabled
  if (llmEnabled && !anthropicApiKey) {
    throw new Error(
      'WITNESS_LLM_ENABLED is true but WITNESS_ANTHROPIC_API_KEY is not set. ' +
        'Please provide an Anthropic API key or disable LLM features.'
    )
  }

  return {
    port,
    webPort,
    name: process.env.WITNESS_NAME || 'witness-server',
    publicUrl: process.env.WITNESS_PUBLIC_URL || `http://localhost:${port}`,
    sessionExpirationMinutes: parseInt(process.env.WITNESS_SESSION_EXPIRATION || '30', 10),
    verbose: process.env.WITNESS_VERBOSE === 'true',
    eventName: process.env.WITNESS_EVENT_NAME || undefined,
    eventStartTime,
    eventEndTime,
    verificationMethod: process.env.WITNESS_VERIFICATION_METHOD || 'session-based-challenge',
    issuerDid: process.env.WITNESS_ISSUER_DID || undefined,
    issuerDidSeed,
    issuerKeyFile: process.env.WITNESS_ISSUER_KEY_FILE || undefined,
    invitationFile: process.env.WITNESS_INVITATION_FILE ?? '.oob-invitation.json',
    reportingDir: process.env.WITNESS_REPORTING_DIR ?? '.reporting',
    mediatorInvitationUrl: process.env.MEDIATOR_INVITATION_URL || undefined,
    mediatorConnectionTimeout: parseInt(process.env.WITNESS_MEDIATOR_CONNECTION_TIMEOUT || '10000', 10),
    tlsEnabled,
    tlsCertPath,
    tlsKeyPath,
    tlsCertsDir,
    tlsAutoGenerate,
    tlsValidityDays,
    tlsHostnames,
    reportingEnabled,
    localityVerificationRequired,
    retainMessages,
    llmEnabled,
    anthropicApiKey,
    anthropicBaseUrl,
    anthropicModel,
    anthropicMaxTokens,
    anthropicTemperature,
    llmContextOrganization,
    llmContextEvent,
    llmContextCapabilities,
    llmRateLimitPerUser,
    llmRateLimitUserWindow,
    llmRateLimitGlobal,
    llmRateLimitGlobalWindow,
  }
}

/**
 * Default configuration for development
 */
export const defaultConfig: WitnessServerConfig = {
  port: 9002,
  webPort: 9003,
  name: 'witness-server',
  publicUrl: 'http://localhost:9002',
  sessionExpirationMinutes: 30,
  verbose: false,
  eventName: undefined,
  eventStartTime: undefined,
  eventEndTime: undefined,
  verificationMethod: 'session-based-challenge',
  issuerDid: undefined,
  issuerDidSeed: undefined,
  issuerKeyFile: undefined,
  invitationFile: '.oob-invitation.json',
  reportingDir: '.reporting',
  mediatorInvitationUrl: undefined,
  mediatorConnectionTimeout: 10000,
  tlsEnabled: true,
  tlsCertPath: undefined,
  tlsKeyPath: undefined,
  tlsCertsDir: '.certs',
  tlsAutoGenerate: true,
  tlsValidityDays: 365,
  tlsHostnames: ['localhost'],
  reportingEnabled: true,
  localityVerificationRequired: true,
  retainMessages: false,
  llmEnabled: false,
  anthropicApiKey: undefined,
  anthropicBaseUrl: undefined,
  anthropicModel: undefined,
  anthropicMaxTokens: undefined,
  anthropicTemperature: undefined,
  llmContextOrganization: undefined,
  llmContextEvent: undefined,
  llmContextCapabilities: undefined,
  llmRateLimitPerUser: 10,
  llmRateLimitUserWindow: 60,
  llmRateLimitGlobal: 100,
  llmRateLimitGlobalWindow: 60,
}

/**
 * Check if mediation is enabled based on config
 */
export function isMediatorEnabled(config: WitnessServerConfig): boolean {
  return !!config.mediatorInvitationUrl
}

/**
 * Detect DID method from DID string
 */
export function detectDidMethod(did: string): 'key' | 'web' | 'peer' | 'unknown' {
  if (did.startsWith('did:key:')) return 'key'
  if (did.startsWith('did:web:')) return 'web'
  if (did.startsWith('did:peer:')) return 'peer'
  return 'unknown'
}

/**
 * Determine the source of DID configuration
 */
export type DidSource = 'CONFIGURED' | 'DERIVED_FROM_SEED' | 'AUTO_GENERATED'

/**
 * Determine the source of key material
 */
export type KeySource = 'SEED_ENV' | 'KEY_FILE' | 'AUTO_GENERATED'

/**
 * Get descriptive strings for DID/key sources
 */
export function getDidSourceDescription(config: WitnessServerConfig): { didSource: DidSource; keySource: KeySource } {
  let didSource: DidSource = 'AUTO_GENERATED'
  let keySource: KeySource = 'AUTO_GENERATED'

  if (config.issuerDid) {
    didSource = 'CONFIGURED'
  } else if (config.issuerDidSeed || config.issuerKeyFile) {
    didSource = 'DERIVED_FROM_SEED'
  }

  if (config.issuerKeyFile) {
    keySource = 'KEY_FILE'
  } else if (config.issuerDidSeed) {
    keySource = 'SEED_ENV'
  }

  return { didSource, keySource }
}
