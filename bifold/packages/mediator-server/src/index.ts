// CRITICAL: reflect-metadata must be imported FIRST — decorator metadata has
// to be available before tsyringe resolves anything.
import 'reflect-metadata'

// CRITICAL: register the native askar binding BEFORE any @credo-ts module
// loads. askar-nodejs registers into askar-shared's module-level singleton as
// an import side effect; if @credo-ts/askar loads first, its NativeAskar
// instance is undefined and key creation fails with "Cannot read properties
// of undefined (reading 'keyGetJwkSecret')" at agent.initialize(). Same
// ordering constraint the witness-server's entry point documents.
import '@openwallet-foundation/askar-nodejs'

import { mkdirSync, writeFileSync } from 'fs'
import { dirname } from 'path'

import { resolveConfig } from './config'
import { MediatorService } from './MediatorService'

/**
 * Boot the mediator and print the one value a developer needs.
 *
 * The "MEDIATOR READY" banner is a contract, not decoration: the spin-up
 * harness (`scripts/local-mediator.js`) waits for it before reading the
 * invitation file, the same way `e2e/lib/witness.js` waits for the witness's
 * own banner.
 */
async function main(): Promise<void> {
  const config = resolveConfig(process.env)
  const mediator = await MediatorService.build(config)

  if (config.invitationPath) {
    mkdirSync(dirname(config.invitationPath), { recursive: true })
    writeFileSync(config.invitationPath, mediator.mediatorUrl, 'utf8')
  }

  console.log('')
  console.log('='.repeat(60))
  console.log('MEDIATOR READY')
  console.log('='.repeat(60))
  console.log(`listening on   http://localhost:${config.port}`)
  console.log(`reachable at   ${config.publicUrl}`)
  console.log(`wallet         ${mediator.walletPath}`)
  console.log('')
  console.log('Put this in app/.env:')
  console.log('')
  console.log(`MEDIATOR_URL=${mediator.mediatorUrl}`)
  console.log('')
  console.log('='.repeat(60))

  // A harness that kills the process group (`timeout`, and yarn forwarding to
  // its child) delivers the signal more than once. Without the guard the
  // second delivery calls agent.shutdown() again and the inbound transport
  // throws ERR_SERVER_NOT_RUNNING, turning a clean stop into a stack trace.
  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`\n[mediator] ${signal} — shutting down`)
    try {
      await mediator.shutdown()
    } catch (error) {
      console.error(`[mediator] shutdown was not clean: ${error instanceof Error ? error.message : String(error)}`)
    }
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((error) => {
  // Credo wraps module-init failures in a generic message and puts the real
  // reason on `cause`, so print the whole chain — otherwise a boot failure
  // reads as "Error during call to 'onInitializeContext'" and says nothing.
  console.error('[mediator] failed to start:')
  let current: unknown = error
  while (current instanceof Error) {
    console.error(`  ${current.message}`)
    current = (current as Error & { cause?: unknown }).cause
  }
  if (error instanceof Error && error.stack) console.error(error.stack)
  process.exit(1)
})
