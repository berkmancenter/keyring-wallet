// node --test scripts/ota/
// The publisher's --skip-tier flag is for the device-test channel with --base only. These cases stop at the
// argument check, before any git or network work.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { test } from 'node:test'

const deploy = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  '..',
  'app',
  'scripts',
  'ota-deploy.mjs'
)
const run = (...args) =>
  spawnSync('node', [deploy, ...args], { encoding: 'utf8', env: { ...process.env, OTA_CHANNEL: '' } })

for (const channel of ['production', 'preview']) {
  test(`--skip-tier is refused on ${channel}`, () => {
    const r = run('--base', 'HEAD', '--channel', channel, '--skip-tier')
    assert.equal(r.status, 1)
    assert.match(r.stderr, /--skip-tier is only for the device-test channel with --base/)
  })
}

test('--skip-tier is refused on device-test with --build instead of --base', () => {
  const r = run('--build', '264', '--channel', 'device-test', '--skip-tier')
  assert.equal(r.status, 1)
  assert.match(r.stderr, /--skip-tier is only for the device-test channel with --base/)
})
