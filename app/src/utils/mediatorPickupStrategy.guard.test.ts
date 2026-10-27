/**
 * App-side guard: no agent config here may use a mediator pickup strategy that
 * cannot receive, and no call site may leave the strategy implicit.
 *
 * The twin of the bifold guard in
 * `bifold/packages/witness-server/__tests__/unit/mediatorPickupStrategy.guard.test.ts`.
 * Two guards rather than one because the two trees ship and test separately —
 * bifold is a submodule consumed on its own, so a guard living only up here
 * would not protect it, and one living only down there would not protect
 * `app/src`.
 *
 * Why a scanning test and not just a shared constant: the failure is invisible.
 * A push-only strategy (`Implicit`) against a mediator that queues rather than
 * pushes sends every outbound message perfectly and receives NOTHING, with no
 * error on either side — an agent that looks healthy and is deaf. A constant
 * cannot stop the next agent typing `Implicit` in a new file, which is exactly
 * how the witness-server ended up losing every inbound message.
 * See docs/spikes/e2e-vrc-connect-findings.md ("fourth failure layer").
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { dirname, join, relative, resolve } from 'path'

/**
 * Strategies no agent CONFIG may name. `Implicit` and `None` never receive from
 * a queueing mediator. `PickUpV2LiveMode` does receive on the Postgres pickup
 * queue, but only with the liveness backstop around it (a socket can die without
 * a close event), so it is started only by the live-pickup owner below, never
 * from config.
 */
const UNRECEIVABLE = new Set(['Implicit', 'PickUpV2LiveMode', 'None'])

/**
 * The one file that may start live pickup. It owns the WebSocket's liveness
 * check and closes a dead socket before restarting; anything else starting
 * live mode would run without that backstop, or stack a second reconnect
 * monitor (credo starts one per initiateMessagePickup in live mode, and only
 * stopMessagePickup ends it).
 */
const LIVE_PICKUP_OWNER = 'utils/livePickup.ts'

/** The guard itself is allowed to name them. */
const ALLOWED = ['utils/mediatorPickupStrategy.guard.test.ts']

const SRC_ROOT = resolve(__dirname, '..')

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found)
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) {
      found.push(full)
    }
  }
  return found
}

/**
 * Strip comments and string literals, so prose that merely mentions
 * `initiateMessagePickup()` — including the comments warning about this bug —
 * is not flagged. Otherwise the fix is to add allowlist entries, which hollows
 * the guard out.
 */
function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, '``')
    .replace(/'(?:\\.|[^\\'])*'/g, "''")
    .replace(/"(?:\\.|[^\\"])*"/g, '""')
}

function scannedFiles(): Array<[string, string]> {
  return sourceFiles(SRC_ROOT)
    .map(
      (file) =>
        [relative(SRC_ROOT, file).replace(/\\/g, '/'), stripCommentsAndStrings(readFileSync(file, 'utf8'))] as [
          string,
          string
        ]
    )
    .filter(([rel]) => !ALLOWED.includes(rel))
}

/** Arguments of each `initiateMessagePickup(...)` call, found by walking to the
 *  matching close paren so multi-line calls are handled. */
function pickupCallArgs(source: string): string[] {
  const calls: string[] = []
  const needle = 'initiateMessagePickup('
  let index = source.indexOf(needle)
  while (index !== -1) {
    let depth = 0
    let end = index + needle.length - 1
    for (; end < source.length; end++) {
      if (source[end] === '(') depth++
      else if (source[end] === ')') {
        depth--
        if (depth === 0) break
      }
    }
    calls.push(source.slice(index + needle.length, end))
    index = source.indexOf(needle, end)
  }
  return calls
}

/** True when the argument list has a top-level comma — i.e. an explicit strategy. */
function hasSecondArgument(args: string): boolean {
  let depth = 0
  for (const char of args) {
    if ('([{'.includes(char)) depth++
    else if (')]}'.includes(char)) depth--
    else if (char === ',' && depth === 0) return true
  }
  return false
}

/**
 * Live-mode starts in `source` not preceded by a stop: for each
 * initiateMessagePickup naming PickUpV2LiveMode, a stopMessagePickup( must
 * appear after the previous pickup start in the file (or the file's start).
 */
function liveStartsWithoutStop(source: string): string[] {
  const offenders: string[] = []
  const needle = 'initiateMessagePickup('
  let previousStart = 0
  let index = source.indexOf(needle)
  while (index !== -1) {
    const args = pickupCallArgs(source.slice(index))[0] ?? ''
    if (args.includes('PickUpV2LiveMode') && !source.slice(previousStart, index).includes('stopMessagePickup(')) {
      offenders.push(args.trim().slice(0, 60))
    }
    previousStart = index + needle.length
    index = source.indexOf(needle, previousStart)
  }
  return offenders
}

describe('mediator pickup strategy (app guard)', () => {
  const files = scannedFiles()

  it('scans a plausible number of source files', () => {
    // Guards the guard: a broken path would make the assertions below pass
    // vacuously, which is how a scanning test quietly rots into a no-op.
    expect(files.length).toBeGreaterThan(50)
  })

  it('no agent config uses a strategy that cannot receive', () => {
    const offenders: string[] = []

    for (const [rel, source] of files) {
      const pattern = /mediatorPickupStrategy:\s*([A-Za-z0-9_.'"$]+)/g
      let match: RegExpExecArray | null
      while ((match = pattern.exec(source)) !== null) {
        const value = match[1].replace(/['"]/g, '')
        const name = value.includes('.') ? value.split('.').pop() ?? value : value
        if (UNRECEIVABLE.has(name)) {
          offenders.push(`${rel}: mediatorPickupStrategy: ${value}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('every initiateMessagePickup call passes the strategy explicitly', () => {
    const offenders: string[] = []

    for (const [rel, source] of files) {
      for (const args of pickupCallArgs(source)) {
        if (!hasSecondArgument(args)) {
          offenders.push(`${rel}: initiateMessagePickup(${args.trim().slice(0, 40)}) — no explicit strategy`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('initiateMessagePickup replaces a running explicit loop instead of stacking one', () => {
    // Guards the credo patch (.yarn/patches/@credo-ts-didcomm-*.patch). Stock
    // credo subscribes a fresh interval on every call and never stops the
    // previous one, so each restart site (agent init, foreground resume, an OS
    // permission dialog closing) added a poll loop; a low-end phone fell 50 s
    // behind the mediator with two of them (2026-09-13). If a credo upgrade
    // drops the patch, this fails before a device does.
    // Resolve from the package entry (build/index.mjs): jest's moduleNameMapper
    // rewrites any '@credo-ts/didcomm…' specifier to that file, so a
    // '/package.json' lookup would silently land there too.
    const api = readFileSync(
      join(dirname(require.resolve('@credo-ts/didcomm')), 'modules/routing/DidCommMediationRecipientApi.mjs'),
      'utf8'
    )
    const start = api.indexOf('async initiateMessagePickup(')
    const explicitLoop = api.indexOf('return interval(mediatorPollingInterval)', start)
    expect(start).toBeGreaterThan(-1)
    expect(explicitLoop).toBeGreaterThan(start)
    const stopBeforeLoop = api.slice(start, explicitLoop).includes('this.stopMessagePickup$.next(true)')
    expect(stopBeforeLoop).toBe(true)
  })

  it('only the live-pickup owner names PickUpV2LiveMode', () => {
    const offenders = files
      .filter(([rel, source]) => rel !== LIVE_PICKUP_OWNER && /\bPickUpV2LiveMode\b/.test(source))
      .map(([rel]) => rel)
    expect(offenders).toEqual([])
  })

  it('every live-mode start is preceded by a stop', () => {
    const offenders: string[] = []
    for (const [rel, source] of files) {
      for (const call of liveStartsWithoutStop(source)) offenders.push(`${rel}: initiateMessagePickup(${call})`)
    }
    expect(offenders).toEqual([])
  })

  it('the stop-before-live check flags what it should (control)', () => {
    // The two cases above pass vacuously while nothing starts live mode, so prove
    // the checker on fixed sources.
    const start = 'r.initiateMessagePickup(undefined, DidCommMediatorPickupStrategy.PickUpV2LiveMode)'
    expect(liveStartsWithoutStop(`async () => { ${start} }`)).toHaveLength(1)
    expect(liveStartsWithoutStop(`async () => { await r.stopMessagePickup(); ${start} }`)).toEqual([])
    // A stop before an EARLIER start does not cover a later one.
    expect(liveStartsWithoutStop(`a = () => { r.stopMessagePickup(); ${start} }\nb = () => { ${start} }`)).toHaveLength(
      1
    )
    // Polling starts are not this check's business.
    expect(liveStartsWithoutStop('r.initiateMessagePickup(undefined, DidCommMediatorPickupStrategy.PickUpV2)')).toEqual(
      []
    )
  })

  it('caps the live reconnect backoff', () => {
    // credo's default ceiling is infinity: each failed reconnect doubles the wait
    // from 100 ms, so a mediator down for minutes leaves a live phone deaf for hours.
    const config = readFileSync(join(SRC_ROOT, 'utils/bc-agent-modules.ts'), 'utf8')
    const match = /maximumMediatorReconnectionIntervalMs:\s*([\d_]+)/.exec(config)
    expect(match).not.toBeNull()
    const ms = Number((match as RegExpExecArray)[1].replace(/_/g, ''))
    expect(ms).toBeGreaterThan(0)
    expect(ms).toBeLessThanOrEqual(60_000)
  })

  it('an interrupted first mediation provisioning is discarded and retried on the next launch', () => {
    // Guards the second hunk of the credo patch: getMediationConnection used to
    // wait forever on a connection whose didexchange request never reached
    // the mediator, bricking a fresh wallet on every launch (2026-09-14).
    const mod = readFileSync(
      join(dirname(require.resolve('@credo-ts/didcomm')), 'modules/routing/DidCommMediationRecipientModule.mjs'),
      'utf8'
    )
    const fn = mod.indexOf('async getMediationConnection(')
    expect(fn).toBeGreaterThan(-1)
    const body = mod.slice(fn, mod.indexOf('\n\t}', fn))
    expect(body).toContain('returnWhenIsConnected(connection.id, { timeoutMs: 15e3 })')
    expect(body).toContain('connectionsApi.deleteById(connection.id)')
    expect(body).toContain('oobApi.deleteById(outOfBandRecord.id)')
  })

  it('a mediator invitation stored without a connection is discarded and received again', async () => {
    // Guards the third hunk: when receiveInvitation fails after saving the
    // out-of-band record, no connection exists, and receiving the same
    // invitation again is refused ("has already been received") — every Retry
    // failed on TestFlight 0.2.0 (204), 2026-09-21. The record has to go first.
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- the file's other cases read the built module the same way
    const didcomm = require('@credo-ts/didcomm')
    const calls: string[] = []
    const oobApi = {
      parseInvitation: async () => ({ id: 'mediator-invitation' }),
      findByReceivedInvitationId: async () => ({ id: 'stranded-oob' }),
      deleteById: async (id: string) => {
        calls.push(`delete ${id}`)
      },
      receiveInvitation: async () => {
        calls.push('receive')
        return { connectionRecord: { id: 'new-connection' } }
      },
    }
    const connectionsApi = {
      findAllByOutOfBandId: async () => [],
      returnWhenIsConnected: async (id: string) => ({ id, isReady: true }),
    }
    const mediationRecipientApi = { getRouting: async () => ({}) }
    const services = new Map<unknown, unknown>([
      [didcomm.DidCommOutOfBandApi, oobApi],
      [didcomm.DidCommConnectionsApi, connectionsApi],
      [didcomm.DidCommMediationRecipientApi, mediationRecipientApi],
    ])
    const agentContext = {
      dependencyManager: { resolve: (token: unknown) => services.get(token) },
      config: { logger: { debug: () => undefined, warn: () => undefined } },
    }

    const module = new didcomm.DidCommMediationRecipientModule()
    const connection = await module.getMediationConnection(agentContext, 'https://mediator.example/invitation')

    expect(calls).toEqual(['delete stranded-oob', 'receive'])
    expect(connection).toEqual({ id: 'new-connection', isReady: true })
  })
})
