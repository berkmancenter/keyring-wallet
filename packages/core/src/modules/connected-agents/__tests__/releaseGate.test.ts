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
 *   (`.revokeSubject(` or an `acl/revoke` task), so a no-op export is not enough; and a ROUTED file outside
 *   `connected-agents` calls it: the wiring that mounts the Revoke sheet, which itself is a view taking `onRevoke`. A
 *   caller counts only if a navigator file (one registering `.Screen` elements or creating a navigator) is it, imports
 *   it, or imports a file that imports it, so an unrouted file calling it does not satisfy the gate.
 * - **The acceptance wired:** a file that handles `keyring/agent/vdc-acceptance/1.0` also calls `verifyVdcPair`.
 *
 * It reads code by name: a refactor that renames the setter or these actions must update the names here, and the
 * failure message says so. **What it cannot see:**
 * - a setter reached from outside `packages/core/src` and `app/src` (another package, native code);
 * - one reached by a computed name (`module['set' + name]`);
 * - the module's state changed by anything but its setter and its initialiser;
 * - a caller more than two imports below a navigator file (a deeper one does not count: put the call in the routed
 *   container rather than loosen this);
 * - imports matched by file name, not resolved paths: two files of one name are not told apart.
 * - the one way it can admit a caller it should not: any file containing `.Screen` (or creating a navigator) counts as
 *   a navigator and seeds the search, so a stray `.Screen` token outside navigation would count a file as routed. It
 *   over-counts navigators, which fails open on "is Revoke wired"; 14 navigator files is right for this app today.
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

const NAVIGATOR = /\.Screen\b|create(?:Native)?StackNavigator\s*\(|createBottomTabNavigator\s*\(/

/** The file names a source imports (the last segment of each specifier, without extension). */
const importedNames = (text: string): Set<string> =>
  new Set(
    [...text.matchAll(/(?:from\s+|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g)].map((m) =>
      (m[1].split('/').pop() ?? '').replace(/\.(tsx?|jsx?)$/, '')
    )
  )

const baseName = (path: string) => (path.split(sep).pop() ?? '').replace(/\.tsx?$/, '')

/** The files a navigator reaches within two imports: navigators, what they import, and what those import. */
function routed(code: SourceFile[]): Set<string> {
  const byName = new Map<string, SourceFile[]>()
  for (const f of code) byName.set(baseName(f.path), [...(byName.get(baseName(f.path)) ?? []), f])
  let frontier = code.filter((f) => NAVIGATOR.test(f.text))
  const reached = new Set(frontier.map((f) => f.path))
  for (let hop = 0; hop < 2; hop++) {
    const next: SourceFile[] = []
    for (const f of frontier)
      for (const name of importedNames(f.text))
        for (const g of byName.get(name) ?? [])
          if (!reached.has(g.path)) {
            reached.add(g.path)
            next.push(g)
          }
    frontier = next
  }
  return reached
}

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
    (() => {
      const reach = routed(code)
      return code.some((f) => !inModule(f.path) && REVOKE_CALL.test(f.text) && reach.has(f.path))
    })()
  const acceptanceWired = code.some((f) => f.text.includes(ACCEPTANCE_TYPE) && /\bverifyVdcPair\s*\(/.test(f.text))
  const missing = flagReachable
    ? [
        ...(revokeWired
          ? []
          : [
              'Revoke (step 7.10): revokeAgentConnection exported, and called from routed wiring outside connected-agents',
            ]),
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
    path: join('/r', 'packages', 'core', 'src', 'screens', 'AgentDetailsContainer.tsx'),
    text: '<AgentDetailsView onRevoke={() => revokeAgentConnection(agent.id)} />',
  }
  const navigator: SourceFile = {
    path: join('/r', 'packages', 'core', 'src', 'navigators', 'MyAgentStack.tsx'),
    text: 'import AgentDetailsContainer from \'../screens/AgentDetailsContainer\'\n<Stack.Screen name="AgentDetails" component={AgentDetailsContainer} />',
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
    expect(releaseGate([flag, devRow, revokeExport, revokeSheet, navigator, acceptance]).missing).toEqual([])
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
    expect(releaseGate([flag, devRow, noop, revokeSheet, navigator, acceptance]).missing).toEqual([
      expect.stringMatching(/Revoke \(step 7\.10\)/),
    ])
  })

  it('an unrouted caller of revokeAgentConnection does not satisfy the gate', () => {
    expect(releaseGate([flag, devRow, revokeExport, revokeSheet, acceptance]).missing).toEqual([
      expect.stringMatching(/Revoke \(step 7\.10\)/),
    ])
  })

  it('a caller one import below the routed screen counts; three imports down does not', () => {
    const screen: SourceFile = {
      path: join('/r', 'packages', 'core', 'src', 'screens', 'AgentDetailsScreen.tsx'),
      text: "import AgentRevoke from './AgentRevoke'",
    }
    const container: SourceFile = {
      path: join('/r', 'packages', 'core', 'src', 'screens', 'AgentRevoke.tsx'),
      text: 'export default () => <Sheet onRevoke={() => revokeAgentConnection(id)} />',
    }
    const nav: SourceFile = {
      ...navigator,
      text: "import AgentDetailsScreen from '../screens/AgentDetailsScreen'\n<Stack.Screen component={AgentDetailsScreen} />",
    }
    expect(releaseGate([flag, devRow, revokeExport, screen, container, nav, acceptance]).missing).toEqual([])
    const middle: SourceFile = {
      path: join('/r', 'packages', 'core', 'src', 'screens', 'Middle.tsx'),
      text: "import AgentRevoke from './AgentRevoke'",
    }
    const deeper: SourceFile = { ...screen, text: "import Middle from './Middle'" }
    expect(releaseGate([flag, devRow, revokeExport, deeper, middle, container, nav, acceptance]).missing).toEqual([
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
