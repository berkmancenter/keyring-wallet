/**
 * Every component that shows a date made by `appDateWords()`, directly or through any chain of calls, must re-render
 * when the language changes: it calls `useTranslation()` (react-i18next replaces `t` on a language change, which
 * re-renders it) or `useDateWords()`. Otherwise its dates stay in the old language until something else draws it.
 * WitnessConnections was one such component (#618), found by reading; this finds the next one.
 *
 * Deliberately dumb: one of those two calls in the component itself, or a comment in it naming why it is fine
 * without, `// dates-rerender: <reason>`. It does not try to work out where a value is computed.
 *
 * The call graph is TypeScript's own symbol resolution (imports, re-exports, aliases), so two functions that share a
 * name are never confused, and a call through an interface method reaches every class implementing it (a display
 * handler's `extractFields`).
 */
import path from 'path'
import ts from 'typescript'

const CORE = path.resolve(__dirname, '../../..')
const SRC = path.join(CORE, 'src')
const SEED = { file: path.join(SRC, 'utils/localDay.ts'), name: 'appDateWords' }
const TRIGGERS = new Set(['useTranslation', 'useDateWords'])
// A reason on the same line: a bare marker does not count.
const OPT_OUT = /\/\/[ \t]*dates-rerender:[ \t]*\S/

interface Fn {
  name: string
  file: string
  calls: Set<string>
  jsx: boolean
  trigger: boolean
  optOut: boolean
}

/** Components that reach `appDateWords()` without a way to re-render on a language change. */
function componentsThatWouldGoStale(extra: Map<string, string> = new Map()): { stale: Fn[]; reached: Fn[] } {
  const config = ts.parseJsonConfigFileContent(
    ts.readConfigFile(path.join(CORE, 'tsconfig.json'), ts.sys.readFile).config,
    ts.sys,
    CORE
  )
  const roots = config.fileNames.filter((f) => f.startsWith(SRC) && !f.includes('__tests__') && !/\.test\./.test(f))
  const options = { ...config.options, noEmit: true }
  const host = ts.createCompilerHost(options)
  const { getSourceFile, fileExists, readFile } = host
  host.fileExists = (f) => extra.has(f) || fileExists(f)
  host.readFile = (f) => extra.get(f) ?? readFile(f)
  host.getSourceFile = (f, language, ...rest) =>
    extra.has(f)
      ? ts.createSourceFile(
          f,
          extra.get(f) as string,
          language,
          true,
          f.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
        )
      : getSourceFile(f, language, ...rest)
  const program = ts.createProgram([...roots, ...extra.keys()], options, host)
  const checker = program.getTypeChecker()
  const ours = (sf: ts.SourceFile) => sf.fileName.startsWith(SRC) && !sf.isDeclarationFile

  const keyOf = (node: ts.Node) => `${node.getSourceFile().fileName}#${node.pos}`
  const isFunctionLike = (node: ts.Node): boolean =>
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ((ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node)) &&
      !!node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)))
  const declarationOf = (expression: ts.Node): ts.Node | undefined => {
    let symbol = checker.getSymbolAtLocation(expression)
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0]
    return declaration && isFunctionLike(declaration) ? declaration : undefined
  }

  const fns = new Map<string, Fn>()
  const record = (node: ts.Node, name: string): Fn => {
    const key = keyOf(node)
    if (!fns.has(key)) {
      fns.set(key, {
        name,
        file: node.getSourceFile().fileName,
        calls: new Set(),
        jsx: false,
        trigger: false,
        optOut: false,
      })
    }
    return fns.get(key) as Fn
  }

  for (const sf of program.getSourceFiles().filter(ours)) {
    const visit = (node: ts.Node, owner: Fn | undefined) => {
      let current = owner
      if (!owner && isFunctionLike(node) && 'name' in node && node.name) {
        current = record(node, (node.name as ts.Node).getText())
        // A `const X = () => …` carries its comments on the statement around it.
        const statement = ts.isVariableDeclaration(node) ? node.parent.parent : node
        current.optOut = OPT_OUT.test(statement.getFullText())
      }
      if (current) {
        if (ts.isCallExpression(node)) {
          const callee = ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression
          if (TRIGGERS.has(callee.getText())) current.trigger = true
          const target = declarationOf(callee)
          if (target) current.calls.add(keyOf(target))
        }
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) current.jsx = true
      }
      ts.forEachChild(node, (child) => visit(child, current))
    }
    ts.forEachChild(sf, (child) => visit(child, undefined))

    // A call through an interface method reaches every class method implementing it.
    const implementations = (node: ts.Node) => {
      if (ts.isClassDeclaration(node)) {
        for (const clause of node.heritageClauses ?? []) {
          for (const type of clause.types) {
            let symbol = checker.getSymbolAtLocation(type.expression)
            if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
            for (const member of node.members) {
              if (!ts.isMethodDeclaration(member) || !member.name) continue
              const signature = symbol?.members?.get(member.name.getText() as ts.__String)?.declarations?.[0]
              if (signature) record(signature, member.name.getText()).calls.add(keyOf(member))
            }
          }
        }
      }
      ts.forEachChild(node, implementations)
    }
    implementations(sf)
  }

  const reaching = new Set(
    [...fns].filter(([, fn]) => fn.file === SEED.file && fn.name === SEED.name).map(([key]) => key)
  )
  expect(reaching.size).toBe(1) // the seed itself was found
  for (let grew = true; grew; ) {
    grew = false
    for (const [key, fn] of fns) {
      if (!reaching.has(key) && [...fn.calls].some((call) => reaching.has(call))) {
        reaching.add(key)
        grew = true
      }
    }
  }
  const reached = [...fns]
    .filter(([key, fn]) => reaching.has(key) && fn.jsx && /^[A-Z]/.test(fn.name))
    .map(([, fn]) => fn)
  return { reached, stale: reached.filter((fn) => !fn.trigger && !fn.optOut) }
}

const named = (fns: Fn[]) => fns.map((fn) => `${path.relative(SRC, fn.file)} ${fn.name}`).sort()

describe('dates follow a language change', () => {
  test('every component showing appDateWords() dates re-renders on a language change', () => {
    const { stale, reached } = componentsThatWouldGoStale()
    // The walk reaches the screens #618 converted, through a call chain and through an interface method.
    expect(named(reached)).toEqual(
      expect.arrayContaining([
        'modules/history/ui/components/HistoryListItem.tsx HistoryListItem',
        'modules/openid/features/notifications/OpenIDNotificationCard.tsx OpenIDNotificationCard',
        'modules/vrc/screens/ContactDetails.tsx ContactDetails',
      ])
    )
    expect(named(stale)).toEqual([])
  }, 120_000)

  // The control: a component like WitnessConnections before #618's fix is caught; one that says why it is fine is not.
  test('a component reaching it without either call is caught, unless it says why', () => {
    // In memory only, beside localDay in a folder that exists, so TypeScript's module resolution finds them. In a
    // made-up folder (a tidy __guardFixture__/) resolution finds nothing and this test passes quietly: it did, once.
    const at = (name: string) => path.join(SRC, 'utils', `dateGuardFixture${name}`)
    const extra = new Map([
      [
        at('Helper.ts'),
        "import { absoluteDate, appDateWords } from './localDay'\nexport const connectedOn = (d: Date) => absoluteDate(d, appDateWords())\n",
      ],
      [
        at('Stale.tsx'),
        "import React from 'react'\nimport { Text } from 'react-native'\nimport { connectedOn } from './dateGuardFixtureHelper'\nexport const Stale: React.FC<{ at: Date }> = ({ at }) => <Text>{connectedOn(at)}</Text>\n",
      ],
      [
        at('Excused.tsx'),
        "import React from 'react'\nimport { Text } from 'react-native'\nimport { connectedOn } from './dateGuardFixtureHelper'\n// dates-rerender: drawn again by its parent's useTranslation on every language change\nexport const Excused: React.FC<{ at: Date }> = ({ at }) => <Text>{connectedOn(at)}</Text>\n",
      ],
      [
        at('Silent.tsx'),
        "import React from 'react'\nimport { Text } from 'react-native'\nimport { connectedOn } from './dateGuardFixtureHelper'\n// dates-rerender:\nexport const Silent: React.FC<{ at: Date }> = ({ at }) => <Text>{connectedOn(at)}</Text>\n",
      ],
    ])
    const { stale } = componentsThatWouldGoStale(extra)
    expect(named(stale)).toEqual(['utils/dateGuardFixtureSilent.tsx Silent', 'utils/dateGuardFixtureStale.tsx Stale'])
  }, 120_000)
})
