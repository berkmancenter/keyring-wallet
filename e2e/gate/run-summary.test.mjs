// node --test e2e/gate/run-summary.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseMeta, summarize } from './run-summary.mjs';

function runs(spec) {
  const root = mkdtempSync(path.join(tmpdir(), 'runs-'));
  for (const [id, { meta, legs }] of Object.entries(spec)) {
    const dir = path.join(root, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'meta'), meta);
    writeFileSync(path.join(dir, 'legs.tsv'), legs.map(([n, rc]) => `${n}\t${rc}\t100\t160`).join('\n') + '\n');
    for (const [n, , log] of legs) { mkdirSync(path.join(dir, n)); writeFileSync(path.join(dir, n, 'leg.log'), log || ''); }
  }
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}

test('meta: key=value, and a repeated key as a list', () => {
  assert.deepEqual(parseMeta('kind=gate\nchanged-why=a\nchanged-why=b\nnot a pair\n'), { kind: 'gate', 'changed-why': ['a', 'b'] });
});

test('each leg gets whose result it is: app, env, harness or none', () => {
  const r = runs({
    '1011-0900-aaaa-gate': {
      meta: 'pin=aaaa\nkind=gate\ntarget=farm\nwallet=aaaa\nenv=the Mac network\nenv-legs=linkwait\nstarted=s\nended=e\n',
      legs: [
        ['kk', 0, 'ROW kk-a PASS — ok\nROW kk-b SKIP — no B\n'],
        ['testreq', 3, 'ROW t1 PASS — ok\nROW t2 FAIL — the banner says X\n'],
        ['linkwait', 3, 'ROW l1 FAIL — threw\n'],
        ['smoke-ios', 0, 'ROW s1 PASS — ok\nENV Mac slept 02:15Z-02:33Z\n'],
        ['p1', 1, 'LEG p1 BROKEN — applicant link: VTA LINK failed\n'],
        ['waiting', 4, ''],
        ['agents', 143, ''],
      ],
    },
  });
  try {
    const s = summarize(path.join(r.root, '1011-0900-aaaa-gate'));
    const v = Object.fromEntries(s.legs.map((l) => [l.name, `${l.verdict}/${l.result}`]));
    assert.deepEqual(v, { kk: 'app/pass', testreq: 'app/fail', linkwait: 'env/fail', 'smoke-ios': 'env/pass', p1: 'harness/broken', waiting: 'none/not-run', agents: 'none/stopped' });
    assert.equal(s.legs.find((l) => l.name === 'testreq').reason, 't2: the banner says X');
    assert.equal(s.overall, 'fail');
    assert.deepEqual(s.counts, { legs: 7, app: 2, env: 2, harness: 1, none: 2, appFail: 1, regressions: 0, possiblyRegressed: 0 });
    assert.deepEqual(s.heads, { wallet: 'aaaa', target: 'farm' });
  } finally {
    r.done();
  }
});

function gitRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'wallet-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
  git('init', '-q');
  const commit = (m) => { writeFileSync(path.join(dir, 'f'), m); git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', m); return git('rev-parse', 'HEAD'); };
  const older = commit('older, without the fix');
  const newer = commit('newer, with the fix');
  return { dir, older, newer, done: () => rmSync(dir, { recursive: true, force: true }) };
}
const tracked = 'ROW in-257-dots SKIP — tracked (IN-257 fix pending): 6 dots\n';
const passed = 'ROW in-257-dots PASS — cleared\n';

test('a tracked row that passed on an ancestor build and skips again is a regression: an app fail', () => {
  const g = gitRepo();
  const r = runs({
    '1010-0900-aaaa-gate': { meta: `kind=gate\npin=${g.older}\nstarted=2026-10-10T09:00:00Z\n`, legs: [['waiting', 0, passed]] },
    '1011-0900-bbbb-gate': { meta: `kind=gate\npin=${g.newer}\nstarted=2026-10-11T09:00:00Z\n`, legs: [['waiting', 0, tracked + 'ROW other PASS — ok\n']] },
  });
  try {
    const s = summarize(path.join(r.root, '1011-0900-bbbb-gate'), { wallet: g.dir });
    assert.deepEqual(s.legs[0].regressions, [{ row: 'in-257-dots', passedIn: '1010-0900-aaaa-gate' }]);
    assert.equal(`${s.legs[0].verdict}/${s.legs[0].result}`, 'app/fail');
    assert.equal(s.overall, 'fail');
  } finally {
    r.done(); g.done();
  }
});

test('an older build that skips a row a newer build passed is not a regression (a dry run on the golden)', () => {
  const g = gitRepo();
  const r = runs({
    '1011-0900-bbbb-gate': { meta: `kind=gate\npin=${g.newer}\nstarted=2026-10-11T09:00:00Z\n`, legs: [['waiting', 0, passed]] },
    '1011-1000-aaaa-dry': { meta: `kind=dry\npin=${g.older}\nstarted=2026-10-11T10:00:00Z\n`, legs: [['waiting', 0, tracked]] },
  });
  try {
    const s = summarize(path.join(r.root, '1011-1000-aaaa-dry'), { wallet: g.dir });
    assert.equal(s.legs[0].regressions, undefined);
    assert.equal(s.overall, 'pass');
  } finally {
    r.done(); g.done();
  }
});

test('ancestry that cannot be told is "possibly regressed", which does not change the verdict', () => {
  const g = gitRepo();
  const r = runs({
    '1010-0900-xxxx-gate': { meta: 'kind=gate\npin=0123456789abcdef0123456789abcdef01234567\nstarted=2026-10-10T09:00:00Z\n', legs: [['waiting', 0, passed]] },
    '1011-0900-bbbb-gate': { meta: `kind=gate\npin=${g.newer}\nstarted=2026-10-11T09:00:00Z\n`, legs: [['waiting', 0, tracked]] },
  });
  try {
    const s = summarize(path.join(r.root, '1011-0900-bbbb-gate'), { wallet: g.dir });
    assert.equal(s.legs[0].possiblyRegressed[0].row, 'in-257-dots');
    assert.equal(s.overall, 'pass');
    assert.equal(s.counts.possiblyRegressed, 1);
  } finally {
    r.done(); g.done();
  }
});

/**
 * A wallet repo across the fold and the move: gl1, gl2 carry bifold as a gitlink (pins 1 and 2 of a stand-in clone),
 * fold has the framework as a tree under bifold/, after changes a file under it, move renames the tree to packages/
 * (Phase 2), moved changes a file under packages/.
 */
function foldRepo() {
  const top = mkdtempSync(path.join(tmpdir(), 'fold-w-')), clone = mkdtempSync(path.join(tmpdir(), 'fold-b-'));
  const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
  const commit = (dir, m) => { git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', m); return git(dir, 'rev-parse', 'HEAD'); };
  const put = (dir, rel, body) => { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), body); };
  git(clone, 'init', '-q'); put(clone, 'packages/core/src/x.ts', '1'); git(clone, 'add', '-A');
  const pin1 = commit(clone, 'b1'); put(clone, 'packages/core/src/x.ts', '2'); git(clone, 'add', '-A'); const pin2 = commit(clone, 'b2');
  git(top, 'init', '-q'); put(top, 'app/src/a.ts', 'a'); git(top, 'add', 'app');
  git(top, 'update-index', '--add', '--cacheinfo', `160000,${pin1},bifold`); const gl1 = commit(top, 'gitlink pin1');
  git(top, 'update-index', '--add', '--cacheinfo', `160000,${pin2},bifold`); const gl2 = commit(top, 'gitlink pin2');
  git(top, 'rm', '-q', '--cached', 'bifold'); put(top, 'bifold/packages/core/src/x.ts', '2'); put(top, 'bifold/packages/core/testids.json', '{}'); git(top, 'add', 'bifold'); const fold = commit(top, 'fold');
  put(top, 'bifold/packages/core/src/x.ts', '3'); git(top, 'add', 'bifold'); const after = commit(top, 'change x');
  git(top, 'mv', 'bifold/packages', 'packages'); const move = commit(top, 'move');
  put(top, 'packages/core/src/x.ts', '4'); git(top, 'add', 'packages'); const moved = commit(top, 'change x again');
  return { top, clone, pin1, pin2, gl1, gl2, fold, after, move, moved, done: () => { rmSync(top, { recursive: true, force: true }); rmSync(clone, { recursive: true, force: true }); } };
}

test('with no bifold repo at hand, the wallet decides ancestry once its commit carries the framework as a tree (packages/, or bifold/ before the move); a gitlink commit still cannot tell', () => {
  const r = foldRepo();
  const run = (pin, bifold) => ({ older: { meta: `kind=gate\npin=${pin.older}\nbifold=${bifold.older}\nstarted=2026-10-10T09:00:00Z\n`, legs: [['waiting', 0, passed]] },
    newer: { meta: `kind=gate\npin=${pin.newer}\nbifold=${bifold.newer}\nstarted=2026-10-11T09:00:00Z\n`, legs: [['waiting', 0, tracked]] } });
  // Folded: bifold= still written (as the folded tree's or any id), no clone anywhere: the wallet ancestry answers.
  const folded = runs(run({ older: r.fold, newer: r.after }, { older: 'f0ld0001', newer: 'f0ld0002' }));
  // Since the move the same, with bifold= the packages/ tree's id (what heads.sh and ota-deploy.mjs write there).
  const packages = runs(run({ older: r.move, newer: r.moved }, { older: 'cafe0001', newer: 'cafe0002' }));
  // Before the fold, the same with the gitlink commits and no clone: unknown, so possibly regressed and no verdict change.
  const gitlinks = runs(run({ older: r.gl1, newer: r.gl2 }, { older: r.pin1, newer: r.pin2 }));
  try {
    const s = summarize(path.join(folded.root, 'newer'), { wallet: r.top, bifold: null });
    assert.deepEqual(s.legs[0].regressions, [{ row: 'in-257-dots', passedIn: 'older' }]);
    assert.equal(s.overall, 'fail');
    const m = summarize(path.join(packages.root, 'newer'), { wallet: r.top, bifold: null });
    assert.deepEqual(m.legs[0].regressions, [{ row: 'in-257-dots', passedIn: 'older' }]);
    assert.equal(m.overall, 'fail');
    const g = summarize(path.join(gitlinks.root, 'newer'), { wallet: r.top, bifold: null });
    assert.equal(g.legs[0].regressions, undefined);
    assert.equal(g.legs[0].possiblyRegressed[0].row, 'in-257-dots');
    assert.equal(g.overall, 'pass');
    // Control: with the clone at hand the gitlink pins are read there, and the regression shows as before.
    const c = summarize(path.join(gitlinks.root, 'newer'), { wallet: r.top, bifold: r.clone });
    assert.deepEqual(c.legs[0].regressions, [{ row: 'in-257-dots', passedIn: 'older' }]);
  } finally {
    folded.done(); packages.done(); gitlinks.done(); r.done();
  }
});

test('earlier means earlier by started=, not by the folder name (MMDD has no year)', () => {
  const g = gitRepo();
  const r = runs({
    // December's run sorts after January's by name, but started before it.
    '1231-2300-aaaa-gate': { meta: `kind=gate\npin=${g.older}\nstarted=2026-12-31T23:00:00Z\n`, legs: [['waiting', 0, passed]] },
    '0101-0900-bbbb-gate': { meta: `kind=gate\npin=${g.newer}\nstarted=2027-01-01T09:00:00Z\n`, legs: [['waiting', 0, tracked]] },
  });
  try {
    const s = summarize(path.join(r.root, '0101-0900-bbbb-gate'), { wallet: g.dir });
    assert.deepEqual(s.legs[0].regressions, [{ row: 'in-257-dots', passedIn: '1231-2300-aaaa-gate' }]);
  } finally {
    r.done(); g.done();
  }
});

test('a later pass on a side build does not hide an ancestor\u2019s pass', () => {
  const g = gitRepo();
  const r = runs({
    '1010-0900-aaaa-gate': { meta: `kind=gate\npin=${g.older}\nstarted=2026-10-10T09:00:00Z\n`, legs: [['waiting', 0, passed]] },
    // a pass on a build that is not an ancestor of the newest (here an unknown side commit), started later
    '1010-1200-side-gate': { meta: 'kind=gate\npin=fedcba9876543210fedcba9876543210fedcba98\nstarted=2026-10-10T12:00:00Z\n', legs: [['waiting', 0, passed]] },
    '1011-0900-bbbb-gate': { meta: `kind=gate\npin=${g.newer}\nstarted=2026-10-11T09:00:00Z\n`, legs: [['waiting', 0, tracked]] },
  });
  try {
    const s = summarize(path.join(r.root, '1011-0900-bbbb-gate'), { wallet: g.dir });
    assert.deepEqual(s.legs[0].regressions, [{ row: 'in-257-dots', passedIn: '1010-0900-aaaa-gate' }]);
  } finally {
    r.done(); g.done();
  }
});

test('all app passes is pass; any leg with no verdict on the app is incomplete', () => {
  const r = runs({
    '1011-1000-cccc-gate': { meta: 'kind=gate\n', legs: [['kk', 0, 'ROW a PASS — ok\n']] },
    '1011-1100-cccc-rerun': { meta: 'kind=rerun\nrerun-of=1011-1000-cccc-gate\n', legs: [['kk', 0, 'ROW a PASS — ok\n'], ['p1', 4, '']] },
  });
  try {
    assert.equal(summarize(path.join(r.root, '1011-1000-cccc-gate')).overall, 'pass');
    const s = summarize(path.join(r.root, '1011-1100-cccc-rerun'));
    assert.equal(s.overall, 'incomplete');
    assert.equal(s.rerunOf, '1011-1000-cccc-gate');
  } finally {
    r.done();
  }
});

const CORE = 'core=vetting-named:kk vetting-hidden:hv signin:signin-ios join:waiting\n';
const pass = (row) => `ROW ${row} PASS — ok\n`;

test('a full gate where every core journey passed is pass', () => {
  const r = runs({ '1019-1000-cccc-gate': { meta: `kind=gate\n${CORE}`, legs: [['kk', 0, pass('kk-vetting')], ['hv', 0, pass('hv-admitted')], ['signin-ios', 0, pass('signin-approved')], ['waiting', 0, pass('join-sent')]] } });
  try {
    const s = summarize(path.join(r.root, '1019-1000-cccc-gate'));
    assert.equal(s.overall, 'pass');
    assert.deepEqual(s.coreMissing, []);
  } finally { r.done(); }
});

test('a core journey not run, all SKIP, or proven only informationally makes a full gate incomplete, with why', () => {
  const r = runs({ '1019-1100-cccc-gate': { meta: `kind=gate\n${CORE}`, legs: [
    ['kk', 0, pass('kk-vetting')],
    ['hv', 0, 'ROW hv-admitted SKIP — NOT RUN (core journey): no seated Keyring vetter configured\n'],
    ['waiting', 3, 'INFORMATIONAL rows=join-sent VETTER=tui\nROW join-sent FAIL — openvtc\n'],
    ['other', 0, pass('x')],
  ] } });
  try {
    const s = summarize(path.join(r.root, '1019-1100-cccc-gate'));
    assert.equal(s.overall, 'incomplete');
    const by = Object.fromEntries(s.coreMissing.map((m) => [m.journey, m.why]));
    assert.match(by['vetting-hidden'], /hv: every row SKIP/);
    assert.equal(by.signin, 'not run');
    assert.match(by.join, /waiting: informational/);
    assert.equal(by['vetting-named'], undefined);
  } finally { r.done(); }
});

test('an informational row never fails its leg, and is listed apart; other FAILs still do', () => {
  const r = runs({ '1019-1200-cccc-rerun': { meta: 'kind=rerun\ninformational=p1-tui-vets\n', legs: [
    ['p1', 3, `${pass('p1-link')}ROW p1-tui-vets FAIL — keyring-test VTC refused manifest/0.2\n`],
    ['agents', 3, `${pass('a')}ROW b FAIL — real\n`],
  ] } });
  try {
    const s = summarize(path.join(r.root, '1019-1200-cccc-rerun'));
    const p1 = s.legs.find((l) => l.name === 'p1');
    assert.equal(p1.result, 'pass');
    assert.equal(p1.fail, 0);
    assert.equal(s.informational[0].row, 'p1-tui-vets');
    assert.equal(s.legs.find((l) => l.name === 'agents').result, 'fail');
    assert.equal(s.overall, 'fail');
  } finally { r.done(); }
});

test('core journeys only decide a full gate: a rerun of a few legs reports them but is not held by them', () => {
  const r = runs({ '1019-1300-cccc-rerun': { meta: `kind=rerun\n${CORE}`, legs: [['kk', 0, pass('kk-vetting')]] } });
  try {
    const s = summarize(path.join(r.root, '1019-1300-cccc-rerun'));
    assert.equal(s.overall, 'pass');
    assert.equal(s.coreMissing.length, 3);
  } finally { r.done(); }
});

test("a leg's INFORMATIONAL line sets aside only the rows it names: its other FAILs still fail it", () => {
  const r = runs({ '1019-1400-cccc-rerun': { meta: 'kind=rerun\n', legs: [
    ['hv', 3, 'INFORMATIONAL rows=hv-proof,hv-driver VETTER=tui\nROW hv-private-badge FAIL — no badge\nROW hv-proof FAIL — openvtc\nROW hv-driver FAIL — rc=1\n'],
  ] } });
  try {
    const s = summarize(path.join(r.root, '1019-1400-cccc-rerun'));
    const hv = s.legs[0];
    assert.equal(hv.result, 'fail');
    assert.match(hv.reason, /hv-private-badge/);
    assert.deepEqual(s.informational.map((i) => i.row).sort(), ['hv-driver', 'hv-proof']);
    assert.equal(s.overall, 'fail');
  } finally { r.done(); }
});

test('a core journey that names a row (hv@hv-admitted) is not proven while that row SKIPs, however many others pass', () => {
  const CORE_ROW = 'core=vetting-named:kk vetting-hidden:hv@hv-admitted signin:signin-ios join:waiting\n';
  const hv = (admitted) => pass('hv-link') + pass('hv-proof') + admitted;
  const r = runs({
    '1021-1000-cccc-gate': { meta: `kind=gate\n${CORE_ROW}`, legs: [['kk', 0, pass('kk-vetting')], ['hv', 0, hv('ROW hv-admitted SKIP — 2 members joined since the run began (read twice) on this shared community\n')], ['signin-ios', 0, pass('signin-approved')], ['waiting', 0, pass('join-sent')]] },
    '1021-1100-cccc-gate': { meta: `kind=gate\n${CORE_ROW}`, legs: [['kk', 0, pass('kk-vetting')], ['hv', 0, hv(pass('hv-admitted'))], ['signin-ios', 0, pass('signin-approved')], ['waiting', 0, pass('join-sent')]] },
  });
  try {
    const s = summarize(path.join(r.root, '1021-1000-cccc-gate'));
    assert.equal(s.overall, 'incomplete');
    assert.deepEqual(s.coreMissing.map((m) => [m.journey, m.why]), [['vetting-hidden', 'hv: hv-admitted did not PASS']]);
    const ok = summarize(path.join(r.root, '1021-1100-cccc-gate'));
    assert.equal(ok.overall, 'pass');
    assert.deepEqual(ok.coreMissing, []);
  } finally { r.done(); }
});

// Each core journey names the row that is the journey (gate.sh CORE_JOURNEYS): a missing or SKIPped verdict row leaves
// the gate incomplete for that journey alone, however the leg's other rows did.
const PINNED = { 'vetting-named': ['kk', 'kk-vetting'], 'vetting-hidden': ['hv', 'hv-admitted'], signin: ['signin-ios', 'signin-approved'], join: ['waiting', 'join-approved-listed'] };
const PINNED_CORE = `core=${Object.entries(PINNED).map(([j, [leg, row]]) => `${j}:${leg}@${row}`).join(' ')}\n`;
for (const [journey, [legName, verdictRow]] of Object.entries(PINNED)) {
  for (const how of ['SKIP', 'missing']) {
    test(`core journey ${journey}: its verdict row ${verdictRow} ${how} leaves the gate incomplete for it alone`, () => {
      const legs = Object.values(PINNED).map(([leg, row]) => [leg, 0, pass(`${leg}-other`) + (leg !== legName ? pass(row) : how === 'SKIP' ? `ROW ${row} SKIP — not this run's to judge\n` : '')]);
      const r = runs({ '1021-1200-cccc-gate': { meta: `kind=gate\n${PINNED_CORE}`, legs } });
      try {
        const s = summarize(path.join(r.root, '1021-1200-cccc-gate'));
        assert.equal(s.overall, 'incomplete');
        assert.deepEqual(s.coreMissing.map((m) => [m.journey, m.why]), [[journey, `${legName}: ${verdictRow} did not PASS`]]);
      } finally { r.done(); }
    });
  }
}

test('the gate pins each core journey to its verdict row', async () => {
  const { readFileSync } = await import('node:fs');
  const gateSh = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'gate.sh'), 'utf8');
  assert.equal(gateSh.match(/^CORE_JOURNEYS="([^"]*)"/m)[1], PINNED_CORE.slice('core='.length).trim());
});

// The fold's graft: a refs/replace/* ref gives the squash a second parent where the ref is present (this Mac's shared
// .git), and none in CI. isAncestor must answer from the real history, or a run on this Mac could call a build that
// never saw a fix an ancestor of one that did.
import { isAncestor } from './run-summary.mjs';
test('isAncestor ignores a replace ref: a grafted parent does not become an ancestor', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'run-summary-graft-'));
  try {
    const env = { ...process.env }; delete env.GIT_NO_REPLACE_OBJECTS; // plain git here must honour the graft
    const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', env }).trim();
    const commit = (m) => { writeFileSync(path.join(dir, m), m); git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', m); return git('rev-parse', 'HEAD'); };
    git('init', '-q');
    const a = commit('a');
    const b = commit('b');
    git('checkout', '-q', '--orphan', 'other');
    git('rm', '-rqf', '.'); // the orphan starts with the old index staged
    const c = commit('c'); // unrelated history
    git('replace', '--graft', b, a, c); // with the graft, c is an ancestor of b; the real b has one parent
    assert.equal(spawnSync('git', ['-C', dir, 'merge-base', '--is-ancestor', c, b], { env }).status, 0, 'plain git honours the graft: c reads as an ancestor');
    assert.equal(isAncestor(dir, c, b), false, 'the tool reads the real history');
    assert.equal(isAncestor(dir, a, b), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
