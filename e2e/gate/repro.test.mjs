// node --test e2e/gate/repro.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathExists } from './changed.mjs';
import { plan, queueLine, rowSkeleton, slugOf, unitSkeleton, unitTestPath } from './repro.mjs';

test('a slug from the report id and the first words of what the tester saw', () => {
  assert.equal(slugOf('IN-257', 'After a wrong PIN, the six dots stay filled'), 'in-257-after-a-wrong-pin-the');
  assert.equal(slugOf('IN-259'), 'in-259');
});

test('unit tests go where this repo keeps them', () => {
  const p = (f) => unitTestPath(f, 's');
  assert.equal(p('packages/core/src/modules/trust-tasks/module/VtaClient.ts'), 'packages/core/src/modules/trust-tasks/__tests__/s.test.ts');
  assert.equal(p('packages/core/src/screens/PINEnter.tsx'), 'packages/core/__tests__/screens/s.test.tsx');
  assert.equal(p('packages/react-hooks/src/x.ts'), 'packages/react-hooks/tests/s.test.ts');
  assert.equal(p('packages/trust-tasks/src/proof.ts'), 'packages/core/src/modules/trust-tasks/__tests__/s.test.ts');
  assert.equal(p('app/src/screens/Home.tsx'), 'app/__tests__/screens/s.test.tsx');
});

test('the starting tests fail until written; a row is plain, tracked only explained, never set', () => {
  assert.match(unitSkeleton({ id: 'IN-259', saw: "it's minted" }), /expect\('replace this'\)\.toBe\(/);
  assert.match(unitSkeleton({ id: 'IN-259', saw: "it's minted" }), /describe\('IN-259: it\\'s minted'/);
  const row = rowSkeleton({ id: 'IN-257', saw: 'dots stay', slug: 'in-257-dots' });
  assert.match(row, /await rows\.row\("in-257-dots", async \(\) => \{/);
  assert.match(row, /ok: false/);
  assert.match(row, /\}\);\n$/, 'the call ends without an options argument');
  assert.doesNotMatch(row.split('\n').filter((l) => !l.startsWith('//')).join('\n'), /tracked/);
});

test('the queue line: exactly this id, the newest one', () => {
  const q = '- t1 | IN-25 | old\n- t2 | IN-257 | not this\n- t3 | IN-25-FIX | newer\n';
  assert.equal(queueLine('IN-25', q), '- t3 | IN-25-FIX | newer');
  assert.equal(queueLine('IN-2', q), '');
});

/** A small repo: a page object, a rows driver and a non-rows driver, two legs; a manifest. */
function fixture() {
  const top = mkdtempSync(path.join(tmpdir(), 'repro-'));
  const e2e = path.join(top, 'e2e');
  const put = (rel, body) => { const p = path.join(e2e, rel); mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, body); };
  put('lib/driver.js', 'export const tapTestId = () => {};\n');
  put('lib/pages/pin.js', 'import { tapTestId } from "../driver.js";\nexport const pin = {\n  enter(d) {\n    return tapTestId(d, "EnterPIN", 1);\n  },\n};\n');
  put('run-pin.mjs', 'import { createRows } from "./lib/rows.js";\nimport { pin } from "./lib/pages/pin.js";\nconst rows = createRows({});\nawait pin.enter(d);\n');
  put('run-plain.mjs', 'import { pin } from "./lib/pages/pin.js";\nawait pin.enter(d);\n');
  put('gate/legs/smoke-x.sh', 'node run-pin.mjs\n');
  put('gate/legs/other.sh', 'node run-plain.mjs\n');
  const manifests = [{ root: 'packages/core/', json: { keys: { EnterPIN: ['src/screens/PINEnter.tsx'] }, stems: {} } }];
  const exists = (f) => !/Typo/.test(f);
  return { top, e2e, opts: { manifests, legsDir: path.join(e2e, 'gate/legs'), exists, repoRoot: top }, done: () => rmSync(top, { recursive: true, force: true }) };
}

test('plan: a screen the gate reaches -> a row in a rows driver (not the one without createRows)', () => {
  const f = fixture();
  try {
    const p = plan({ files: ['packages/core/src/screens/PINEnter.tsx'] }, f.opts);
    assert.equal(p.kind, 'row');
    assert.deepEqual(p.driver.leg, 'smoke-x');
    assert.match(p.driver.driver, /run-pin\.mjs$/);
  } finally {
    f.done();
  }
});

test('plan: logic owning no testID -> a unit test, every unmapped file listed; a typo is missing, not logic', () => {
  const f = fixture();
  try {
    const p = plan({ files: ['packages/core/src/modules/trust-tasks/module/VtaClient.ts', 'packages/core/src/modules/trust-tasks/module/vtaAgent.ts'] }, f.opts);
    assert.equal(p.kind, 'unit');
    assert.equal(p.unmapped.length, 2);
    assert.match(p.unitPath, /trust-tasks\/__tests__\/<slug>\.test\.ts$/);
    const t = plan({ files: ['packages/core/src/screens/Typo.tsx'] }, f.opts);
    assert.equal(t.kind, 'none');
    assert.deepEqual(t.missing, ['packages/core/src/screens/Typo.tsx']);
  } finally {
    f.done();
  }
});

/**
 * A wallet repo across the fold and the move: gl1, gl2 carry bifold as a gitlink (pins 1 and 2 of a stand-in clone),
 * fold has the framework as a tree under bifold/ (x.ts, testids.json), move renames it to packages/ (Phase 2), after
 * changes packages/core/src/x.ts.
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
  return { top, clone, gl1, gl2, fold, move, after, done: () => { rmSync(top, { recursive: true, force: true }); rmSync(clone, { recursive: true, force: true }); } };
}

test('plan on a moved repo whose packages/ is not on disk: a file in HEAD’s tree is present (a unit test); a typo under packages/, and a bifold/… path since the move, are missing', () => {
  const f = fixture(), r = movedRepo();
  try {
    rmSync(path.join(r.top, 'packages'), { recursive: true, force: true });
    const opts = { ...f.opts, exists: (p) => pathExists(p, r.top) };
    const p = plan({ files: ['packages/core/src/x.ts'] }, opts);
    assert.equal(p.kind, 'unit');
    assert.deepEqual(p.missing, []);
    assert.equal(p.unitPath, 'packages/core/__tests__/<slug>.test.ts');
    const t = plan({ files: ['packages/core/src/screens/Typo.tsx'] }, opts);
    assert.equal(t.kind, 'none');
    assert.deepEqual(t.missing, ['packages/core/src/screens/Typo.tsx']);
    const old = plan({ files: ['bifold/packages/core/src/x.ts'] }, opts);
    assert.equal(old.kind, 'none');
    assert.deepEqual(old.missing, ['bifold/packages/core/src/x.ts']);
  } finally {
    f.done(); r.done();
  }
});
