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
import { join, relative, resolve } from 'path'

/** Strategies that cannot reliably receive from a queueing mediator. */
const UNRECEIVABLE = new Set(['Implicit', 'PickUpV2LiveMode', 'None'])

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
})
