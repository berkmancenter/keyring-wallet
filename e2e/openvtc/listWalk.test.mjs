// node --test e2e/openvtc/listWalk.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { walkTo } from './listWalk.js';

/** A TUI list of `rows`, cursor at `at`, that wraps (or stops at its ends). */
function fakeList(rows, { at = 0, wraps = false } = {}) {
  const tui = {
    at,
    presses: 0,
    screen() {
      return rows.map((r, i) => `${i === this.at ? '▸ ' : '  '}${r}`).join('\n');
    },
    async pressEach([key]) {
      this.presses++;
      const step = key === 'Down' ? 1 : key === 'Up' ? -1 : 0;
      const next = this.at + step;
      this.at = wraps ? (next + rows.length) % rows.length : Math.min(Math.max(next, 0), rows.length - 1);
    },
  };
  return tui;
}

const rows = (n) => Array.from({ length: n }, (_, i) => `did:webvh:Qm${i}:keyring-vti-dids.ngrok.app:row-${i}  statement signed`);
const wanted = (tail) => (screen) => screen.split('\n').some((l) => l.includes('▸') && l.includes(`:${tail} `));

test('reaches the last row of a long list below the cursor', async () => {
  const list = rows(200);
  const tui = fakeList(list);
  assert.equal(await walkTo(tui, wanted('row-199'), { pace: 0 }), true);
  assert.equal(tui.at, 199);
});

test('reaches a row above the cursor when the list stops at its end', async () => {
  const tui = fakeList(rows(120), { at: 90 });
  assert.equal(await walkTo(tui, wanted('row-3'), { pace: 0 }), true);
  assert.equal(tui.at, 3);
});

test('a wrapping list is walked once round, not forever', async () => {
  const tui = fakeList(rows(50), { at: 10, wraps: true });
  assert.equal(await walkTo(tui, wanted('row-9'), { pace: 0 }), true);
  assert.equal(tui.at, 9);
});

test('a row that is not there ends the walk: false, after each key covered the list once', async () => {
  const tui = fakeList(rows(60), { at: 0 });
  assert.equal(await walkTo(tui, wanted('row-999'), { pace: 0 }), false);
  // Down to the end (59 moves + 1 that does not move), then Up back (59 + 1).
  assert.equal(tui.presses, 120);
});

test('the eighth row that a six-press walk missed on 2026-09-25', async () => {
  const tui = fakeList(rows(8));
  assert.equal(await walkTo(tui, wanted('row-7'), { pace: 0 }), true);
});
