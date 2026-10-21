// node --test scripts/ota/
// record-fingerprint.sh in a throwaway repo, with a fake `npx` standing in for
// `hot-updater fingerprint create` (it injects into the native files the way the
// real one does). staging.yaml runs the script without continue-on-error, so its
// exit status is the store build step's: it must fail only when a file was not
// put back.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const script = path.join(path.dirname(new URL(import.meta.url).pathname), 'record-fingerprint.sh')
const NATIVE = [
  'app/ios/AriesBifold/Info.plist',
  'app/ios/AriesBifoldTests/Info.plist',
  'app/android/app/src/main/AndroidManifest.xml',
]
const IOS = '0dfd029716f42c47ede761ce7bc2b4404bc9fde9'

// mode: ok | create-fails | lock-first (the first file cannot be restored)
const run = (mode) => {
  const root = mkdtempSync(path.join(tmpdir(), 'record-fp-'))
  const repo = path.join(root, 'repo')
  mkdirSync(path.join(repo, 'scripts', 'ota'), { recursive: true })
  copyFileSync(script, path.join(repo, 'scripts', 'ota', 'record-fingerprint.sh'))
  for (const f of NATIVE) {
    mkdirSync(path.dirname(path.join(repo, f)), { recursive: true })
    writeFileSync(path.join(repo, f), `original ${f}\n`)
  }
  const bin = path.join(root, 'bin')
  mkdirSync(bin)
  writeFileSync(
    path.join(bin, 'npx'),
    `#!/bin/bash
for f in ios/AriesBifold/Info.plist ios/AriesBifoldTests/Info.plist android/app/src/main/AndroidManifest.xml; do echo INJECTED >> "$f"; done
[ "$MODE" = create-fails ] && exit 1
echo '{"ios":{"hash":"${IOS}","sources":[]},"android":{"hash":"25c3c1df48da7165295a8210d13a338e2d228545","sources":[]}}' > fingerprint.json
[ "$MODE" = lock-first ] && chmod 444 ios/AriesBifold/Info.plist
exit 0
`
  )
  chmodSync(path.join(bin, 'npx'), 0o755)
  const output = path.join(root, 'github-output')
  writeFileSync(output, '')
  const r = spawnSync(
    'bash',
    [path.join(repo, 'scripts', 'ota', 'record-fingerprint.sh'), 'ios', path.join(root, 'out')],
    {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, MODE: mode, GITHUB_OUTPUT: output },
    }
  )
  const restored = NATIVE.map((f) => readFileSync(path.join(repo, f), 'utf8') === `original ${f}\n`)
  return {
    status: r.status,
    log: r.stdout + r.stderr,
    restored,
    leftover: existsSync(path.join(repo, 'app', 'fingerprint.json')),
    output: readFileSync(output, 'utf8'),
  }
}

test('recorded: exit 0, the hash as output, every file back', () => {
  const r = run('ok')
  assert.equal(r.status, 0, r.log)
  assert.equal(r.output.trim(), `hash=${IOS}`)
  assert.deepEqual(r.restored, [true, true, true])
  assert.equal(r.leftover, false)
})

test('not computable: exit 0 (the release goes on), a warning, no hash, every file back', () => {
  const r = run('create-fails')
  assert.equal(r.status, 0, r.log)
  assert.match(r.log, /::warning::record-fingerprint: no ios fingerprint recorded \(fingerprint create failed\)/)
  assert.equal(r.output, '')
  assert.deepEqual(r.restored, [true, true, true])
})

test('a file not put back: exit 3 (the build job fails), the others still restored', () => {
  const r = run('lock-first')
  assert.equal(r.status, 3, r.log)
  assert.match(r.log, /::error::record-fingerprint: app\/ios\/AriesBifold\/Info.plist was not restored/)
  assert.deepEqual(r.restored, [false, true, true])
  assert.equal(r.leftover, false)
})
