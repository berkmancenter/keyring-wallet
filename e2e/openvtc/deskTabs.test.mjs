// node --test e2e/openvtc/deskTabs.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DESK_VIEWS, moveDeskTo, selectedTab } from './deskTabs.js';

/**
 * A desk whose selected view is known only from its style, as openvtc draws
 * it. `wraps` models a TUI whose → from the last view goes back to the first.
 */
function fakeDesk({ at = 'Tickets', wraps = false, readable = true } = {}) {
  return {
    at: DESK_VIEWS.indexOf(at),
    presses: [],
    deskSelection() {
      return readable ? DESK_VIEWS[this.at] : undefined;
    },
    async pressEach([key]) {
      this.presses.push(key);
      const next = this.at + (key === 'Right' ? 1 : key === 'Left' ? -1 : 0);
      this.at = wraps ? (next + DESK_VIEWS.length) % DESK_VIEWS.length : Math.min(Math.max(next, 0), DESK_VIEWS.length - 1);
    },
  };
}

test('reaches Requests from Tickets with one ← (the 16:22Z desk, whose rows said none of the old words)', async () => {
  const desk = fakeDesk({ at: 'Tickets' });
  assert.equal(await moveDeskTo(desk, 'Requests', { gapMs: 0 }), true);
  assert.deepEqual(desk.presses, ['Left']);
  assert.equal(DESK_VIEWS[desk.at], 'Requests');
});

test('reaches each view from each view, wrapping or not', async () => {
  for (const wraps of [false, true]) {
    for (const from of DESK_VIEWS) {
      for (const to of DESK_VIEWS) {
        const desk = fakeDesk({ at: from, wraps });
        assert.equal(await moveDeskTo(desk, to, { gapMs: 0 }), true, `${from} → ${to} (wraps ${wraps})`);
        assert.equal(DESK_VIEWS[desk.at], to);
        assert.ok(desk.presses.length <= 2);
      }
    }
  }
});

test('says so, pressing nothing, when it cannot read the selection', async () => {
  const desk = fakeDesk({ readable: false });
  assert.equal(await moveDeskTo(desk, 'Requests', { gapMs: 0 }), false);
  assert.deepEqual(desk.presses, []);
});

test('the selected view is the one drawn bold, else the one in its own colour', () => {
  const plain = { bold: false, colour: 'dim' };
  assert.equal(
    selectedTab([
      { label: 'Requests', ...plain },
      { label: 'Tickets', bold: true, colour: 'accent' },
      { label: 'Issued', ...plain },
    ]),
    'Tickets'
  );
  assert.equal(
    selectedTab([
      { label: 'Requests', bold: false, colour: 'accent' },
      { label: 'Tickets', ...plain },
      { label: 'Issued', ...plain },
    ]),
    'Requests'
  );
  assert.equal(selectedTab(DESK_VIEWS.map((label) => ({ label, ...plain }))), undefined);
});
