// The rooms-sample bundle check: it must fail on a bundle carrying the marker and pass on one without it,
// and refuse an empty or missing bundle rather than pass it (a check that read nothing would pass).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-no-rooms-sample.sh')
const run = (file) => spawnSync('bash', [script, file, 'test bundle'], { encoding: 'utf8' })
const withBundle = (content, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rooms-sample-'))
  const file = path.join(dir, 'index.bundle')
  fs.writeFileSync(file, content)
  try {
    return fn(file)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('a bundle carrying the sample marker fails', () => {
  withBundle('var a=1;var m="ROOMS_SAMPLE_DATA: sample rooms, never in a store build";', (file) => {
    const r = run(file)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /rooms sample data is in this bundle/)
  })
})

test('a bundle without it passes (the control for the failure above)', () => {
  withBundle('var a=1;var createSampleRoomsService=void 0;', (file) => {
    const r = run(file)
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /no rooms sample data/)
  })
})

test('an empty or missing bundle is refused, not passed', () => {
  withBundle('', (file) => assert.equal(run(file).status, 2))
  assert.equal(run('/nonexistent/index.bundle').status, 2)
})
