/**
 * One switch per SEDI/KERI feature, plus one kill for all of them (Alberto, 2026-11-10). Each feature's switch is off
 * by default; its own remote off and the umbrella SEDI_KERI_REMOTE_OFF each beat a saved "on", and neither turns it on.
 *
 * The switches are found, not listed: every `export const …_REMOTE_OFF` in the package's source is a SEDI/KERI
 * feature's own kill unless {@link NOT_SEDI_KERI} says otherwise, and its module's `set…Enabled` / `is…Enabled` are
 * checked here. So a new switch that does not answer the umbrella fails here without anyone remembering to add it.
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

import { SEDI_KERI_REMOTE_OFF } from '../module/sediKeriRemoteOff'
import {
  STATE_VERIFIED_APPROVERS_REMOTE_OFF,
  setStateVerifiedApproversEnabled,
} from '../module/stateVerifiedApproversFlag'
import { TRUSTED_APPROVERS_REMOTE_OFF, setTrustedApproversEnabled } from '../module/trustedApproversFlag'
import { isTrustTestStateEnabled, setTrustTestStateEnabled } from '../module/trustTestStateFlag'

const SRC = join(__dirname, '..', '..', '..')

/**
 * Remote offs that are not a SEDI/KERI feature's, so they need not answer the umbrella. Kept by hand on purpose, and
 * short: a new remote off is a SEDI/KERI switch until someone says here that it is not.
 */
const NOT_SEDI_KERI = new Set(['SEDI_KERI_REMOTE_OFF', 'SHARED_CONNECT_REMOTE_OFF'])

/** Every source file of the package (no tests). */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return entry === '__tests__' || entry === 'node_modules' ? [] : sourceFiles(path)
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : []
  })
}

/** Every `export const …_REMOTE_OFF` in the source, with the file that declares it. */
const KILLS = sourceFiles(SRC).flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(/export const ([A-Z][A-Z0-9_]*_REMOTE_OFF)\b/g)].map((m) => ({
    file,
    kill: m[1],
  }))
)

/** The one export of `module` whose name matches `pattern`; a switch module with none or several is an error here. */
function oneExport(module: Record<string, unknown>, pattern: RegExp, file: string): string {
  const names = Object.keys(module).filter((name) => pattern.test(name) && typeof module[name] === 'function')
  if (names.length !== 1) throw new Error(`${relative(SRC, file)}: expected one ${pattern} export, found ${names}`)
  return names[0]
}

const SWITCHES = KILLS.filter(({ kill }) => !NOT_SEDI_KERI.has(kill)).map(({ file, kill }) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const module = require(file) as Record<string, unknown>
  const set = oneExport(module, /^set\w+Enabled$/, file)
  const is = oneExport(module, /^is\w+Enabled$/, file)
  return {
    name: relative(SRC, file),
    exports: [kill, set, is],
    set: module[set] as (enabled: boolean) => void,
    is: module[is] as () => boolean,
    own: module[kill] as { off: boolean },
  }
})

afterEach(() => {
  setTrustTestStateEnabled(false)
  SEDI_KERI_REMOTE_OFF.off = false
  for (const s of SWITCHES) {
    s.own.off = false
    s.set(false)
  }
})

describe('the switches found', () => {
  it('include the ones known today (a floor, so a scan that finds nothing fails)', () => {
    expect(SWITCHES.map((s) => s.exports[0])).toEqual(
      expect.arrayContaining([
        'TRUSTED_APPROVERS_REMOTE_OFF',
        'STATE_VERIFIED_APPROVERS_REMOTE_OFF',
        'STATE_CARD_REMOTE_OFF',
        'CONFIRM_ITS_YOU_REMOTE_OFF',
      ])
    )
  })

  it('every remote off said not to be SEDI/KERI is still in the source (the allowance is not stale)', () => {
    const found = new Set(KILLS.map((k) => k.kill))
    expect([...NOT_SEDI_KERI].filter((kill) => !found.has(kill))).toEqual([])
  })

  it.each(SWITCHES.map((s) => [s.name, s] as const))(
    '%s: its kill, its switch and its reading are exported from the package index',
    (_, s) => {
      const text = readFileSync(join(SRC, 'index.ts'), 'utf8')
      expect(s.exports.filter((name) => !new RegExp(`\\b${name}\\b`).test(text))).toEqual([])
    }
  )
})

describe.each(SWITCHES)('the $name switch', (s) => {
  it('is off until the app turns it on', () => {
    expect(s.is()).toBe(false)
    s.set(true)
    expect(s.is()).toBe(true)
  })

  it('the SEDI/KERI kill beats a saved "on" (control: with the kill off, it works)', () => {
    s.set(true)
    SEDI_KERI_REMOTE_OFF.off = true
    expect(s.is()).toBe(false)
    SEDI_KERI_REMOTE_OFF.off = false
    expect(s.is()).toBe(true)
  })

  it('its own remote off beats a saved "on" too, and neither kill turns it on', () => {
    s.set(true)
    s.own.off = true
    expect(s.is()).toBe(false)
    s.own.off = false
    s.set(false)
    SEDI_KERI_REMOTE_OFF.off = false
    expect(s.is()).toBe(false)
  })
})

describe('the umbrella', () => {
  it('kills every SEDI/KERI switch at once (control: each still answers for itself without it)', () => {
    for (const s of SWITCHES) s.set(true)
    SEDI_KERI_REMOTE_OFF.off = true
    expect(SWITCHES.map((s) => s.is())).toEqual(SWITCHES.map(() => false))
    SEDI_KERI_REMOTE_OFF.off = false
    expect(SWITCHES.map((s) => s.is())).toEqual(SWITCHES.map(() => true))
  })

  it('every switch and kill is exported from the trust-tasks index and the package index', () => {
    const names = [
      'setStateVerifiedApproversEnabled',
      'isStateVerifiedApproversEnabled',
      'STATE_VERIFIED_APPROVERS_REMOTE_OFF',
      'setConfirmItsYouEnabled',
      'isConfirmItsYouEnabled',
      'CONFIRM_ITS_YOU_REMOTE_OFF',
      'SEDI_KERI_REMOTE_OFF',
      'setTrustTestStateEnabled',
      'isTrustTestStateEnabled',
      'holdK0TestGuardianCard',
      'becomeK0TestWard',
    ]
    for (const file of [join(__dirname, '..', 'index.ts'), join(__dirname, '..', '..', '..', 'index.ts')]) {
      const text = readFileSync(file, 'utf8')
      for (const name of names)
        expect([file.split('/src/')[1], name, new RegExp(`\\b${name}\\b`).test(text)]).toEqual([
          file.split('/src/')[1],
          name,
          true,
        ])
    }
  })
})

describe('the "Trust the test state (K0)" setting', () => {
  const bothOn = () => {
    setTrustedApproversEnabled(true)
    setStateVerifiedApproversEnabled(true)
  }

  it('is off until the app turns it on, even with both switches on', () => {
    bothOn()
    expect(isTrustTestStateEnabled()).toBe(false)
    setTrustTestStateEnabled(true)
    expect(isTrustTestStateEnabled()).toBe(true)
  })

  it('holds only while both switches are on (control: both on, it holds)', () => {
    setTrustTestStateEnabled(true)
    expect(isTrustTestStateEnabled()).toBe(false)
    setTrustedApproversEnabled(true)
    expect(isTrustTestStateEnabled()).toBe(false)
    setStateVerifiedApproversEnabled(true)
    expect(isTrustTestStateEnabled()).toBe(true)
  })

  it.each([
    ['trusted approvers turned off remotely', () => (TRUSTED_APPROVERS_REMOTE_OFF.off = true)],
    ['state-verified approvers turned off remotely', () => (STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = true)],
    ['the SEDI/KERI umbrella', () => (SEDI_KERI_REMOTE_OFF.off = true)],
  ])('%s beats a saved "on" (control: without it, the setting holds)', (_, off) => {
    bothOn()
    setTrustTestStateEnabled(true)
    expect(isTrustTestStateEnabled()).toBe(true)
    off()
    expect(isTrustTestStateEnabled()).toBe(false)
  })
})
