/**
 * The release gate the plan owner requires (#1060 findings 15, 19 and 21, relayed): the build fails while the
 * agent-connect developer flag can be on before Revoke (step 7.10) and the chat's VDC acceptance (step 7.9) are
 * wired. A check, not a convention.
 *
 * - **"The flag can be on":** any mention of `setAgentConnectEnabled` outside the tests and the flag's own file, in
 *   `packages/core/src` or `app/src`. A call, an import, or an aliased import all count, and a developer-setting row,
 *   a start-up apply, and a remote or build-time switch each has to reach the setter. Or the flag's initial value not
 *   being the literal `false`, which catches a default read from an environment value or a build constant.
 * - **Revoke wired:** `connected-agents` exports `revokeAgentConnection` from a file that reaches the VTA's revoke
 *   (`.revokeSubject(` or an `acl/revoke` task), so a no-op export is not enough, and a file outside `connected-agents`
 *   calls it (the Revoke sheet).
 * - **The acceptance wired:** a file that handles `keyring/agent/vdc-acceptance/1.0` also calls `verifyVdcPair`.
 *
 * It reads code by name: a refactor that renames the setter or these actions must update the names here, and the
 * failure message says so. **What it cannot see:**
 * - a setter reached from outside `packages/core/src` and `app/src` (another package, native code);
 * - one reached by a computed name (`module['set' + name]`);
 * - the module's state changed by anything but its setter and its initialiser.
 *
 * None of these exists today; a new way of turning the flag on must come through the setter or be added here.
 */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, relative, sep } from 'path'

type SourceFile = { path: string; text: string }

const SETTER = /\bsetAgentConnectEnabled\b/
const FLAG_FILE = join('connected-agents', 'agentConnectFlag.ts')
const REVOKE_EXPORT =
  /export\s+(?:async\s+)?function\s+revokeAgentConnection\b|export\s+const\s+revokeAgentConnection\b/
const REVOKE_CALL = /\brevokeAgentConnection\s*\(/
const REVOKE_REACHES_VTA = /\.revokeSubject\s*\(|acl\/revoke\//
const ACCEPTANCE_TYPE = 'keyring/agent/vdc-acceptance/1.0'

const isTest = (path: string) => path.split(sep).includes('__tests__') || /\.test\.tsx?$/.test(path)
const inModule = (path: string) => path.includes(`connected-agents${sep}`)

/** What the gate finds, as pure facts about a set of source files. */
export function releaseGate(files: SourceFile[]): { flagReachable: boolean; missing: string[] } {
  const code = files.filter((f) => !isTest(f.path))
  const flagFile = code.find((f) => f.path.endsWith(FLAG_FILE))
  const setterCalls = code.filter((f) => !f.path.endsWith(FLAG_FILE) && SETTER.test(f.text))
  const defaultOn = !!flagFile && !/let agentConnectEnabled = false\b/.test(flagFile.text)
  const flagReachable = setterCalls.length > 0 || defaultOn
  const revokeWired =
    code.some((f) => inModule(f.path) && REVOKE_EXPORT.test(f.text) && REVOKE_REACHES_VTA.test(f.text)) &&
    code.some((f) => !inModule(f.path) && REVOKE_CALL.test(f.text))
  const acceptanceWired = code.some((f) => f.text.includes(ACCEPTANCE_TYPE) && /\bverifyVdcPair\s*\(/.test(f.text))
  const missing = flagReachable
    ? [
        ...(revokeWired
          ? []
          : ['Revoke (step 7.10): revokeAgentConnection exported and called outside connected-agents']),
        ...(acceptanceWired
          ? []
          : [`the chat's VDC acceptance (step 7.9): ${ACCEPTANCE_TYPE} handled with verifyVdcPair`]),
      ]
    : []
  return { flagReachable, missing }
}

function sources(root: string): SourceFile[] {
  if (!existsSync(root)) return []
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? e.name === 'node_modules'
          ? []
          : walk(join(dir, e.name))
        : /\.tsx?$/.test(e.name)
          ? [join(dir, e.name)]
          : []
    )
  return walk(root).map((path) => ({ path, text: readFileSync(path, 'utf8') }))
}

const CORE_SRC = join(__dirname, '..', '..', '..')
const APP_SRC = join(__dirname, '..', '..', '..', '..', '..', '..', 'app', 'src')

describe('the agent-connect release gate (#1060 finding 21)', () => {
  it('the flag cannot be on in any build while Revoke (7.10) or the chat acceptance (7.9) is missing', () => {
    const files = [...sources(CORE_SRC), ...sources(APP_SRC)]
    expect(files.length).toBeGreaterThan(500)
    expect(files.some((f) => f.path.endsWith(FLAG_FILE))).toBe(true)
    const { missing } = releaseGate(files)
    if (missing.length) {
      const callers = files
        .filter((f) => !isTest(f.path) && !f.path.endsWith(FLAG_FILE) && SETTER.test(f.text))
        .map((f) => relative(join(CORE_SRC, '..', '..', '..'), f.path))
      throw new Error(
        `agent connect can be switched on (${callers.join(', ') || 'its default is not false'}) before: ${missing.join('; ')}. ` +
          'Wire them, or keep the flag unreachable. If they were renamed, update releaseGate.test.ts.'
      )
    }
  })

  it('today the flag is not reachable: nothing outside the tests sets it, and it starts off', () => {
    expect(releaseGate([...sources(CORE_SRC), ...sources(APP_SRC)]).flagReachable).toBe(false)
  })
})

describe('control: the gate bites', () => {
  const flag: SourceFile = {
    path: join('/r', 'packages', 'core', 'src', 'modules', FLAG_FILE),
    text: 'let agentConnectEnabled = false\nexport function setAgentConnectEnabled(e: boolean) { agentConnectEnabled = e }',
  }
  const devRow: SourceFile = {
    path: join('/r', 'app', 'src', 'screens', 'Developer.tsx'),
    text: 'onToggle={(v) => setAgentConnectEnabled(v)}',
  }
  const revokeExport: SourceFile = {
    path: join('/r', 'packages', 'core', 'src', 'modules', 'connected-agents', 'actions.ts'),
    text: 'export async function revokeAgentConnection(id: string) { await client.revokeSubject(id) }',
  }
  const revokeSheet: SourceFile = {
    path: join('/r', 'packages', 'core', 'src', 'screens', 'RevokeAgent.tsx'),
    text: 'onPress={() => revokeAgentConnection(agent.id)}',
  }
  const acceptance: SourceFile = {
    path: join('/r', 'packages', 'core', 'src', 'modules', 'connected-agents', 'chatControl.ts'),
    text: `if (type === '${ACCEPTANCE_TYPE}') await verifyVdcPair({ grant, acceptance })`,
  }

  it('a developer-setting row with neither step wired fails, naming both', () => {
    const { flagReachable, missing } = releaseGate([flag, devRow])
    expect(flagReachable).toBe(true)
    expect(missing).toHaveLength(2)
    expect(missing[0]).toMatch(/Revoke \(step 7\.10\)/)
    expect(missing[1]).toMatch(/acceptance \(step 7\.9\)/)
  })

  it('a default turned on is reachable too', () => {
    expect(releaseGate([{ ...flag, text: 'let agentConnectEnabled = true' }]).flagReachable).toBe(true)
  })

  it('a revoke exported but never called from a screen is not wired', () => {
    expect(releaseGate([flag, devRow, revokeExport, acceptance]).missing).toEqual([
      expect.stringMatching(/Revoke \(step 7\.10\)/),
    ])
  })

  it('with both wired, the setting may exist', () => {
    expect(releaseGate([flag, devRow, revokeExport, revokeSheet, acceptance]).missing).toEqual([])
  })

  it('an aliased import of the setter makes the flag reachable, though no call names it', () => {
    const aliased = {
      path: join('/r', 'app', 'src', 'remote', 'flags.ts'),
      text: "import { setAgentConnectEnabled as on } from '@bifold/core'\nexport const apply = (v: boolean) => on(v)",
    }
    expect(releaseGate([flag, aliased]).flagReachable).toBe(true)
  })

  it('a default read from an environment value or a build constant is reachable', () => {
    expect(
      releaseGate([{ ...flag, text: "let agentConnectEnabled = process.env.AGENT_CONNECT === '1'" }]).flagReachable
    ).toBe(true)
    expect(releaseGate([{ ...flag, text: 'let agentConnectEnabled = Config.AGENT_CONNECT' }]).flagReachable).toBe(true)
  })

  it('a no-op revokeAgentConnection, called from a screen but reaching no revoke, is not wired', () => {
    const noop = { ...revokeExport, text: 'export async function revokeAgentConnection(id: string) {}' }
    expect(releaseGate([flag, devRow, noop, revokeSheet, acceptance]).missing).toEqual([
      expect.stringMatching(/Revoke \(step 7\.10\)/),
    ])
  })

  it('a setter called only from a test does not make the flag reachable', () => {
    const inTest = {
      path: join('/r', 'packages', 'core', 'src', '__tests__', 'x.test.ts'),
      text: 'setAgentConnectEnabled(true)',
    }
    expect(releaseGate([flag, inTest]).flagReachable).toBe(false)
  })
})
