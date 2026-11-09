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

// --release names the bundle on the server: <store build>.<n> of the --build it targets, checked before any git work.
for (const [release, build] of [['277.1', '276'], ['276', '276'], ['276.x', '276'], ['2766.1', '276']]) {
  test(`--release ${release} is refused for --build ${build}`, () => {
    const r = run('--build', build, '--release', release, '--channel', 'production')
    assert.equal(r.status, 1)
    assert.match(r.stderr, new RegExp(`--release ${release.replace('.', '\\.')} is not a release of store build ${build}`))
  })
}

test('--release is refused with --base (a device-test build has no store build to number it from)', () => {
  const r = run('--base', 'HEAD', '--release', '276.1', '--channel', 'device-test')
  assert.equal(r.status, 1)
  assert.match(r.stderr, /is not a release of store build \(none\)/)
})
