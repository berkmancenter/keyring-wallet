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
  for (const words of ['publish to everyone', "format\\('publish to \\{0\\}'", "'ring 1'", "'ring 0'", 'widen to everyone', 'widen to ring 1', 'withdraw', 'ios \\+ android', ' \\(dry run\\)'])
    assert.match(runName, new RegExp(words))
})

test('recording the published bundle can never fail a publish that succeeded', () => {
  // post-release (the smoke and the brake) runs only on a successful publish run: a fatal record step would skip it.
  const step = yml.slice(yml.indexOf('- name: Record the published bundle'), yml.indexOf('- name: Promote ('))
  assert.match(step, /continue-on-error: true/)
  assert.match(step, /if-no-files-found: warn/)
  assert.doesNotMatch(step, /if-no-files-found: error/)
})

// One click (10-29, the owner's rule: updates reach testers at once): a publish widens in the same run.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const stepOf = (name) => {
  const at = yml.indexOf(`- name: ${name}`)
  assert.ok(at >= 0, `no step "${name}"`)
  const next = yml.indexOf('\n      - ', at + 1)
  return yml.slice(at, next < 0 ? undefined : next)
}

test('to_ring is for publish too: ring2 by default, ring0 a deliberate staged release', () => {
  const toRing = inputs.slice(inputs.indexOf('      to_ring:'), inputs.indexOf('      expect_fingerprint:'))
  assert.match(toRing, /options: \[ring2, ring1, ring0\]/)
  assert.match(toRing, /default: ring2/)
  const runName = yml.slice(yml.indexOf('run-name:'), yml.indexOf('\non:'))
  assert.match(runName, /inputs\.to_ring == 'ring2' && 'publish to everyone'/)
  assert.match(yml, /\[ "\$ACTION" != promote \] \|\| \[ "\$TO_RING" != ring0 \] \|\| err "promote widens past ring 0/)
})

test('a publish past ring 0 widens after the record, in the same job, from the record ota-deploy wrote', () => {
  assert.ok(yml.indexOf('- name: Record the published bundle') < yml.indexOf('- name: Widen the published bundle'))
  const widen = stepOf('Widen the published bundle')
  assert.match(widen, /success\(\)/)
  assert.match(widen, /inputs\.action == 'publish' && inputs\.to_ring != 'ring0'/)
  assert.match(widen, /promote\.mjs --channel "\$CHANNEL" --platform "\$PLATFORM" --bundle-id "\$id" --to "\$TO_RING"/)
  const file = '${{ runner.temp }}/ota-bundle.jsonl'
  assert.ok(stepOf('Publish to ring 0').includes(`OTA_BUNDLE_RECORD: ${file}`))
  assert.ok(widen.includes(`RECORD: ${file}`))
  // No second approval: the widen is a step of the publish job, which the one ota-approval gate already let run.
  assert.doesNotMatch(widen, /environment:/)
})

test("the widen's own record read: this platform's one bundle, or a refusal", () => {
  const script = /node -e '([^']+)' "\$RECORD" "\$PLATFORM"/.exec(stepOf('Widen the published bundle'))[1]
  const dir = mkdtempSync(path.join(tmpdir(), 'widen-'))
  let n = 0
  const read = (lines, platform) => {
    const f = path.join(dir, `r${n++}.jsonl`)
    writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
    try {
      return execFileSync('node', ['-e', script, f, platform], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch {
      return 'REFUSED'
    }
  }
  const ios = { platform: 'ios', id: '01a18a0e-ce52-71a3-921f-a865e037b812', channel: 'production' }
  const android = { platform: 'android', id: '01a18a08-3d07-7f46-bec7-7fc9d67c8e3c', channel: 'production' }
  assert.equal(read([ios, android], 'ios'), ios.id)
  assert.equal(read([android], 'ios'), 'REFUSED')
  assert.equal(read([ios, { ...ios, id: android.id }], 'ios'), 'REFUSED')
})

test('post-release runs after a failed run too, so a bundle that reached ring 0 is always smoked', () => {
  const post = readFileSync(path.join(root, '.github', 'workflows', 'post-release.yml'), 'utf8')
  assert.match(post, /contains\(fromJSON\('\["success","failure"\]'\), github\.event\.workflow_run\.conclusion\)/)
})
