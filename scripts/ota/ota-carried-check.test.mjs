// node --test scripts/ota/
// ota-carried-check.sh on a throwaway wallet whose framework is the packages/ tree (since the move): it passes when
// every OTA commit reaches the cut's target (by patch-id, by content, docs only, or a replacement on the target), fails
// on a commit that does not, and refuses (exit 2) what it cannot follow: a commit from before the move (it touches
// bifold/…), or a target that still carries bifold.
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
const run = (wallet, ...args) =>
  spawnSync('bash', [path.join(wallet, 'scripts', 'ota', 'ota-carried-check.sh'), ...args], { encoding: 'utf8' })

/** A wallet with this script at scripts/ota and the framework's tree at packages/ (or where `framework` says). */
function wallet(framework = 'packages/core/a.ts') {
  const top = mkdtempSync(path.join(tmpdir(), 'ota-carried-'))
  const dir = path.join(top, 'wallet')
  mkdirSync(dir)
  git(dir, 'init', '-q', '-b', 'main')
  mkdirSync(path.join(dir, 'scripts', 'ota'), { recursive: true })
  copyFileSync(script, path.join(dir, 'scripts', 'ota', 'ota-carried-check.sh'))
  commit(dir, framework, 'a\n', 'base')
  return { top, dir }
}

/**
 * The wallet's OTA branch hotfix/1 carries an app fix, a framework fix under packages/, a shim (replaced in the store
 * build by a yarn patch) and release notes; main gets the app fix, the framework fix (unless `frameworkOnMain` is
 * false) and the patch. Returns the check's run on hotfix/1.
 */
function setup({ frameworkOnMain = true, replacement = 'on-main', mergeMain = false } = {}) {
  const { top, dir } = wallet()
  commit(dir, 'app/a.ts', 'a\n', 'app base')
  git(dir, 'checkout', '-q', '-b', 'hotfix/1')
  commit(dir, 'app/b.ts', 'b\n', 'an app fix')
  const shim = commit(dir, 'packages/core/shim.ts', 'shim\n', 'the shim, replaced in the store build')
  commit(dir, 'packages/core/fix.ts', 'fix\n', 'a framework fix')
  commit(dir, 'docs/notes.md', 'notes\n', 'release notes')
  git(dir, 'checkout', '-q', 'main')
  commit(dir, 'app/b.ts', 'b\n', 'an app fix (#2)')
  if (frameworkOnMain) commit(dir, 'packages/core/fix.ts', 'fix\n', 'a framework fix (#1)')
  if (mergeMain) {
    // The way our sessions bring a branch up to date (force-pushes are refused): a merge commit on the OTA branch.
    git(dir, 'checkout', '-q', 'hotfix/1')
    git(dir, 'merge', '-q', '--no-ff', '-m', 'Merge main into hotfix/1', 'main')
    git(dir, 'checkout', '-q', 'main')
  }
  const patch = commit(dir, 'patches/askar.patch', 'p\n', 'the store fix that replaces the shim')
  const by = replacement === 'on-main' ? patch : git(dir, 'rev-parse', 'hotfix/1')
  const replacements = path.join(top, 'replacements.txt')
  writeFileSync(replacements, `# test\nwallet ${shim.slice(0, 8)} ${by.slice(0, 8)} the store fix\n`)
  return (...extra) => run(dir, '--wallet', 'hotfix/1', '--no-fetch', '--remote', '', '--replacements', replacements, ...extra)
}

test('passes when every OTA commit reaches the target, each for its reason; the framework change like any other', () => {
  const r = setup()()
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /an app fix +on the target as [0-9a-f]{8} \(same patch-id\)/)
  assert.match(r.stdout, /a framework fix +on the target as [0-9a-f]{8} \(same patch-id\)/)
  assert.match(r.stdout, /release notes +docs only/)
  assert.match(r.stdout, /the shim, replaced in the store build +replaced by [0-9a-f]{8} \(the store fix\)/)
  assert.match(r.stdout, /its framework tree [0-9a-f]{8} \(packages\/, one codebase\)/)
})

test('a framework fix the target lacks is MISSING, like an app fix would be', () => {
  const r = setup({ frameworkOnMain: false })()
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stdout, /a framework fix +MISSING/)
})

test('fails when the named replacement is not on the target', () => {
  const r = setup({ replacement: 'off-main' })()
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stdout, /the shim, replaced in the store build +NOT REPLACED: [0-9a-f]{8} is not on main/)
})

test('a merge of main into the OTA branch is not a missing commit', () => {
  const r = setup({ mergeMain: true })()
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.doesNotMatch(r.stdout, /Merge main/)
})

test('--bifold and --bifold-dir (the submodule era) are refused with the reason, not ignored', () => {
  for (const extra of [['--bifold', 'ota/1'], ['--bifold-dir', '/nowhere']]) {
    const r = setup()(...extra)
    assert.equal(r.status, 2, extra.join(' '))
    assert.match(r.stderr, /name their branches with --wallet/)
  }
})

/**
 * A wallet whose OTA branch hotfix/1 makes `ota` (a list of [file, text, message]) and whose main then makes `main`.
 * Returns the check's run on hotfix/1.
 */
function walletOnly(ota, main, base = [['app/c.ts', '1\n2\n3\n4\n5\n6\n7\n8\n', 'app base']], framework) {
  const { dir } = wallet(framework)
  for (const [f, text, msg] of base) commit(dir, f, text, msg)
  git(dir, 'checkout', '-q', '-b', 'hotfix/1')
  for (const [f, text, msg] of ota) commit(dir, f, text, msg)
  git(dir, 'checkout', '-q', 'main')
  for (const [f, text, msg] of main) {
    if (typeof f === 'string') commit(dir, f, text, msg)
    else {
      // One commit of several files, as a squash merge lands.
      for (const [file, body] of Object.entries(f)) {
        mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
        writeFileSync(path.join(dir, file), body)
        git(dir, 'add', file)
      }
      git(dir, 'commit', '-q', '-m', text)
    }
  }
  return run(dir, '--wallet', 'hotfix/1', '--no-fetch', '--remote', '')
}

test('a change that landed on main in new context still counts (a squash over a conflict resolution)', () => {
  // main changed a neighbouring line first, so the same added line comes with different context: no patch-id match.
  const r = walletOnly(
    [['app/c.ts', '1\n2\n3\n4\nX\n5\n6\n7\n8\n', 'add X']],
    [
      ['app/c.ts', '1\n2\n3\n4\n5b\n6\n7\n8\n', 'main changes a neighbour'],
      ['app/c.ts', '1\n2\n3\n4\nX\n5b\n6\n7\n8\n', 'add X (#3)'],
    ]
  )
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /add X +on the target as [0-9a-f]{8} \(the same changed lines, in new context\)/)
})

test('two OTA commits squashed into one on main still count, by content', () => {
  const r = walletOnly(
    [
      ['app/d.ts', 'd\n', 'add d'],
      ['packages/core/e.ts', 'e\n', 'add e'],
    ],
    [[{ 'app/d.ts': 'd\n', 'packages/core/e.ts': 'e\n' }, 'add d and e (#4)']]
  )
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /add d +on the target by content/)
  assert.match(r.stdout, /add e +on the target by content/)
})

test('a change main has since changed again is MISSING, for a person to look at', () => {
  const r = walletOnly(
    [['app/c.ts', '1\n2\n3\n4\nX\n5\n6\n7\n8\n', 'add X']],
    [['app/c.ts', '1\n2\n3\n4\nY\n5\n6\n7\n8\n', 'add Y instead (#5)']]
  )
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stdout, /add X +MISSING/)
})

test('an OTA commit from before the move (it touches bifold/…) cannot be followed: its row says so and the run exits 2, even with everything else carried', () => {
  // The OTA branch left main before the move: its framework fix is under bifold/, main's twin is under packages/.
  const r = walletOnly(
    [
      ['app/d.ts', 'd\n', 'add d'],
      ['bifold/packages/core/fix.ts', 'fix\n', 'a framework fix, old place'],
    ],
    [
      ['app/d.ts', 'd\n', 'add d (#6)'],
      ['packages/core/fix.ts', 'fix\n', 'a framework fix (#7)'],
    ]
  )
  assert.equal(r.status, 2, r.stdout + r.stderr)
  assert.match(r.stdout, /add d +on the target as [0-9a-f]{8} \(same patch-id\)/)
  assert.match(r.stdout, /a framework fix, old place +touches bifold\/ \(from before the move of the framework into packages\/\): cannot be followed/)
  assert.match(r.stderr, /from before the move .* check it by hand/)
  assert.doesNotMatch(r.stdout, /everything shipped by OTA reaches the target/)
})

test('a target that still carries bifold (from before the move) is refused, exit 2, before any row', () => {
  const r = walletOnly([['app/d.ts', 'd\n', 'add d']], [], undefined, 'bifold/packages/core/a.ts')
  assert.equal(r.status, 2, r.stdout + r.stderr)
  assert.match(r.stderr, /main carries bifold as a tree \(from before the move/)
  assert.doesNotMatch(r.stdout, /add d/)
})

test('a target with no packages/ tree at all is refused, exit 2', () => {
  const r = walletOnly([['app/d.ts', 'd\n', 'add d']], [], undefined, 'app/only.ts')
  assert.equal(r.status, 2, r.stdout + r.stderr)
  assert.match(r.stderr, /has no packages\/ tree/)
})
