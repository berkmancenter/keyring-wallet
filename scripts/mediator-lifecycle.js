/**
 * Local-mediator lifecycle, shared by `yarn mediator` and `yarn demo`.
 *
 * `app/.env` is a build-time input — react-native-config bakes it into the
 * native build — so a demo that starts the mediator *after* the app is built
 * would ship the app the previous run's dead invitation. Everything here is
 * arranged so the invitation lands in `app/.env` before any build starts.
 *
 * Standalone on purpose: `e2e/lib/witness.js` does the equivalent job for the
 * witness, but `e2e/` is a separate npm package outside the yarn workspaces,
 * so importing from it would make "start a mediator" depend on having
 * installed the e2e suite first.
 */

const { spawn, execSync } = require('node:child_process')
const { createServer } = require('node:net')
const { existsSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const repoRoot = join(__dirname, '..')
const mediatorDir = join(repoRoot, 'bifold', 'packages', 'mediator-server')
const envPath = join(repoRoot, 'app', '.env')
const envSamplePath = join(repoRoot, 'app', '.env.sample')

const DEFAULT_PORT = 3010

/**
 * The only cleartext hosts a debug build will talk to, per
 * `app/android/app/src/debug/res/xml/network_security_config.xml` and the
 * `localhost` ATS exception in `app/ios/AriesBifold/Info.plist`. A physical
 * device, or an emulator and a simulator at once, has no such host in common
 * and needs the tunnel.
 */
function defaultEndpointFor(platform, port) {
  if (platform === 'android') return `http://10.0.2.2:${port}`
  if (platform === 'ios') return `http://localhost:${port}`
  return undefined
}

/** Fail before spending 20s on agent startup, with a message naming the port. */
async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', (err) => {
      reject(
        err.code === 'EADDRINUSE'
          ? new Error(`port ${port} is already in use — stop that process or pass --port <other>`)
          : err
      )
    })
    srv.listen(port, () => srv.close(() => resolve()))
  })
}

/**
 * A cloudflared quick tunnel, giving the local mediator an https address any
 * device can reach. No Cloudflare account needed.
 */
async function startTunnel(port, readyTimeoutMs = 60000) {
  try {
    execSync('command -v cloudflared', { stdio: 'ignore' })
  } catch {
    throw new Error(
      `cloudflared is not installed, and it is what gives the local mediator an https address.\n` +
        `  Install it (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/),\n` +
        `  or skip the tunnel with --endpoint http://10.0.2.2:${port} (Android emulator) or ` +
        `--endpoint http://localhost:${port} (iOS simulator).`
    )
  }

  const proc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let url
  const onData = (buf) => {
    const match = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
    if (match && !url) url = match[0]
  }
  proc.stdout.on('data', onData)
  proc.stderr.on('data', onData)

  const deadline = Date.now() + readyTimeoutMs
  while (Date.now() < deadline) {
    if (url) return { url, stop: () => proc.kill('SIGINT') }
    await new Promise((r) => setTimeout(r, 500))
  }
  proc.kill('SIGINT')
  throw new Error(`cloudflared did not produce a tunnel URL within ${readyTimeoutMs}ms`)
}

/** Create app/.env from the sample if it does not exist yet. */
function ensureEnvFile() {
  if (existsSync(envPath)) return false
  if (!existsSync(envSamplePath)) throw new Error(`neither ${envPath} nor ${envSamplePath} exists`)
  writeFileSync(envPath, readFileSync(envSamplePath, 'utf8'))
  return true
}

/**
 * Set MEDIATOR_URL in app/.env, preserving every other line — a developer's
 * own OCA_URL or debug flags survive.
 */
function writeMediatorUrl(mediatorUrl) {
  const created = ensureEnvFile()
  const lines = readFileSync(envPath, 'utf8').split('\n')
  const next = `MEDIATOR_URL=${mediatorUrl}`
  const index = lines.findIndex((line) => /^\s*MEDIATOR_URL\s*=/.test(line))
  if (index === -1) lines.push(next)
  else lines[index] = next
  writeFileSync(envPath, lines.join('\n'))
  return { created }
}

/**
 * Start the mediator and resolve once it has published an invitation.
 *
 * Resolving on the invitation *file* rather than on the banner is what lets a
 * caller sequence a build behind it: the file appears only after the agent is
 * initialized and listening.
 */
async function startMediator({ port = DEFAULT_PORT, endpoint, fresh = false, verbose = false } = {}) {
  await assertPortFree(port)

  let tunnel
  let publicUrl = endpoint
  if (!publicUrl) {
    console.log('[mediator] starting cloudflared tunnel…')
    tunnel = await startTunnel(port)
    publicUrl = tunnel.url
    console.log(`[mediator] tunnel up: ${publicUrl}`)
  }

  // Removed before the mediator starts, not after it is read: a leftover file
  // from a previous run holds a previous run's endpoint, and writing that into
  // app/.env would point the wallet at an address that no longer answers —
  // exactly the stale-invitation failure this tooling exists to end.
  const invitationPath = join(mediatorDir, '.mediator-invitation')
  rmSync(invitationPath, { force: true })

  const env = {
    ...process.env,
    MEDIATOR_PORT: String(port),
    MEDIATOR_PUBLIC_URL: publicUrl,
    MEDIATOR_INVITATION_PATH: invitationPath,
    MEDIATOR_VERBOSE: verbose ? 'true' : 'false',
  }

  if (fresh) execSync('yarn fresh', { cwd: mediatorDir, env, stdio: 'inherit' })

  // `yarn start` runs ts-node as a GRANDCHILD, so killing this child would
  // only signal the yarn wrapper and orphan the mediator — still holding the
  // port. detached:true makes it a process-group leader we can kill whole.
  const proc = spawn('yarn', ['start'], { cwd: mediatorDir, env, detached: true, stdio: 'inherit' })

  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    try {
      process.kill(-proc.pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
    tunnel?.stop()
  }

  let exited = false
  proc.on('exit', () => {
    exited = true
    tunnel?.stop()
  })

  const deadline = Date.now() + 180000
  while (Date.now() < deadline) {
    if (exited) throw new Error('the mediator exited before publishing an invitation — see its output above')
    if (existsSync(invitationPath)) {
      return { mediatorUrl: readFileSync(invitationPath, 'utf8').trim(), publicUrl, stop, process: proc }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  stop()
  throw new Error('the mediator did not publish an invitation within 180s')
}

module.exports = {
  DEFAULT_PORT,
  defaultEndpointFor,
  ensureEnvFile,
  envPath,
  startMediator,
  writeMediatorUrl,
}
