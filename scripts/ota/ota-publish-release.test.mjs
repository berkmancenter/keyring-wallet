// node --test scripts/ota/
// ota-publish.yml names each run by its release (10-29, the owner's ask): "OTA 276.2 · publish to ring 0".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..')
const yml = readFileSync(path.join(root, '.github', 'workflows', 'ota-publish.yml'), 'utf8')
const inputs = yml.slice(yml.indexOf('    inputs:'), yml.indexOf('\npermissions:'))

test('the workflow is "OTA release", and post-release subscribes to that name', () => {
  assert.match(yml, /^name: OTA release$/m)
  // post-release.yml lands separately; when it is on this tree, it must list this name.
  try {
    const post = readFileSync(path.join(root, '.github', 'workflows', 'post-release.yml'), 'utf8')
    assert.match(post, /workflows: \[[^\]]*"OTA release"[^\]]*\]/)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
})

test('the release input replaced build: still ten inputs, GitHub\'s limit', () => {
  const names = [...inputs.matchAll(/^      ([a-z_]+):$/gm)].map((m) => m[1])
  assert.equal(names.length, 10)
  assert.ok(names.includes('release'))
  assert.ok(!names.includes('build'))
  assert.doesNotMatch(yml, /inputs\.build/)
})

test('production and preview runs need a release <store build>.<n>; the store build comes from it', () => {
  assert.match(yml, /\[\[ "\$RELEASE" =~ \^\[0-9\]\+\\\.\[0-9\]\+\$ \]\] \|\| err "\$CHANNEL needs release/)
  // Every step that reads the store build derives it from the release, the part before the dot.
  const steps = yml.split(/\n      - name: /).filter((s) => /\$BUILD\b/.test(s))
  assert.ok(steps.length >= 3, `steps using $BUILD: ${steps.length}`)
  for (const s of steps) assert.match(s, /BUILD="\$\{RELEASE%%\.\*\}"/, `a step uses $BUILD without deriving it: ${s.split('\n')[0]}`)
})

test('the run title names the release and what the run does', () => {
  const runName = yml.slice(yml.indexOf('run-name:'), yml.indexOf('\non:'))
  assert.match(runName, /OTA \$\{\{ inputs\.release \|\| inputs\.channel \}\}/)
  for (const words of ['publish to ring 0', 'widen to everyone', 'widen to ring 1', 'withdraw', 'ios \\+ android', ' \\(dry run\\)'])
    assert.match(runName, new RegExp(words))
})

test('recording the published bundle can never fail a publish that succeeded', () => {
  // post-release (the smoke and the brake) runs only on a successful publish run: a fatal record step would skip it.
  const step = yml.slice(yml.indexOf('- name: Record the published bundle'), yml.indexOf('- name: Promote ('))
  assert.match(step, /continue-on-error: true/)
  assert.match(step, /if-no-files-found: warn/)
  assert.doesNotMatch(step, /if-no-files-found: error/)
})
