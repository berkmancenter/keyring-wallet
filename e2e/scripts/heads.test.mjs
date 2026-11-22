// node --test e2e/scripts/heads.test.mjs
// heads.sh in both eras: a wallet that pins bifold as a submodule (release/255 and older), and the folded tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
const commit = (dir, m) => { git(dir, 'add', '-A'); git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', m); return git(dir, 'rev-parse', 'HEAD'); };
// A wallet-shaped repo holding a copy of heads.sh at e2e/scripts/, so ROOT resolves to it.
const wallet = (top) => {
  const w = path.join(top, 'wallet');
  mkdirSync(path.join(w, 'e2e/scripts'), { recursive: true });
  cpSync(path.join(here, 'heads.sh'), path.join(w, 'e2e/scripts/heads.sh'));
  git(w, 'init', '-q');
  return w;
};
const run = (w, env = {}) => spawnSync('bash', [path.join(w, 'e2e/scripts/heads.sh')], { encoding: 'utf8', env: { ...process.env, ...env } });

test('folded tree: no pin, the wallet head scopes the result, exit 0', () => {
  const top = mkdtempSync(path.join(tmpdir(), 'heads-fold-'));
  try {
    const w = wallet(top);
    writeFileSync(path.join(w, 'app.txt'), 'app\n');
    mkdirSync(path.join(w, 'bifold/packages/core/src'), { recursive: true });
    writeFileSync(path.join(w, 'bifold/packages/core/src/x.ts'), 'x\n');
    const head = commit(w, 'folded');
    const tree = git(w, 'rev-parse', 'HEAD:bifold');
    const r = run(w);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`heads: wallet ${head.slice(0, 8)} · bifold tree ${tree.slice(0, 8)} \\(one codebase, no pin\\)`));
    assert.match(r.stdout, /heads: SUMMARY wallet .* \(one codebase: the wallet commit scopes the result\)/);
    assert.doesNotMatch(r.stdout + r.stderr, /this wallet tree pins|UNKNOWN|ALLOW_UNPINNED/);
  } finally {
    rmSync(top, { recursive: true, force: true });
  }
});

test('submodule era: at the pin exit 0; behind the pin, the gap is named and the run fails unless ALLOW_UNPINNED', () => {
  const top = mkdtempSync(path.join(tmpdir(), 'heads-pin-'));
  try {
    // bifold's own repository with two commits, checked out at bifold/ inside the wallet, as a submodule checkout is.
    const w = wallet(top);
    const b = path.join(w, 'bifold');
    mkdirSync(b);
    git(b, 'init', '-q');
    writeFileSync(path.join(b, 'a.txt'), 'a\n');
    const b1 = commit(b, 'bifold one');
    writeFileSync(path.join(b, 'a.txt'), 'b\n');
    const b2 = commit(b, 'bifold two');
    writeFileSync(path.join(w, 'app.txt'), 'app\n');
    git(w, 'add', 'app.txt', 'e2e');
    git(w, 'update-index', '--add', '--cacheinfo', `160000,${b2},bifold`);
    git(w, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'pins two');
    let r = run(w);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\(at pin\)/);
    git(b, 'checkout', '-q', b1); // the checkout falls one commit behind the pin
    r = run(w);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /missing 1 commit\(s\) the pin has/);
    assert.match(r.stdout, /SUMMARY .* \(pin .*, minus .* "bifold two"\)/);
    r = run(w, { ALLOW_UNPINNED: '1' });
    assert.equal(r.status, 0);
  } finally {
    rmSync(top, { recursive: true, force: true });
  }
});
