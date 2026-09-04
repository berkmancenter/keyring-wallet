// The acceptance check for this package: a wallet-shaped agent connects to
// the mediator's invitation and is granted mediation. `yarn test` only covers
// config parsing; this is the only thing that proves the mediator does its
// job, so run it after changing anything in MediatorService.
//
// Deliberately a script rather than a jest test: @credo-ts ships ESM builds
// that this package's ts-jest/CommonJS setup cannot parse (the same
// constraint the repo's CLAUDE.md documents for @bifold/react-hooks), and the
// advice there is to not bend the jest config to match. ts-node runs it fine,
// which is how `yarn start` works at all.
//
//   yarn verify   → exits 0 when mediation is granted, 1 with a reason if not
//
// The recipient is configured the way Keyring's own agent is
// (`app/src/utils/bc-agent-modules.ts`): PickUpV2, an invitation URL, HTTP
// outbound. If this passes, the MEDIATOR_URL that `yarn mediator` writes into
// app/.env is a working value for the app.

// Import ordering is load-bearing — see the note in index.ts.
import 'reflect-metadata'
import '@openwallet-foundation/askar-nodejs'

import { Agent, ConsoleLogger, LogLevel } from '@credo-ts/core'
import { AskarModule } from '@credo-ts/askar'
import {
  DidCommHttpOutboundTransport,
  DidCommMediationState,
  DidCommMediatorPickupStrategy,
  DidCommModule,
} from '@credo-ts/didcomm'
import { agentDependencies } from '@credo-ts/node'
import { askar } from '@openwallet-foundation/askar-nodejs'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { resolveConfig } from './config'
import { MediatorService } from './MediatorService'

// A high port, so a developer's already-running mediator (3010) or witness
// (9002/9003) does not make this fail for an unrelated reason.
const PORT = Number(process.env.MEDIATOR_VERIFY_PORT || 3311)
const PUBLIC_URL = `http://localhost:${PORT}`

function check(condition: boolean, description: string): void {
  if (!condition) throw new Error(`FAILED: ${description}`)
  console.log(`  ok — ${description}`)
}

async function main(): Promise<void> {
  const mediatorWalletDir = mkdtempSync(join(tmpdir(), 'mediator-verify-'))
  const recipientWalletDir = mkdtempSync(join(tmpdir(), 'recipient-verify-'))

  let mediator: MediatorService | undefined
  let recipient: Agent | undefined

  try {
    console.log(`[verify] starting a mediator on ${PUBLIC_URL}`)
    mediator = await MediatorService.build(
      resolveConfig({
        MEDIATOR_PUBLIC_URL: PUBLIC_URL,
        MEDIATOR_PORT: String(PORT),
        MEDIATOR_WALLET_PATH: mediatorWalletDir,
        MEDIATOR_WALLET_ID: 'mediator-under-verification',
      })
    )

    console.log('[verify] checking the invitation it minted')
    check(mediator.mediatorUrl.startsWith(`${PUBLIC_URL}?c_i=`), 'MEDIATOR_URL is a c_i invitation at the public URL')

    const invitation = JSON.parse(Buffer.from(mediator.mediatorUrl.split('c_i=')[1], 'base64').toString('utf8'))
    check(
      invitation['@type'] === 'https://didcomm.org/connections/1.0/invitation',
      'the invitation is a connections/1.0 invitation'
    )
    check(invitation.serviceEndpoint === PUBLIC_URL, 'the invitation carries this run’s public endpoint, not a stale one')
    check(Array.isArray(invitation.recipientKeys) && invitation.recipientKeys.length === 1, 'it carries one recipient key')

    console.log('[verify] connecting a wallet-shaped agent to it')
    recipient = new Agent({
      config: { logger: new ConsoleLogger(LogLevel.error) },
      dependencies: agentDependencies,
      modules: {
        askar: new AskarModule({
          askar,
          store: {
            id: 'recipient-under-verification',
            key: 'recipient-under-verification-key',
            database: { type: 'sqlite', config: { path: join(recipientWalletDir, 'recipient.db') } },
          },
        }),
        didcomm: new DidCommModule({
          credentials: false,
          proofs: false,
          mediationRecipient: {
            mediatorInvitationUrl: mediator.mediatorUrl,
            mediatorPickupStrategy: DidCommMediatorPickupStrategy.PickUpV2,
          },
        }),
      },
    })
    recipient.modules.didcomm.registerOutboundTransport(new DidCommHttpOutboundTransport())
    await recipient.initialize()

    const mediationRecord = await recipient.modules.didcomm.mediationRecipient.findDefaultMediator()
    check(mediationRecord !== null, 'the wallet has a default mediator')
    check(mediationRecord?.state === DidCommMediationState.Granted, `mediation was granted (state: ${mediationRecord?.state})`)

    console.log('\n[verify] PASSED — a wallet pointed at this MEDIATOR_URL gets mediation')
  } finally {
    await recipient?.shutdown().catch(() => undefined)
    await mediator?.shutdown().catch(() => undefined)
    rmSync(mediatorWalletDir, { recursive: true, force: true })
    rmSync(recipientWalletDir, { recursive: true, force: true })
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`\n[verify] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
