/**
 * Every bottom toast sits clear of the tab bar. The library's own offset (40)
 * put a toast on the tabs for its whole showing (#261 measured it on the built
 * app); one shared offset (`useToastAboveTabBar`) moves it up. This holds the
 * rule for the whole app, so a new bottom toast cannot quietly land on the
 * tabs again: a `Toast.show` (or its params) that says `position: 'bottom'`
 * must also give a `bottomOffset`.
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

import type { TFunction } from 'i18next'

import { linkNoticeToast } from '../module/keyringLinkOpen'
import { TAB_BAR_CLEARANCE } from '../screens/aboveTabBar'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const SRC = join(__dirname, '..', '..', '..')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : sources(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

/** The object literal around a match: from the `{` that opens it to the `}` that closes it. */
function enclosingObject(text: string, at: number): string {
  let depth = 0
  let start = at
  for (; start >= 0; start--) {
    if (text[start] === '}') depth++
    if (text[start] === '{') {
      if (depth === 0) break
      depth--
    }
  }
  depth = 0
  let end = at
  for (; end < text.length; end++) {
    if (text[end] === '{') depth++
    if (text[end] === '}') {
      if (depth === 0) break
      depth--
    }
  }
  return text.slice(start, end + 1)
}

describe('bottom toasts clear the tab bar', () => {
  it('every one in the app gives a bottomOffset', () => {
    const offenders: string[] = []
    let found = 0
    for (const file of sources(SRC)) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/position:\s*['"]bottom['"]/g)) {
        found++
        if (!/\bbottomOffset\b/.test(enclosingObject(text, match.index ?? 0))) {
          const line = text.slice(0, match.index).split('\n').length
          offenders.push(`${relative(SRC, file)}:${line}`)
        }
      }
    }
    // The scan found the toasts it is meant to hold (link, refused card, scan, …).
    expect(found).toBeGreaterThanOrEqual(8)
    expect(offenders).toEqual([])
  })

  it('a link being read, or not usable, is shown above the tabs', () => {
    const t = ((key: string) => key) as unknown as TFunction
    const offset = 34 + TAB_BAR_CLEARANCE
    expect(linkNoticeToast({ kind: 'reading' }, t, offset)).toMatchObject({ position: 'bottom', bottomOffset: offset })
    expect(linkNoticeToast({ kind: 'unusable' }, t, offset)).toMatchObject({ position: 'bottom', bottomOffset: offset })
  })
})
