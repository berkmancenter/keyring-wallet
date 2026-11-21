/**
 * Who may put a relationship proposal in front of the person (`setProposalPrompt`).
 *
 * `respondToRelationshipProposal` (ceremony.ts) sends every answer whose key starts with `enc:` to the shared-connect
 * inviter's handler, which answers only codes this phone showed and drops the rest after the prompt is cleared. That
 * is safe only while the inviter is the one caller that sets an `enc:` prompt. A new caller keyed by an encounter key
 * would have its Accept dropped after the consent sheet closed, so the person would believe they had accepted when
 * nothing was.
 *
 * Today there are two callers: the ceremony, keyed by a real connection id, and the inviter, keyed by `enc:` + the
 * code's id. This holds that set, derived from core's source rather than listed by hand, so a third caller is a
 * deliberate edit here and not a quiet one. A call is found however its callee is written (`store.setProposalPrompt`,
 * `store['setProposalPrompt']`, a destructured `setProposalPrompt`); the method's own definition, comments and tests
 * are not calls. A call through a renamed alias is not seen.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import ts from 'typescript'

const SRC = path.resolve(__dirname, '../../..')
const NAME = 'setProposalPrompt'

/** Production callers, by path under core's src, with how many calls each makes. */
const CALLERS: Record<string, number> = {
  'modules/trust-tasks/ceremony.ts': 1,
  'modules/trust-tasks/module/sharedConnectInviterCeremony.ts': 1,
}

const notProduction = (rel: string) => /(^|\/)__tests__\/|\.test\.|(^|\/)__mocks__\/|(^|\/)fixtures?\//.test(rel)

/** The calls to `setProposalPrompt` in one file's source. */
function callsIn(fileName: string, text: string): number {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, kind)
  let calls = 0
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (
        (ts.isIdentifier(callee) && callee.text === NAME) ||
        (ts.isPropertyAccessExpression(callee) && callee.name.text === NAME) ||
        (ts.isElementAccessExpression(callee) &&
          ts.isStringLiteralLike(callee.argumentExpression) &&
          callee.argumentExpression.text === NAME)
      )
        calls += 1
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return calls
}

/** Every production file under `root` that calls `setProposalPrompt`, with its count. */
function callersUnder(root: string): Record<string, number> {
  const found: Record<string, number> = {}
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const full = path.join(dir, entry.name)
      const rel = path.relative(root, full).split(path.sep).join('/')
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') && !notProduction(rel)) {
        const calls = callsIn(entry.name, fs.readFileSync(full, 'utf8'))
        if (calls > 0) found[rel] = calls
      }
    }
  }
  walk(root)
  return found
}

describe('who puts a relationship proposal in front of the person', () => {
  it('finds a call however its callee is written, and not the definition, a comment or a test', () => {
    expect(callsIn('a.ts', "vrcFlowStore.setProposalPrompt({ connectionId: 'enc:x' })")).toBe(1)
    expect(callsIn('a.ts', "store['setProposalPrompt'](prompt)")).toBe(1)
    expect(callsIn('a.tsx', 'const { setProposalPrompt } = store\nsetProposalPrompt(prompt)')).toBe(1)
    expect(callsIn('a.ts', 'class Store { setProposalPrompt(prompt: Prompt): void {} }')).toBe(0)
    expect(callsIn('a.ts', '// vrcFlowStore.setProposalPrompt(prompt)\n/* setProposalPrompt(p) */')).toBe(0)
    expect(notProduction('modules/x/__tests__/a.test.ts')).toBe(true)
    expect(notProduction('modules/x/ceremony.ts')).toBe(false)
  })

  it('sees a caller added anywhere in a tree, with how many calls it makes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proposal-callers-'))
    try {
      fs.mkdirSync(path.join(root, 'modules/reader'), { recursive: true })
      fs.mkdirSync(path.join(root, 'modules/reader/__tests__'), { recursive: true })
      fs.writeFileSync(
        path.join(root, 'modules/reader/scan.ts'),
        "store.setProposalPrompt({ connectionId: 'enc:a' })\nstore.setProposalPrompt({ connectionId: 'enc:b' })\n"
      )
      fs.writeFileSync(path.join(root, 'modules/reader/__tests__/scan.test.ts'), 'store.setProposalPrompt(p)\n')
      expect(callersUnder(root)).toEqual({ 'modules/reader/scan.ts': 2 })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('is the ceremony and the shared-connect inviter, once each, and nothing else', () => {
    // A new caller fails here. Before adding it to CALLERS: if its key can start with `enc:`, its Accept goes to the
    // inviter's handler and is dropped (ceremony.ts, respondToRelationshipProposal).
    expect(callersUnder(SRC)).toEqual(CALLERS)
  })
})
