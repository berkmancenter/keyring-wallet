/**
 * tsp-esm-preload.cjs: the witness runs as CommonJS, and @openvtc/vti-tsp-js is ESM-only (its exports map has an
 * "import" condition and no "require"), so the require() in @bifold/trust-tasks' CommonJS build fails without it.
 * Run in a child Node, outside jest's own module system, the way the witness starts (`node -r ./tsp-esm-preload.cjs`).
 */
import { spawnSync } from 'child_process'
import path from 'path'

const witness = path.resolve(__dirname, '..')
const probe = `const m = require('@openvtc/vti-tsp-js'); const h = require('@openvtc/vti-tsp-js/hpke');
console.log(JSON.stringify({ tsp: typeof m.cesr, hpke: Object.keys(h).length > 0 }))`

const node = (args: string[]) => spawnSync(process.execPath, [...args, '-e', probe], { cwd: witness, encoding: 'utf8' })

describe('tsp-esm-preload', () => {
  it('without it, require() of @openvtc/vti-tsp-js fails as the witness did', () => {
    const r = node([])
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/ERR_PACKAGE_PATH_NOT_EXPORTED|No "exports" main defined/)
  })

  it('with it, both entry points load through require()', () => {
    const r = node(['-r', './tsp-esm-preload.cjs'])
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout.trim().split('\n').pop() as string)).toEqual({ tsp: 'object', hpke: true })
  })
})
