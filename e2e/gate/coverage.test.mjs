// node --test e2e/gate/coverage.test.mjs — the coverage manifest: every row with its leg and anchor, from a run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { anchorOf, byAnchor, diff, loadFlows, manifest, MANIFEST, runRows } from './coverage.mjs';

const flows = loadFlows();

test('rows map to the five anchors by name first, then by leg, else other', () => {
  assert.equal(anchorOf('kk', 'kk-vetting', flows), 'vetting');
  assert.equal(anchorOf('smoke-android', 'android-signin-unjoined-names-community', flows), 'signin');
  assert.equal(anchorOf('waiting', 'join-approved-card', flows), 'join');
  assert.equal(anchorOf('linkfail', 'swap-held', flows), 'agent');
  assert.equal(anchorOf('p1', '317 Approve asks the owner', flows), 'agent');
  assert.equal(anchorOf('lostreq', 'some-new-row', flows), 'join', 'a leg rule when no row rule matches');
  assert.equal(anchorOf('smoke-ios', 'ios-cold-launch-no-crash', flows), 'other');
  for (const [, a] of flows.rows) assert.ok(flows.anchors.includes(a), `${a} is one of the anchors`);
});

test('a run gives its rows sorted and unique, and a removed row shows in the diff', () => {
  const d = mkdtempSync(path.join(tmpdir(), 'cov-'));
  try {
    for (const [leg, log] of [['kk', 'ROW kk-link PASS — a\nROW kk-link PASS — again\n'], ['waiting', 'ROW join-approved-card FAIL — b\nROW cards-back-new-install SKIP — c\n'], ['meta-only', '']]) {
      mkdirSync(path.join(d, leg));
      if (log) writeFileSync(path.join(d, leg, 'leg.log'), log);
    }
    const text = manifest(runRows(d), flows);
    assert.equal(text, 'leg\trow\tanchor\nkk\tkk-link\tvetting\nwaiting\tcards-back-new-install\tjoin\nwaiting\tjoin-approved-card\tjoin\n');
    assert.deepEqual(byAnchor(text), { vetting: 1, join: 2 });
    const fewer = text.replace('waiting\tjoin-approved-card\tjoin\n', '');
    assert.deepEqual(diff(text, fewer), ['- waiting\tjoin-approved-card\tjoin']);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('the committed manifest is well formed: a header, three fields, known anchors, no duplicates', () => {
  const lines = readFileSync(MANIFEST, 'utf8').split('\n').filter(Boolean);
  assert.equal(lines[0], 'leg\trow\tanchor');
  const seen = new Set();
  for (const l of lines.slice(1)) {
    const f = l.split('\t');
    assert.equal(f.length, 3, l);
    assert.ok(flows.anchors.includes(f[2]), `${l}: unknown anchor`);
    assert.ok(!seen.has(`${f[0]}\t${f[1]}`), `${l}: duplicate`);
    seen.add(`${f[0]}\t${f[1]}`);
  }
  assert.ok(lines.length > 100, 'the full gate has well over 100 rows');
});
