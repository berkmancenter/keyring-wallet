// node --test e2e/openvtc/listWalk.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rowSelected, walkTo } from './listWalk.js';

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

// openvtc e49816c, 2026-09-29: with 25 tickets out the Tickets list fills the
// pane and the "Read aloud" detail below it is off screen, so the only sign of
// the selection is the ▸ on the ticket's own row.
test('rowSelected: the row carrying the cursor names the ticket', () => {
  const screen = [
    '│║   Requests (22)  Tickets (25)  Issued (18)    ←/→   █',
    '│║▸ 39TA-2HT0  did:webvh:QmUs…MPJB:keyring-vti-vtc.ngrok.app  1 left, until 2026-10-09  █',
    '│║  4CPB-TAXR  did:webvh:QmUs…MPJB:keyring-vti-vtc.ngrok.app  1 left, until 2026-10-13  ║',
  ].join('\n');
  assert.equal(rowSelected(screen, '39TA-2HT0'), true);
  assert.equal(rowSelected(screen, '4CPB-TAXR'), false);
  // The Activity Log names the new ticket too; that is not a selection.
  assert.equal(rowSelected('│[10:57:22] Ticket 4CPB-TAXR for did:webvh:… — press ⏎', '4CPB-TAXR'), false);
});

/**
 * A list in a pane `height` rows tall that scrolls apart from its cursor, as
 * openvtc's content panel does: Down/Up move the ▸, PageDown/PageUp move the view.
 */
function fakePane(rows, { at = 0, height = 27 } = {}) {
  return {
    at,
    top: 0,
    presses: [],
    screen() {
      return rows.slice(this.top, this.top + height).map((r, i) => `${this.top + i === this.at ? '▸ ' : '  '}${r}`).join('\n');
    },
    async pressEach([key]) {
      this.presses.push(key);
      if (key === 'Down') this.at = Math.min(this.at + 1, rows.length - 1);
      if (key === 'Up') this.at = Math.max(this.at - 1, 0);
      if (key === 'PageDown') this.top = Math.min(this.top + height, Math.max(rows.length - height, 0));
      if (key === 'PageUp') this.top = Math.max(this.top - height, 0);
    },
  };
}
const tickets = (n) => Array.from({ length: n }, (_, i) => `T${String(i).padStart(3, '0')}-ABCD  Keyring Lab Community  spent or expired`);
const ticketWanted = (code) => (screen) => rowSelected(screen, code);

test('1012-2223: without reveal, a ticket below the fold of a pane that does not follow is never reached', async () => {
  const tui = fakePane(tickets(28));
  assert.equal(await walkTo(tui, ticketWanted('T027-ABCD'), { pace: 0 }), false);
});

test('with reveal, the walk pages after the cursor and reaches the last of 28 tickets', async () => {
  const tui = fakePane(tickets(28));
  assert.equal(await walkTo(tui, ticketWanted('T027-ABCD'), { pace: 0, reveal: { Down: 'PageDown', Up: 'PageUp' } }), true);
  assert.equal(tui.at, 27);
  assert.ok(tui.presses.includes('PageDown'));
});

test('with reveal, a long list several pages deep, then back up to a row above the start', async () => {
  const tui = fakePane(tickets(200), { at: 150, height: 20 });
  tui.top = 140;
  assert.equal(await walkTo(tui, ticketWanted('T005-ABCD'), { pace: 0, reveal: { Down: 'PageDown', Up: 'PageUp' } }), true);
  assert.equal(tui.at, 5);
});

test('with reveal, a code that is not there still ends the walk: false', async () => {
  const tui = fakePane(tickets(60), { height: 25 });
  assert.equal(await walkTo(tui, ticketWanted('ZZZZ-ZZZZ'), { pace: 0, reveal: { Down: 'PageDown', Up: 'PageUp' } }), false);
  assert.ok(tui.presses.length < 400);
});
