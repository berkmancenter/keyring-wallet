/**
 * Every Trust Task family Keyring knows at more than one version is sent at a version picked from what the other
 * side serves, or by stepping down from the newest Keyring knows: never one version written at the call site. The
 * sign-in port sent `device/heartbeat/0.2` alone, an agent from vta-service 0.67 serves only 0.3, and every sign-in
 * on one ended at "the agent needs an update" before its grant was sent (IN-390, #823). This finds the next one.
 *
 * Deliberately dumb, and loud:
 * - A construct that picks a version carries `@versionLadder` in its doc comment, naming the families it ladders
 *   (`@versionLadder rooms/keys/act`) or none for every family in it. A function, method, const or member may.
 * - In one, a list holding two or more versions of a family runs newest first from the newest version Keyring
 *   knows, and the construct names that version somewhere.
 * - Outside one, a version of such a family passed as an argument, or as a document's `type`, carries
 *   `// version-pinned: <reason>` on its line or a comment line just above: the other side serves that one version only. A
 *   list of versions that are read, never sent (the requests the phone parses), carries `// version-set: <reason>`.
 *   A bare marker does not count.
 * - A set that must hold every version a ladder may send (the read lane, a rule's coverage, what a capability accepts)
 *   carries `@versionCoverage`: newest first, like a ladder, so a version added to the ladder fails here until the set
 *   holds it, where a set that silently missed it would only change what happens to that one task (bifold #837's
 *   heartbeat). It is not a ladder and does not say what is sent: it may hold more than the ladder (the read lane holds
 *   rooms/keys/browse 0.2, which nothing sends), a send inside one is outside a ladder, and it never meets the FLOOR.
 * - Every such family is seen at least once. One sent in a shape this cannot see fails rather than passing unseen.
 *
 * "Newest" is the newest version named anywhere in core's src, so a version added for one call site is the one
 * every other site of that family must now reach. Values are resolved through TypeScript's own symbols: constants,
 * object members, template literals over `SPEC`, conditionals, `??` and `||`, and a `let` through every value
 * assigned to it. A version built at run time (a slug list mapped onto `SPEC`) is not seen, and needs no marker.
 */
import path from 'path'
import ts from 'typescript'

const CORE = path.resolve(__dirname, '../../../..')
const SRC = path.join(CORE, 'src')
const URI = /^https:\/\/trusttasks\.org\/spec\/(.+)\/(\d+\.\d+)$/
// A reason on the same line, or on a comment line of its own just above: a bare marker does not count, and nor does
// a marker that ends the statement before.
const PINNED = /\/\/[ \t]*version-pinned:[ \t]*\S/
const SET = /\/\/[ \t]*version-set:[ \t]*\S/
const TAG = 'versionLadder'
const COVERAGE = 'versionCoverage'

/**
 * The families the 276.11 fixes ladder, and the file each one's ladder is in: held whatever else changes, so a
 * resolution that quietly finds nothing fails here rather than passing everything. `null`: Keyring knows one version
 * (`device/register/0.2`, all an agent serves from 04a96cd9); a second makes it a family held like the rest.
 */
const FLOOR: Record<string, string | null> = {
  'device/heartbeat': 'modules/trust-tasks/module/vtaDevices.ts',
  'device/register': null,
  'rooms/keys/browse': 'modules/rooms/real/agentRoomsService.ts',
  'rooms/keys/act': 'modules/rooms/real/wire.ts',
  'rooms/records/put': 'modules/rooms/real/agentRoomsService.ts',
  'vtc/rooms/offers/list': 'modules/rooms/real/wire.ts',
  'vta/contexts/delete': 'modules/trust-tasks/module/VtaClient.ts',
  'auth/step-up/approve-response': 'modules/trust-tasks/module/stepUp.ts',
}

type Kind =
  | 'sent outside a ladder'
  | 'listed outside a ladder'
  | 'not newest first'
  | 'never reaches the newest'
  | 'names a family Keyring does not know'
  | 'never seen'

interface Problem {
  file: string
  line: number
  family: string
  kind: Kind
  versions: string[]
}

interface Survey {
  known: Map<string, Set<string>>
  problems: Problem[]
  /** Family to the files (relative to src) holding a ladder for it. */
  ladders: Map<string, Set<string>>
}

const byVersion = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })
const shown = (p: Problem) => `${p.file}:${p.line} ${p.family} [${p.versions.join(', ')}] ${p.kind}`

function survey(extra: Map<string, string> = new Map()): Survey {
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
      ? ts.createSourceFile(f, extra.get(f) as string, language, true, ts.ScriptKind.TS)
      : getSourceFile(f, language, ...rest)
  const program = ts.createProgram([...roots, ...extra.keys()], options, host)
  const checker = program.getTypeChecker()
  const files = program
    .getSourceFiles()
    .filter((sf) => sf.fileName.startsWith(SRC) && !sf.isDeclarationFile && !sf.fileName.includes('__tests__'))
  const walk = (node: ts.Node, visit: (n: ts.Node) => void) => {
    visit(node)
    ts.forEachChild(node, (child) => walk(child, visit))
  }

  const declarationOf = (expression: ts.Expression): ts.Declaration | undefined => {
    let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expression) ? expression.name : expression)
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
    return symbol?.valueDeclaration ?? symbol?.declarations?.[0]
  }
  // Every value a `let` is given after its declaration.
  const assigned = new Map<ts.Declaration, ts.Expression[]>()
  for (const sf of files) {
    walk(sf, (n) => {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left)) {
        const declaration = declarationOf(n.left)
        if (declaration) assigned.set(declaration, [...(assigned.get(declaration) ?? []), n.right])
      }
    })
  }
  const values = (expression: ts.Expression | undefined, depth = 0): string[] => {
    if (!expression || depth > 10) return []
    const next = (e: ts.Expression | undefined) => values(e, depth + 1)
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return [expression.text]
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression) ||
      ts.isNonNullExpression(expression)
    )
      return next(expression.expression)
    if (ts.isConditionalExpression(expression)) return [...next(expression.whenTrue), ...next(expression.whenFalse)]
    if (
      ts.isBinaryExpression(expression) &&
      (expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        expression.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    )
      return [...next(expression.left), ...next(expression.right)]
    if (ts.isTemplateExpression(expression)) {
      let text = expression.head.text
      for (const span of expression.templateSpans) {
        const part = next(span.expression)
        if (part.length !== 1) return []
        text += part[0] + span.literal.text
      }
      return [text]
    }
    if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression)) {
      const declaration = declarationOf(expression)
      if (declaration && (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)))
        return [...next(declaration.initializer), ...(assigned.get(declaration) ?? []).flatMap(next)]
    }
    return []
  }
  const versionsOf = (expression: ts.Expression): Array<[string, string]> =>
    values(expression).flatMap((v) => {
      const m = URI.exec(v)
      return m ? [[m[1], m[2]] as [string, string]] : []
    })

  const known = new Map<string, Set<string>>()
  for (const sf of files) {
    walk(sf, (n) => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) {
        for (const [family, version] of versionsOf(n)) known.set(family, (known.get(family) ?? new Set()).add(version))
      }
    })
  }
  const several = (family: string) => (known.get(family)?.size ?? 0) > 1
  const newest = (family: string) => [...(known.get(family) ?? [])].sort(byVersion).pop() as string

  const problems: Problem[] = []
  const place = (node: ts.Node) => {
    const sf = node.getSourceFile()
    return { file: path.relative(SRC, sf.fileName), line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1 }
  }
  const report = (node: ts.Node, family: string, kind: Kind, versions: string[]) => {
    const where = place(node)
    if (!problems.some((p) => p.file === where.file && p.line === where.line && p.family === family && p.kind === kind))
      problems.push({ ...where, family, kind, versions })
  }
  const markedBy = (node: ts.Node, marker: RegExp) => {
    const sf = node.getSourceFile()
    const line = sf.getLineAndCharacterOfPosition(node.getStart()).line
    const lines = sf.text.split('\n')
    return marker.test(lines[line]) || (line > 0 && /^\s*\/\//.test(lines[line - 1]) && marker.test(lines[line - 1]))
  }
  /** The nearest construct around `node` carrying one of `tags` that covers `family`. */
  const taggedFor = (node: ts.Node, family: string, tags: string[]): ts.Node | undefined => {
    for (let at: ts.Node | undefined = node; at; at = at.parent) {
      for (const tag of ts.getJSDocTags(at)) {
        if (!tags.includes(tag.tagName.text)) continue
        const named = (ts.getTextOfJSDocComment(tag.comment) ?? '').split(/[\s,]+/).filter(Boolean)
        if (named.length === 0 || named.includes(family)) return at
      }
    }
    return undefined
  }
  const ladderOf = (node: ts.Node, family: string) => taggedFor(node, family, [TAG])

  const seen = new Set<string>()
  const ladderNodes = new Map<ts.Node, Set<string>>()
  const noteLadder = (node: ts.Node, family: string) =>
    ladderNodes.set(node, (ladderNodes.get(node) ?? new Set()).add(family))
  for (const sf of files) {
    walk(sf, (n) => {
      const sent: ts.Expression[] = []
      if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && n.arguments) sent.push(...n.arguments)
      if (ts.isPropertyAssignment(n) && n.name.getText() === 'type') sent.push(n.initializer)
      for (const argument of sent) {
        const families = new Map<string, Set<string>>()
        for (const [family, version] of versionsOf(argument))
          if (several(family)) families.set(family, (families.get(family) ?? new Set()).add(version))
        for (const [family, versions] of families) {
          seen.add(family)
          const ladder = ladderOf(argument, family)
          if (ladder) noteLadder(ladder, family)
          else if (!markedBy(argument, PINNED))
            report(argument, family, 'sent outside a ladder', [...versions].sort(byVersion))
        }
      }
      if (ts.isArrayLiteralExpression(n)) {
        const listed = new Map<string, string[]>()
        for (const element of n.elements)
          if (!ts.isSpreadElement(element) && !ts.isOmittedExpression(element))
            for (const [family, version] of versionsOf(element))
              if (several(family)) listed.set(family, [...(listed.get(family) ?? []), version])
        for (const [family, versions] of listed) {
          seen.add(family)
          if (versions.length < 2 || markedBy(n, SET)) continue
          const ladder = ladderOf(n, family)
          if (!ladder && !taggedFor(n, family, [COVERAGE])) {
            report(n, family, 'listed outside a ladder', versions)
            continue
          }
          if (ladder) noteLadder(ladder, family)
          const descending = versions.every((v, i) => i === 0 || byVersion(versions[i - 1], v) > 0)
          if (!descending || versions[0] !== newest(family)) report(n, family, 'not newest first', versions)
        }
      }
      for (const tag of ts.getJSDocTags(n)) {
        if (tag.tagName.text !== TAG && tag.tagName.text !== COVERAGE) continue
        for (const family of (ts.getTextOfJSDocComment(tag.comment) ?? '').split(/[\s,]+/).filter(Boolean))
          if (!known.has(family)) report(n, family, 'names a family Keyring does not know', [])
      }
    })
  }

  const ladders = new Map<string, Set<string>>()
  for (const [node, families] of ladderNodes) {
    for (const family of families) {
      ladders.set(family, (ladders.get(family) ?? new Set()).add(place(node).file))
      const reached = new Set<string>()
      walk(node, (n) => {
        if (ts.isExpression(n)) for (const [f, v] of versionsOf(n)) if (f === family) reached.add(v)
      })
      if (!reached.has(newest(family)))
        report(
          node,
          family,
          'never reaches the newest',
          [...reached].sort(byVersion).concat(`newest ${newest(family)}`)
        )
    }
  }
  for (const [family, versions] of known)
    if (versions.size > 1 && !seen.has(family))
      problems.push({ file: '', line: 0, family, kind: 'never seen', versions: [...versions].sort(byVersion) })
  return { known, problems, ladders }
}

// Each a small module of its own, in families no real code uses, so each rule is shown failing and passing.
const fixture = (name: string) => path.join(SRC, '__versionLadderGuard__', `${name}.ts`)
const SEND = `declare function send(type: string, payload?: unknown): Promise<unknown>\nconst SPEC = 'https://trusttasks.org/spec/'\n`
const FIXTURES = new Map<string, string>([
  // The IN-390 shape: a family gains 0.2 for one call, and another still sends 0.1 alone.
  [
    fixture('bareOlder'),
    `${SEND}export const T = { beat: \`\${SPEC}guard/beat/0.1\`, beat02: \`\${SPEC}guard/beat/0.2\` }\nexport const go = () => send(T.beat)\nexport const goToo = () => send(T.beat02) // version-pinned: the fixture's host serves 0.2 only\n`,
  ],
  // A step-down held in a \`let\`, with no tag: seen through its assignments.
  [
    fixture('untaggedLet'),
    `${SEND}const L = { a1: \`\${SPEC}guard/let/0.1\`, a2: \`\${SPEC}guard/let/0.2\` }\nexport async function list() {\n  let type = L.a2\n  try {\n    return await send(type)\n  } catch {\n    type = L.a1\n    return send(type)\n  }\n}\n`,
  ],
  // A tagged ladder, newest first: passes. Then one oldest first, and one that never reaches 0.3.
  [
    fixture('tagged'),
    `${SEND}declare function ask(name: string, types: string[]): Promise<unknown>\nconst G = { g1: \`\${SPEC}guard/good/0.1\`, g2: \`\${SPEC}guard/good/0.2\` }\nconst B = { b1: \`\${SPEC}guard/order/0.1\`, b2: \`\${SPEC}guard/order/0.2\` }\nconst S = { s1: \`\${SPEC}guard/stale/0.1\`, s2: \`\${SPEC}guard/stale/0.2\`, s3: \`\${SPEC}guard/stale/0.3\` }\nexport const known = () => send(S.s3) // version-pinned: shows 0.3 is known\n/** @versionLadder guard/good */\nexport const good = () => ask('good', [G.g2, G.g1])\n/** @versionLadder guard/order */\nexport const order = () => ask('order', [B.b1, B.b2])\n/** @versionLadder */\nexport async function stale() {\n  let type = S.s2\n  try {\n    return await send(type)\n  } catch {\n    type = S.s1\n    return send(type)\n  }\n}\n/** @versionLadder guard/typo */\nexport const typo = () => undefined\n`,
  ],
  // Markers: a reason passes, a bare marker does not. A document's \`type\` is a send too.
  [
    fixture('markers'),
    `${SEND}const P = { p1: \`\${SPEC}guard/pin/0.1\`, p2: \`\${SPEC}guard/pin/0.2\` }\nexport const why = () => send(P.p1) // version-pinned: the fixture's host serves 0.1 only\nexport const bare = () => send(P.p1) // version-pinned:\n// version-set: the versions this fixture reads\nexport const READS = [P.p1, P.p2]\nexport const UNSAID = [P.p2, P.p1]\nexport const doc = { type: P.p1 }\n`,
  ],
  // A coverage set: newest first passes, an old one fails, and a send inside one is not in a ladder.
  [
    fixture('coverage'),
    `${SEND}const C = { c1: \`\${SPEC}guard/cover/0.1\`, c2: \`\${SPEC}guard/cover/0.2\` }\nconst O = { o1: \`\${SPEC}guard/coverold/0.1\`, o2: \`\${SPEC}guard/coverold/0.2\`, o3: \`\${SPEC}guard/coverold/0.3\` }\n/** @versionCoverage guard/cover */\nexport const HELD = new Set([C.c2, C.c1])\n/** @versionCoverage guard/coverold */\nexport const STALE = new Set([O.o2, O.o1])\n/** @versionCoverage guard/cover */\nexport const notALadder = () => send(C.c2)\nexport const reaches = () => send(O.o3) // version-pinned: shows 0.3 is known\n`,
  ],
  // Two versions known, neither ever sent or listed: this cannot see how the family is sent.
  [
    fixture('unseen'),
    `const SPEC = 'https://trusttasks.org/spec/'\nexport const H = { h1: \`\${SPEC}guard/hidden/0.1\`, h2: \`\${SPEC}guard/hidden/0.2\` }\n`,
  ],
])

describe('every family Keyring knows at more than one version is sent from a ladder', () => {
  let found: Survey
  beforeAll(() => {
    found = survey(FIXTURES)
  }, 180_000)
  const inFixtures = (p: Problem) => p.file.startsWith('__versionLadderGuard__') || p.family.startsWith('guard/')

  it("finds nothing in core's src", () => {
    expect(found.problems.filter((p) => !inFixtures(p)).map(shown)).toEqual([])
  })

  it('holds the floor: each fixed family is known, and laddered in its own file', () => {
    for (const [family, file] of Object.entries(FLOOR)) {
      expect([family, found.known.has(family)]).toEqual([family, true])
      if (file === null) {
        expect([family, found.known.get(family)?.size === 1 || found.ladders.has(family)]).toEqual([family, true])
      } else {
        expect([family, [...(found.ladders.get(family) ?? [])]]).toEqual([family, expect.arrayContaining([file])])
      }
    }
  })

  it('a coverage set is not a ladder: nothing it holds counts as a family laddered in its file', () => {
    expect(found.ladders.has('guard/cover')).toBe(false)
    expect(found.ladders.get('rooms/keys/browse')).not.toContain('modules/trust-tasks/module/vtaReadLane.ts')
    expect(found.ladders.get('device/heartbeat')).not.toContain('modules/trust-tasks/module/vtaReadLane.ts')
  })

  it('reports each rule broken in the fixtures, and nothing they keep', () => {
    // One line per fixture, family and rule: a rule broken at two sites is one line here (the lines are checked below).
    const got = [
      ...new Set(
        found.problems.filter(inFixtures).map((p) => `${path.basename(p.file, '.ts') || '-'} ${p.family} ${p.kind}`)
      ),
    ].sort()
    expect(got).toEqual(
      [
        'bareOlder guard/beat sent outside a ladder',
        'untaggedLet guard/let sent outside a ladder',
        'tagged guard/order not newest first',
        'tagged guard/stale never reaches the newest',
        'tagged guard/typo names a family Keyring does not know',
        'coverage guard/cover sent outside a ladder',
        'coverage guard/coverold not newest first',
        'markers guard/pin sent outside a ladder', // the bare marker, and the document's type
        'markers guard/pin listed outside a ladder',
        '- guard/hidden never seen',
      ].sort()
    )
    // The bare marker and the document's `type` are two sites; the reasoned one is none.
    expect(
      found.problems.filter((p) => p.family === 'guard/pin' && p.kind === 'sent outside a ladder').map((p) => p.line)
    ).toEqual([5, 9])
  })
})
