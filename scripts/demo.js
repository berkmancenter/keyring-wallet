#!/usr/bin/env node
/**
 * `yarn demo:android` / `yarn demo:ios` — clone, install, run. No .env editing.
 *
 * The point of this script is the ordering. `app/.env` is a *build-time*
 * input: react-native-config bakes MEDIATOR_URL into the native build, so a
 * developer who builds first and starts a mediator second ships an app
 * carrying the previous run's dead invitation, and finds out much later as
 * "There is no mediator to pickup messages from". So: start the mediator,
 * wait for it to publish a live invitation, write it, and only then build.
 *
 * The mediator then stays in the foreground for as long as the demo runs —
 * it is not a background service, and closing this closes it.
 */

const { execFileSync, spawn } = require('node:child_process')
const { createServer } = require('node:net')
const { join } = require('node:path')

const { DEFAULT_PORT, defaultEndpointFor, startMediator, writeMediatorUrl } = require('./mediator-lifecycle')

const appDir = join(__dirname, '..', 'app')
const APP_ID = 'asml.bkc.harvard.wallet'
const DEFAULT_METRO_PORT = 8081

const HELP = `
yarn demo:android / yarn demo:ios — start a local mediator and run the app

Everything a basic demo needs, in one command: no .env to edit, no mediator URL
to paste, no account anywhere. app/.env is created from .env.sample if you have
not got one, and its MEDIATOR_URL is set to a mediator started here.

  --tunnel          Reach the mediator through a cloudflared tunnel instead of
                    a cleartext localhost address. Needed for physical phones,
                    or an Android emulator and an iOS simulator at once.
  --port <n>        Local port the mediator binds (default ${DEFAULT_PORT}).
  --metro-port <n>  Port for Metro (default ${DEFAULT_METRO_PORT}). Use this when another
                    checkout already has Metro on ${DEFAULT_METRO_PORT}.
  --device <id>     Build to this device/emulator instead of the first one
                    attached (\`adb devices\` lists them).
  --fresh           Wipe the mediator's wallet before starting.
  --verbose         Pass through the mediator's debug logging.
`

function parseArgs(argv) {
  const [platform, ...rest] = argv
  if (!['android', 'ios'].includes(platform)) {
    throw new Error(`expected a platform of "android" or "ios", got "${platform ?? '(none)'}"`)
  }

  const args = {
    platform,
    port: DEFAULT_PORT,
    metroPort: DEFAULT_METRO_PORT,
    device: undefined,
    tunnel: false,
    fresh: false,
    verbose: false,
  }
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '--port') args.port = Number(rest[++i])
    else if (arg === '--metro-port') args.metroPort = Number(rest[++i])
    else if (arg === '--device') args.device = rest[++i]
    else if (arg === '--tunnel') args.tunnel = true
    else if (arg === '--fresh') args.fresh = true
    else if (arg === '--verbose') args.verbose = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else throw new Error(`unknown argument "${arg}" — run with --help`)
  }
  for (const [name, value] of [
    ['--port', args.port],
    ['--metro-port', args.metroPort],
  ]) {
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      throw new Error(`${name} must be an integer between 1 and 65535`)
    }
  }
  return args
}

async function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => resolve(false))
    srv.listen(port, () => srv.close(() => resolve(true)))
  })
}

/**
 * The react-native CLI reacts to an occupied Metro port by *asking* whether to
 * use another one — and when there is no terminal to answer, it gives up and
 * exits 0 without building anything. A demo that trusted that exit code would
 * announce success over an app that was never installed, so refuse the
 * condition up front instead.
 */
async function assertMetroPortFree(port) {
  if (await isPortFree(port)) return
  throw new Error(
    `Metro's port ${port} is already in use — most likely a Metro from another checkout.\n` +
      `  Stop it, or re-run with --metro-port <other port>.`
  )
}

/**
 * Trust the device, not the exit code: confirm the package is actually
 * installed. See assertMetroPortFree for why the exit code is not enough.
 */
function assertInstalledOnAndroid(device) {
  const adbArgs = device ? ['-s', device] : []
  let packages
  try {
    packages = execFileSync('adb', [...adbArgs, 'shell', 'pm', 'list', 'packages', APP_ID], { encoding: 'utf8' })
  } catch (error) {
    throw new Error(`could not ask adb what is installed: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!packages.includes(APP_ID)) {
    throw new Error(`the build finished but ${APP_ID} is not installed on the device — see the build output above`)
  }
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd, stdio: 'inherit' })
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`))))
    proc.on('error', reject)
  })
}

/**
 * Start Metro here rather than letting `react-native run-android` do it.
 *
 * The CLI starts Metro by opening a *new terminal window*, which does nothing
 * over SSH or in CI: the build proceeds, the app installs and launches, and
 * then sits forever unable to fetch a bundle, with the only clue a
 * "Couldn't connect… will silently retry" line buried in logcat. Owning the
 * process means we can wait for it to actually listen before building, and
 * shut it down with everything else.
 */
async function startMetro(port) {
  const proc = spawn('yarn', ['start', '--port', String(port)], {
    cwd: appDir,
    detached: true,
    stdio: 'inherit',
  })

  let exited = false
  proc.on('exit', () => (exited = true))

  const stop = () => {
    try {
      process.kill(-proc.pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
  }

  const deadline = Date.now() + 180000
  while (Date.now() < deadline) {
    if (exited) throw new Error('Metro exited before it began listening — see its output above')
    if (!(await isPortFree(port))) return { stop }
    await new Promise((r) => setTimeout(r, 1000))
  }
  stop()
  throw new Error(`Metro did not start listening on port ${port} within 180s`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(HELP)
    return
  }

  await assertMetroPortFree(args.metroPort)

  const endpoint = args.tunnel ? undefined : defaultEndpointFor(args.platform, args.port)

  console.log(`[demo] starting a local mediator for ${args.platform}`)
  const mediator = await startMediator({ port: args.port, endpoint, fresh: args.fresh, verbose: args.verbose })

  const stop = () => mediator.stop()
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  const { created } = writeMediatorUrl(mediator.mediatorUrl)
  console.log(`[demo] ${created ? 'created app/.env and set' : 'set'} MEDIATOR_URL — ${mediator.publicUrl}`)

  console.log(`[demo] starting Metro on port ${args.metroPort}`)
  const metro = await startMetro(args.metroPort)
  const stopAll = () => {
    metro.stop()
    mediator.stop()
  }
  process.off('SIGINT', stop)
  process.off('SIGTERM', stop)
  process.on('SIGINT', stopAll)
  process.on('SIGTERM', stopAll)

  // Only now is it safe to build: react-native-config reads app/.env here.
  console.log(`[demo] building and launching the app (yarn ${args.platform})`)
  try {
    const platformArgs = ['--no-packager', '--port', String(args.metroPort)]
    if (args.device) platformArgs.push(args.platform === 'ios' ? '--udid' : '--deviceId', args.device)

    if (args.platform === 'ios') await run('yarn', ['ios:setup'], appDir)
    await run('yarn', [args.platform, ...platformArgs], appDir)
    if (args.platform === 'android') assertInstalledOnAndroid(args.device)
  } catch (error) {
    stopAll()
    throw error
  }

  console.log('')
  console.log('[demo] the app is running against your local mediator.')
  console.log('[demo] leave this terminal open — closing it stops Metro and the mediator.')

  // Hold the process open: Metro and the mediator are the demo's running
  // infrastructure and both belong to this terminal.
  await new Promise(() => {})
}

main().catch((error) => {
  console.error(`[demo] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
