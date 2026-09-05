#!/usr/bin/env node
/**
 * `yarn mediator` — run a local DIDComm mediator and point app/.env at it.
 *
 * Use this when you want the mediator on its own and will build the app
 * yourself. `yarn demo:android` / `yarn demo:ios` do both in one command.
 *
 * The lifecycle lives in scripts/mediator-lifecycle.js, shared with the demo
 * runner; this file is the CLI over it.
 */

const { DEFAULT_PORT, startMediator, writeMediatorUrl } = require('./mediator-lifecycle')

const HELP = `
yarn mediator — run a local DIDComm mediator for Keyring

  --endpoint <url>  Address the wallet uses to reach the mediator. Skips the
                    tunnel. Debug builds permit cleartext to these hosts only:
                      http://10.0.2.2:<port>   Android emulator
                      http://localhost:<port>  iOS simulator
                    Anything else — physical phones, or an Android emulator and
                    an iOS simulator at the same time — needs the tunnel.
  --port <n>        Local port the mediator binds (default ${DEFAULT_PORT}).
  --fresh           Delete the mediator's wallet first: no connections, no
                    queued messages.
  --no-env          Print MEDIATOR_URL instead of writing it to app/.env.
  --verbose         Pass through the mediator's debug logging.
`

function parseArgs(argv) {
  const args = { port: DEFAULT_PORT, endpoint: undefined, fresh: false, writeEnv: true, verbose: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--port') args.port = Number(argv[++i])
    else if (arg === '--endpoint') args.endpoint = argv[++i]
    else if (arg === '--fresh') args.fresh = true
    else if (arg === '--no-env') args.writeEnv = false
    else if (arg === '--verbose') args.verbose = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else throw new Error(`unknown argument "${arg}" — run with --help`)
  }
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
    throw new Error('--port must be an integer between 1 and 65535')
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(HELP)
    return
  }

  const mediator = await startMediator(args)

  process.on('SIGINT', mediator.stop)
  process.on('SIGTERM', mediator.stop)
  mediator.process.on('exit', (code) => process.exit(code ?? 0))

  if (args.writeEnv) {
    const { created } = writeMediatorUrl(mediator.mediatorUrl)
    if (created) console.log('[mediator] created app/.env from .env.sample')
    console.log('[mediator] app/.env MEDIATOR_URL updated — build the app in another terminal')
  }
}

main().catch((error) => {
  console.error(`[mediator] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
