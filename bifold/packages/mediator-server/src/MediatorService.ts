import { Agent, ConsoleLogger, InitConfig, LogLevel } from '@credo-ts/core'
import { AskarModule } from '@credo-ts/askar'
import {
  DidCommHttpOutboundTransport,
  DidCommMessageForwardingStrategy,
  DidCommModule,
} from '@credo-ts/didcomm'
import { agentDependencies, DidCommHttpInboundTransport } from '@credo-ts/node'
import { askar } from '@openwallet-foundation/askar-nodejs'
import { mkdirSync } from 'fs'

import { MediatorConfig, walletFilePath } from './config'

/**
 * A DIDComm mediator with exactly the surface a wallet needs from one:
 * accept a connection, grant mediation, hold forwarded messages in a queue,
 * and hand them over on pickup. It issues nothing and verifies nothing, so
 * the credential and proof modules are off — that keeps the boot fast and the
 * dependency set small enough that this package needs no ledger, no
 * anoncreds, and no network beyond its own port.
 *
 * Pickup is `QueueOnly`: a recipient's messages wait in the queue until the
 * wallet asks for them. This is what Keyring's own agent expects — it runs
 * `DidCommMediatorPickupStrategy.PickUpV2` and polls (see
 * `app/src/utils/bc-agent-modules.ts`), rather than holding a live websocket.
 */
export class MediatorService {
  public readonly agent: Agent<ReturnType<typeof buildMediatorModules>>
  private readonly config: MediatorConfig
  private invitationUrl?: string

  private constructor(config: MediatorConfig) {
    this.config = config

    // Askar wants the directory to exist before it opens the sqlite file.
    mkdirSync(config.storagePath, { recursive: true })

    // Credo 0.6 has no agent-level label; the name a wallet shows for its
    // mediator comes from the invitation, minted in createInvitation below.
    const agentConfig: InitConfig = {
      logger: new ConsoleLogger(config.verbose ? LogLevel.debug : LogLevel.warn),
    }

    this.agent = new Agent({
      config: agentConfig,
      dependencies: agentDependencies,
      modules: buildMediatorModules(config),
    })

    this.agent.modules.didcomm.registerInboundTransport(new DidCommHttpInboundTransport({ port: config.port }))
    this.agent.modules.didcomm.registerOutboundTransport(new DidCommHttpOutboundTransport())
  }

  public static async build(config: MediatorConfig): Promise<MediatorService> {
    const service = new MediatorService(config)
    await service.agent.initialize()
    await service.createInvitation()
    return service
  }

  /**
   * Mint a fresh multi-use invitation on every boot.
   *
   * Deliberately not reused across boots: the invitation carries this
   * mediator's `serviceEndpoint`, and the endpoint changes whenever the
   * tunnel in front of it is restarted. A cached invitation would still parse
   * and still connect — to an address that no longer answers — which is the
   * exact failure the checked-in `.env.sample` value produces today, and it
   * surfaces only as "there is no mediator to pickup messages from" much
   * later (`e2e/README.md`).
   */
  private async createInvitation(): Promise<void> {
    const { invitation } = await this.agent.modules.didcomm.oob.createLegacyInvitation({
      label: this.config.label,
      multiUseInvitation: true,
    })
    this.invitationUrl = invitation.toUrl({ domain: this.config.publicUrl })
  }

  /** The `MEDIATOR_URL` value a wallet should be pointed at. */
  public get mediatorUrl(): string {
    if (!this.invitationUrl) throw new Error('mediator has not been built yet — call MediatorService.build()')
    return this.invitationUrl
  }

  public get walletPath(): string {
    return walletFilePath(this.config)
  }

  public async shutdown(): Promise<void> {
    await this.agent.shutdown()
  }
}

function buildMediatorModules(config: MediatorConfig) {
  return {
    askar: new AskarModule({
      askar,
      store: {
        id: config.walletId,
        key: config.walletKey,
        database: {
          type: 'sqlite',
          config: { path: walletFilePath(config) },
        },
      },
    }),
    didcomm: new DidCommModule({
      endpoints: [config.publicUrl],
      // Several wallets connect through one multi-use invitation; without
      // this they deadlock at "request-received" (the same reason the
      // witness-server sets it).
      processDidCommMessagesConcurrently: true,
      connections: { autoAcceptConnections: true },
      mediator: {
        autoAcceptMediationRequests: true,
        messageForwardingStrategy: DidCommMessageForwardingStrategy.QueueOnly,
      },
      // A mediator routes; it never issues or verifies.
      credentials: false,
      proofs: false,
      basicMessages: false,
    }),
  }
}
