/**
 * A linked person is never sent to the old My Agent panel. The vetting done
 * card's "Go to My Agent" did, and someone admitted a moment before read
 * "You are being vetted", raw DIDs and the agent host's name (225 gate).
 * "My Agent" is `agentHomeScreen()`; nothing else names the panel as a
 * destination.
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import path from 'path'

import { Screens } from '../../../types/navigators'
import { agentHomeScreen } from '../screens/agentHome'

const SRC = path.join(__dirname, '..', '..', '..')
/** Where the panel may be named: the route list, its stack, the helper, and the link map used before a link exists. */
const ALLOWED = [
  'types/navigators.ts',
  'navigators/MyAgentStack.tsx',
  'modules/trust-tasks/screens/agentHome.ts',
  'modules/trust-tasks/module/vtiLinks.ts',
]

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : sources(full)
    return /\.tsx?$/.test(name) ? [full] : []
  })

describe('My Agent for a linked phone is the "Your agent" home', () => {
  test('agentHomeScreen: the home once linked, the panel (which offers the link) before', () => {
    expect(agentHomeScreen({ kind: 'linked' })).toBe(Screens.VtaAgent)
    expect(agentHomeScreen({ kind: 'notLinked' })).toBe(Screens.MyAgent)
  })

  test('no screen sends anyone to the old panel directly', () => {
    const offenders = sources(SRC)
      .map((file) => [path.relative(SRC, file), readFileSync(file, 'utf8')] as const)
      .filter(([rel]) => !ALLOWED.includes(rel.split(path.sep).join('/')))
      .flatMap(([rel, text]) =>
        text
          .split('\n')
          .map((line, i) => [i + 1, line] as const)
          .filter(([, line]) => /\bScreens\.MyAgent\b/.test(line) && !/^\s*(\/\/|\*)/.test(line))
          .map(([n, line]) => `${rel}:${n}: ${line.trim()}`)
      )
    expect(offenders).toEqual([])
  }, 30000)
})
