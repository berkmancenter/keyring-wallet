/**
 * Agent connect, the screen catalogue: every P0 state in e2e/lib/agent-connect-screens.json is drawn from props
 * (fixtures/screenStates.tsx), its steps taken, and checked to show exactly the translated words the manifest lists
 * (not literal content: see shownKeys), with its marker on screen and its canvas frame and kit mockup on disk. A
 * failure names the state and its frame.
 *
 * The manifest is a curated list of the states chosen for the catalogue. Its agreement with the drawings, which this
 * checks both ways, is not coverage of every state the screens have. And it proves a state shows the words the
 * manifest lists, not that those are the right words for that state: a settled string shown in the wrong case passes
 * the copy test and this one alike (the Revoke notice's title was such a case, settled by the plan owner).
 *
 * This is a check on words and states before the emulator walk of step 7.11, not 7.11's evidence: that is the
 * screenshot pairs on the emulator and the simulator. The walk reads the same manifest.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import en from '../../../localization/en/en.json'
import { testIdWithKey } from '../../../utils/testable'

import { SCREEN_STATES } from './fixtures/screenStates'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

type Step = { press?: string; pressLabel?: string; within?: string }
type ScreenState = {
  id: string
  marker: string
  steps?: Step[]
  frame: string | null
  noFrame?: string
  kit: string | null
  words: string[]
  noWords?: string
  frameOnly?: Array<{ what: string; why: string }>
  appOnly?: Array<{ what: string; why: string }>
}
type Manifest = { canvas: string; kit: string; states: ScreenState[] }

const ROOT = path.resolve(__dirname, '../../../../../..')
const MANIFEST: Manifest = JSON.parse(readFileSync(path.join(ROOT, 'e2e/lib/agent-connect-screens.json'), 'utf8'))
const id = (key: string) => testIdWithKey(key)

/**
 * Every "Section.Key" string in the rendered tree, in order, once each: the translated words a state shows (the test
 * i18n returns keys). It checks words, not literal content: a name, a digit or the "7 / 64" counter is not collected,
 * so a wrong counter or a wrong name passes here.
 */
const shownKeys = (node: unknown, out: string[] = []): string[] => {
  if (node == null) return out
  if (typeof node === 'string') {
    if (/^[A-Z]\w*\.[A-Z]\w*$/.test(node) && !out.includes(node)) out.push(node)
    return out
  }
  if (Array.isArray(node)) {
    node.forEach((child) => shownKeys(child, out))
    return out
  }
  const children = (node as { children?: unknown }).children
  if (children) shownKeys(children, out)
  return out
}

// A step may start work that answers later (Revoke's outcome): each is followed by a flush, so the state the manifest
// names is the one on screen when its words are read.
const draw = async (state: ScreenState) => {
  const tree = render(<BasicAppContext>{SCREEN_STATES[state.id]()}</BasicAppContext>)
  for (const step of state.steps ?? []) {
    if (step.press) fireEvent.press(tree.getByTestId(id(step.press), { includeHiddenElements: true }))
    await act(async () => undefined)
    if (step.pressLabel) {
      const target = tree
        .getAllByTestId(id(step.within ?? ''), { includeHiddenElements: true })
        .find((node) => node.props.accessibilityLabel === step.pressLabel)
      if (!target) throw new Error(`${state.id}: no ${step.within} labelled "${step.pressLabel}"`)
      fireEvent.press(target)
    }
  }
  return tree
}

describe('agent connect screen catalogue (a check on words, not 7.11 evidence)', () => {
  it('has a drawing for every state in the manifest, and a manifest state for every drawing', () => {
    const listed = MANIFEST.states.map((s) => s.id).sort()
    expect(Object.keys(SCREEN_STATES).sort()).toEqual(listed)
    expect(new Set(listed).size).toBe(listed.length)
  })

  it('names a frame and a kit mockup that exist, or says why a state has no frame or no words', () => {
    const problems = MANIFEST.states.flatMap((s) => {
      const out: string[] = []
      if (s.frame && !existsSync(path.join(ROOT, MANIFEST.canvas, s.frame))) out.push(`${s.id}: no frame ${s.frame}`)
      if (s.kit && !existsSync(path.join(ROOT, MANIFEST.kit, s.kit))) out.push(`${s.id}: no kit mockup ${s.kit}`)
      if (!s.frame && !s.noFrame) out.push(`${s.id}: no frame and no reason`)
      if (s.frame && s.noFrame) out.push(`${s.id}: a frame and a no-frame reason`)
      // An empty word list makes the words check vacuous for that state, so it must say why.
      if (s.words.length === 0 && !s.noWords) out.push(`${s.id}: no words and no reason`)
      if (s.words.length > 0 && s.noWords) out.push(`${s.id}: words and a no-words reason`)
      return out
    })
    expect(problems).toEqual([])
    // Control: a frame name that is not in the export is caught.
    expect(existsSync(path.join(ROOT, MANIFEST.canvas, '99-not-a-frame.png'))).toBe(false)
  })

  it('lists only words that exist in the English strings', () => {
    const missing = MANIFEST.states.flatMap((s) =>
      s.words
        .filter((key) => {
          const [section, name] = key.split('.')
          const strings = (en as unknown as Record<string, Record<string, string>>)[section] ?? {}
          return !(name in strings) && !(`${name}_other` in strings)
        })
        .map((key) => `${s.id}: ${key}`)
    )
    expect(missing).toEqual([])
  })

  it.each(MANIFEST.states.map((s) => [s.id, s] as const))(
    '%s shows exactly its words, with its marker',
    async (_, state) => {
      const tree = await draw(state)
      const where = { state: state.id, frame: state.frame ?? `(no frame: ${state.noFrame})` }
      expect({
        ...where,
        marker: tree.queryAllByTestId(id(state.marker), { includeHiddenElements: true }).length > 0,
      }).toEqual({
        ...where,
        marker: true,
      })
      expect({ ...where, words: [...shownKeys(tree.toJSON())].sort() }).toEqual({
        ...where,
        words: [...state.words].sort(),
      })
      tree.unmount()
    }
  )
})
