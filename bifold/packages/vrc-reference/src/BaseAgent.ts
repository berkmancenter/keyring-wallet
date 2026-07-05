import type { InitConfig } from '@credo-ts/core'
import {
  Agent,
  CacheModule,
  ConsoleLogger,
  DidsModule,
  InMemoryLruCache,
  KeyDidRegistrar,
  KeyDidResolver,
  LogLevel,
  PeerDidRegistrar,
  PeerDidResolver,
  W3cCredentialsModule,
} from '@credo-ts/core'
import {
  DidCommAutoAcceptCredential,
  DidCommAutoAcceptProof,
  DidCommCredentialV2Protocol,
  DidCommDifPresentationExchangeProofFormatService,
  DidCommHttpOutboundTransport,
  DidCommJsonLdCredentialFormatService,
  DidCommMediatorPickupStrategy,
  DidCommModule,
  DidCommProofV2Protocol,
  DidCommWsOutboundTransport,
} from '@credo-ts/didcomm'
import { AskarModule } from '@credo-ts/askar'
import { agentDependencies, DidCommHttpInboundTransport } from '@credo-ts/node'
import { askar } from '@openwallet-foundation/askar-nodejs'

import { demoDocumentLoader, deleteWallet, walletExists, shouldUseFresh, getWalletStoragePath } from '@bifold/vrc-shared'
import { greenText, purpleText } from './OutputClass'

type DemoAgent = Agent<ReturnType<typeof getJsonLdDemoModules>>

export class BaseAgent {
  public port: number
  public name: string
  public config: InitConfig
  public agent: DemoAgent
  public mediatorInvitationUrl?: string
  private httpTransportTimer?: NodeJS.Timeout

  public constructor({ port, name, mediatorInvitationUrl }: { port: number; name: string; mediatorInvitationUrl?: string }) {
    this.name = name
    this.port = port
    this.mediatorInvitationUrl = mediatorInvitationUrl

    const config: InitConfig = {
      logger: new ConsoleLogger(getLogLevelFromEnv()),
    }

    this.config = config

    this.agent = new Agent({
      config,
      dependencies: agentDependencies,
      modules: getJsonLdDemoModules({
        walletId: name,
        walletKey: name,
        // When using mediator, endpoints are provided by the mediator
        endpoints: mediatorInvitationUrl ? undefined : [`http://localhost:${this.port}`],
        mediatorInvitationUrl,
      }),
    })

    // Configure transport based on whether we're using a mediator
    if (mediatorInvitationUrl) {
      // Mediated transport: Use WebSocket for mediator communication
      console.log(greenText(`[${this.name}] Using mediated transport via: ${mediatorInvitationUrl.substring(0, 50)}...`))
      this.agent.modules.didcomm.registerOutboundTransport(new DidCommWsOutboundTransport())
      this.agent.modules.didcomm.registerOutboundTransport(new DidCommHttpOutboundTransport())
    } else {
      // Direct transport: Use HTTP inbound/outbound
      console.log(greenText(`[${this.name}] Using direct HTTP transport on port ${this.port}`))
      this.agent.modules.didcomm.registerInboundTransport(new DidCommHttpInboundTransport({ port }))
      this.agent.modules.didcomm.registerOutboundTransport(new DidCommHttpOutboundTransport())
    }
  }

  public async initializeAgent(options?: { fresh?: boolean }) {
    const useFresh = options?.fresh ?? shouldUseFresh()

    // Handle fresh start
    if (useFresh) {
      const existed = walletExists(this.name)
      if (existed) {
        deleteWallet(this.name)
      }
      console.log(greenText(`\n[${this.name}] 🆕 Starting with FRESH wallet\n`))
    }

    await this.agent.initialize()

    // If using mediator, ensure proper setup with provision() and initiateMessagePickup()
    // This is the correct pattern per Credo-ts expert guidance
    console.log(purpleText(`[${this.name}] 🔍 DEBUG: Mediator URL check: ${this.mediatorInvitationUrl ? 'PRESENT' : 'MISSING'}`))
    if (this.mediatorInvitationUrl) {
      console.log(purpleText(`[${this.name}] 🔍 DEBUG: Calling setupMediation()...`))
      await this.setupMediation()
    }

    // Wait for HTTP inbound transport to be fully ready
    await this.waitForHttpTransport()

    // Log wallet state after initialization
    await this.logWalletState(useFresh)
  }

  /**
   * Set up mediation following the correct pattern from official Credo-ts tests:
   * 1. Find mediator connection
   * 2. Call provision() to set up mediation record
   * 3. Call initiateMessagePickup() to enable message delivery
   * 
   * This is REQUIRED for proper mediator functionality per Credo-ts expert guidance.
   */
  private async setupMediation(): Promise<void> {
    try {
      // Find default mediator connection (created automatically during initialize)
      const mediatorConnection = await this.agent.modules.didcomm.mediationRecipient.findDefaultMediatorConnection()
      
      if (!mediatorConnection) {
        console.log(purpleText(`[${this.name}] ⚠️  No mediator connection found yet`))
        return
      }

      console.log(greenText(`[${this.name}] ✓ Mediator connection found`))

      // Check if mediation already provisioned
      let mediationRecord = await this.agent.modules.didcomm.mediationRecipient.findByConnectionId(mediatorConnection.id)
      
      if (!mediationRecord) {
        // Provision mediation (requests and waits for mediation grant)
        console.log(purpleText(`[${this.name}] Provisioning mediation...`))
        mediationRecord = await this.agent.modules.didcomm.mediationRecipient.provision(mediatorConnection)
        console.log(greenText(`[${this.name}] ✓ Mediation provisioned`))
      } else {
        console.log(greenText(`[${this.name}] ✓ Mediation already provisioned`))
      }

      // Initiate message pickup - CRITICAL for receiving messages from mediator
      await this.agent.modules.didcomm.mediationRecipient.initiateMessagePickup(mediationRecord)
      console.log(greenText(`[${this.name}] ✓ Message pickup initiated`))
      
    } catch (error) {
      // Log warning but don't fail - mediator setup can retry later
      console.log(purpleText(`[${this.name}] ⚠️  Mediation setup: ${(error as Error).message}`))
      console.log(purpleText(`[${this.name}] Mediator will be used if available\n`))
    }
  }

  private async logWalletState(isFresh: boolean) {
    try {
      const connections = await this.agent.modules.didcomm.connections.getAll()
      const credentials = await this.agent.w3cCredentials.getAll()

      if (isFresh) {
        console.log(greenText(`[${this.name}] ✓ Fresh wallet initialized (0 connections, 0 credentials)`))
      } else if (connections.length === 0 && credentials.length === 0) {
        console.log(purpleText(`[${this.name}] Wallet loaded (empty - no prior data)`))
      } else {
        console.log(purpleText(`\n[${this.name}] ⚠️  Wallet loaded with EXISTING data:`))
        console.log(purpleText(`    - ${connections.length} connection(s)`))
        console.log(purpleText(`    - ${credentials.length} credential(s)`))
        console.log(purpleText(`    Use --fresh flag to start clean\n`))
      }
    } catch (_error) {
      // Ignore errors during state logging
    }
  }

  private async waitForHttpTransport(): Promise<void> {
    // Give the HTTP server time to fully start listening
    // This is critical for bidirectional message exchange
    // 2 seconds ensures the HTTP server is ready to receive messages
    return new Promise((resolve) => {
      this.httpTransportTimer = setTimeout(resolve, 2000)
    })
  }

  public async shutdown() {
    // Clear any pending timers to prevent Node.js assertion errors
    if (this.httpTransportTimer) {
      clearTimeout(this.httpTransportTimer)
      this.httpTransportTimer = undefined
    }
    
    await this.agent.shutdown()
  }
}

function getLogLevelFromEnv(): LogLevel {
  const levelFromEnv = process.env.CREDO_LOG_LEVEL?.toLowerCase()
  const mapping: Record<string, LogLevel> = {
    fatal: LogLevel.fatal,
    error: LogLevel.error,
    warn: LogLevel.warn,
    warning: LogLevel.warn,
    info: LogLevel.info,
    debug: LogLevel.debug,
    trace: LogLevel.trace,
    test: LogLevel.test,
  }

  return levelFromEnv ? mapping[levelFromEnv] ?? LogLevel.info : LogLevel.info
}

interface GetDemoModulesOptions {
  walletId: string
  walletKey: string
  endpoints?: string[]
  mediatorInvitationUrl?: string
}

function getJsonLdDemoModules({ walletId, walletKey, endpoints, mediatorInvitationUrl }: GetDemoModulesOptions) {
  return {
    askar: new AskarModule({
      askar,
      store: {
        id: walletId,
        key: walletKey,
        database: {
          type: 'sqlite',
          config: {
            path: getWalletStoragePath(walletId),
          },
        },
      },
    }),
    didcomm: new DidCommModule({
      endpoints,
      // CRITICAL: Enable concurrent message processing for multi-use invitations
      // Without this, connections get stuck at "request-received" state when multiple
      // devices connect via the same multi-use invitation (especially with mediator)
      processDidCommMessagesConcurrently: true,
      connections: {
        autoAcceptConnections: true,
      },
      credentials: {
        autoAcceptCredentials: DidCommAutoAcceptCredential.Never,
        credentialProtocols: [
          new DidCommCredentialV2Protocol({ credentialFormats: [new DidCommJsonLdCredentialFormatService()] }),
        ],
      },
      proofs: {
        autoAcceptProofs: DidCommAutoAcceptProof.Never,
        proofProtocols: [
          new DidCommProofV2Protocol({ proofFormats: [new DidCommDifPresentationExchangeProofFormatService()] }),
        ],
      },
      // Mediation recipient config is only applied when a mediator URL is provided
      mediationRecipient: mediatorInvitationUrl
        ? {
            mediatorInvitationUrl,
            mediatorPickupStrategy: DidCommMediatorPickupStrategy.Implicit,
          }
        : undefined,
    }),
    w3cCredentials: new W3cCredentialsModule({
      documentLoader: demoDocumentLoader,
    }),
    cache: new CacheModule({
      cache: new InMemoryLruCache({ limit: 100 }),
    }),
    dids: new DidsModule({
      resolvers: [new KeyDidResolver(), new PeerDidResolver()],
      registrars: [new KeyDidRegistrar(), new PeerDidRegistrar()],
    }),
  }
}
