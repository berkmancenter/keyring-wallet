/**
 * One switch per feature, each with its own remote off (the SEDI/KERI umbrella kill is gone with the demo). A
 * feature's switch is off by default; its own remote off beats a saved "on", and does not turn it on.
 *
 * One feature ships on: "Confirm it's you" (Alberto, 2026-11-18), named in {@link SHIPS_ON}. Its kill must beat what
 * it ships as, not only what an app set: with nothing setting it, a kill is the only way it goes off.
 *
 * The switches are found, not listed: every `export const …_REMOTE_OFF` in the package's source is a feature's own
 * kill unless {@link NOT_SEDI_KERI} says otherwise, and its module's `set…Enabled` / `is…Enabled` are checked here.
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const SRC = join(__dirname, '..', '..', '..')

/**
 * Remote offs that are not a SEDI/KERI feature's, so they need not answer the umbrella. Kept by hand on purpose, and
 * short: a new remote off is a SEDI/KERI switch until someone says here that it is not.
 */
const NOT_SEDI_KERI = new Set([
  'SHARED_CONNECT_REMOTE_OFF',
  // DIDComm transport, not SEDI/KERI features, so the umbrella does not turn them off. Both ship on (Alberto,
  // 2026-11-20), and each kill's "beats what it ships as" row is where it lives: tspCarriage.test.ts for
  // TSP_SEND_REMOTE_OFF, createRelationshipInvitationDidCommV2Gate.test.ts for DIDCOMM_V2_MINT_REMOTE_OFF.
  'TSP_SEND_REMOTE_OFF',
  'DIDCOMM_V2_MINT_REMOTE_OFF',
])

/**
 * The switches that ship on, by their own kill's name. Kept by hand on purpose: a switch whose default moves to on
 * without being named here fails "ships off", so no other SEDI/KERI feature comes out from behind its switch unnoticed.
 */
const SHIPS_ON = new Set(['CONFIRM_ITS_YOU_REMOTE_OFF'])

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
    file,
    kill,
    shipsOn: SHIPS_ON.has(kill),
    exports: [kill, set, is],
    set: module[set] as (enabled: boolean) => void,
    is: module[is] as () => boolean,
    own: module[kill] as { off: boolean },
  }
})

/**
 * A switch as a start-up finds it: its module loaded anew, with nothing having set it, beside the umbrella that same
 * load reads. The suite's own copies are set and reset by every row, so they cannot say what a release ships.
 */
function asShipped(file: string, kill: string) {
  let found: { is: () => boolean; set: (enabled: boolean) => void; own: { off: boolean } }
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const module = require(file) as Record<string, unknown>
    found = {
      is: module[oneExport(module, /^is\w+Enabled$/, file)] as () => boolean,
      set: module[oneExport(module, /^set\w+Enabled$/, file)] as (enabled: boolean) => void,
      own: module[kill] as { off: boolean },
    }
  })
  return found!
}

afterEach(() => {
  for (const s of SWITCHES) {
    s.own.off = false
    s.set(false)
  }
})

describe('the switches found', () => {
  it('include the ones known today (a floor, so a scan that finds nothing fails)', () => {
    expect(SWITCHES.map((s) => s.exports[0])).toEqual(expect.arrayContaining(['CONFIRM_ITS_YOU_REMOTE_OFF']))
  })

  it('every switch said to ship on is one of them (the list is not stale)', () => {
    const found = new Set(SWITCHES.map((s) => s.kill))
    expect([...SHIPS_ON].filter((kill) => !found.has(kill))).toEqual([])
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

// No switch ships off today (the one left ships on); the rows below run for the first one that is added without
// being named in SHIPS_ON, which is what the guard is for.
const SHIPS_OFF = SWITCHES.filter((s) => !s.shipsOn)
if (SHIPS_OFF.length > 0) {
  describe.each(SHIPS_OFF)('the $name switch, which ships off', (s) => {
    it('is off as a start-up finds it, until the app turns it on', () => {
      const shipped = asShipped(s.file, s.kill)
      expect(shipped.is()).toBe(false)
      shipped.set(true)
      expect(shipped.is()).toBe(true)
    })
  })
}

describe.each(SWITCHES.filter((s) => s.shipsOn))('the $name switch, which ships on', (s) => {
  it('is on as a start-up finds it, with nothing having set it (control: a run can still turn it off)', () => {
    const shipped = asShipped(s.file, s.kill)
    expect(shipped.is()).toBe(true)
    shipped.set(false)
    expect(shipped.is()).toBe(false)
  })

  it('its own remote off beats what it ships as (control: with the kill back off, it is on again)', () => {
    const shipped = asShipped(s.file, s.kill)
    shipped.own.off = true
    expect(shipped.is()).toBe(false)
    shipped.own.off = false
    expect(shipped.is()).toBe(true)
  })
})

describe.each(SWITCHES)('the $name switch', (s) => {
  it('turned off for a run, it is off; turned on, it is on', () => {
    s.set(false)
    expect(s.is()).toBe(false)
    s.set(true)
    expect(s.is()).toBe(true)
  })

  it('its own remote off beats a saved "on" too, and the kill does not turn it on', () => {
    s.set(true)
    s.own.off = true
    expect(s.is()).toBe(false)
    s.own.off = false
    s.set(false)
    expect(s.is()).toBe(false)
  })
})

describe('the switches are exported', () => {
  it('every switch and kill is exported from the trust-tasks index and the package index', () => {
    const names = ['setConfirmItsYouEnabled', 'isConfirmItsYouEnabled', 'CONFIRM_ITS_YOU_REMOTE_OFF']
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
