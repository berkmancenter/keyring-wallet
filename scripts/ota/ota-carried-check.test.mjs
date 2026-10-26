// node --test scripts/ota/
// ota-carried-check.sh on throwaway wallet and bifold repos: it passes when every OTA commit reaches the cut's target
// (by patch-id, a pin bump, docs only, or a replacement on the target) and fails on a commit that does not.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const here = path.dirname(new URL(import.meta.url).pathname)
const script = path.join(here, 'ota-carried-check.sh')

const git = (dir, ...args) =>
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-C', dir, ...args],
    { encoding: 'utf8' }
  ).trim()
const commit = (dir, file, text, msg) => {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  writeFileSync(path.join(dir, file), text)
  git(dir, 'add', file)
  git(dir, 'commit', '-q', '-m', msg)
  return git(dir, 'rev-parse', 'HEAD')
}

/** A bifold repo and a wallet repo pinning it, each with an OTA branch carrying `ota` commits beyond main. */
function setup({ bifoldOnMain = true, replacement = 'on-main' } = {}) {
  const top = mkdtempSync(path.join(tmpdir(), 'ota-carried-'))
  const bifold = path.join(top, 'bifold-repo')
  const wallet = path.join(top, 'wallet')
  for (const dir of [bifold, wallet]) {
    mkdirSync(dir)
    git(dir, 'init', '-q', '-b', 'main')
  }
  commit(bifold, 'core/a.ts', 'a\n', 'base')
  git(bifold, 'checkout', '-q', '-b', 'ota/1')
  const shim = commit(bifold, 'core/shim.ts', 'shim\n', 'the shim, replaced in the store build')
  commit(bifold, 'core/fix.ts', 'fix\n', 'a fix that merged to main')
  git(bifold, 'checkout', '-q', 'main')
  if (bifoldOnMain) commit(bifold, 'core/fix.ts', 'fix\n', 'a fix that merged to main (#1)')
  const pin = git(bifold, 'rev-parse', 'main')

  mkdirSync(path.join(wallet, 'scripts', 'ota'), { recursive: true })
  copyFileSync(script, path.join(wallet, 'scripts', 'ota', 'ota-carried-check.sh'))
  commit(wallet, 'app/a.ts', 'a\n', 'base')
  git(wallet, 'checkout', '-q', '-b', 'hotfix/1')
  commit(wallet, 'app/b.ts', 'b\n', 'an app fix that merged to main')
  git(wallet, 'update-index', '--add', '--cacheinfo', `160000,${git(bifold, 'rev-parse', 'ota/1')},bifold`)
  git(wallet, 'commit', '-q', '-m', 'pin the OTA bifold')
  commit(wallet, 'docs/notes.md', 'notes\n', 'release notes')
  git(wallet, 'checkout', '-q', 'main')
  commit(wallet, 'app/b.ts', 'b\n', 'an app fix that merged to main (#2)')
  git(wallet, 'update-index', '--add', '--cacheinfo', `160000,${pin},bifold`)
  git(wallet, 'commit', '-q', '-m', 'pin bifold main')
  const patch = commit(wallet, 'patches/askar.patch', 'p\n', 'the store fix that replaces the shim')
  const by = replacement === 'on-main' ? patch : git(wallet, 'rev-parse', 'hotfix/1')
  const replacements = path.join(top, 'replacements.txt')
  writeFileSync(replacements, `# test\nbifold ${shim.slice(0, 8)} ${by.slice(0, 8)} the store fix\n`)

  return () =>
    spawnSync(
      'bash',
      [
        path.join(wallet, 'scripts', 'ota', 'ota-carried-check.sh'),
        ...['--wallet', 'hotfix/1', '--bifold', 'ota/1', '--no-fetch', '--remote', ''],
        ...['--bifold-dir', bifold, '--replacements', replacements],
      ],
      { encoding: 'utf8' }
    )
}

test('passes when every OTA commit reaches the target, each for its reason', () => {
  const r = setup()()
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /an app fix that merged to main +on the target as [0-9a-f]{8} \(same patch-id\)/)
  assert.match(r.stdout, /pin the OTA bifold +pin bump/)
  assert.match(r.stdout, /release notes +docs only/)
  assert.match(r.stdout, /a fix that merged to main +on the target as/)
  assert.match(r.stdout, /the shim, replaced in the store build +replaced by [0-9a-f]{8} \(the store fix\)/)
})

test('fails on an OTA commit that is not in the bifold the target pins', () => {
  const r = setup({ bifoldOnMain: false })()
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stdout, /a fix that merged to main +MISSING/)
})

test('fails when the named replacement is not on the target', () => {
  const r = setup({ replacement: 'off-main' })()
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stdout, /the shim, replaced in the store build +NOT REPLACED: [0-9a-f]{8} is not on main/)
})
