// node --test e2e/gate/samebuild.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appPaths, globToRegExp, pushPathsIgnore, verdict } from './samebuild.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

const WORKFLOW = `name: Test builds
on:
  push:
    # a comment inside the trigger
    branches: [main]
    paths-ignore:
      - "docs/**"
      - "**/*.md"
      - 'e2e/**'
      - tsp-reference/**
  workflow_dispatch:
    inputs:
      platform:
        type: string
jobs:
  build:
    runs-on: ubuntu-latest
`;

test('reads the push trigger’s paths-ignore list, quoted or not, and nothing after it', () => {
  assert.deepEqual(pushPathsIgnore(WORKFLOW), ['docs/**', '**/*.md', 'e2e/**', 'tsp-reference/**']);
  assert.equal(pushPathsIgnore('on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n'), undefined);
  assert.equal(pushPathsIgnore('name: x\njobs: {}\n'), undefined);
});

test('the real test-builds.yml lists e2e/** and docs/** (read, not copied)', () => {
  const globs = pushPathsIgnore(readFileSync(path.join(repoRoot, '.github/workflows/test-builds.yml'), 'utf8'));
  assert.ok(globs.includes('e2e/**') && globs.includes('docs/**'), JSON.stringify(globs));
});

test('globs as GitHub matches them: ** at any depth, **/ also at the root, * within a segment', () => {
  assert.ok(globToRegExp('**/*.md').test('README.md'));
  assert.ok(globToRegExp('**/*.md').test('app/docs/x.md'));
  assert.ok(globToRegExp('e2e/**').test('e2e/gate/gate.sh'));
  assert.ok(!globToRegExp('e2e/**').test('app/e2e.ts'));
  assert.ok(!globToRegExp('docs/*').test('docs/a/b.md'));
  assert.deepEqual(appPaths(['e2e/a.js', 'docs/x.md', 'app/src/App.tsx', 'README.md'], ['e2e/**', 'docs/**', '**/*.md']), ['app/src/App.tsx']);
});

test('a fake commit range: e2e-only is the same app; an app change is not; an unreadable range is unknown', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'samebuild-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
  const commit = (file, body, msg) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), body);
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', msg);
    return git('rev-parse', 'HEAD');
  };
  try {
    git('init', '-q');
    commit('.github/workflows/test-builds.yml', WORKFLOW, 'workflow');
    const built = commit('app/src/App.tsx', 'export {}\n', 'app');
    commit('e2e/gate/gate.sh', 'echo\n', 'e2e only');
    const e2eOnly = commit('docs/notes.md', '# n\n', 'docs only');
    const appChange = commit('app/src/App.tsx', 'export const x = 1\n', 'app change');
    assert.deepEqual(verdict(dir, built, e2eOnly), { code: 0, line: 'same' });
    assert.deepEqual(verdict(dir, built, appChange), { code: 1, line: 'app-changed 1 app/src/App.tsx' });
    assert.equal(verdict(dir, built, 'deadbeef').code, 2);
    assert.equal(verdict(dir, built, e2eOnly, '.github/workflows/missing.yml').code, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
