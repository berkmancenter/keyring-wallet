// node --test e2e/gate/run-summary.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
    ['waiting', 3, 'INFORMATIONAL VETTER=tui\nROW join-sent FAIL — openvtc\n'],
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
