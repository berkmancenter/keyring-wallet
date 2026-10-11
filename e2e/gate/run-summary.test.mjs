// node --test e2e/gate/run-summary.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
    assert.deepEqual(s.counts, { legs: 7, app: 2, env: 2, harness: 1, none: 2, appFail: 1, regressions: 0 });
    assert.deepEqual(s.heads, { wallet: 'aaaa', target: 'farm' });
  } finally {
    r.done();
  }
});

test('a tracked row that passed in an earlier run and skips again is a regression: an app fail', () => {
  const r = runs({
    '1010-0900-aaaa-gate': { meta: 'kind=gate\n', legs: [['waiting', 0, 'ROW in-257-dots PASS — cleared\n']] },
    '1011-0900-bbbb-gate': { meta: 'kind=gate\n', legs: [['waiting', 0, 'ROW in-257-dots SKIP — tracked (IN-257 fix pending): 6 dots\nROW other PASS — ok\n']] },
  });
  try {
    const s = summarize(path.join(r.root, '1011-0900-bbbb-gate'));
    const leg = s.legs[0];
    assert.deepEqual(leg.regressions, [{ row: 'in-257-dots', passedIn: '1010-0900-aaaa-gate' }]);
    assert.equal(`${leg.verdict}/${leg.result}`, 'app/fail');
    assert.equal(s.overall, 'fail');
    // The earlier run, judged alone, has nothing to regress from.
    assert.equal(summarize(path.join(r.root, '1010-0900-aaaa-gate')).overall, 'pass');
  } finally {
    r.done();
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
