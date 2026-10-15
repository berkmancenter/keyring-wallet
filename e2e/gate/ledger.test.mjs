// node --test e2e/gate/ledger.test.mjs — the flakiness ledger over runs/*/meta and their legs' ROW lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ledger, parseMeta, parseRows, readRuns } from './ledger.mjs';

const NOW = Date.parse('2026-10-15T00:00:00Z');

function home(runs) {
  const h = mkdtempSync(path.join(tmpdir(), 'ledger-'));
  for (const [run, meta, legs] of runs) {
    mkdirSync(path.join(h, 'runs', run), { recursive: true });
    writeFileSync(path.join(h, 'runs', run, 'meta'), Object.entries(meta).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
    for (const [leg, log] of Object.entries(legs)) {
      mkdirSync(path.join(h, 'runs', run, leg), { recursive: true });
      writeFileSync(path.join(h, 'runs', run, leg, 'leg.log'), log);
    }
  }
  return h;
}

test('meta keeps the first value of a key; ROW lines keep the last status per row', () => {
  assert.deepEqual(parseMeta('pin=abc\nkind=gate\nnote=x=y\nnote=second\n'), { pin: 'abc', kind: 'gate', note: 'x=y' });
  assert.deepEqual(parseRows('HEADS x\nROW r1 FAIL — no\nROW r2 SKIP — n/a\nROW r1 PASS — yes\nROW r3 SKIP — tracked (IN-1 pending): it failed\nLEG k DONE 0\n'), [
    { row: 'r1', status: 'PASS' }, { row: 'r2', status: 'SKIP' }, { row: 'r3', status: 'TRACKED' },
  ]);
});

test('a row that passed and failed on the same pin and harness is flaky there; a harness fix between is not; SKIPs and old runs are not counted', () => {
  const h = home([
    ['1014-0001-aaaa-gate', { pin: 'aaaaaaaa11', harness: 'h1h1h1h', kind: 'gate', started: '2026-10-14T00:01:00Z' }, { p1: 'ROW appr FAIL — x\nROW link PASS — y\nROW skipme SKIP — z\n' }],
    ['1014-0101-aaaa-rerun', { pin: 'aaaaaaaa11', harness: 'h1h1h1h', kind: 'rerun', started: '2026-10-14T01:01:00' }, { p1: 'ROW appr PASS — x\n' }],
    // The same pin with a fixed harness: link failed before the fix and passes after it, which is no flake.
    ['1014-0201-aaaa-rerun', { pin: 'aaaaaaaa11', harness: 'h2h2h2h', kind: 'rerun', started: '2026-10-14T02:01:00Z' }, { p1: 'ROW link FAIL — before\n' }],
    ['1014-0301-aaaa-rerun', { pin: 'aaaaaaaa11', harness: 'h3h3h3h', kind: 'rerun', started: '2026-10-14T03:01:00Z' }, { p1: 'ROW link PASS — after\n' }],
    ['1013-0001-bbbb-gate', { pin: 'bbbbbbbb22', kind: 'gate', started: '2026-10-13T00:01:00Z' }, { p1: 'ROW appr FAIL — x\nROW link PASS — y\n' }],
    ['0901-0001-cccc-gate', { pin: 'cccccccc33', kind: 'gate', started: '2026-09-01T00:01:00Z' }, { p1: 'ROW appr FAIL — old\n' }],
  ]);
  try {
    const runs = readRuns(h, { days: 14, now: NOW });
    assert.equal(runs.length, 5, 'the September run is outside the window');
    const rows = ledger(runs);
    assert.deepEqual(rows.map((r) => [r.leg, r.row, r.pass, r.fail, r.flakyOn]), [
      ['p1', 'appr', 1, 2, ['aaaaaaaa@h1h1h1h']],
      ['p1', 'link', 3, 1, []],
    ]);
    assert.equal(rows[0].rate.toFixed(2), '0.33');
  } finally {
    rmSync(h, { recursive: true, force: true });
  }
});

test('no runs folder is an empty ledger, not an error', () => {
  const h = mkdtempSync(path.join(tmpdir(), 'ledger-'));
  try {
    assert.deepEqual(readRuns(h, { now: NOW }), []);
  } finally {
    rmSync(h, { recursive: true, force: true });
  }
});

test('a tracked row that failed counts as a fail with its tracked count, and can be flaky', () => {
  const h = home([
    ['1014-0001-aaaa-gate', { pin: 'aaaaaaaa11', harness: 'h1h1h1h', kind: 'gate', started: '2026-10-14T00:01:00Z' }, { waiting: 'ROW role SKIP — tracked (UI pending): AgentCard_role false\n' }],
    ['1014-0101-aaaa-rerun', { pin: 'aaaaaaaa11', harness: 'h1h1h1h', kind: 'rerun', started: '2026-10-14T01:01:00Z' }, { waiting: 'ROW role PASS — ok\n' }],
  ]);
  try {
    const [r] = ledger(readRuns(h, { days: 14, now: NOW }));
    assert.deepEqual([r.row, r.pass, r.fail, r.tracked, r.flakyOn], ['role', 1, 1, 1, ['aaaaaaaa@h1h1h1h']]);
  } finally {
    rmSync(h, { recursive: true, force: true });
  }
});
