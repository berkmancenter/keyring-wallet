/**
 * A code the rooms code acts on, sends or expects to see must not log as `other`. `LOGGED_REFUSAL_CODES` is a closed
 * list that fails closed, so a word missing from it turns nothing red by itself: the report just says less. That cost
 * a red main (#932 and #909, two authority credentials: `refused (other)`). Found by reading the rooms source and its
 * tests for what they name, and asked of `failureCategory` itself.
 *
 * What this holds: a code named in this module. What it can't: a code only an agent knows, which reads `other` until
 * it's named somewhere; and two PRs each green alone and red together, which is for the merge to catch.
 */
import fs from 'fs'
import path from 'path'

import { VtiRefusal } from '../../trust-tasks/module/vtiAgent'
import { failureCategory } from '../roomsLogWords'

const ROOMS = path.resolve(__dirname, '..')
const THIS_FILE = path.basename(__filename)

const sources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const at = path.join(dir, entry.name)
    if (entry.isDirectory()) return sources(at)
    return /\.tsx?$/.test(entry.name) && entry.name !== THIS_FILE ? [at] : []
  })
const text = sources(ROOMS).map((file) => fs.readFileSync(file, 'utf8'))

const matches = (pattern: RegExp): string[] => [
  ...new Set(text.flatMap((source) => [...source.matchAll(pattern)].map((m) => m[1]))),
]

/** What a line names that is no code: the word for an unknown one, and a test's title. */
const NOT_A_CODE = new Set(['other', 'control'])

const CODES = {
  'a line a test expects': matches(/refused \(([A-Za-z]+)[,)]/g).filter((word) => !NOT_A_CODE.has(word)),
  'a task-prefixed code on the wire or in a fake': matches(/['`](?:rooms|vtc\/rooms)\/[a-z/_.0-9-]*:([A-Za-z]+)['`]/g),
  'a refusal the code acts on': matches(/refusalCode\([^)]*\) [!=]== '([A-Za-z]+)'/g),
  'a code the code compares': matches(/\b(?:e|error|refusal)\.code [!=]== '([A-Za-z]+)'/g),
  'a refusal the service throws': matches(/new RoomsRefused\(\s*'[A-Za-z]+',\s*'([A-Za-z]+)'/g),
}

describe('every code this module names can be logged', () => {
  test.each(Object.entries(CODES))('%s', (_where, codes) => {
    expect(codes.length).toBeGreaterThan(0)
    const unknown = codes.filter((code) => failureCategory(new VtiRefusal(code, 'x')) !== `refused (${code})`)
    expect(unknown).toEqual([])
  })

  test('every reason a test expects beside a code', () => {
    const reasons = matches(/refused \([A-Za-z]+, ([a-z_]+)\)/g)
    expect(reasons).toEqual(expect.arrayContaining(['conflict']))
    const unknown = reasons.filter(
      (reason) => failureCategory(new VtiRefusal('taskFailed', 'x', { reason })) !== `refused (taskFailed, ${reason})`
    )
    expect(unknown).toEqual([])
  })

  test('the scan sees the one that went wrong, so it is looking in the right place', () => {
    expect(CODES['a line a test expects']).toContain('conflict')
    expect(CODES['a task-prefixed code on the wire or in a fake']).toContain('conflict')
    expect(CODES['a refusal the code acts on']).toContain('alreadyJoined')
    expect(CODES['a refusal the service throws']).toContain('welcomeMissing')
  })

  test('the two a report has to tell apart', () => {
    expect(failureCategory(new VtiRefusal('taskFailed', 'x', { reason: 'conflict' }))).toBe(
      'refused (taskFailed, conflict)'
    )
    expect(failureCategory(new VtiRefusal('taskFailed', 'x', { reason: 'not_found' }))).toBe(
      'refused (taskFailed, not_found)'
    )
    expect(failureCategory(new VtiRefusal('taskFailed', 'x', { code: 'rooms/keys/seal:conflict' }))).toBe(
      'refused (conflict)'
    )
  })

  test('an unknown word still reads other: the list is still closed (control)', () => {
    expect(failureCategory(new VtiRefusal('personaAIsHidden', 'x'))).toBe('refused (other)')
  })
})
