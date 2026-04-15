/**
 * WitnessService - Core Witness Logic for VRC Witnessed Exchanges
 *
 * This service implements the Witness role in the DTG Witnessed Exchange flow:
 * 1. Session Creation (The Handshake) - Generate challenge and distribute to participants
 * 2. Credential Verification & Endorsement - Verify VPs and inner VRCs
 * 3. Credential Distribution - Issue VWCs to participants
 *
 * Communication is done entirely over DIDComm (basic messages and credential protocol).
 */

import {
  Agent,
  AutoAcceptCredential,
  AutoAcceptProof,
  BasicMessageEventTypes,
  BasicMessagesModule,
  CacheModule,
  ConnectionEventTypes,
  ConnectionsModule,
  CredentialsModule,
  DidsModule,
  DifPresentationExchangeProofFormatService,
  InMemoryLruCache,
  InitConfig,
  JsonLdCredentialFormatService,
  JsonTransformer,
  Key,
  KeyDidRegistrar,
  KeyDidResolver,
  KeyType,
  LogLevel,
  ConsoleLogger,
  PeerDidNumAlgo,
  PeerDidRegistrar,
  PeerDidResolver,
  ProofsModule,
  TypedArrayEncoder,
  utils,
  V2CredentialProtocol,
  V2ProofProtocol,
  W3cCredentialsModule,
  W3cJsonLdVerifiableCredential,
  W3cJsonLdVerifiablePresentation,
  WebDidResolver,
  type BasicMessageStateChangedEvent,
  type ConnectionRecord,
  type ConnectionStateChangedEvent,
} from '@credo-ts/core'
import { AskarModule } from '@credo-ts/askar'
import { agentDependencies, HttpInboundTransport } from '@credo-ts/node'
import {
  HttpOutboundTransport,
  WsOutboundTransport,
  MediatorPickupStrategy,
  MediationRecipientModule,
} from '@credo-ts/core'
import { ariesAskar } from '@hyperledger/aries-askar-nodejs'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { createHash, randomBytes } from 'crypto'
import path from 'path'

import {
  WitnessServerConfig,
  loadKeyFile,
  detectDidMethod,
  getDidSourceDescription,
  isMediatorEnabled,
  type DidSource,
  type KeySource,
} from './config'

import { pseudonymDisplay } from './pseudonym'

// Import shared wallet config
import { getWalletStoragePath } from '@bifold/vrc-shared'

import {
  CredentialRegistry,
  type IssuedCredentialRecord,
  type VerificationResult as RegistryVerificationResult,
} from './CredentialRegistry'

import { LocalityService, LocalityEvidence } from './LocalityService'
import { LLMService, createLLMService } from './LLMService'

// Import shared modules from @bifold/vrc-contexts and @bifold/vrc-shared
import { WITNESSED_EXCHANGE_CONTEXT_URL } from '@bifold/vrc-contexts'
import { demoDocumentLoader } from '@bifold/vrc-shared'

// Import vcLibraries for debugging JSON-LD canonicalization
import { vcLibraries } from '@credo-ts/core'

import { ReportingGraph } from './ReportingGraph'

// Session expiration time in minutes (default)
const DEFAULT_SESSION_EXPIRATION_MINUTES = 30

/**
 * Default expiration time for VWC credentials (in days)
 * Set via W3C VC v1 `expirationDate` field
 */
const DEFAULT_CREDENTIAL_EXPIRATION_DAYS = 7
const DEFAULT_CREDENTIAL_EXPIRATION_MS = DEFAULT_CREDENTIAL_EXPIRATION_DAYS * 24 * 60 * 60 * 1000

/**
 * Persisted invitation file format
 */
export interface PersistedInvitation {
  invitationUrl: string
  outOfBandId: string
  createdAt: string
  configHash?: string // Hash of config values that affect the invitation
}

/**
 * Persisted seed file format
 */
export interface PersistedSeed {
  seed: string
  derivedDid: string
  createdAt: string
  configHash?: string // Hash of config - should match invitation's configHash
}

/**
 * Session data for a witnessed exchange
 */
export interface SessionData {
  sessionId: string
  challenge: string
  domain: string
  participants: Set<string>
  receivedPresentations: Map<string, any>
  /** connectionId → reportingDid for participants that opted in to activity reporting */
  receivedReportingDids: Map<string, string>
  /** connectionId → whether the participant included hardware attestation evidence */
  receivedAttestations: Map<string, boolean>
  /** connectionId → whether the participant requested witness credentials (true) or just edge recording (false) */
  witnessRequested: Map<string, boolean>
  createdAt: Date
  expiresAt: Date
}

/**
 * Result of presentation verification
 */
export interface VerificationResult {
  verified: boolean
  sessionId?: string
  error?: string
}

type WitnessAgent = Agent<ReturnType<typeof getWitnessModulesTyped>>

function getWitnessModules(mediatorInvitationUrl?: string) {
  const modules: Record<string, unknown> = {
    connections: new ConnectionsModule({
      autoAcceptConnections: true,
    }),
    credentials: new CredentialsModule({
      autoAcceptCredentials: AutoAcceptCredential.Never,
      credentialProtocols: [new V2CredentialProtocol({ credentialFormats: [new JsonLdCredentialFormatService()] })],
    }),
    proofs: new ProofsModule({
      autoAcceptProofs: AutoAcceptProof.Never,
      proofProtocols: [new V2ProofProtocol({ proofFormats: [new DifPresentationExchangeProofFormatService()] })],
    }),
    w3cCredentials: new W3cCredentialsModule({
      documentLoader: demoDocumentLoader,
    }),
    cache: new CacheModule({
      cache: new InMemoryLruCache({ limit: 100 }),
    }),
    dids: new DidsModule({
      resolvers: [new KeyDidResolver(), new PeerDidResolver(), new WebDidResolver()],
      registrars: [new KeyDidRegistrar(), new PeerDidRegistrar()],
    }),
    askar: new AskarModule({
      ariesAskar,
    }),
    basicMessages: new BasicMessagesModule(),
  }

  // Add mediation recipient module if mediator URL is provided
  if (mediatorInvitationUrl) {
    modules.mediationRecipient = new MediationRecipientModule({
      mediatorInvitationUrl,
      mediatorPickupStrategy: MediatorPickupStrategy.Implicit,
    })
  }

  return modules as ReturnType<typeof getWitnessModulesTyped>
}

// Type helper for module inference
function getWitnessModulesTyped() {
  return {
    connections: new ConnectionsModule({
      autoAcceptConnections: true,
    }),
    credentials: new CredentialsModule({
      autoAcceptCredentials: AutoAcceptCredential.Never,
      credentialProtocols: [new V2CredentialProtocol({ credentialFormats: [new JsonLdCredentialFormatService()] })],
    }),
    proofs: new ProofsModule({
      autoAcceptProofs: AutoAcceptProof.Never,
      proofProtocols: [new V2ProofProtocol({ proofFormats: [new DifPresentationExchangeProofFormatService()] })],
    }),
    w3cCredentials: new W3cCredentialsModule({
      documentLoader: demoDocumentLoader,
    }),
    cache: new CacheModule({
      cache: new InMemoryLruCache({ limit: 100 }),
    }),
    dids: new DidsModule({
      resolvers: [new KeyDidResolver(), new PeerDidResolver(), new WebDidResolver()],
      registrars: [new KeyDidRegistrar(), new PeerDidRegistrar()],
    }),
    askar: new AskarModule({
      ariesAskar,
    }),
    basicMessages: new BasicMessagesModule(),
    mediationRecipient: new MediationRecipientModule({
      mediatorInvitationUrl: '',
      mediatorPickupStrategy: MediatorPickupStrategy.Implicit,
    }),
  } as const
}

/**
 * WitnessService - Implements the Witness role for witnessed VRC exchanges
 */
export class WitnessService {
  public readonly agent: WitnessAgent
  public readonly config: WitnessServerConfig
  public readonly port: number
  public readonly name: string
  public readonly credentialRegistry: CredentialRegistry
  public localityService?: LocalityService
  public llmService?: LLMService

  private issuerDid?: string
  private issuerVerificationMethodId?: string
  private activeSessions: Map<string, SessionData> = new Map()
  private outOfBandId?: string
  private invitationUrl?: string

  // Registry: relationship DID → witness connection ID
  private relationshipDidRegistry: Map<string, string> = new Map()

  // Pending session requests awaiting counterparty
  private pendingSessionRequests: Map<
    string,
    {
      initiatorConnectionId: string
      initiatorRelationshipDid: string
      counterpartyRelationshipDid: string
      /** The witness preference from the initiator's session-request */
      initiatorWitnessPreference: boolean
      /** The witness preference from the counterparty's session-request (set when counterparty responds) */
      counterpartyWitnessPreference?: boolean
      /** When this pending request was stored, for TTL-based cleanup */
      timestamp: Date
    }
  > = new Map()

  private static readonly PENDING_REQUEST_TTL_MS = 3 * 60 * 1000 // 3 minutes
  private pendingRequestCleanupInterval?: NodeJS.Timeout
  private sessionCleanupInterval?: NodeJS.Timeout

  /** Persistent opt-in reporting graph (connectionId ↔ reportingDid, exchange edges) */
  public reportingGraph!: ReportingGraph

  // Event callbacks
  private onSessionComplete?: (sessionId: string) => void
  private onSessionCompleteWithParticipants?: (sessionId: string, walletAId: string, walletBId: string) => void
  /** Callback with attestation count and received reporting DIDs for network UI edge scoring */
  private onSessionCompleteWithAttestations?: (
    sessionId: string,
    walletAId: string,
    walletBId: string,
    attestationCount: number,
    receivedReportingDids: string[] | undefined
  ) => void
  private onWalletConnectedCallback?: (connectionId: string, label: string) => void
  private onSessionCreatedCallback?: (sessionId: string, walletAId: string, walletBId: string) => void
  private onCredentialIssuedCallback?: (record: IssuedCredentialRecord) => void

  private constructor(config: WitnessServerConfig) {
    this.config = config
    this.port = config.port
    this.name = config.name

    const useMediator = isMediatorEnabled(config)

    const walletId = `${config.name}-wallet`

    const agentConfig: InitConfig = {
      label: config.name,
      walletConfig: {
        id: walletId,
        key: `${config.name}-key`,
        storage: {
          type: 'sqlite',
          config: {
            path: getWalletStoragePath(walletId),
          },
        },
      },
      // When using mediator, endpoints are provided by the mediator
      endpoints: useMediator ? undefined : [config.publicUrl],
      logger: new ConsoleLogger(config.verbose ? LogLevel.debug : LogLevel.warn),
      // CRITICAL: Enable concurrent message processing for multi-use invitations
      // Without this, connections get stuck at "request-received" state when multiple
      // devices connect via the same multi-use invitation (especially with mediator)
      // See: https://github.com/openwallet-foundation/credo-ts/blob/v0.5.x/packages/core/src/types.ts#L86
      processDidCommMessagesConcurrently: true,
    }

    this.agent = new Agent({
      config: agentConfig,
      dependencies: agentDependencies,
      modules: getWitnessModules(config.mediatorInvitationUrl),
    })

    if (useMediator) {
      // Use WebSocket for mediator communication with keep-alive
      const wsTransport = new WsOutboundTransport()
      const httpTransport = new HttpOutboundTransport()

      this.agent.registerOutboundTransport(wsTransport)
      this.agent.registerOutboundTransport(httpTransport)
    } else {
      // Use direct HTTP transport
      this.agent.registerInboundTransport(new HttpInboundTransport({ port: config.port }))
      this.agent.registerOutboundTransport(new HttpOutboundTransport())
    }

    // Initialize credential registry
    this.credentialRegistry = new CredentialRegistry({ maxRecords: 1000 })

    // Initialize LLM service if enabled
    try {
      this.llmService = createLLMService(config) || undefined
      if (this.llmService && config.verbose) {
        console.log(`[${this.name}] LLM service enabled`)
      }
    } catch (error) {
      console.error(`[${this.name}] Failed to initialize LLM service:`, error)
      throw error
    }
  }

  /**
   * Build and initialize a WitnessService instance
   */
  public static async build(config: WitnessServerConfig): Promise<WitnessService> {
    const service = new WitnessService(config)
    await service.initialize()
    return service
  }

  /**
   * Initialize the witness agent and create necessary DIDs
   */
  private async initialize(): Promise<void> {
    console.log(`[${this.name}] Initializing agent...`)
    await this.agent.initialize()
    console.log(`[${this.name}] Agent initialized successfully`)

    // Wait for transport to be fully ready (critical for mediation stability)
    await this.waitForTransportReady()

    // Register debug event listeners for mediation
    this.registerDebugEventListeners()

    await this.ensureDedicatedIssuerDid()

    // Initialize reporting graph at the configured directory (default: .reporting/ beside .oob-invitation.json,
    // .witness-seed.json, etc.) — intentionally separate from the Credo wallet so that the graph
    // persists across `yarn fresh` wallet resets.
    const reportingDir = this.config.reportingDir ?? '.reporting'
    this.reportingGraph = new ReportingGraph(reportingDir, this.name)

    this.registerMessageHandlers()
    this.startPendingRequestCleanup()
    this.startSessionCleanup()

    // Print startup configuration summary
    await this.printStartupConfig()
  }

  /**
   * Periodically purge stale pending session requests so that half-completed
   * witness handshakes don't accumulate indefinitely.
   */
  private startPendingRequestCleanup(): void {
    this.pendingRequestCleanupInterval = setInterval(() => {
      const now = Date.now()
      for (const [key, req] of this.pendingSessionRequests) {
        if (now - req.timestamp.getTime() > WitnessService.PENDING_REQUEST_TTL_MS) {
          console.log(
            `[${this.name}] Purging stale pending request for ${key} (age: ${Math.round(
              (now - req.timestamp.getTime()) / 1000
            )}s)`
          )
          this.pendingSessionRequests.delete(key)
        }
      }
    }, 60_000)
  }

  /**
   * Periodically purge expired active sessions so that failed/abandoned
   * witness exchanges don't accumulate and collide with future sessions.
   */
  private startSessionCleanup(): void {
    this.sessionCleanupInterval = setInterval(() => {
      const now = Date.now()
      for (const [id, session] of this.activeSessions) {
        if (now > session.expiresAt.getTime()) {
          console.log(
            `[${this.name}] Purging expired session ${id} (age: ${Math.round(
              (now - session.createdAt.getTime()) / 1000
            )}s)`
          )
          this.activeSessions.delete(id)
        }
      }
    }, 30_000)
  }

  /**
   * Wait for transport to be fully ready after initialization
   * This is critical for mediated connections to establish properly
   */
  private async waitForTransportReady(): Promise<void> {
    const useMediator = isMediatorEnabled(this.config)

    if (useMediator) {
      // For mediated transport, wait longer to ensure WebSocket connection is stable
      // This prevents the "keylistUpdateAndAwait timeout" issue
      console.log(`[${this.name}] Waiting for mediator connection to stabilize...`)
      await new Promise((resolve) => setTimeout(resolve, 3000))
      console.log(`[${this.name}] Mediator connection stabilized`)
    } else {
      // For direct HTTP transport, give the HTTP server time to fully start listening
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }

  /**
   * Register debug event listeners for mediation troubleshooting
   * Only registers verbose logging when config.verbose is true
   */
  private registerDebugEventListeners(): void {
    // Only register verbose event logging when verbose mode is enabled
    if (!this.config.verbose) {
      return
    }

    // Monitor ALL agent events to see what's happening
    this.agent.events.on('*' as any, (event: any) => {
      // Log all events except some very noisy ones
      const eventType = event.type || 'unknown'
      if (!eventType.includes('AgentMessageReceived') && !eventType.includes('AgentMessageProcessed')) {
        console.log(`[${this.name}] [DEBUG] Event:`, eventType, JSON.stringify(event.payload || {}, null, 2))
      }
    })

    // Specifically monitor problem reports (always useful even in verbose mode)
    this.agent.events.on('ProblemReportMessage' as any, (event: any) => {
      console.log(`[${this.name}] [DEBUG] !!!! PROBLEM REPORT RECEIVED !!!!`)
      console.log(`[${this.name}] [DEBUG] Problem Report Details:`, JSON.stringify(event, null, 2))
    })

    // Monitor message received - use AgentMessageProcessed for decrypted messages
    this.agent.events.on('AgentMessageProcessed' as any, (event: any) => {
      const message = event.payload?.message
      const messageType = message?.['@type'] || message?.type

      // Only log if we have a valid message type (skip encrypted messages)
      if (messageType) {
        // Extract short type name for readability (e.g., "basicmessage/1.0/message")
        const shortType = messageType.includes('/') ? messageType.split('/').slice(-3).join('/') : messageType

        console.log(`[${this.name}] [DEBUG] Message processed:`, {
          type: shortType,
          id: (message['@id'] || message.id || 'unknown').substring(0, 8) + '...',
        })

        // Log full message if it's a problem report
        if (messageType.includes('problem-report')) {
          console.log(`[${this.name}] [DEBUG] PROBLEM REPORT CONTENT:`, JSON.stringify(message, null, 2))
        }
      }
    })

    console.log(`[${this.name}] [DEBUG] Event listeners registered (verbose mode)`)
  }

  /**
   * Print startup configuration to console
   */
  public async printStartupConfig(invitationUrl?: string): Promise<void> {
    const { didSource } = getDidSourceDescription(this.config)
    const didMethod = this.issuerDid ? detectDidMethod(this.issuerDid) : 'unknown'
    const useMediator = isMediatorEnabled(this.config)

    // Get wallet storage path for display (relative to witness-server directory)
    const walletId = `${this.config.name}-wallet`
    const walletPath = getWalletStoragePath(walletId)
    const relativePath = this.getRelativeWalletPath(walletPath)

    // Get wallet state information
    const connections = await this.agent.connections.getAll()
    const credentials = await this.agent.w3cCredentials.getAllCredentialRecords()
    const walletState = connections.length === 0 && credentials.length === 0 ? 'FRESH' : 'EXISTING'

    // Check persistence files and determine seed status
    const invitationFileExists = this.config.invitationFile ? existsSync(this.config.invitationFile) : false
    const seedFile = this.getSeedFilePath()
    const seedFileExists = seedFile ? existsSync(seedFile) : false

    // Determine seed source for display
    let seedSourceDisplay = 'unknown'
    if (this.config.issuerKeyFile) {
      seedSourceDisplay = `FILE (${this.config.issuerKeyFile.split('/').pop()})`
    } else if (this.config.issuerDidSeed) {
      seedSourceDisplay = 'ENV (WITNESS_ISSUER_SEED)'
    } else if (seedFileExists) {
      seedSourceDisplay = 'LOADED (.witness-seed.json)'
    } else {
      seedSourceDisplay = 'NEW (just generated)'
    }

    // TLS status
    const tlsStatus = this.config.tlsEnabled ? 'enabled' : 'disabled'
    const webScheme = this.config.tlsEnabled ? 'https' : 'http'

    // Locality service status
    let localityStatus = 'disabled'
    if (this.localityService?.isEnabled()) {
      localityStatus = this.config.localityVerificationRequired ? 'enabled (required)' : 'enabled (optional)'
    }

    // Current timestamp
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19)

    console.log('')
    console.log('╔══════════════════════════════════════════════════════════════════╗')
    console.log(`║          WITNESS SERVER - Started ${this.padRight(timestamp, 28)}║`)
    console.log('╠══════════════════════════════════════════════════════════════════╣')
    console.log('║  CONFIG                                                          ║')
    console.log(`║    Name:            ${this.padRight(this.config.name, 43)}║`)
    console.log(`║    Event:           ${this.padRight(this.config.eventName || '(not set)', 43)}║`)
    console.log(`║    Method:          ${this.padRight(this.config.verificationMethod, 43)}║`)
    console.log(`║    Session TTL:     ${this.padRight(`${this.config.sessionExpirationMinutes} minutes`, 43)}║`)
    if (this.config.eventStartTime || this.config.eventEndTime) {
      console.log('╠══════════════════════════════════════════════════════════════════╣')
      console.log('║  EVENT WINDOW                                                    ║')
      const startDisplay = this.config.eventStartTime
        ? this.config.eventStartTime.toISOString()
        : '(not set — no start gate)'
      const endDisplay = this.config.eventEndTime ? this.config.eventEndTime.toISOString() : '(not set — no end gate)'
      console.log(`║    Start:           ${this.padRight(startDisplay, 43)}║`)
      console.log(`║    End:             ${this.padRight(endDisplay, 43)}║`)
    }
    console.log('╠══════════════════════════════════════════════════════════════════╣')
    console.log('║  WALLET                                                          ║')
    console.log(
      `║    Status:          ${this.padRight(
        `${walletState} (${connections.length} connections, ${credentials.length} credentials)`,
        43
      )}║`
    )
    console.log(`║    ID:              ${this.padRight(walletId, 43)}║`)
    console.log(`║    Path:            ${this.padRight(relativePath, 43)}║`)
    console.log('╠══════════════════════════════════════════════════════════════════╣')
    console.log('║  IDENTITY                                                        ║')
    console.log(`║    Source:          ${this.padRight(this.getDidSourceLabel(didSource), 43)}║`)
    console.log(`║    Method:          ${this.padRight(didMethod, 43)}║`)
    console.log(`║    DID:             ${this.padRight(this.truncateDid(this.issuerDid || '', 43), 43)}║`)
    console.log(`║    Key Type:        ${this.padRight('Ed25519', 43)}║`)
    console.log(`║    Seed Source:     ${this.padRight(seedSourceDisplay, 43)}║`)
    if (this.issuerDid) {
      const fingerprint = this.issuerDid.split(':').pop()?.substring(0, 20) || ''
      console.log(`║    Fingerprint:     ${this.padRight(fingerprint + '...', 43)}║`)
    }
    console.log('╠══════════════════════════════════════════════════════════════════╣')
    console.log('║  NETWORK                                                         ║')
    console.log(`║    Transport:       ${this.padRight(useMediator ? 'MEDIATOR (WebSocket)' : 'DIRECT (HTTP)', 43)}║`)
    if (useMediator) {
      const mediatorUrl = this.config.mediatorInvitationUrl || ''
      let mediatorDisplay = mediatorUrl
      try {
        const url = new URL(mediatorUrl.split('?')[0])
        mediatorDisplay = url.hostname + (url.port ? ':' + url.port : '')
      } catch {
        mediatorDisplay = mediatorUrl.substring(0, 38)
      }
      console.log(`║    Mediator:        ${this.padRight(mediatorDisplay, 43)}║`)
    } else {
      console.log(`║    DIDComm Port:    ${this.padRight(String(this.config.port), 43)}║`)
      console.log(`║    Public URL:      ${this.padRight(this.config.publicUrl.substring(0, 43), 43)}║`)
    }
    console.log(`║    Web UI Port:     ${this.padRight(String(this.config.webPort), 43)}║`)
    console.log(`║    TLS:             ${this.padRight(tlsStatus, 43)}║`)
    console.log(`║    Locality:        ${this.padRight(localityStatus, 43)}║`)
    console.log('╠══════════════════════════════════════════════════════════════════╣')
    console.log('║  PERSISTENCE                                                     ║')
    console.log(
      `║    Invitation:      ${this.padRight(
        this.config.invitationFile ? `${this.config.invitationFile} ${invitationFileExists ? '✓' : '✗'}` : '(disabled)',
        43
      )}║`
    )
    console.log(
      `║    Seed File:       ${this.padRight(
        seedFile ? `${seedFile.split('/').pop()} ${seedFileExists ? '✓' : '✗'}` : '(disabled)',
        43
      )}║`
    )
    const { dids: reportingDids, edges: reportingEdges } = this.reportingGraph.stats()
    const reportingStatus = this.config.reportingEnabled
      ? 'enabled — set WITNESS_REPORTING_ENABLED=false to disable'
      : 'DISABLED (WITNESS_REPORTING_ENABLED=false)'
    const reportingDirRelative = this.getRelativeWalletPath(path.join(process.cwd(), '.reporting'))
    console.log('╠══════════════════════════════════════════════════════════════════╣')
    console.log('║  REPORTING GRAPH (opt-in activity)                               ║')
    console.log(`║    Status:          ${this.padRight(reportingStatus, 43)}║`)
    console.log(`║    Storage:         ${this.padRight(reportingDirRelative, 43)}║`)
    console.log(`║    DIDs registered: ${this.padRight(String(reportingDids), 43)}║`)
    console.log(`║    Edges recorded:  ${this.padRight(String(reportingEdges), 43)}║`)
    if (invitationUrl || this.invitationUrl) {
      console.log('╠══════════════════════════════════════════════════════════════════╣')
      console.log('║  READY                                                           ║')
      const qrPageUrl = `${webScheme}://localhost:${this.config.webPort}/`
      console.log(`║    QR Page:         ${this.padRight(qrPageUrl, 43)}║`)
      console.log(`║    Fresh Start:     ${this.padRight('yarn fresh', 43)}║`)
    }
    console.log('╚══════════════════════════════════════════════════════════════════╝')
    console.log('')
  }

  private padRight(str: string, len: number): string {
    return str.padEnd(len).substring(0, len)
  }

  private truncateDid(did: string, maxLen: number = 45): string {
    if (did.length <= maxLen) return did
    const truncateAt = maxLen - 3
    return did.substring(0, truncateAt) + '...'
  }

  private getRelativeWalletPath(absolutePath: string): string {
    // Make path relative to witness-server directory
    // witness-server is at bifold/vrc_reference/witness-server/
    // wallets are at bifold/vrc_reference/.wallets/
    const path = require('path')
    const witnessServerDir = process.cwd()
    const relativePath = path.relative(witnessServerDir, absolutePath)

    return this.truncatePath(relativePath)
  }

  private truncatePath(path: string): string {
    if (path.length <= 45) return path
    // Truncate from the middle to keep the filename visible
    const fileName = path.split('/').pop() || ''
    const remaining = 45 - fileName.length - 3 // -3 for '...'
    if (remaining < 10) {
      // If path is too long, just show end
      return '...' + path.substring(path.length - 42)
    }
    const start = path.substring(0, remaining)
    return start + '...' + fileName
  }

  private getDidSourceLabel(source: DidSource): string {
    switch (source) {
      case 'CONFIGURED':
        return 'CONFIGURED (from WITNESS_ISSUER_DID)'
      case 'DERIVED_FROM_SEED':
        return 'DERIVED (from seed)'
      case 'AUTO_GENERATED':
        return 'AUTO_GENERATED (random did:peer)'
    }
  }

  private getKeySourceLabel(source: KeySource): string {
    switch (source) {
      case 'KEY_FILE':
        return `KEY_FILE (${this.config.issuerKeyFile})`
      case 'SEED_ENV':
        return 'SEED_ENV (WITNESS_ISSUER_SEED)'
      case 'AUTO_GENERATED':
        return 'AUTO_GENERATED (random)'
    }
  }

  /**
   * Create or import the dedicated issuer DID for signing VWCs
   *
   * Priority:
   * 1. config.issuerDid + key material → Import existing DID
   * 2. key material only → Create did:key from seed
   * 3. Nothing → Auto-generate random did:peer
   */
  private async ensureDedicatedIssuerDid(): Promise<void> {
    if (this.issuerDid && this.issuerVerificationMethodId) return

    // Load key material if available
    const seedHex = await this.loadKeyMaterial()

    if (this.config.issuerDid) {
      // Import existing DID with provided key material
      await this.importExistingDid(this.config.issuerDid, seedHex)
    } else if (seedHex) {
      // Derive did:peer from seed (deterministic, stable across restarts)
      await this.createDidPeerFromSeed(seedHex)
    } else {
      // Auto-generate random did:peer (default behavior)
      await this.createRandomPeerDid()
    }
  }

  /**
   * Load key material from config (seed env var or key file)
   * Priority: key file > seed env var > persisted seed file > none
   */
  private async loadKeyMaterial(): Promise<string | undefined> {
    // Priority 1: key file
    if (this.config.issuerKeyFile) {
      console.log(`[${this.name}] Loading key material from file: ${this.config.issuerKeyFile}`)
      const keyFile = loadKeyFile(this.config.issuerKeyFile)

      if (keyFile.seed) {
        return keyFile.seed
      } else if (keyFile.privateKeyHex) {
        // For Ed25519, the seed is the first 32 bytes of the private key
        return keyFile.privateKeyHex.substring(0, 64)
      } else if (keyFile.privateKeyBase64) {
        const decoded = Buffer.from(keyFile.privateKeyBase64, 'base64')
        return decoded.toString('hex').substring(0, 64)
      }
    }

    // Priority 2: seed env var
    if (this.config.issuerDidSeed) {
      console.log(`[${this.name}] Using key seed from WITNESS_ISSUER_SEED`)
      return this.config.issuerDidSeed
    }

    // Priority 3: persisted seed file (auto-generated, stable across restarts)
    const seedFile = this.getSeedFilePath()
    if (seedFile && existsSync(seedFile)) {
      try {
        const persistedSeed = this.loadPersistedSeed(seedFile)
        console.log(`[${this.name}] Loaded persisted seed from ${seedFile}`)
        console.log(`[${this.name}]   Created: ${persistedSeed.createdAt}`)
        console.log(`[${this.name}]   DID: ${persistedSeed.derivedDid}`)
        return persistedSeed.seed
      } catch (error) {
        console.warn(`[${this.name}] Failed to load seed from ${seedFile}: ${(error as Error).message}`)
        console.warn(`[${this.name}] Will generate new seed...`)
      }
    }

    return undefined
  }

  /**
   * Import an existing DID with provided key material
   * Note: The key will be created internally by Credo when importing the DID
   */
  private async importExistingDid(did: string, seedHex?: string): Promise<void> {
    const method = detectDidMethod(did)
    console.log(`[${this.name}] Importing existing DID: ${did}`)
    console.log(`[${this.name}]   Method: ${method}`)

    if (!seedHex) {
      throw new Error(
        `Cannot import DID ${did}: no key material provided (set WITNESS_ISSUER_SEED or WITNESS_ISSUER_KEY_FILE)`
      )
    }

    // Import the DID into the wallet
    // Credo will handle key creation internally based on the DID
    await this.agent.dids.import({
      did,
      overwrite: true,
    })

    // Get verification method ID
    const resolved = await this.agent.dids.resolve(did)
    if (!resolved.didDocument) {
      throw new Error(`Failed to resolve imported DID: ${did}`)
    }

    const assertionOrAuth = resolved.didDocument.assertionMethod?.[0] ?? resolved.didDocument.authentication?.[0]
    const verificationMethodId = typeof assertionOrAuth === 'string' ? assertionOrAuth : assertionOrAuth?.id

    if (!verificationMethodId) {
      throw new Error('No verification method available for the imported DID')
    }

    this.issuerDid = did
    this.issuerVerificationMethodId = verificationMethodId

    console.log(`[${this.name}]   ✓ DID imported successfully`)
  }

  /**
   * Verify that the provided key matches the DID document's public key
   */
  private async verifyKeyAgainstDidDocument(did: string, key: Key): Promise<void> {
    console.log(`[${this.name}]   Verifying key against DID document...`)

    const resolved = await this.agent.dids.resolve(did)
    if (!resolved.didDocument) {
      throw new Error(`Failed to resolve DID document for verification: ${did}`)
    }

    const verificationMethod = resolved.didDocument.verificationMethod?.[0]
    if (!verificationMethod) {
      throw new Error(`DID document has no verification methods: ${did}`)
    }

    // Extract public key from DID document
    const docPublicKey =
      verificationMethod.publicKeyMultibase ||
      verificationMethod.publicKeyBase58 ||
      (verificationMethod as any).publicKeyJwk?.x

    // Compare with our key
    const ourPublicKey = key.publicKeyBase58

    if (docPublicKey !== ourPublicKey) {
      console.log(`[${this.name}]   ✗ Key mismatch detected!`)
      console.log(`[${this.name}]     DID document key: ${String(docPublicKey).substring(0, 20)}...`)
      console.log(`[${this.name}]     Provided key:     ${ourPublicKey.substring(0, 20)}...`)
      throw new Error('Key does not match DID document public key')
    }

    console.log(`[${this.name}]   ✓ Key verified against DID document`)
  }

  /**
   * Get the seed file path (derives from invitation file path)
   */
  private getSeedFilePath(): string | undefined {
    if (!this.config.invitationFile) return undefined
    // Replace .oob-invitation.json with .witness-seed.json
    return this.config.invitationFile.replace(/\.oob-invitation\.json$/, '.witness-seed.json')
  }

  /**
   * Load persisted seed from disk with validation
   */
  private loadPersistedSeed(filePath: string): PersistedSeed {
    const content = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(content) as PersistedSeed

    if (!parsed.seed || !parsed.derivedDid) {
      throw new Error('Invalid seed file: missing seed or derivedDid')
    }

    // Check if config has changed since seed was created
    const currentConfigHash = this.computeConfigHash()
    if (parsed.configHash && parsed.configHash !== currentConfigHash) {
      throw new Error(`Config has changed since seed was created. Seed will be regenerated to match new invitation.`)
    }

    return parsed
  }

  /**
   * Persist seed to disk (synchronized with invitation persistence)
   */
  private persistSeed(seedHex: string): void {
    const seedFile = this.getSeedFilePath()
    if (!seedFile) return

    if (!this.issuerDid) {
      console.warn(`[${this.name}] Cannot persist seed: no DID created yet`)
      return
    }

    const data: PersistedSeed = {
      seed: seedHex,
      derivedDid: this.issuerDid,
      createdAt: new Date().toISOString(),
      configHash: this.computeConfigHash(),
    }

    try {
      writeFileSync(seedFile, JSON.stringify(data, null, 2), 'utf-8')
      console.log(`[${this.name}] Persisted seed to ${seedFile}`)
    } catch (error) {
      console.warn(`[${this.name}] Failed to persist seed: ${(error as Error).message}`)
    }
  }

  /**
   * Create a did:peer from a seed (deterministic, stable across restarts)
   * If the DID already exists in the wallet, it will be reused
   */
  private async createDidPeerFromSeed(seedHex: string): Promise<void> {
    console.log(`[${this.name}] Creating did:peer from seed...`)

    const seedBytes = TypedArrayEncoder.fromHex(seedHex)

    // Let Credo handle key creation internally during DID creation
    const result = await this.agent.dids.create({
      method: 'peer',
      options: {
        numAlgo: PeerDidNumAlgo.InceptionKeyWithoutDoc,
        keyType: KeyType.Ed25519,
      },
      secret: {
        seed: seedBytes,
      },
    })

    // If creation failed because key exists, find the existing DID
    if (result.didState?.state === 'failed' && result.didState.reason?.includes('Key already exists')) {
      console.log(`[${this.name}]   Key already exists in wallet, reusing existing DID...`)

      // Get all DIDs and find the one created from this seed
      const allDids = await this.agent.dids.getCreatedDids()
      const matchingDid = allDids.find(
        (record) => record.did.startsWith('did:peer:') && record.did.includes('z6Mk') // did:peer:0 uses multibase encoding
      )

      if (matchingDid) {
        console.log(`[${this.name}]   ✓ Reused existing DID: ${matchingDid.did}`)
        // Resolve to get verification method
        const resolved = await this.agent.dids.resolve(matchingDid.did)
        if (!resolved.didDocument) {
          throw new Error(`Failed to resolve existing DID: ${matchingDid.did}`)
        }

        const didDocument = resolved.didDocument
        const assertionOrAuth = didDocument.assertionMethod?.[0] ?? didDocument.authentication?.[0]
        const verificationMethodId = typeof assertionOrAuth === 'string' ? assertionOrAuth : assertionOrAuth?.id

        if (!verificationMethodId) {
          throw new Error('No verification method available for the existing did:peer')
        }

        this.issuerDid = matchingDid.did
        this.issuerVerificationMethodId = verificationMethodId
        return
      }

      // If we can't find it, throw the original error
      console.error(
        `[${this.name}] DID creation failed and couldn't find existing DID:`,
        JSON.stringify(result, null, 2)
      )
      throw new Error(`Failed to create did:peer from seed: ${result.didState?.state || 'unknown state'}`)
    }

    if (result.didState?.state !== 'finished' || !result.didState.did || !result.didState.didDocument) {
      console.error(`[${this.name}] DID creation failed:`, JSON.stringify(result, null, 2))
      throw new Error(`Failed to create did:peer from seed: ${result.didState?.state || 'unknown state'}`)
    }

    const didDocument = result.didState.didDocument
    const assertionOrAuth = didDocument.assertionMethod?.[0] ?? didDocument.authentication?.[0]
    const verificationMethodId = typeof assertionOrAuth === 'string' ? assertionOrAuth : assertionOrAuth?.id

    if (!verificationMethodId) {
      throw new Error('No verification method available for the created did:peer')
    }

    this.issuerDid = result.didState.did
    this.issuerVerificationMethodId = verificationMethodId

    console.log(`[${this.name}]   ✓ Created: ${this.issuerDid}`)

    // Persist seed for next restart (unless it was already persisted)
    const seedFile = this.getSeedFilePath()
    if (seedFile && !existsSync(seedFile)) {
      this.persistSeed(seedHex)
    }
  }

  /**
   * Create a random did:peer and persist seed (default behavior - zero config)
   * If wallet already has DIDs (e.g., after fresh command that deleted seed file), reuses them
   */
  private async createRandomPeerDid(): Promise<void> {
    console.log(`[${this.name}] Auto-generating random did:peer...`)

    // Check if wallet already has did:peer DIDs (e.g., seed file was deleted but wallet persists)
    const existingDids = await this.agent.dids.getCreatedDids()
    const existingPeerDid = existingDids.find(
      (record) => record.did.startsWith('did:peer:') && record.did.includes('z6Mk')
    )

    if (existingPeerDid) {
      console.log(`[${this.name}]   Wallet already has did:peer, reusing: ${existingPeerDid.did}`)

      // Resolve to get verification method
      const resolved = await this.agent.dids.resolve(existingPeerDid.did)
      if (!resolved.didDocument) {
        throw new Error(`Failed to resolve existing DID: ${existingPeerDid.did}`)
      }

      const didDocument = resolved.didDocument
      const assertionOrAuth = didDocument.assertionMethod?.[0] ?? didDocument.authentication?.[0]
      const verificationMethodId = typeof assertionOrAuth === 'string' ? assertionOrAuth : assertionOrAuth?.id

      if (!verificationMethodId) {
        throw new Error('No verification method available for the existing did:peer')
      }

      this.issuerDid = existingPeerDid.did
      this.issuerVerificationMethodId = verificationMethodId

      // Try to get the key - it should already exist in wallet
      // We can't easily retrieve the original seed, but the key is already in the wallet
      console.log(`[${this.name}]   ✓ Reused existing DID and key from wallet`)

      // Note: issuerKey remains undefined since we can't retrieve it, but it's not needed
      // for the current implementation (DIDComm doesn't require signing announcements)

      return
    }

    // No existing DID - generate new one
    // Generate random seed for deterministic DID creation
    const seedBuffer = randomBytes(32)
    const seedHex = seedBuffer.toString('hex')
    const seedBytes = TypedArrayEncoder.fromHex(seedHex)

    // Let Credo handle key creation internally during DID creation
    const result = await this.agent.dids.create({
      method: 'peer',
      options: {
        numAlgo: PeerDidNumAlgo.InceptionKeyWithoutDoc,
        keyType: KeyType.Ed25519,
      },
      secret: {
        seed: seedBytes,
      },
    })

    if (result.didState?.state !== 'finished' || !result.didState.did || !result.didState.didDocument) {
      console.error(`[${this.name}] DID creation failed:`, JSON.stringify(result, null, 2))
      throw new Error(`Failed to create dedicated issuer DID: ${result.didState?.state || 'unknown state'}`)
    }

    const didDocument = result.didState.didDocument
    const assertionOrAuth = didDocument.assertionMethod?.[0] ?? didDocument.authentication?.[0]
    const verificationMethodId = typeof assertionOrAuth === 'string' ? assertionOrAuth : assertionOrAuth?.id

    if (!verificationMethodId) {
      throw new Error('No verification method available for the witness issuer DID')
    }

    this.issuerDid = result.didState.did
    this.issuerVerificationMethodId = verificationMethodId

    console.log(`[${this.name}]   ✓ Created: ${this.issuerDid}`)

    // Auto-persist the seed for stability across restarts
    this.persistSeed(seedHex)
  }

  /**
   * Register DIDComm message handlers for witnessed exchange protocol
   */
  private registerMessageHandlers(): void {
    // Listen for connection state changes to send witness announcement
    this.agent.events.on<ConnectionStateChangedEvent>(
      ConnectionEventTypes.ConnectionStateChanged,
      async ({ payload }) => {
        const { connectionRecord, previousState } = payload

        // Only send witness announcement when connection becomes completed (not on re-connections)
        if (connectionRecord.state === 'completed' && previousState !== 'completed') {
          const peerLabel = connectionRecord.theirLabel || 'Unknown'
          const peerDid = connectionRecord.theirDid ? connectionRecord.theirDid.substring(0, 40) + '...' : 'pending'

          console.log(`[${this.name}] ════════════════════════════════════════`)
          console.log(`[${this.name}] 🤝 NEW PARTICIPANT CONNECTED`)
          console.log(`[${this.name}]   Name: ${peerLabel}`)
          console.log(`[${this.name}]   DID:  ${peerDid}`)
          console.log(`[${this.name}]   Connection ID: ${connectionRecord.id}`)
          console.log(`[${this.name}] ════════════════════════════════════════`)

          // NOTE: We intentionally do NOT notify the dashboard broadcaster here.
          // The dashboard only shows opted-in participants (those who have registered
          // a reporting DID). Nodes are added to the dashboard when a participant
          // sends a reporting-did-registration message, using their pseudonym —
          // never the wallet name.

          try {
            // Build the announcement message
            // Note: No signature needed - DIDComm already provides authenticated encryption
            const announcement = {
              type: 'witness-announcement',
              witness: {
                name: this.name,
                did: this.issuerDid,
                eventName: this.config.eventName || null,
                eventStartTime: this.config.eventStartTime?.toISOString() || null,
                eventEndTime: this.config.eventEndTime?.toISOString() || null,
                capabilities: ['witnessed-vrc-exchange'],
                version: '1.0',
              },
              timestamp: new Date().toISOString(),
            }

            await this.agent.basicMessages.sendMessage(connectionRecord.id, JSON.stringify(announcement))
            console.log(`[${this.name}] ✓ Sent witness-announcement to ${peerLabel}`)

            // Send human-readable welcome messages after the machine-readable announcement
            // These appear as regular chat messages in the witness channel
            const eventName = this.config.eventName || 'this event'

            const welcomeMessage =
              `Welcome to ${eventName}! 🎉\n\n` +
              `I'm the ${this.name}. I am verifying credential exchanges during this event.\n\n` +
              `You're all set — go connect with others!`

            await new Promise((resolve) => setTimeout(resolve, 750))
            await this.agent.basicMessages.sendMessage(connectionRecord.id, welcomeMessage)
            console.log(`[${this.name}] ✓ Sent welcome message to ${peerLabel}`)
          } catch (error) {
            console.error(`[${this.name}] Failed to send witness announcement:`, error)
          }
        }
      }
    )

    // Listen for basic messages for witnessed exchange protocol
    this.agent.events.on<BasicMessageStateChangedEvent>(
      BasicMessageEventTypes.BasicMessageStateChanged,
      async ({ payload }) => {
        const { basicMessageRecord, message } = payload

        // Only process received messages
        if (basicMessageRecord.role !== 'receiver') return

        const connectionId = basicMessageRecord.connectionId
        const content = message.content
        const messageId = basicMessageRecord.id

        // Get connection info for friendly logging
        let peerName = 'Unknown'
        try {
          const conn = await this.agent.connections.getById(connectionId)
          peerName = conn.theirLabel || 'Unknown'
        } catch {
          // Connection lookup failed, use default
        }

        try {
          const parsedMessage = JSON.parse(content)
          const msgType = parsedMessage.type || '(unknown)'

          // Log received message with peer name
          console.log(`[${this.name}] ← ${msgType} from ${peerName}`)

          // Handle session-request (participant-initiated)
          if (parsedMessage.type === 'session-request') {
            await this.handleSessionRequest(connectionId, parsedMessage)
            await this.deleteMessageRecord(messageId, 'session-request')
            return
          }

          // Handle submit-presentation
          if (parsedMessage.type === 'submit-presentation' && parsedMessage.presentation) {
            // reportingDid is optional — only present when the participant opted in to reporting
            await this.handlePresentationSubmission(
              connectionId,
              parsedMessage.presentation,
              parsedMessage.reportingDid
            )
            await this.deleteMessageRecord(messageId, 'submit-presentation')
            return
          }

          // Handle reporting-did-registration (opt-in activity reporting)
          if (parsedMessage.type === 'reporting-did-registration') {
            if (!this.config.reportingEnabled) {
              console.log(
                `[${this.name}] ℹ Reporting is disabled at server level — ignoring reporting-did-registration from ${peerName}`
              )
              await this.deleteMessageRecord(messageId, 'reporting-did-registration')
              return
            }
            const { reportingDid } = parsedMessage
            if (typeof reportingDid === 'string' && reportingDid.startsWith('did:')) {
              this.reportingGraph.registerReportingDid(connectionId, reportingDid)
              const { dids, edges } = this.reportingGraph.stats()
              console.log(`[${this.name}] ✓ Reporting DID registered for ${peerName}: ${reportingDid}`)
              console.log(`[${this.name}]   Reporting graph: ${dids} DID(s) registered, ${edges} edge(s) recorded`)

              // Notify dashboard broadcaster with pseudonym label — never the wallet name.
              // The reporting DID is the stable pseudonymous identity for this participant;
              // it becomes the node ID in the live dashboard graph.
              if (this.onWalletConnectedCallback) {
                const display = pseudonymDisplay(reportingDid)
                this.onWalletConnectedCallback(reportingDid, display.label.replace('\n', ' '))
              }
            } else {
              console.warn(
                `[${this.name}] Invalid reporting-did-registration from ${peerName}: ${JSON.stringify(parsedMessage)}`
              )
            }
            await this.deleteMessageRecord(messageId, 'reporting-did-registration')
            return // protocol message — do not echo back
          }

          // Handle verify-credential request
          if (parsedMessage.type === 'verify-credential') {
            await this.handleVerifyCredentialRequest(connectionId, parsedMessage)
            await this.deleteMessageRecord(messageId, 'verify-credential')
            return
          }

          // Unknown JSON message type
          console.log(`[${this.name}] 💬 ${peerName}: ${content.substring(0, 200)}`)
          await this.agent.basicMessages.sendMessage(
            connectionId,
            'Thanks for your message! If you have feedback about the Keyring, please share it here: https://forms.gle/KWEDvvmDUVSMz4VK9'
          )
          await this.deleteMessageRecord(messageId, 'feedback message')
        } catch (parseError) {
          // Plain text message — handle with LLM if enabled, otherwise use fallback
          console.log(`[${this.name}] 💬 ${peerName}: ${content}`)

          if (this.llmService?.isEnabled()) {
            // Use AI-powered response
            try {
              const aiResponse = await this.llmService.generateResponse(connectionId, content)

              // Debug logging (verbose mode only)
              if (this.config.verbose) {
                console.log(`[${this.name}] 🤖 AI response generated, length: ${aiResponse.length}`)
                console.log(`[${this.name}] 🤖 AI response preview: ${aiResponse.substring(0, 100)}...`)
                console.log(`[${this.name}] 🤖 Sending to connectionId: ${connectionId}`)
              }

              const sentMessage = await this.agent.basicMessages.sendMessage(connectionId, aiResponse)

              if (this.config.verbose) {
                console.log(
                  `[${this.name}] 🤖 basicMessages.sendMessage returned:`,
                  JSON.stringify({
                    id: sentMessage?.id,
                    role: sentMessage?.role,
                    content: sentMessage?.content?.substring(0, 50),
                  })
                )
              }
              console.log(`[${this.name}] 🤖 AI response sent to ${peerName}`)
            } catch (llmError) {
              console.error(`[${this.name}] LLM error:`, llmError)
              // Fallback to default message if LLM fails
              await this.agent.basicMessages.sendMessage(
                connectionId,
                'Thanks for your message! If you have feedback about the Keyring, please share it here: https://forms.gle/KWEDvvmDUVSMz4VK9'
              )
            }
          } else {
            // LLM disabled - use default response
            await this.agent.basicMessages.sendMessage(
              connectionId,
              'Thanks for your message! If you have feedback about the Keyring, please share it here: https://forms.gle/KWEDvvmDUVSMz4VK9'
            )
          }
          await this.deleteMessageRecord(messageId, 'plain text message')
        }
      }
    )
  }

  /**
   * Set the locality service reference
   */
  public setLocalityService(localityService: LocalityService): void {
    this.localityService = localityService
  }

  /**
   * Handle session-request from a participant
   * The participant must specify both their relationship DID and counterparty's relationship DID
   *
   * The optional `witness` field (default: true) indicates:
   * - true: Request full witnessed exchange with VWC issuance
   * - false: Record edge in network graph only (no VWC issued)
   */
  private async handleSessionRequest(
    initiatorConnectionId: string,
    message: { myRelationshipDid: string; counterpartyDid: string; witness?: boolean }
  ): Promise<void> {
    const { myRelationshipDid, counterpartyDid, witness = true } = message

    console.log(`[${this.name}] ========================================`)
    console.log(`[${this.name}] PROCESSING SESSION-REQUEST`)
    console.log(`[${this.name}]   From connection: ${initiatorConnectionId}`)
    console.log(`[${this.name}]   My relationship DID: ${myRelationshipDid}`)
    console.log(`[${this.name}]   Looking for counterparty DID: ${counterpartyDid}`)
    console.log(
      `[${this.name}]   Witness requested: ${witness ? 'YES (VWC will be issued)' : 'NO (edge recording only)'}`
    )

    // ── Event time window check ──────────────────────────────────────────────
    const now = new Date()
    if (this.config.eventStartTime && now < this.config.eventStartTime) {
      const startIso = this.config.eventStartTime.toISOString()
      console.log(`[${this.name}]   ✗ Session request rejected: event has not started (starts ${startIso})`)
      await this.agent.basicMessages.sendMessage(
        initiatorConnectionId,
        JSON.stringify({
          type: 'error',
          code: 'event-not-started',
          message: `The event has not started yet. Witnessing begins at ${startIso}.`,
          eventStartTime: startIso,
        })
      )
      return
    }

    if (this.config.eventEndTime && now > this.config.eventEndTime) {
      const endIso = this.config.eventEndTime.toISOString()
      console.log(`[${this.name}]   ✗ Session request rejected: event has ended (ended ${endIso})`)
      await this.agent.basicMessages.sendMessage(
        initiatorConnectionId,
        JSON.stringify({
          type: 'error',
          code: 'event-ended',
          message: `The event has ended. Witnessing ended at ${endIso}.`,
          eventEndTime: endIso,
        })
      )
      return
    }
    // ── End of event time window check ──────────────────────────────────────

    // Verify initiator connection exists
    const initiatorConnection = await this.agent.connections.findById(initiatorConnectionId)

    if (!initiatorConnection) {
      console.log(`[${this.name}]   ✗ Initiator connection not found!`)
      await this.sendErrorMessage(initiatorConnectionId, 'Session request failed: Your connection not found')
      return
    }

    console.log(`[${this.name}]   ✓ Initiator connection found`)

    // Register initiator's relationship DID
    this.relationshipDidRegistry.set(myRelationshipDid, initiatorConnectionId)
    console.log(`[${this.name}]   ✓ Registered: ${myRelationshipDid} → ${initiatorConnectionId}`)

    // Check if counterparty is already registered
    const counterpartyConnectionId = this.relationshipDidRegistry.get(counterpartyDid)

    if (!counterpartyConnectionId) {
      // Counterparty not registered yet - store as pending request
      console.log(`[${this.name}]   ⏳ Counterparty not registered yet, storing pending request`)

      this.pendingSessionRequests.set(counterpartyDid, {
        initiatorConnectionId,
        initiatorRelationshipDid: myRelationshipDid,
        counterpartyRelationshipDid: counterpartyDid,
        initiatorWitnessPreference: witness, // Store initiator's witness preference
        timestamp: new Date(),
      })

      console.log(`[${this.name}]   Waiting for counterparty ${counterpartyDid} to send session-request`)
      console.log(`[${this.name}] ========================================`)
      return
    }

    console.log(`[${this.name}]   ✓ Found counterparty connection: ${counterpartyConnectionId}`)

    // Verify counterparty connection is completed
    const counterpartyConnection = await this.agent.connections.findById(counterpartyConnectionId)
    if (!counterpartyConnection || counterpartyConnection.state !== 'completed') {
      console.log(`[${this.name}]   ✗ Counterparty connection not ready`)
      await this.sendErrorMessage(initiatorConnectionId, 'Session request failed: Counterparty not connected')
      return
    }

    // Retrieve the pending request to get the initiator's witness preference
    const existingRequest = this.pendingSessionRequests.get(counterpartyDid)
    const initiatorWitnessPref = existingRequest?.initiatorWitnessPreference ?? true

    // If locality verification is required, verify both participants have valid proofs
    if (this.config.localityVerificationRequired && this.localityService?.isEnabled()) {
      const initiatorDid = initiatorConnection.theirDid
      const counterpartyDid = counterpartyConnection.theirDid

      if (!initiatorDid || !this.localityService.hasValidProof(initiatorDid)) {
        console.log(`[${this.name}] ✗ Co-locality verification required for initiator ${initiatorDid}`)
        await this.sendErrorMessage(
          initiatorConnectionId,
          JSON.stringify({
            type: 'error',
            code: 'locality-verification-required',
            message: 'You must verify co-location with the witness before creating a session',
            instructions: 'Use the BLE proximity transport to prove co-location with the witness',
          })
        )
        return
      }

      if (!counterpartyDid || !this.localityService.hasValidProof(counterpartyDid)) {
        console.log(`[${this.name}] ✗ Co-locality verification required for counterparty ${counterpartyDid}`)
        await this.sendErrorMessage(
          initiatorConnectionId,
          JSON.stringify({
            type: 'error',
            code: 'locality-verification-required',
            message: 'Counterparty must verify co-location with the witness before creating a session',
            instructions: 'Counterparty must use the BLE proximity transport to prove co-location with the witness',
          })
        )
        return
      }

      console.log(`[${this.name}] ✓ Locality verified for both participants`)
    } else if (!this.config.localityVerificationRequired) {
      console.log(`[${this.name}] ℹ Locality verification not required (WITNESS_LOCALITY_REQUIRED=false)`)
    }

    // Both parties are registered - create session!
    console.log(`[${this.name}]   ✓ Both parties registered, creating session`)
    // Pass both preferences: initiator's from stored request, counterparty's from current message
    const { sessionId } = await this.createWitnessedSession(
      initiatorConnectionId,
      counterpartyConnectionId,
      initiatorWitnessPref, // Initiator's witness preference
      witness // Counterparty's witness preference (from this message)
    )

    console.log(`[${this.name}] Created session ${sessionId}`)

    // Notify dashboard about session creation
    if (this.onSessionCreatedCallback) {
      this.onSessionCreatedCallback(sessionId, initiatorConnectionId, counterpartyConnectionId)
    }

    // Clean up pending requests for both parties
    this.pendingSessionRequests.delete(myRelationshipDid)
    this.pendingSessionRequests.delete(counterpartyDid)

    console.log(`[${this.name}] ========================================`)
  }

  /**
   * Handle presentation submission from a participant
   *
   * @param connectionId  Witness connection of the submitting participant
   * @param presentation  The VP payload
   * @param reportingDid  Optional reporting DID included by the participant when reporting is enabled.
   *                      A graph edge is recorded only when BOTH participants provide this.
   */
  private async handlePresentationSubmission(
    connectionId: string,
    presentation: any,
    reportingDid?: string
  ): Promise<void> {
    console.log(`[${this.name}] Received presentation from connection ${connectionId}`)
    if (reportingDid) {
      console.log(`[${this.name}]   Participant included reportingDid: ${reportingDid}`)
    }

    const result = await this.verifyPresentation(connectionId, presentation)

    if (result.verified) {
      console.log(`[${this.name}] ✓ Presentation verified for session ${result.sessionId}`)

      // Store the reporting DID and attestation status in the session
      if (result.sessionId) {
        const session = this.activeSessions.get(result.sessionId)
        if (session) {
          // Check if this presentation includes hardware attestation evidence
          const credentials = presentation.verifiableCredential || []
          const vrcJson = credentials[0]
          const hasAttestation = vrcJson && Array.isArray(vrcJson.evidence) && vrcJson.evidence.length > 0
          session.receivedAttestations.set(connectionId, hasAttestation)

          if (hasAttestation) {
            console.log(`[${this.name}]   Participant ${connectionId} included hardware attestation evidence`)
          } else {
            console.log(`[${this.name}]   Participant ${connectionId} did not include hardware attestation evidence`)
          }

          // Store reporting DID if provided
          if (reportingDid) {
            session.receivedReportingDids.set(connectionId, reportingDid)
            console.log(
              `[${this.name}]   Stored reportingDid for connection ${connectionId} in session ${result.sessionId}`
            )
          }

          // Mark whether this participant requested witness credentials
          // Note: We determine this from the session request stored earlier.
          // If not already stored, default to false (no VWC issued) - participant must explicitly request.
          // The witnessRequested map tracks per-participant preferences.
          if (!session.witnessRequested.has(connectionId)) {
            session.witnessRequested.set(connectionId, false)
            console.log(
              `[${this.name}]   Participant ${connectionId} did not request witness credentials (VWC will not be issued)`
            )
          }

          // Also register in the persistent reporting graph so that the live dashboard
          // can look up the reporting DID from the connection ID when the session
          // completes.  Without this, wallets that send their reportingDid via
          // submit-presentation (rather than a separate reporting-did-registration
          // message) would be invisible on the live dashboard because
          // reportingGraph.getReportingDid(connectionId) returns undefined.
          if (this.config.reportingEnabled && reportingDid) {
            this.reportingGraph.registerReportingDid(connectionId, reportingDid)

            // Notify the dashboard broadcaster so the wallet node appears immediately,
            // using the pseudonym — never the wallet label or connection ID.
            if (this.onWalletConnectedCallback) {
              const display = pseudonymDisplay(reportingDid)
              this.onWalletConnectedCallback(reportingDid, display.label.replace('\n', ' '))
            }
          }
        }
      }

      // Check if we have both presentations - auto-issue VWCs
      if (result.sessionId) {
        const session = this.activeSessions.get(result.sessionId)
        if (session && session.receivedPresentations.size >= 2) {
          console.log(`[${this.name}] Session ${result.sessionId} complete - auto-issuing VWCs...`)
          await this.issueWitnessCredentials(result.sessionId)
        }
      }
    } else {
      console.log(`[${this.name}] ✗ Presentation verification failed: ${result.error}`)
      await this.sendErrorMessage(connectionId, `Presentation rejected: ${result.error}`)
    }
  }

  /**
   * Handle verify-credential request via DIDComm
   */
  private async handleVerifyCredentialRequest(
    connectionId: string,
    message: { credential?: any; credentialId?: string; digest?: string }
  ): Promise<void> {
    console.log(`[${this.name}] Received verify-credential request from ${connectionId}`)

    let result: RegistryVerificationResult

    if (message.credential) {
      // Full credential verification
      result = await this.verifyWitnessCredential(message.credential)
    } else if (message.credentialId) {
      // Lookup by VWC ID
      result = this.verifyByCredentialId(message.credentialId)
    } else if (message.digest) {
      // Lookup by VRC digest
      result = this.verifyByDigest(message.digest)
    } else {
      result = {
        verified: false,
        issuerMatch: false,
        inRegistry: false,
        error: 'Must provide credential, credentialId, or digest',
      }
    }

    // Send response
    const response = {
      type: 'verify-credential-response',
      ...result,
    }

    await this.agent.basicMessages.sendMessage(connectionId, JSON.stringify(response))
    console.log(`[${this.name}] Sent verify-credential-response: verified=${result.verified}`)
  }

  /**
   * Verify a full Witness Credential (VWC)
   */
  public async verifyWitnessCredential(credential: any): Promise<RegistryVerificationResult> {
    try {
      // Check issuer matches
      const issuer = typeof credential.issuer === 'string' ? credential.issuer : credential.issuer?.id
      const issuerMatch = issuer === this.issuerDid

      if (!issuerMatch) {
        return {
          verified: false,
          issuerMatch: false,
          inRegistry: false,
          error: `Credential issuer ${issuer} does not match this witness (${this.issuerDid})`,
        }
      }

      // Check if in registry
      const vwcId = credential.id
      const record = vwcId ? this.credentialRegistry.findByVwcId(vwcId) : undefined
      const inRegistry = !!record

      // Verify signature cryptographically
      let signatureValid = false
      try {
        const vwcCredential = JsonTransformer.fromJSON(credential, W3cJsonLdVerifiableCredential)
        const verificationResult = await this.agent.w3cCredentials.verifyCredential({
          credential: vwcCredential as any,
        })
        signatureValid = verificationResult.isValid
      } catch (verifyError) {
        console.log(`[${this.name}] Signature verification error: ${(verifyError as Error).message}`)
      }

      return {
        verified: issuerMatch && (inRegistry || signatureValid),
        issuerMatch,
        inRegistry,
        issuedAt: record?.issuedAt?.toISOString(),
        sessionId: record?.sessionId,
      }
    } catch (error) {
      return {
        verified: false,
        issuerMatch: false,
        inRegistry: false,
        error: (error as Error).message,
      }
    }
  }

  /**
   * Verify by VWC ID (registry lookup only)
   */
  public verifyByCredentialId(credentialId: string): RegistryVerificationResult {
    const record = this.credentialRegistry.findByVwcId(credentialId)

    if (record) {
      return {
        verified: true,
        issuerMatch: true,
        inRegistry: true,
        issuedAt: record.issuedAt.toISOString(),
        sessionId: record.sessionId,
      }
    }

    return {
      verified: false,
      issuerMatch: false,
      inRegistry: false,
      error: `Credential ID ${credentialId} not found in registry`,
    }
  }

  /**
   * Verify by VRC digest (registry lookup only)
   */
  public verifyByDigest(digest: string): RegistryVerificationResult {
    const records = this.credentialRegistry.findByDigest(digest)

    if (records.length > 0) {
      const record = records[0]
      return {
        verified: true,
        issuerMatch: true,
        inRegistry: true,
        issuedAt: record.issuedAt.toISOString(),
        sessionId: record.sessionId,
      }
    }

    return {
      verified: false,
      issuerMatch: false,
      inRegistry: false,
      error: `No credential found for VRC digest ${digest}`,
    }
  }

  /**
   * Send an error message to a connection
   */
  private async sendErrorMessage(connectionId: string, error: string): Promise<void> {
    try {
      await this.agent.basicMessages.sendMessage(connectionId, JSON.stringify({ type: 'error', error }))
    } catch {
      console.log(`[${this.name}] Failed to send error message to ${connectionId}`)
    }
  }

  /**
   * Look up a relationship DID by connection ID
   * Used for logging participant roles without exposing credential data
   */
  private getRelationshipDidForConnection(connectionId: string): string | undefined {
    for (const [relDid, connId] of this.relationshipDidRegistry.entries()) {
      if (connId === connectionId) {
        return relDid
      }
    }
    return undefined
  }

  // ============================================
  // Connection Management
  // ============================================

  /**
   * Create a reusable connection invitation (for QR code)
   *
   * If invitationFile is configured and exists, loads the invitation from disk.
   * Otherwise, creates a new invitation and persists it for stability across restarts.
   *
   * Returns the HTTP invitation URL (for QR codes and direct use)
   */
  public async createReusableInvitation(): Promise<string> {
    const invitationFile = this.config.invitationFile

    // Try to load existing invitation from disk
    if (invitationFile && existsSync(invitationFile)) {
      try {
        const savedInvitation = this.loadPersistedInvitation(invitationFile)
        this.invitationUrl = savedInvitation.invitationUrl
        this.outOfBandId = savedInvitation.outOfBandId

        console.log(`[${this.name}] Loaded existing invitation from ${invitationFile}`)
        console.log(`[${this.name}]   Created: ${savedInvitation.createdAt}`)
        console.log(`[${this.name}]   OOB ID: ${this.outOfBandId}`)

        // Verify the OOB record actually exists in the wallet
        // If wallet was wiped but file still exists, this will fail
        try {
          const outOfBandRecord = await this.agent.oob.findById(this.outOfBandId)
          if (!outOfBandRecord) {
            throw new Error('OOB record not found in wallet')
          }
          console.log(`[${this.name}]   ✓ OOB record verified in wallet`)
          console.log(`[${this.name}] Invitation URL: ${this.invitationUrl}`)
          return this.invitationUrl
        } catch (oobError) {
          console.warn(`[${this.name}] ⚠ OOB record validation failed: ${(oobError as Error).message}`)
          console.warn(`[${this.name}] This usually means the wallet was wiped but persisted files remain`)
          console.warn(`[${this.name}] Deleting out-of-sync files and regenerating...`)

          // Delete both invitation and seed files (they're synchronized)
          const seedFile = this.getSeedFilePath()
          if (existsSync(invitationFile)) {
            unlinkSync(invitationFile)
            console.log(`[${this.name}]   Deleted ${invitationFile}`)
          }
          if (seedFile && existsSync(seedFile)) {
            unlinkSync(seedFile)
            console.log(`[${this.name}]   Deleted ${seedFile}`)
          }

          // Clear in-memory state and fall through to regenerate
          this.invitationUrl = undefined
          this.outOfBandId = undefined
        }
      } catch (error) {
        console.warn(`[${this.name}] Failed to load invitation from ${invitationFile}: ${(error as Error).message}`)
        console.warn(`[${this.name}] Creating new invitation...`)
      }
    }

    // Create new invitation
    const outOfBand = await this.agent.oob.createInvitation({
      multiUseInvitation: true,
    })

    this.outOfBandId = outOfBand.id
    this.invitationUrl = outOfBand.outOfBandInvitation.toUrl({
      domain: this.config.publicUrl,
    })

    console.log(`[${this.name}] Created reusable invitation`)
    console.log(`[${this.name}] Invitation URL: ${this.invitationUrl}`)

    // Persist invitation to disk for stability across restarts
    if (invitationFile) {
      this.persistInvitation(invitationFile)
    }

    return this.invitationUrl
  }

  /**
   * Get the deep link version of the invitation URL using keyring:// scheme
   * This uses Credo's toUrl() method with the keyring:// domain
   */
  public async getInvitationDeepLink(): Promise<string> {
    if (!this.outOfBandId) {
      throw new Error('No invitation created yet. Call createReusableInvitation() first.')
    }

    // Get the out-of-band record by ID
    const outOfBandRecord = await this.agent.oob.findById(this.outOfBandId)
    if (!outOfBandRecord) {
      throw new Error(`Out-of-band record not found: ${this.outOfBandId}`)
    }

    // Use Credo's toUrl() method with keyring:// domain
    return outOfBandRecord.outOfBandInvitation.toUrl({
      domain: 'keyring://',
    })
  }

  /**
   * Compute a hash of config values that affect the invitation
   * If any of these change, the cached invitation should be invalidated
   */
  private computeConfigHash(): string {
    const relevantConfig = {
      publicUrl: this.config.publicUrl,
      port: this.config.port,
      name: this.config.name,
      mediatorInvitationUrl: this.config.mediatorInvitationUrl,
    }
    const configString = JSON.stringify(relevantConfig, Object.keys(relevantConfig).sort())
    return createHash('sha256').update(configString).digest('hex').substring(0, 16)
  }

  /**
   * Load a persisted invitation from disk
   * Validates that the config hasn't changed since the invitation was created
   */
  private loadPersistedInvitation(filePath: string): PersistedInvitation {
    const content = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(content) as PersistedInvitation

    if (!parsed.invitationUrl || !parsed.outOfBandId) {
      throw new Error('Invalid invitation file: missing invitationUrl or outOfBandId')
    }

    // Check if config has changed since invitation was created
    const currentConfigHash = this.computeConfigHash()
    if (parsed.configHash && parsed.configHash !== currentConfigHash) {
      throw new Error(
        `Config has changed since invitation was created (expected hash: ${parsed.configHash}, current: ${currentConfigHash}). Invitation will be regenerated.`
      )
    }

    return parsed
  }

  /**
   * Persist an invitation to disk
   */
  private persistInvitation(filePath: string): void {
    if (!this.invitationUrl || !this.outOfBandId) {
      console.warn(`[${this.name}] Cannot persist invitation: no invitation created yet`)
      return
    }

    const data: PersistedInvitation = {
      invitationUrl: this.invitationUrl,
      outOfBandId: this.outOfBandId,
      createdAt: new Date().toISOString(),
      configHash: this.computeConfigHash(),
    }

    try {
      writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
      console.log(`[${this.name}] Persisted invitation to ${filePath}`)
    } catch (error) {
      console.warn(`[${this.name}] Failed to persist invitation: ${(error as Error).message}`)
    }
  }

  /**
   * Reset the persisted invitation (delete file and create new invitation)
   * Also deletes the seed file to ensure DID and invitation stay synchronized
   * Call this to generate a fresh invitation URL
   */
  public async resetInvitation(): Promise<string> {
    const invitationFile = this.config.invitationFile
    const seedFile = this.getSeedFilePath()

    // Delete existing invitation file if present
    if (invitationFile && existsSync(invitationFile)) {
      try {
        unlinkSync(invitationFile)
        console.log(`[${this.name}] Deleted existing invitation file: ${invitationFile}`)
      } catch (error) {
        console.warn(`[${this.name}] Failed to delete invitation file: ${(error as Error).message}`)
      }
    }

    // Delete existing seed file if present (to regenerate DID with new invitation)
    if (seedFile && existsSync(seedFile)) {
      try {
        unlinkSync(seedFile)
        console.log(`[${this.name}] Deleted existing seed file: ${seedFile}`)
      } catch (error) {
        console.warn(`[${this.name}] Failed to delete seed file: ${(error as Error).message}`)
      }
    }

    // Clear in-memory state
    this.invitationUrl = undefined
    this.outOfBandId = undefined

    // Create fresh invitation (will also generate and persist new seed)
    return this.createReusableInvitation()
  }

  /**
   * Create a single-use connection invitation
   */
  public async createConnectionInvitation(): Promise<string> {
    const outOfBand = await this.agent.oob.createInvitation()
    const invitationUrl = outOfBand.outOfBandInvitation.toUrl({
      domain: this.config.publicUrl,
    })

    console.log(`[${this.name}] Created connection invitation`)
    return invitationUrl
  }

  /**
   * Get the current reusable invitation URL
   */
  public getInvitationUrl(): string | undefined {
    return this.invitationUrl
  }

  /**
   * Get all active connections
   */
  public async getConnections(): Promise<ConnectionRecord[]> {
    return this.agent.connections.getAll()
  }

  /**
   * Get the witness issuer DID
   */
  public getIssuerDid(): string | undefined {
    return this.issuerDid
  }

  // ============================================
  // Session Management
  // ============================================

  /**
   * Create a witnessed session between two participants
   *
   * @param aliceConnectionId - Connection ID of the first participant (initiator)
   * @param bobConnectionId - Connection ID of the second participant (counterparty)
   * @param initiatorWitnessPreference - The witness preference from the initiator's session-request
   * @param counterpartyWitnessPreference - The witness preference from the counterparty's session-request
   */
  public async createWitnessedSession(
    aliceConnectionId: string,
    bobConnectionId: string,
    initiatorWitnessPreference: boolean = true,
    counterpartyWitnessPreference: boolean = true
  ): Promise<{ sessionId: string; challenge: string; domain: string }> {
    const sessionId = utils.uuid()
    const challenge = utils.uuid()
    const domain = `witness-session-${this.port}`

    const expirationMinutes = this.config.sessionExpirationMinutes ?? DEFAULT_SESSION_EXPIRATION_MINUTES

    const sessionData: SessionData = {
      sessionId,
      challenge,
      domain,
      participants: new Set([aliceConnectionId, bobConnectionId]),
      receivedPresentations: new Map(),
      receivedReportingDids: new Map(),
      receivedAttestations: new Map(),
      witnessRequested: new Map(),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + expirationMinutes * 60 * 1000),
    }

    // Store both participants' witness preferences
    sessionData.witnessRequested.set(aliceConnectionId, initiatorWitnessPreference)
    sessionData.witnessRequested.set(bobConnectionId, counterpartyWitnessPreference)

    // Evict any stale sessions that share a participant with the new session
    for (const [existingId, existing] of this.activeSessions) {
      for (const participantId of sessionData.participants) {
        if (existing.participants.has(participantId)) {
          console.log(`[${this.name}] Evicting stale session ${existingId} (overlapping participant ${participantId})`)
          this.activeSessions.delete(existingId)
          break
        }
      }
    }

    this.activeSessions.set(sessionId, sessionData)

    console.log(`[${this.name}] Created witnessed session: ${sessionId}`)
    console.log(`[${this.name}]   Challenge: ${challenge}`)
    console.log(`[${this.name}]   Participants: ${aliceConnectionId}, ${bobConnectionId}`)

    // Send challenge to both participants
    const challengeMessage = JSON.stringify({
      type: 'session-challenge',
      sessionId,
      challenge,
      domain,
    })

    await this.agent.basicMessages.sendMessage(aliceConnectionId, challengeMessage)
    await this.agent.basicMessages.sendMessage(bobConnectionId, challengeMessage)

    console.log(`[${this.name}] Sent session challenge to both participants`)

    return { sessionId, challenge, domain }
  }

  /**
   * Verify a submitted presentation
   */
  public async verifyPresentation(
    connectionId: string,
    presentationJson: Record<string, any>
  ): Promise<VerificationResult> {
    try {
      // Find the newest active session for this connection
      let sessionData: SessionData | undefined
      for (const session of this.activeSessions.values()) {
        if (session.participants.has(connectionId)) {
          if (!sessionData || session.createdAt > sessionData.createdAt) {
            sessionData = session
          }
        }
      }

      if (!sessionData) {
        return { verified: false, error: 'No active session found for this connection' }
      }

      // ========================================
      // Step 1: STRUCTURAL CHECKS
      // ========================================
      const proof = presentationJson.proof
      if (!proof) {
        return { verified: false, error: 'Presentation has no proof' }
      }

      const credentials = presentationJson.verifiableCredential || []
      if (!Array.isArray(credentials) || credentials.length === 0) {
        return { verified: false, error: 'Presentation contains no credentials' }
      }

      const vrcJson = credentials[0]
      const types = vrcJson.type || []
      if (!types.includes('RelationshipCredential')) {
        return { verified: false, error: 'Credential is not a RelationshipCredential' }
      }

      console.log(`[${this.name}]   ✓ Credential type is RelationshipCredential`)

      // ========================================
      // Step 2: DEBUG - Canonicalize VP/VRC (only when verbose mode is enabled)
      // This helps debug JSON-LD canonicalization mismatches between mobile and server
      // ========================================
      if (this.config.verbose) {
        const agentContext = this.agent.context
        const documentLoader = demoDocumentLoader(agentContext)
        const jsonld = vcLibraries.jsonld

        // Create VP without proof for canonicalization (this is what's signed)
        const vpWithoutProof = { ...presentationJson }
        delete vpWithoutProof.proof

        try {
          const vpCanonical = await jsonld.canonize(vpWithoutProof, {
            algorithm: 'URDNA2015',
            format: 'application/n-quads',
            documentLoader: documentLoader,
          })
          console.log(`[${this.name}]   [CANON-DEBUG] VP canonical form (server):`)
          console.log(`[${this.name}]     ---BEGIN CANONICAL---`)
          vpCanonical.split('\n').forEach((line: string) => {
            if (line.trim()) console.log(`[${this.name}]     ${line}`)
          })
          console.log(`[${this.name}]     ---END CANONICAL---`)
        } catch (canonError) {
          console.log(`[${this.name}]   [CANON-DEBUG] VP canonicalization failed: ${(canonError as Error).message}`)
        }

        // Also canonicalize the VRC for comparison
        const vrcWithoutProof = { ...vrcJson }
        delete vrcWithoutProof.proof

        try {
          const vrcCanonical = await jsonld.canonize(vrcWithoutProof, {
            algorithm: 'URDNA2015',
            format: 'application/n-quads',
            documentLoader: documentLoader,
          })
          console.log(`[${this.name}]   [CANON-DEBUG] VRC canonical form (server):`)
          console.log(`[${this.name}]     ---BEGIN CANONICAL---`)
          vrcCanonical.split('\n').forEach((line: string) => {
            if (line.trim()) console.log(`[${this.name}]     ${line}`)
          })
          console.log(`[${this.name}]     ---END CANONICAL---`)
        } catch (canonError) {
          console.log(`[${this.name}]   [CANON-DEBUG] VRC canonicalization failed: ${(canonError as Error).message}`)
        }
      }

      // ========================================
      // Step 3: CONTEXT CHECK - Cryptographically verify VP signature
      // This verifies the holder signed the VP with the correct challenge/domain
      // ========================================
      console.log(`[${this.name}]   Verifying VP signature (Context Check)...`)
      console.log(`[${this.name}]     Expected challenge: ${sessionData.challenge}`)
      console.log(`[${this.name}]     Expected domain: ${sessionData.domain}`)
      console.log(`[${this.name}]     VP holder: ${presentationJson.holder}`)

      try {
        const vpPresentation = JsonTransformer.fromJSON(presentationJson, W3cJsonLdVerifiablePresentation)

        const vpVerificationResult = await this.agent.w3cCredentials.verifyPresentation({
          presentation: vpPresentation as any,
          challenge: sessionData.challenge,
          domain: sessionData.domain,
        })

        console.log(`[${this.name}]   VP verification result:`)
        console.log(`[${this.name}]     isValid: ${vpVerificationResult.isValid}`)

        if (!vpVerificationResult.isValid) {
          console.log(`[${this.name}]   ✗ VP signature verification FAILED`)
          if (vpVerificationResult.error) {
            console.log(`[${this.name}]     Error: ${vpVerificationResult.error.message}`)
          }
          // Log detailed validation results only in verbose mode
          if (this.config.verbose && vpVerificationResult.validations) {
            console.log(
              `[${this.name}]     Validations: ${JSON.stringify(vpVerificationResult.validations, null, 2).substring(
                0,
                1000
              )}`
            )
          }
          const errorDetail = vpVerificationResult.error?.message || 'VP signature invalid'
          return { verified: false, error: `VP verification failed: ${errorDetail}` }
        }

        console.log(`[${this.name}]   ✓ VP signature cryptographically verified (Context Check)`)
      } catch (vpVerifyError) {
        const err = vpVerifyError as Error
        console.log(`[${this.name}]   ✗ VP verification exception: ${err.message}`)
        if (this.config.verbose) {
          console.log(`[${this.name}]     Stack: ${err.stack?.substring(0, 500)}`)
        }
        return { verified: false, error: `VP verification failed: ${err.message}` }
      }

      // ========================================
      // Step 4: IDENTITY CHECK - Cryptographically verify VRC signature
      // ========================================
      const vrcProof = vrcJson.proof
      if (!vrcProof) {
        console.log(`[${this.name}]   ✗ VRC has no proof/signature`)
        return { verified: false, error: 'VRC credential has no proof' }
      }

      console.log(`[${this.name}]   Verifying VRC signature...`)
      console.log(`[${this.name}]     Proof type: ${vrcProof.type}`)
      console.log(`[${this.name}]     Verification method: ${vrcProof.verificationMethod}`)

      try {
        const vrcCredential = JsonTransformer.fromJSON(vrcJson, W3cJsonLdVerifiableCredential)

        const vrcVerificationResult = await this.agent.w3cCredentials.verifyCredential({
          credential: vrcCredential as any,
        })

        console.log(`[${this.name}]   VRC verification result: isValid=${vrcVerificationResult.isValid}`)
        if (this.config.verbose) {
          console.log(`[${this.name}]     Validations: ${JSON.stringify(vrcVerificationResult.validations, null, 2)}`)
        }

        if (!vrcVerificationResult.isValid) {
          console.log(`[${this.name}]   ✗ VRC signature verification FAILED`)
          if (vrcVerificationResult.error) {
            console.log(`[${this.name}]     Error: ${vrcVerificationResult.error.message}`)
            if (this.config.verbose) {
              console.log(`[${this.name}]     Stack: ${vrcVerificationResult.error.stack?.substring(0, 500)}`)
            }
          }
          const errorDetail = vrcVerificationResult.error?.message || 'Unknown error'
          return { verified: false, error: `VRC signature invalid: ${errorDetail}` }
        }

        console.log(`[${this.name}]   ✓ VRC signature cryptographically verified (Identity Check)`)
      } catch (verifyError) {
        const err = verifyError as Error
        console.log(`[${this.name}]   ✗ VRC verification exception: ${err.message}`)
        if (this.config.verbose) {
          console.log(`[${this.name}]     Stack: ${err.stack?.substring(0, 500)}`)
        }
        return { verified: false, error: `VRC verification failed: ${err.message}` }
      }

      // ========================================
      // Step 5: FRESHNESS CHECK - Verify timestamp is recent
      // ========================================
      const issuanceDate = new Date(vrcJson.issuanceDate)
      const now = new Date()
      const fiveMinutesInMs = 5 * 60 * 1000
      const timeDiff = Math.abs(now.getTime() - issuanceDate.getTime())

      if (timeDiff > fiveMinutesInMs) {
        return { verified: false, error: 'Credential issuance date is not fresh (>5 minutes old)' }
      }

      console.log(`[${this.name}]   ✓ Freshness check passed (issued ${Math.round(timeDiff / 1000)}s ago)`)

      // Store the verified presentation
      sessionData.receivedPresentations.set(connectionId, presentationJson)

      console.log(`[${this.name}] ✓ All verification checks passed for connection ${connectionId}`)

      return { verified: true, sessionId: sessionData.sessionId }
    } catch (error) {
      return { verified: false, error: (error as Error).message }
    }
  }

  /**
   * Issue Witness Credentials (VWCs) to both participants
   *
   * If either party set `witness: false` in their session-request, skip VWC issuance
   * but still record the edge in the network graph (if both parties have reportingDids).
   */
  public async issueWitnessCredentials(sessionId: string): Promise<void> {
    const sessionData = this.activeSessions.get(sessionId)
    if (!sessionData) {
      throw new Error(`Session ${sessionId} not found`)
    }

    if (sessionData.receivedPresentations.size !== 2) {
      throw new Error(
        `Session ${sessionId} incomplete: received ${sessionData.receivedPresentations.size}/2 presentations`
      )
    }

    // Check if both parties requested witness credentials
    // If either set witness: false, skip VWC issuance but still record edge
    const participantIds = Array.from(sessionData.participants)
    const bothWantWitness = participantIds.every((connId) => sessionData.witnessRequested.get(connId) !== false)

    if (!bothWantWitness) {
      console.log(`[${this.name}] Session ${sessionId}: At least one party requested no witness credentials`)
      console.log(`[${this.name}]   Skipping VWC issuance, but recording edge in network graph`)
    } else {
      console.log(`[${this.name}] Issuing witness credentials for session ${sessionId}...`)

      // Build locality evidence if locality verification is enabled
      let localityEvidence: LocalityEvidence | undefined
      if (this.localityService?.isEnabled()) {
        // Get participant DIDs from connections
        const participantDids: string[] = []
        for (const connId of participantIds) {
          const conn = await this.agent.connections.findById(connId)
          if (conn?.theirDid) {
            participantDids.push(conn.theirDid)
          }
        }

        localityEvidence = this.localityService.buildLocalityEvidence(participantDids)
        if (localityEvidence) {
          console.log(`[${this.name}] Including locality verification evidence in VWCs`)
        }
      }

      const presentationEntries = Array.from(sessionData.receivedPresentations.entries())

      // Cross-distribution: VWC about one participant's VRC goes to the OTHER participant
      for (const [senderConnectionId, presentation] of presentationEntries) {
        const recipientConnectionId = participantIds.find((id) => id !== senderConnectionId)
        if (!recipientConnectionId) {
          throw new Error(`Could not find recipient for VWC from ${senderConnectionId}`)
        }

        const witnessCredential = this.buildWitnessCredential(sessionData, presentation, localityEvidence)

        const rawIssuer = presentation.verifiableCredential?.[0]?.issuer
        const vrcIssuer = typeof rawIssuer === 'string' ? rawIssuer : (rawIssuer as any)?.id || 'unknown'

        await this.agent.credentials.offerCredential({
          connectionId: recipientConnectionId,
          protocolVersion: 'v2',
          autoAcceptCredential: AutoAcceptCredential.Always,
          credentialFormats: {
            jsonld: {
              credential: witnessCredential,
              options: {
                proofType: 'Ed25519Signature2018',
                proofPurpose: 'assertionMethod',
              },
            },
          },
        })

        // Get recipient DID for registry
        const recipientConnection = await this.agent.connections.findById(recipientConnectionId)
        const recipientDid = recipientConnection?.theirDid || 'unknown'

        // Register the issued credential
        const registryRecord: IssuedCredentialRecord = {
          vwcId: witnessCredential.id,
          sessionId: sessionData.sessionId,
          vrcDigest: witnessCredential.credentialSubject.digest,
          vrcIssuerId: vrcIssuer,
          recipientDid,
          recipientConnectionId,
          issuedAt: new Date(),
          eventName: this.config.eventName,
        }
        this.credentialRegistry.register(registryRecord)

        // Notify activity log of new credential (forwards to broadcaster for live WS updates)
        if (this.onCredentialIssuedCallback) {
          this.onCredentialIssuedCallback(registryRecord)
        }

        const senderRelDid = this.getRelationshipDidForConnection(senderConnectionId)
        const recipientRelDid = this.getRelationshipDidForConnection(recipientConnectionId)
        console.log(`[${this.name}] VWC: ${senderRelDid?.substring(0, 20) ?? 'unknown'}... → ${recipientRelDid?.substring(0, 20) ?? 'unknown'}...`)
        console.log(`[${this.name}]   Registered in credential registry: ${witnessCredential.id}`)
      }

      console.log(`[${this.name}] All witness credentials issued for session ${sessionId}`)
    }

    // Calculate attestation count for this session (needed for both reporting graph and callbacks)
    const attestationCount = Array.from(sessionData.receivedAttestations.values()).filter(Boolean).length
    console.log(`[${this.name}] Session ${sessionId} had ${attestationCount} hardware attestation(s)`)

    // Record opt-in reporting graph edge when BOTH parties included a reportingDid
    if (this.config.reportingEnabled) {
      const reportingDids = Array.from(sessionData.receivedReportingDids.values())
      if (reportingDids.length === 2) {
        // Record edge with witnessed=bothWantWitness and attestationCount for proper node/edge scoring on load
        // witnessed=false when either party said "witness: false" in their session-request
        this.reportingGraph.recordEdge(reportingDids[0], reportingDids[1], sessionId, bothWantWitness, attestationCount)
        const { dids, edges } = this.reportingGraph.stats()
        console.log(`[${this.name}] ✓ Reporting edge recorded (both parties opted in)`)
        console.log(`[${this.name}]   Reporting graph totals: ${dids} DID(s) registered, ${edges} edge(s) recorded`)
      } else if (reportingDids.length === 1) {
        console.log(`[${this.name}] ℹ Only one party opted in to reporting — no edge recorded`)
        console.log(`[${this.name}]   (The opted-in participant's reportingDid is held but not linked)`)
      } else {
        console.log(`[${this.name}] ℹ Neither party opted in to reporting — no edge recorded`)
      }
    }

    // Get participant array and received reporting DIDs before cleaning up session
    const participantArr = Array.from(sessionData.participants)
    const receivedReportingDids = Array.from(sessionData.receivedReportingDids.values())

    // Clean up session
    this.activeSessions.delete(sessionId)

    // Notify callbacks if registered
    if (this.onSessionComplete) {
      this.onSessionComplete(sessionId)
    }
    if (this.onSessionCompleteWithParticipants) {
      this.onSessionCompleteWithParticipants(sessionId, participantArr[0] ?? '', participantArr[1] ?? '')
    }
    if (this.onSessionCompleteWithAttestations) {
      this.onSessionCompleteWithAttestations(
        sessionId,
        participantArr[0] ?? '',
        participantArr[1] ?? '',
        attestationCount,
        receivedReportingDids.length > 0 ? receivedReportingDids : undefined
      )
    }
  }

  /**
   * Build a Witness Credential (VWC) according to the DTG spec
   *
   * witnessContext structure per spec:
   * - event (OPTIONAL): Human-readable event name
   * - sessionId (OPTIONAL): Session or nonce identifier
   * - method (OPTIONAL): Verification method used
   * - localityVerification (OPTIONAL): Evidence of co-locality verification (transport TBD)
   * - hardwareAttestationIncluded (OPTIONAL): Whether the VRC included hardware attestation evidence
   *
   * HARDWARE ATTESTATION:
   * When a mobile wallet submits a VP with a VRC that includes W3C evidence block
   * (hardware-backed signature with certificate chain), the witness records this
   * in the VWC. The witness does NOT verify the certificate chain (that's the
   * device's responsibility) - it only attests to the PRESENCE of hardware
   * attestation evidence. This allows verifiers to know:
   * 1. The exchange was witnessed (the VWC itself)
   * 2. The participant used hardware-backed authentication (hardwareAttestationIncluded flag)
   */
  private buildWitnessCredential(
    sessionData: SessionData,
    observedPresentation: any,
    localityEvidence?: LocalityEvidence
  ): any {
    if (!this.issuerDid) {
      throw new Error('Witness issuer DID not initialized')
    }

    const vwcId = `urn:uuid:${utils.uuid()}`

    const credentials = observedPresentation.verifiableCredential || []
    const vrcJson = credentials[0]

    if (!vrcJson) {
      throw new Error('No VRC found in presentation')
    }

    // Compute SHA-256 digest of the VRC
    const vrcCanonical = JSON.stringify(vrcJson, Object.keys(vrcJson).sort())
    const digest = 'sha256:' + createHash('sha256').update(vrcCanonical).digest('hex')

    const vrcIssuer = typeof vrcJson.issuer === 'string' ? vrcJson.issuer : vrcJson.issuer?.id || 'unknown'

    // Check if VRC includes hardware attestation evidence
    // The witness does NOT verify the certificate chain - only records its presence
    // Device-side verification is responsible for chain validation (soft check currently)
    const hasHardwareAttestationEvidence = Array.isArray(vrcJson.evidence) && vrcJson.evidence.length > 0
    if (hasHardwareAttestationEvidence) {
      console.log(
        `[${this.name}] VRC includes hardware attestation evidence (${vrcJson.evidence.length} evidence block(s))`
      )
    } else {
      console.log(`[${this.name}] VRC does not include hardware attestation evidence`)
    }

    // Build witnessContext according to spec (event, sessionId, method - no domain/timestamp)
    const witnessContext: Record<string, any> = {
      sessionId: sessionData.sessionId,
      method: this.config.verificationMethod,
      // Flag indicating whether the VRC included hardware attestation evidence
      // This does NOT mean the evidence was verified by the witness
      // It means the participant's device performed hardware-backed authentication
      hardwareAttestationIncluded: hasHardwareAttestationEvidence,
    }

    // Only include event if configured
    if (this.config.eventName) {
      witnessContext.event = this.config.eventName
    }

    // Include locality verification evidence if available
    if (localityEvidence) {
      witnessContext.localityVerification = localityEvidence
    }

    return {
      '@context': ['https://www.w3.org/2018/credentials/v1', WITNESSED_EXCHANGE_CONTEXT_URL],
      id: vwcId,
      type: ['VerifiableCredential', 'DTGCredential', 'WitnessCredential'],
      issuer: {
        id: this.issuerDid,
        name: this.name,
      },
      issuanceDate: new Date().toISOString(),
      // W3C VC v1 expirationDate and validUntil - set to current time + 7 days
      expirationDate: new Date(Date.now() + DEFAULT_CREDENTIAL_EXPIRATION_MS).toISOString(),
      validUntil: new Date(Date.now() + DEFAULT_CREDENTIAL_EXPIRATION_MS).toISOString(),
      credentialSubject: {
        id: vrcIssuer,
        digest: digest,
        witnessContext,
      },
    }
  }

  // ============================================
  // Session Queries
  // ============================================

  /**
   * Get session data by ID
   */
  public getSessionData(sessionId: string): SessionData | undefined {
    return this.activeSessions.get(sessionId)
  }

  /**
   * Get presentation count for a session
   */
  public getSessionPresentationCount(sessionId: string): number {
    const session = this.activeSessions.get(sessionId)
    return session?.receivedPresentations.size ?? 0
  }

  /**
   * Get total presentation count across all sessions
   */
  public getTotalPresentationCount(): number {
    let total = 0
    for (const session of this.activeSessions.values()) {
      total += session.receivedPresentations.size
    }
    return total
  }

  /**
   * Get all active sessions
   */
  public getActiveSessions(): SessionData[] {
    return Array.from(this.activeSessions.values())
  }

  /**
   * List active sessions (for logging)
   */
  public async listActiveSessions(): Promise<void> {
    if (this.activeSessions.size === 0) {
      console.log(`[${this.name}] No active sessions`)
      return
    }

    console.log(`[${this.name}] Active Sessions (${this.activeSessions.size}):`)
    for (const [sessionId, session] of this.activeSessions.entries()) {
      console.log(`  Session: ${sessionId}`)
      console.log(`    Challenge: ${session.challenge}`)
      console.log(`    Participants: ${session.participants.size}`)
      console.log(`    Presentations received: ${session.receivedPresentations.size}/2`)
      console.log(`    Created: ${session.createdAt.toISOString()}`)
    }
  }

  /**
   * Send a basic message to a connection
   */
  public async sendMessage(connectionId: string, message: string): Promise<void> {
    await this.agent.basicMessages.sendMessage(connectionId, message)
  }

  /**
   * Delete a basic message record from the wallet after processing.
   * This is called after each message is handled to preserve user privacy.
   *
   * When retainMessages is false (default), messages are deleted after processing.
   * When retainMessages is true, messages are kept for debugging/audit purposes.
   *
   * Note: This only affects the witness's storage - users' devices retain their own message history.
   *
   * @param messageId - The ID of the BasicMessageRecord to delete
   * @param messageType - The type of message (for logging purposes)
   */
  private async deleteMessageRecord(messageId: string, messageType: string): Promise<void> {
    // Skip deletion if message retention is enabled
    if (this.config.retainMessages) {
      if (this.config.verbose) {
        console.log(`[${this.name}] 📝 Retaining ${messageType} message (WITNESS_RETAIN_MESSAGES=true)`)
      }
      return
    }

    try {
      await this.agent.basicMessages.deleteById(messageId)
      if (this.config.verbose) {
        console.log(`[${this.name}] 🗑️ Deleted ${messageType} message record: ${messageId.substring(0, 8)}...`)
      }
    } catch (error) {
      // Log warning but don't fail - message processing is more important
      console.warn(
        `[${this.name}] ⚠️ Failed to delete message record ${messageId.substring(0, 8)}...: ${(error as Error).message}`
      )
    }
  }

  /**
   * Register callback for session completion
   */
  public onSessionCompleted(callback: (sessionId: string) => void): void {
    this.onSessionComplete = callback
  }

  /**
   * Register callback for session completion with participant info
   */
  public onSessionCompletedWithParticipants(
    callback: (sessionId: string, walletAId: string, walletBId: string) => void
  ): void {
    this.onSessionCompleteWithParticipants = callback
  }

  /**
   * Register callback for session completion with attestation count and received reporting DIDs.
   * This is called when a witnessed session completes and provides:
   * - attestationCount: number of parties that included hardware attestation evidence
   * - receivedReportingDids: array of reporting DIDs submitted in THIS session's presentations
   *   (only present when parties opted in to reporting)
   */
  public onSessionCompletedWithAttestations(
    callback: (
      sessionId: string,
      walletAId: string,
      walletBId: string,
      attestationCount: number,
      receivedReportingDids?: string[]
    ) => void
  ): void {
    this.onSessionCompleteWithAttestations = callback
  }

  /**
   * Register callback for new wallet connections
   */
  public onWalletConnected(callback: (connectionId: string, label: string) => void): void {
    this.onWalletConnectedCallback = callback
  }

  /**
   * Register callback for session creation (both parties registered)
   */
  public onSessionCreated(callback: (sessionId: string, walletAId: string, walletBId: string) => void): void {
    this.onSessionCreatedCallback = callback
  }

  /**
   * Register callback for each issued VWC.
   * Called once per credential after it is registered in the credential registry.
   * Used by WebServer to forward issuances to the NetworkBroadcaster so the
   * activity log receives live `credential-issued` WebSocket events.
   */
  public onCredentialIssued(callback: (record: IssuedCredentialRecord) => void): void {
    this.onCredentialIssuedCallback = callback
  }

  /**
   * Shutdown the witness service
   */
  public async shutdown(): Promise<void> {
    console.log(`[${this.name}] Shutting down witness service...`)
    if (this.pendingRequestCleanupInterval) {
      clearInterval(this.pendingRequestCleanupInterval)
    }
    if (this.sessionCleanupInterval) {
      clearInterval(this.sessionCleanupInterval)
    }
    await this.agent.shutdown()
  }
}
