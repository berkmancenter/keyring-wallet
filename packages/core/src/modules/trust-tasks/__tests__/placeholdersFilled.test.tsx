/**
 * No "{{…}}" on screen. The approver's request card read "{{asker}}'s phone shows the same code:" (a6's K1 run,
 * 11-13): ApprovalDetails called t('Requests.ForAgentMatchCode') with no params, live since 11-10. The other request
 * rows render through the mock `t` that returns the key, so they could not see it; these render real i18next.
 *
 * The scan below is a net, not a proof: it reads `t('Key')` and `t(cond ? 'A' : 'B')` calls with no second argument,
 * so a key built at run time, or one passed through a variable, escapes it. Its root is all of core's src, not only
 * the modules. The rows render the tree's strings, never its props: a placeholder in an accessibilityLabel is left to
 * the scan.
 */
import { render } from '@testing-library/react-native'
import fs from 'fs'
import i18next from 'i18next'
import path from 'path'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import en from '../../../localization/en/en.json'
import fr from '../../../localization/fr/fr.json'
import ptBr from '../../../localization/pt-br/pt-br.json'
import { testIdWithKey } from '../../../utils/testable'
import { ApprovalDetails } from '../screens/ApprovalDetails'

let mockT: (key: string, options?: Record<string, unknown>) => string
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => mockT(key, options) }),
}))
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const LOCALES = { en, fr, 'pt-BR': ptBr } as const
const i18n = i18next.createInstance()

beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    fallbackLng: false,
    resources: Object.fromEntries(Object.entries(LOCALES).map(([lng, translation]) => [lng, { translation }])),
    interpolation: { escapeValue: false },
  })
})

const SPEC = 'https://trusttasks.org/spec/'
const approval = {
  matchCode: '0af466',
  payloadDigest: 'zQmP5QwFGQirRyDYDwAtFoKdEEhF7zFHVhWbeWhepszs3Qm',
  taskType: `${SPEC}vta/contexts/create/1.0`,
  subject: 'keyring-demo',
}
const forSam = { ...approval, forAgent: { agentDid: 'did:webvh:sams-agent.example', asker: 'Sam' } }

type Node = { children?: Array<Node | string> | null } | string | null
/** Every text on screen, one line each (the strings in the tree, never its props). */
const texts = (node: Node | Node[]): string[] =>
  Array.isArray(node)
    ? node.flatMap(texts)
    : typeof node === 'string'
      ? [node]
      : node?.children
        ? texts(node.children)
        : []
const allText = (tree: ReturnType<typeof render>): string => texts(tree.toJSON() as Node).join('\n')

describe.each(Object.keys(LOCALES))('the request card, in %s', (lng) => {
  beforeAll(async () => {
    await i18n.changeLanguage(lng)
    mockT = (key, options) => i18n.t(key, options) as string
  })

  it("for someone else's agent: the code's label names them, and no {{…}} shows anywhere", () => {
    for (const card of [forSam, { ...forSam, taskType: `${SPEC}vta/something/new/0.1` }]) {
      const tree = render(
        <BasicAppContext>
          <ApprovalDetails approval={card} />
        </BasicAppContext>
      )
      expect(tree.getByTestId(testIdWithKey('ApprovalMatchCodeLabel'))).toHaveTextContent(/Sam/)
      expect(allText(tree)).not.toMatch(/\{\{|\}\}/)
    }
  })

  it("control: this phone's own agent keeps its own label, with no name in it, and no {{…}}", () => {
    const tree = render(
      <BasicAppContext>
        <ApprovalDetails approval={approval} />
      </BasicAppContext>
    )
    expect(tree.getByTestId(testIdWithKey('ApprovalMatchCodeLabel'))).toHaveTextContent(
      i18n.t('MyAgent.ApprovalMatchCode') as string
    )
    expect(allText(tree)).not.toMatch(/\{\{|\}\}|Sam/)
  })
})

describe("every t() call in core's src that leaves a {{…}} unfilled", () => {
  const SRC = path.resolve(__dirname, '../../..')
  /**
   * Read raw on purpose: dateWords() takes these as format templates and localDay's own formatter fills them. Exact
   * file and keys, so a new one-argument call elsewhere in that file is still caught.
   */
  const TEMPLATES: Record<string, string[]> = {
    [path.join('utils', 'localDay.ts')]: [
      'Chat.Dates.ThisYear',
      'Chat.Dates.OtherYear',
      'Chat.Dates.DayMonth',
      'Chat.Dates.DateTime',
      'Chat.Dates.Time12',
      'Chat.Dates.Time24',
    ],
  }
  const lookup = (key: string): unknown =>
    key
      .split('.')
      .reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), en)

  /** `t(…)` calls with ONE argument, as [file:line, the argument]; strings and nested brackets are skipped over. */
  function oneArgCalls(src: string): Array<{ line: number; arg: string }> {
    const found: Array<{ line: number; arg: string }> = []
    const start = /(?<![\w.$])t\(/g
    let m: RegExpExecArray | null
    while ((m = start.exec(src))) {
      let i = m.index + 2
      let depth = 1
      let commas = 0
      let quote: string | null = null
      for (; i < src.length && depth > 0; i++) {
        const c = src[i]
        if (quote) {
          if (c === '\\') i++
          else if (c === quote) quote = null
          continue
        }
        if (c === "'" || c === '"' || c === '`') quote = c
        else if ('([{'.includes(c)) depth++
        else if (')]}'.includes(c)) depth--
        else if (c === ',' && depth === 1) commas++
      }
      const arg = src.slice(m.index + 2, i - 1)
      // A trailing comma is still one argument.
      if (commas === 0 || (commas === 1 && /,\s*$/.test(arg))) {
        found.push({ line: src.slice(0, m.index).split('\n').length, arg })
      }
    }
    return found
  }

  function sources(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) return e.name === '__tests__' ? [] : sources(p)
      return /\.tsx?$/.test(e.name) ? [p] : []
    })
  }

  /** Every one-argument call whose English has a placeholder, as { file (relative to src), line, key }. */
  const unfilledCalls = () =>
    sources(SRC).flatMap((file) =>
      oneArgCalls(fs.readFileSync(file, 'utf8')).flatMap(({ line, arg }) =>
        [...arg.matchAll(/'([A-Za-z][\w.]+)'/g)]
          .map((k) => k[1])
          .filter((key) => /\{\{/.test(String(lookup(key) ?? '')))
          .map((key) => ({ file: path.relative(SRC, file), line, key }))
      )
    )

  it('finds none outside the date templates', () => {
    const unfilled = unfilledCalls()
      .filter(({ file, key }) => !TEMPLATES[file]?.includes(key))
      .map(({ file, line, key }) => `${file}:${line} ${key}`)
    expect(unfilled).toEqual([])
  })

  it('control: the scan reaches beyond the modules, and every date template it lets pass is still there', () => {
    const found = unfilledCalls()
    for (const [file, keys] of Object.entries(TEMPLATES))
      expect(found.filter((c) => c.file === file).map((c) => c.key)).toEqual(keys)
  })

  it('control: the scan sees a one-argument call with a placeholder, a ternary one, and lets a filled one pass', () => {
    const src = [
      "t('Requests.ForAgentMatchCode')",
      "t(x ? 'MyAgent.ApprovalMatchCode' : 'Requests.ForAgentMatchCode',)",
      "t('Requests.ForAgentMatchCode', forWords)",
      "at('Requests.ForAgentMatchCode')",
    ].join('\n')
    expect(oneArgCalls(src).map((c) => c.line)).toEqual([1, 2])
    expect(String(lookup('Requests.ForAgentMatchCode'))).toMatch(/\{\{asker\}\}/)
  })
})
