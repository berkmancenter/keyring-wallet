/**
 * Repo-wide guard: no agent in this monorepo may be configured with a mediator
 * pickup strategy that cannot receive, and no call site may leave the strategy
 * implicit.
 *
 * This exists because the failure it prevents is invisible. An agent on a
 * push-only strategy (`Implicit`) against a mediator that queues rather than
 * pushes sends every outbound message perfectly and receives NOTHING, forever,
 * with no error on either side. The witness-server ran that way and lost every
 * inbound message; the only symptom was an e2e timeout with an empty log.
 * See docs/spikes/e2e-vrc-connect-findings.md ("fourth failure layer").
 *
 * A shared constant does not prevent this — nothing stops the next agent from
 * typing `Implicit` in a new file, which is exactly how it happened. So the
 * guard reads the source tree instead.
 *
 * Two rules, because the bug has two shapes:
 *  1. A config assigning an unreceivable strategy.
 *  2. `initiateMessagePickup()` called WITHOUT an explicit strategy — credo then
 *     resolves `mediationRecord.pickupStrategy ?? moduleConfig`, so a value
 *     persisted in the wallet silently outranks the config and delivery starts
 *     depending on hidden per-wallet state.
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'

/** Strategies that cannot reliably receive from a queueing mediator. */
const UNRECEIVABLE = new Set(['Implicit', 'PickUpV2LiveMode', 'None'])

/** Files allowed to name the unsafe strategies: the guard itself, and the
 *  helper whose whole job is to reject them. */
const ALLOWED = [
  'vrc-shared/src/mediation.ts',
  'witness-server/__tests__/unit/mediatorPickupStrategy.guard.test.ts',
  'witness-server/__tests__/unit/WitnessService.test.ts',
]

const PACKAGES_ROOT = resolve(__dirname, '..', '..', '..')

function sourceFiles(dir: string, found: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return found
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'build' || entry === 'dist' || entry === 'lib') continue
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
 * Strip comments and string literals. Without this the guard flags prose that
 * merely *mentions* `initiateMessagePickup()` — including the comments warning
 * about this very bug — which would train people to add allowlist entries and
 * hollow the guard out.
 */
function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, '``')
    .replace(/'(?:\\.|[^\\'])*'/g, "''")
    .replace(/"(?:\\.|[^\\"])*"/g, '""')
}

/** All package source files, as [relativePath, executable code]. */
function scannedFiles(): Array<[string, string]> {
  return sourceFiles(PACKAGES_ROOT)
    .map(
      (file) =>
        [relative(PACKAGES_ROOT, file).replace(/\\/g, '/'), stripCommentsAndStrings(readFileSync(file, 'utf8'))] as [
          string,
          string
        ]
    )
    .filter(([rel]) => !ALLOWED.includes(rel))
}

/** Arguments of each `initiateMessagePickup(...)` call, by walking to the
 *  matching close paren so multi-line calls are handled correctly. */
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

/** True when the argument list has a comma at paren/bracket depth 0 — i.e. a
 *  second argument, the explicit strategy. */
function hasSecondArgument(args: string): boolean {
  let depth = 0
  for (const char of args) {
    if ('([{'.includes(char)) depth++
    else if (')]}'.includes(char)) depth--
    else if (char === ',' && depth === 0) return true
  }
  return false
}

describe('mediator pickup strategy (repo-wide guard)', () => {
  const files = scannedFiles()

  it('scans a plausible number of source files', () => {
    // Guards the guard: a broken path would make every assertion below pass
    // vacuously, which is the classic way a scanning test rots into a no-op.
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
