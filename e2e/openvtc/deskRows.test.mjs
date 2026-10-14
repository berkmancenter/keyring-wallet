// node --test e2e/openvtc/deskRows.test.mjs
// The vetter's desk keeps every run's requests, and its pane does not follow the ▸: awaitCard must find the new
// request below the fold (1014-1651 rerun, p1: 29 earlier requests, "card verified —" never on screen).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { awaitCard, deskView } from './tuiRoles.js';

/** A Requests view `height` rows tall over `n` signed requests and the new one last; its card verifies after `after` ms. */
function fakeDesk(n, { height = 26, after = 0 } = {}) {
  const t0 = Date.now();
  return {
    n, at: n, top: 0, presses: [], recorded: [],
    rows() {
      const last = Date.now() - t0 >= after ? 'card verified — check the person, then attest or decline' : 'session open — waiting for their card';
      return [...Array.from({ length: n }, (_, i) => `did:webvh:Qm${i}:dids.ic3.dev:old-${i}  statement signed`), `did:webvh:QmNew:dids.ic3.dev:new-one  ${last}`];
    },
    screen() {
      const rows = this.rows().slice(this.top, this.top + height).map((r, i) => `│║${this.top + i === this.at ? '▸ ' : '  '}${r}`);
      return [`│║   Requests (${this.n + 1})  Tickets (3)  Issued (3)    ←/→`, ...rows].join('\n');
    },
    async pressEach([k]) {
      this.presses.push(k);
      if (k === 'Down') this.at = Math.min(this.at + 1, this.n);
      if (k === 'Up') this.at = Math.max(this.at - 1, 0);
      if (k === 'PageDown') this.top = Math.min(this.top + height, Math.max(this.n + 1 - height, 0));
      if (k === 'PageUp') this.top = Math.max(this.top - height, 0);
    },
    async waitFor(text, { step }) {
      if (!this.screen().includes(text)) throw new Error(`${step}: no "${text}"`);
      this.recorded.push(step);
      return [text];
    },
    failure: (step, _at, why) => new Error(`${step}: ${why}`),
    record() {},
  };
}

test('finds the new request card-verified below the fold, though the pane shows only the old ones', async () => {
  const tui = fakeDesk(29);
  assert.ok(!tui.screen().includes('card verified'), 'the fixture must start with the new row off screen');
  await awaitCard(tui, { timeoutMs: 60000 });
  assert.ok(tui.screen().includes('▸ did:webvh:QmNew'), 'the new request is selected and on screen');
  assert.deepEqual(tui.recorded, ['vetter.cardVerified']);
});

test('fails as vetter.cardVerified when the card never verifies', async () => {
  const tui = fakeDesk(29, { after: 1e9 });
  await assert.rejects(awaitCard(tui, { timeoutMs: 50 }), /vetter\.cardVerified/);
});

test('a short desk with the row on screen needs no key', async () => {
  const tui = fakeDesk(3);
  await awaitCard(tui, { timeoutMs: 1000 });
  assert.deepEqual(tui.presses, []);
});

/** The desk's three views on ←/→, either wrapping round or stopping at the ends, starting on `start`. */
function fakeViews(start, { wraps }) {
  const views = ['Requests', 'Tickets', 'Issued'];
  const body = { Requests: '  did:webvh:Qm1:dids.ic3.dev:old-1  statement signed', Tickets: '▸ 3CXB-P14R  Keyring Lab Community  1 left, until 2026-10-17', Issued: '  did:webvh:Qm1  signed 2026-10-14' };
  return {
    at: views.indexOf(start), presses: [],
    screen() { return `│║   Requests (30)  Tickets (4)  Issued (27)    ←/→\n│║${body[views[this.at]]}`; },
    async pressEach([k]) {
      this.presses.push(k);
      const step = k === 'Right' ? 1 : k === 'Left' ? -1 : 0;
      this.at = wraps ? (this.at + step + 3) % 3 : Math.min(Math.max(this.at + step, 0), 2);
    },
    async waitFor(re, { step }) { if (!re.test(this.screen())) throw new Error(`${step}: not shown`); },
  };
}

test('deskView reaches Requests from Tickets when the views stop at their ends (Left, after Right)', async () => {
  const tui = fakeViews('Tickets', { wraps: false });
  await deskView(tui, 'Requests');
  assert.equal(tui.at, 0);
});

test('deskView reaches Requests from Tickets when the views wrap, with Right alone', async () => {
  const tui = fakeViews('Tickets', { wraps: true });
  await deskView(tui, 'Requests');
  assert.equal(tui.at, 0);
  assert.ok(!tui.presses.includes('Left'));
});

test('deskView presses nothing when the view is already showing', async () => {
  const tui = fakeViews('Requests', { wraps: false });
  await deskView(tui, 'Requests');
  assert.deepEqual(tui.presses, []);
});
