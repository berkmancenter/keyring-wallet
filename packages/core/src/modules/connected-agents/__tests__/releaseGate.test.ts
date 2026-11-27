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
 * - an import through a package specifier (`@bifold/core`) or a path alias: only relative imports are resolved, by
 *   path, so a caller reached only through one does not count. This fails closed (a real caller is missed, and the
 *   gate stays red), never open: two files of one name are told apart. That is safe only while every navigator is in
 *   `packages/core/src`, so the Revoke wiring is a relative import: were one in `app/src`, it would import through
 *   `@bifold/core` and the gate could never be satisfied. A test below fails when a navigator appears outside the
 *   package, which is the moment to teach the gate that import;
 * - the one way it can admit a caller it should not: any file whose live code contains `.Screen` (or creates a
 *   navigator) counts as a navigator and seeds the search, so a stray `.Screen` token in code outside navigation would
 *   count a file as routed. It over-counts navigators, which fails open on "is Revoke wired". Every file it seeds from
 *   today is a real navigator. Comments and strings no longer count: each pattern that could count a step as wired, or
 *   the flag as off, reads the file with its comments blanked, and the revoke call and export with its strings blanked
 *   too (`blanked`, TypeScript's own parser). The setter is still read raw, since a mention there only errs strict.
 *
 * A new way of turning the flag on must come through the setter or be added here.
 */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { dirname, join, relative, resolve, sep } from 'path'
import ts from 'typescript'

type SourceFile = { path: string; text: string }

/**
 * `text` with every comment blanked, and with `strings` also every string literal, template part and JSX text: the
 * same length, newlines kept, so a pattern can match only live code. Read with TypeScript's own parser, so a `//` or a
 * `/*` inside a string is not a comment.
 */
export function blanked(path: string, text: string, strings: boolean): string {
  const kind = /\.[jt]sx$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, kind)
  const ranges: [number, number][] = []
  const comments = (pos: number) => {
    for (const r of [
      ...(ts.getLeadingCommentRanges(text, pos) ?? []),
      ...(ts.getTrailingCommentRanges(text, pos) ?? []),
    ])
      ranges.push([r.pos, r.end])
  }
  // Every token, punctuation included (`getChildren`), so a comment before a closing `}` with nothing after it is
  // found too: each comment is in the leading trivia of the token after it, the end-of-file token last.
  const visit = (node: ts.Node) => {
    const children = node.getChildren(source)
    if (children.length === 0) comments(node.pos)
    const literal =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      node.kind === ts.SyntaxKind.JsxText
    if (strings && literal) ranges.push([node.getStart(source), node.end])
    for (const child of children) visit(child)
  }
  visit(source)
  const out = text.split('')
  for (const [from, to] of ranges) for (let i = from; i < to; i++) if (out[i] !== '\n') out[i] = ' '
  return out.join('')
}

const SETTER = /\bsetAgentConnectEnabled\b/
const FLAG_FILE = join('connected-agents', 'agentConnectFlag.ts')
const REVOKE_EXPORT =
  /export\s+(?:async\s+)?function\s+revokeAgentConnection\b|export\s+const\s+revokeAgentConnection\b/
const REVOKE_CALL = /\brevokeAgentConnection\s*\(/
const REVOKE_REACHES_VTA = /\.revokeSubject\s*\(|acl\/revoke\//
const ACCEPTANCE_TYPE = 'keyring/agent/vdc-acceptance/1.0'

const NAVIGATOR = /\.Screen\b|create(?:Native)?StackNavigator\s*\(|createBottomTabNavigator\s*\(/

const IMPORT = /(?:from\s+|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g
const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', `${sep}index.ts`, `${sep}index.tsx`]

/**
 * The files a source imports, by resolved path. Only relative specifiers are followed: a package specifier
 * (`@bifold/core`, `react-native`) is not, so a caller reached only through one does not count (it fails closed).
 */
function importedFiles(from: SourceFile, byPath: Map<string, SourceFile>): SourceFile[] {
  const found: SourceFile[] = []
  for (const m of from.text.matchAll(IMPORT)) {
    if (!m[1].startsWith('.')) continue
    const base = resolve(dirname(from.path), m[1])
    const hit = EXTENSIONS.map((ext) => byPath.get(base + ext)).find((f) => f !== undefined)
    if (hit) found.push(hit)
  }
  return found
}

/** The files a navigator reaches within two imports: navigators, what they import, and what those import. */
function routed(code: SourceFile[]): Set<string> {
  const byPath = new Map(code.map((f) => [resolve(f.path), f] as const))
  let frontier = code.filter((f) => NAVIGATOR.test(f.text))
  const reached = new Set(frontier.map((f) => f.path))
  for (let hop = 0; hop < 2; hop++) {
    const next: SourceFile[] = []
    for (const f of frontier)
      for (const g of importedFiles(f, byPath))
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
  const raw = files.filter((f) => !isTest(f.path))
  // Each pattern reads the view where a false match errs strict, never open. The setter: any mention, raw, comments
  // included (a mention only makes the flag look reachable). Everything that would count a step as wired, or the flag
  // as off: comments blanked (`live`), and for the revoke call and export also strings blanked (`bare`), so a comment
  // or a string that names a call is not a call.
  const live = raw.map((f) => ({ path: f.path, text: blanked(f.path, f.text, false) }))
  const bare = new Map(raw.map((f) => [f.path, blanked(f.path, f.text, true)]))
  const flagFile = live.find((f) => f.path.endsWith(FLAG_FILE))
  const setterCalls = raw.filter((f) => !f.path.endsWith(FLAG_FILE) && SETTER.test(f.text))
  const defaultOn = !!flagFile && !/let agentConnectEnabled = false\b/.test(flagFile.text)
  const flagReachable = setterCalls.length > 0 || defaultOn
  const revokeWired =
    live.some(
      (f) => inModule(f.path) && REVOKE_EXPORT.test(bare.get(f.path) ?? '') && REVOKE_REACHES_VTA.test(f.text)
    ) &&
    (() => {
      const reach = routed(live)
      return live.some((f) => !inModule(f.path) && REVOKE_CALL.test(bare.get(f.path) ?? '') && reach.has(f.path))
    })()
  const acceptanceWired = live.some((f) => f.text.includes(ACCEPTANCE_TYPE) && /\bverifyVdcPair\s*\(/.test(f.text))
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

  it('every navigator is in packages/core/src, so the Revoke wiring is an import the gate can follow', () => {
    const navigators = (root: string) =>
      sources(root)
        .filter((f) => !isTest(f.path) && NAVIGATOR.test(f.text))
        .map((f) => relative(join(CORE_SRC, '..', '..', '..'), f.path))
    // Controls, one per root: app/src resolves and holds code (a root that does not exist reads as no files, and then
    // as no navigators), and the same reading finds the package's navigators. So an empty app list is a measured zero.
    expect(sources(APP_SRC).length).toBeGreaterThan(0)
    expect(navigators(CORE_SRC).length).toBeGreaterThan(0)
    // A navigator in app/src reaches the package through `@bifold/core`, which the gate does not follow: teach it that
    // import before adding one, or Revoke can never count as wired.
    expect(navigators(APP_SRC)).toEqual([])
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

  const wiredTree = () => [flag, devRow, revokeExport, revokeSheet, navigator, acceptance]
  const revokeMissing = [expect.stringMatching(/Revoke \(step 7\.10\)/)]

  describe('a comment or a string that names a call is not the call (found by the review lane on #1082)', () => {
    it('control: the tree wired for real passes', () => {
      expect(releaseGate(wiredTree()).missing).toEqual([])
    })

    it('a routed caller whose call is only in a comment, a block comment or a JSX comment is not wired', () => {
      for (const text of [
        '// onRevoke calls revokeAgentConnection(agent.id) once 7.10 lands\n<AgentDetailsView />',
        '/* revokeAgentConnection(agent.id) */\n<AgentDetailsView />',
        '<View>{/* revokeAgentConnection(agent.id) */}<AgentDetailsView /></View>',
      ]) {
        const tree = wiredTree().map((f) => (f === revokeSheet ? { ...f, text } : f))
        expect([text, releaseGate(tree).missing]).toEqual([text, revokeMissing])
      }
    })

    it('a call named in a string, a template or JSX text is not wired either', () => {
      for (const text of [
        "const hint = 'revokeAgentConnection(agent.id)'",
        'const hint = `revokeAgentConnection(${agent.id})`',
        '<Text>revokeAgentConnection(id) is step 7.10</Text>',
      ]) {
        const tree = wiredTree().map((f) => (f === revokeSheet ? { ...f, text } : f))
        expect([text, releaseGate(tree).missing]).toEqual([text, revokeMissing])
      }
    })

    it('an export only in a comment, or reaching the VTA only in a comment, is not wired', () => {
      const commentedExport = {
        ...revokeExport,
        text: '// export async function revokeAgentConnection(id) {}\nclient.revokeSubject(id)',
      }
      expect(releaseGate(wiredTree().map((f) => (f === revokeExport ? commentedExport : f))).missing).toEqual(
        revokeMissing
      )
      const noOp = {
        ...revokeExport,
        text: 'export async function revokeAgentConnection(id: string) { /* client.revokeSubject(id) */ }',
      }
      expect(releaseGate(wiredTree().map((f) => (f === revokeExport ? noOp : f))).missing).toEqual(revokeMissing)
      // control: an acl/revoke task named in a string still reaches the VTA (strings are kept for that pattern)
      const byTask = {
        ...revokeExport,
        text: "export async function revokeAgentConnection(id: string) { await task('https://trusttasks.org/spec/acl/revoke/0.3', id) }",
      }
      expect(releaseGate(wiredTree().map((f) => (f === revokeExport ? byTask : f))).missing).toEqual([])
    })

    it('a default turned on beside a commented "= false" is still reachable', () => {
      const hidden = { ...flag, text: '// let agentConnectEnabled = false\nlet agentConnectEnabled = true' }
      expect(releaseGate([hidden]).flagReachable).toBe(true)
    })

    it('a .Screen or an import only in a comment seeds and follows nothing', () => {
      const commentedNav = {
        ...navigator,
        text: "// import AgentDetailsContainer from '../screens/AgentDetailsContainer'\n// <Stack.Screen />",
      }
      expect(releaseGate(wiredTree().map((f) => (f === navigator ? commentedNav : f))).missing).toEqual(revokeMissing)
    })

    it('blanked keeps the length and the lines, and a // inside a string is not a comment', () => {
      const text = "const u = 'https://x.example/a' // note\n/* b */ f()"
      const out = blanked('a.ts', text, false)
      expect(out).toHaveLength(text.length)
      expect(out.split('\n')).toHaveLength(2)
      expect(out).toContain("'https://x.example/a'")
      expect(out).not.toContain('note')
      expect(out).toContain('f()')
      expect(blanked('a.ts', text, true)).not.toContain('x.example')
    })
  })

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

  it('a file that only shares its name with one a screen imports is not routed', () => {
    const screen: SourceFile = {
      path: join('/r', 'packages', 'core', 'src', 'screens', 'AgentDetailsScreen.tsx'),
      text: "import AgentRevoke from '../hooks/AgentRevoke'",
    }
    const sameNameHook: SourceFile = {
      path: join('/r', 'packages', 'core', 'src', 'hooks', 'AgentRevoke.ts'),
      text: 'export const useNothing = () => undefined',
    }
    const unroutedCaller: SourceFile = {
      path: join('/r', 'packages', 'core', 'src', 'screens', 'AgentRevoke.tsx'),
      text: 'export default () => <Sheet onRevoke={() => revokeAgentConnection(id)} />',
    }
    const nav: SourceFile = {
      ...navigator,
      text: "import AgentDetailsScreen from '../screens/AgentDetailsScreen'\n<Stack.Screen component={AgentDetailsScreen} />",
    }
    expect(
      releaseGate([flag, devRow, revokeExport, screen, sameNameHook, unroutedCaller, nav, acceptance]).missing
    ).toEqual([expect.stringMatching(/Revoke \(step 7\.10\)/)])
    // Control: the screen importing the caller itself, by its own path, does count.
    const importsCaller = { ...screen, text: "import AgentRevoke from './AgentRevoke'" }
    expect(
      releaseGate([flag, devRow, revokeExport, importsCaller, sameNameHook, unroutedCaller, nav, acceptance]).missing
    ).toEqual([])
  })

  it('a setter called only from a test does not make the flag reachable', () => {
    const inTest = {
      path: join('/r', 'packages', 'core', 'src', '__tests__', 'x.test.ts'),
      text: 'setAgentConnectEnabled(true)',
    }
    expect(releaseGate([flag, inTest]).flagReachable).toBe(false)
  })
})
