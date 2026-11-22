/**
 * No screen may put a caught error's own text in front of a person (225 gate:
 * the vetting screen showed "vtiAgent: sent vtc/join-requests/manifest; the
 * community has not answered yet"). A failure is said through `sayFailure`
 * (or `plainError`), with the original only under Details.
 *
 * This reads the screens' source: any `.message` or `String(e)` of a caught
 * error outside a Details helper fails it, so a new screen that does it again
 * is caught before it ships, not on a tester's phone.
 */
import { readdirSync, readFileSync } from 'fs'
import path from 'path'

import { InWords, sayFailure } from '../screens/plainError'

const SCREENS = path.join(__dirname, '..', 'screens')
/** Where the raw text is the point: what Details shows. */
const DETAIL_HELPERS = [/^\s*(export )?(const|function) detailOf\b/, /^\s*function plainError\b|^export function plainError\b/]
const RAW = /\b(e|err|error)\.message\b|String\((e|err|error)\)/

describe('no raw error text on a screen', () => {
  test("no screen shows a caught error's own message outside Details", () => {
    const offenders: string[] = []
    for (const file of readdirSync(SCREENS).filter((f) => /\.tsx?$/.test(f))) {
      const lines = readFileSync(path.join(SCREENS, file), 'utf8').split('\n')
      let inDetail = false
      lines.forEach((line, i) => {
        if (DETAIL_HELPERS.some((re) => re.test(line))) inDetail = true
        else if (/^(export )?(const|function|class) /.test(line)) inDetail = false
        if (file === 'plainError.ts') return
        if (!inDetail && RAW.test(line) && !/^\s*(\/\/|\*)/.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
    // Reading every screen takes seconds under jest's transform: past its 5 s default on a busy runner.
  }, 30000)

  test('sayFailure never returns the raw text as the sentence', () => {
    const raw = 'vtiAgent: sent vtc/join-requests/manifest; the community has not answered yet'
    for (const e of [new Error(raw), raw, new Error('[TrustTasks:VtaClient] x https://trusttasks.org/spec/a/1.0'), undefined]) {
      const said = sayFailure(e)
      expect(said.key).toMatch(/^Errors\./)
      expect(said.words).toBeUndefined()
    }
    expect(sayFailure(new Error(raw)).detail).toBe(raw)
  })

  test('words already said are shown as they are, with nothing under Details', () => {
    expect(sayFailure(new InWords('There was no open application to withdraw.'))).toEqual({
      words: 'There was no open application to withdraw.',
    })
  })
})
