// node --test scripts/ota/
// ota-carried-check.sh on throwaway wallet and bifold repos: it passes when every OTA commit reaches the cut's target
// (by patch-id, docs only, a replacement on the target, or through the bifold commit a pin bump points at) and fails
// on a commit that does not, however it is reached.
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
const pinTo = (dir, sha, msg) => {
  git(dir, 'update-index', '--add', '--cacheinfo', `160000,${sha},bifold`)
  git(dir, 'commit', '-q', '-m', msg)
}

/**
 * A bifold repo and a wallet repo pinning it. The wallet's OTA branch hotfix/1 carries an app fix, a pin bump to the
 * bifold OTA branch ota/1 (a shim replaced in the store build, and a fix), and release notes.
 */
function setup({ bifoldOnMain = true, replacement = 'on-main', mergeMain = false } = {}) {
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
  commit(bifold, 'core/fix.ts', 'fix\n', 'a bifold fix')
  git(bifold, 'checkout', '-q', 'main')
  if (bifoldOnMain) commit(bifold, 'core/fix.ts', 'fix\n', 'a bifold fix (#1)')
  const pin = git(bifold, 'rev-parse', 'main')

  mkdirSync(path.join(wallet, 'scripts', 'ota'), { recursive: true })
  copyFileSync(script, path.join(wallet, 'scripts', 'ota', 'ota-carried-check.sh'))
  commit(wallet, 'app/a.ts', 'a\n', 'base')
  git(wallet, 'checkout', '-q', '-b', 'hotfix/1')
  commit(wallet, 'app/b.ts', 'b\n', 'an app fix')
  pinTo(wallet, git(bifold, 'rev-parse', 'ota/1'), 'pin the OTA bifold')
  commit(wallet, 'docs/notes.md', 'notes\n', 'release notes')
  git(wallet, 'checkout', '-q', 'main')
  commit(wallet, 'app/b.ts', 'b\n', 'an app fix (#2)')
  if (mergeMain) {
    // The way our sessions bring a branch up to date (force-pushes are refused): a merge commit on the OTA branch.
    git(wallet, 'checkout', '-q', 'hotfix/1')
    git(wallet, 'merge', '-q', '--no-ff', '-m', 'Merge main into hotfix/1', 'main')
    git(wallet, 'checkout', '-q', 'main')
  }
  pinTo(wallet, pin, 'pin bifold main')
  const patch = commit(wallet, 'patches/askar.patch', 'p\n', 'the store fix that replaces the shim')
  const by = replacement === 'on-main' ? patch : git(wallet, 'rev-parse', 'hotfix/1')
  const replacements = path.join(top, 'replacements.txt')
  writeFileSync(replacements, `# test\nbifold ${shim.slice(0, 8)} ${by.slice(0, 8)} the store fix\n`)

  return (...extra) =>
    spawnSync(
      'bash',
      [
        path.join(wallet, 'scripts', 'ota', 'ota-carried-check.sh'),
        ...['--wallet', 'hotfix/1', '--no-fetch', '--remote', '', '--bifold-dir', bifold, '--replacements', replacements],
        ...extra,
      ],
      { encoding: 'utf8' }
    )
}

test('passes when every OTA commit reaches the target, each for its reason', () => {
  const r = setup()()
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /an app fix +on the target as [0-9a-f]{8} \(same patch-id\)/)
  assert.match(r.stdout, /pin the OTA bifold +pin bump to [0-9a-f]{8}: its bifold commits are checked below/)
  assert.match(r.stdout, /release notes +docs only/)
  assert.match(r.stdout, /a bifold fix +on the target as/)
  assert.match(r.stdout, /the shim, replaced in the store build +replaced by [0-9a-f]{8} \(the store fix\)/)
})

test('a pin bump is checked through the bifold commit it pins, with or without --bifold', () => {
  // The OTA pinned a bifold fix the target's pin lacks. Naming no bifold branch must not wave it through.
  const run = setup({ bifoldOnMain: false })
  for (const extra of [[], ['--bifold', 'ota/1']]) {
    const r = run(...extra)
    assert.equal(r.status, 1, `${extra.join(' ') || 'no --bifold'}: ${r.stdout}${r.stderr}`)
    assert.match(r.stdout, /a bifold fix +MISSING/)
  }
})

test('a named bifold branch the pin bumps already covered gets no second set of rows', () => {
  const r = setup()('--bifold', 'ota/1')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(r.stdout.match(/a bifold fix /g).length, 1)
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

/**
 * A wallet whose OTA branch hotfix/1 makes `ota` (a list of [file, text, message]) and whose main then makes `main`,
 * pinning one bifold commit throughout. Returns the check's run on hotfix/1.
 */
function walletOnly(ota, main, base = [['app/c.ts', '1\n2\n3\n4\n5\n6\n7\n8\n', 'base']]) {
  const top = mkdtempSync(path.join(tmpdir(), 'ota-carried-w-'))
  const bifold = path.join(top, 'bifold-repo')
  const wallet = path.join(top, 'wallet')
  for (const dir of [bifold, wallet]) {
    mkdirSync(dir)
    git(dir, 'init', '-q', '-b', 'main')
  }
  const pin = commit(bifold, 'core/a.ts', 'a\n', 'base')
  mkdirSync(path.join(wallet, 'scripts', 'ota'), { recursive: true })
  copyFileSync(script, path.join(wallet, 'scripts', 'ota', 'ota-carried-check.sh'))
  for (const [f, text, msg] of base) commit(wallet, f, text, msg)
  pinTo(wallet, pin, 'pin bifold')
  git(wallet, 'checkout', '-q', '-b', 'hotfix/1')
  for (const [f, text, msg] of ota) commit(wallet, f, text, msg)
  git(wallet, 'checkout', '-q', 'main')
  for (const [f, text, msg] of main) {
    if (typeof f === 'string') commit(wallet, f, text, msg)
    else {
      // One commit of several files, as a squash merge lands.
      for (const [file, body] of Object.entries(f)) {
        mkdirSync(path.dirname(path.join(wallet, file)), { recursive: true })
        writeFileSync(path.join(wallet, file), body)
        git(wallet, 'add', file)
      }
      git(wallet, 'commit', '-q', '-m', text)
    }
  }
  return spawnSync(
    'bash',
    [
      path.join(wallet, 'scripts', 'ota', 'ota-carried-check.sh'),
      ...['--wallet', 'hotfix/1', '--no-fetch', '--remote', '', '--bifold-dir', bifold],
    ],
    { encoding: 'utf8' }
  )
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
      ['app/e.ts', 'e\n', 'add e'],
    ],
    [[{ 'app/d.ts': 'd\n', 'app/e.ts': 'e\n' }, 'add d and e (#4)']]
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

test('says what is missing, and exits 2, when the bifold commit the target pins is not in the bifold repository', () => {
  const r = setup()('--bifold-dir', mkdtempSync(path.join(tmpdir(), 'ota-carried-empty-')))
  assert.equal(r.status, 2, r.stdout + r.stderr)
  assert.match(r.stderr, /the bifold commit main pins \([0-9a-f]{40}\) is not in/)
})
