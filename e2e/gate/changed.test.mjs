// node --test e2e/gate/changed.test.mjs
// changed.mjs picks the gate legs whose drivers reach a testID that a changed file owns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { changedFiles, idsOwnedBy, layoutAt, ownersFrom, pathExists, select, unitsOf } from './changed.mjs';

/** A small repo: two screens, a page object, three drivers, four legs. */
function fixture() {
  const top = mkdtempSync(path.join(tmpdir(), 'changed-'));
  const e2e = path.join(top, 'e2e');
  const put = (rel, body) => { const p = path.join(e2e, rel); mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, body); };
  put('lib/pages/join.js', `import { existsTestId, tapTestId } from "../driver.js";
export const join = {
  ask(d) {
    return tapTestId(d, "JoinAsk", 1000);
  },
  read(d) {
    return existsTestId(d, "JoinStanding", 1000);
  },
};
`);
  put('lib/driver.js', 'export const tapTestId = () => {};\nexport const existsTestId = () => {};\n');
  put('run-join.mjs', `import { join } from "./lib/pages/join.js";
await join.ask(d);
`);
  put('run-standing.mjs', `import { join } from "./lib/pages/join.js";
await join.read(d);
`);
  put('run-link.mjs', `import { tapTestId } from "./lib/driver.js";
const JOURNEY = process.env.JOURNEY === "1";
async function journey(d) {
  await tapTestId(d, "JoinAsk", 1000);
}
await tapTestId(d, "LinkStart", 1000);
if (JOURNEY) await journey(d);
`);
  put('gate/legs/ask.sh', 'node run-link.mjs\nnode run-join.mjs\n');
  put('gate/legs/standing.sh', 'node run-link.mjs\nnode run-standing.mjs\n');
  put('gate/legs/link.sh', 'LINK_MODE=manual node run-link.mjs\n');
  put('gate/legs/journey.sh', 'JOURNEY=1 \\\n  node run-link.mjs\n');
  const manifests = [{ root: 'packages/core/', json: { keys: {
    JoinAsk: ['src/screens/VtiJoin.ids.ts'], JoinStanding: ['src/screens/Standing.tsx'], LinkStart: ['src/screens/Link.tsx'],
  }, stems: {} } }];
  return { top, e2e, manifests, done: () => rmSync(top, { recursive: true, force: true }) };
}

const legsFor = (changed) => {
  const f = fixture();
  try {
    const r = select(changed, { manifests: f.manifests, legsDir: path.join(f.e2e, 'gate/legs'), root: f.e2e, top: f.top });
    return { legs: [...r.legs.keys()].sort(), unmapped: r.unmapped, reasons: r.legs };
  } finally {
    f.done();
  }
};

test('a screen owns the testIDs of its typed ids map beside it', () => {
  const owners = ownersFrom([{ root: 'packages/core/', json: { keys: { JoinAsk: ['src/screens/VtiJoin.ids.ts'] }, stems: {} } }]);
  const r = idsOwnedBy(['packages/core/src/screens/VtiJoin.tsx'], owners);
  assert.deepEqual([...r.keys], ['JoinAsk']);
  assert.deepEqual(r.unmapped, []);
  // A screen that owns a stem itself still gets its ids map's keys too.
  const both = ownersFrom([{ root: 'r/', json: { keys: { A: ['s/X.ids.ts'] }, stems: { B_: ['s/X.tsx'] } } }]);
  const r2 = idsOwnedBy(['r/s/X.tsx'], both);
  assert.deepEqual([[...r2.keys], [...r2.stems]], [['A'], ['B_']]);
});

test('only the legs whose drivers reach the changed screen: the page-object method, not the whole object', () => {
  // VtiJoin owns JoinAsk: run-join calls join.ask (JoinAsk); run-standing calls join.read only; run-link's journey
  // names JoinAsk but runs only where JOURNEY=1.
  const r = legsFor(['packages/core/src/screens/VtiJoin.tsx']);
  assert.deepEqual(r.legs, ['ask', 'journey']);
  assert.ok(r.reasons.get('ask').some((w) => w.unit.endsWith('lib/pages/join.js#join.ask')));
});

test('a flow behind a flag counts only for the legs that switch it on', () => {
  const r = legsFor(['packages/core/src/screens/Link.tsx']);
  assert.deepEqual(r.legs, ['ask', 'journey', 'link', 'standing']);
  assert.deepEqual(legsFor(['packages/core/src/screens/Standing.tsx']).legs, ['standing']);
});

test('a source file that owns no testID is unmapped, never silently ignored', () => {
  const r = legsFor(['packages/core/src/module/VtaClient.ts', 'docs/notes.md']);
  assert.deepEqual(r.legs, []);
  assert.deepEqual(r.unmapped, ['packages/core/src/module/VtaClient.ts']);
});

test('units: top-level declarations, and an object literal’s methods as obj.method', () => {
  const names = unitsOf('export const join = {\n  ask(d) {\n  },\n  async read(d) {\n  },\n};\nfunction helper() {}\n').map((u) => u.name);
  assert.deepEqual(names, ['join', 'join.ask', 'join.read', 'helper']);
});

test('gate.sh changed refuses what it cannot narrow, and while paused', async () => {
  const { execFileSync } = await import('node:child_process');
  const home = mkdtempSync(path.join(tmpdir(), 'changed-cmd-'));
  try {
    mkdirSync(path.join(home, 'env'));
    writeFileSync(path.join(home, 'env', 'farm.env'), 'PNM_BIN=x\n');
    const gate = path.join(path.dirname(new URL(import.meta.url).pathname), 'gate.sh');
    const run = (...a) => {
      try { execFileSync('bash', [gate, 'changed', ...a], { env: { ...process.env, GATE_HOME: home }, encoding: 'utf8', stdio: 'pipe' }); return ''; }
      catch (e) { return String(e.stderr) + String(e.stdout); }
    };
    assert.match(run('--pin', 'abc', '--files', 'packages/core/src/module/NoIds.ts'), /own no testID.*Run the full gate/);
    writeFileSync(path.join(home, 'stop-after-leg'), 'test pause\n');
    assert.match(run('--pin', 'abc', '--files', 'packages/core/src/screens/PINEnter.tsx'), /paused \(test pause/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a path in neither tree is reported as missing, not taken for a logic file', () => {
  const f = fixture();
  try {
    mkdirSync(path.join(f.top, 'app/src'), { recursive: true });
    writeFileSync(path.join(f.top, 'app/src/Real.tsx'), 'export {}\n');
    assert.equal(pathExists('app/src/Real.tsx', f.top), true);
    assert.equal(pathExists('app/src/Typo.tsx', f.top), false);
  } finally {
    f.done();
  }
});

/**
 * A wallet repo across the fold and the move: gl1, gl2 carry bifold as a gitlink (pins 1 and 2 of a stand-in clone),
 * fold has the framework as a tree under bifold/ (x.ts, testids.json), move renames it to packages/ (Phase 2), after
 * changes packages/core/src/x.ts, plain changes app/ only.
 */
function movedRepo() {
  const top = mkdtempSync(path.join(tmpdir(), 'move-w-')), clone = mkdtempSync(path.join(tmpdir(), 'move-b-'));
  const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
  const commit = (dir, m) => { git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', m); return git(dir, 'rev-parse', 'HEAD'); };
  const put = (dir, rel, body) => { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), body); };
  git(clone, 'init', '-q'); put(clone, 'packages/core/src/x.ts', '1'); put(clone, 'packages/core/testids.json', '{"keys":{},"stems":{}}'); git(clone, 'add', '-A');
  const pin1 = commit(clone, 'b1'); put(clone, 'packages/core/src/x.ts', '2'); git(clone, 'add', '-A'); const pin2 = commit(clone, 'b2');
  git(top, 'init', '-q'); put(top, 'app/src/a.ts', 'a'); git(top, 'add', 'app');
  git(top, 'update-index', '--add', '--cacheinfo', `160000,${pin1},bifold`); const gl1 = commit(top, 'gitlink pin1');
  git(top, 'update-index', '--add', '--cacheinfo', `160000,${pin2},bifold`); const gl2 = commit(top, 'gitlink pin2');
  git(top, 'rm', '-q', '--cached', 'bifold'); put(top, 'bifold/packages/core/src/x.ts', '2'); put(top, 'bifold/packages/core/testids.json', '{"keys":{},"stems":{}}'); git(top, 'add', 'bifold'); const fold = commit(top, 'fold');
  git(top, 'mv', 'bifold/packages', 'packages'); const move = commit(top, 'move');
  put(top, 'packages/core/src/x.ts', '3'); git(top, 'add', 'packages'); const after = commit(top, 'change x');
  put(top, 'app/src/a.ts', 'b'); git(top, 'add', 'app'); const plain = commit(top, 'app only');
  return { top, clone, pin1, pin2, gl1, gl2, fold, move, after, plain, git: (...a) => git(top, ...a), done: () => { rmSync(top, { recursive: true, force: true }); rmSync(clone, { recursive: true, force: true }); } };
}
const X = 'packages/core/src/x.ts';

test('a range: ends at packages/ read the framework from the wallet diff alone; one reaching back before the move is marked, never empty', () => {
  const r = movedRepo();
  try {
    assert.deepEqual([r.gl2, r.fold, r.move, 'nonesuch'].map((rev) => layoutAt(rev, r.top)), ['bifold', 'bifold', 'packages', null]);
    // Control: packages..packages, no clone anywhere, no BIFOLD_GIT: the diff names the path, and nothing else.
    assert.deepEqual(changedFiles(`${r.move}..${r.after}`, r.top), [X]);
    assert.deepEqual(changedFiles(`${r.after}..${r.plain}`, r.top), ['app/src/a.ts']);
    assert.deepEqual(changedFiles(`${r.move}..${r.move}`, r.top), []);
    // The move itself in the range (the folded tree at the base, packages/ at the tip): the mark, and not one of the
    // thousands of moved paths; the mark makes it unmapped (the full gate), not nothing.
    const crossing = changedFiles(`${r.fold}..${r.after}`, r.top);
    assert.deepEqual(crossing, ['bifold']);
    assert.deepEqual(idsOwnedBy(['bifold'], ownersFrom([])).unmapped, ['bifold']);
    // From the submodule era, and the wallet's own change beside it: the same mark, the wallet path kept.
    assert.deepEqual(changedFiles(`${r.gl2}..${r.plain}`, r.top), ['app/src/a.ts', 'bifold']);
    // Both ends before the move: this tool knows the packages/ layout, so it says "all of it" rather than nothing.
    assert.deepEqual(changedFiles(`${r.gl1}..${r.gl2}`, r.top), ['bifold']);
    assert.deepEqual(changedFiles(`${r.gl2}..${r.fold}`, r.top), ['bifold']);
  } finally {
    r.done();
  }
});

test('pathExists: packages/ is read from HEAD’s tree when not on disk; a typo, and a bifold/… path since the move, are missing (never unknowable)', () => {
  const r = movedRepo();
  try {
    rmSync(path.join(r.top, 'packages'), { recursive: true, force: true }); // a worktree whose packages/ is not on disk
    assert.equal(pathExists(X, r.top), true);
    assert.equal(pathExists('packages/core/src/Typo.ts', r.top), false);
    assert.equal(pathExists('bifold/packages/core/src/x.ts', r.top), false);
    // A checkout from before the move: this script does not read elsewhere for it (it is the tool of that era's).
    r.git('checkout', '-q', r.fold);
    assert.equal(pathExists(X, r.top), false);
    assert.equal(pathExists('bifold/packages/core/src/x.ts', r.top), true);
  } finally {
    r.done();
  }
});
