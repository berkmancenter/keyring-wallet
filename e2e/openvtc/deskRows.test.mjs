// node --test e2e/openvtc/deskRows.test.mjs
// The vetter's desk keeps every run's requests, and its pane does not follow the ▸: awaitCard must find the new
// request below the fold (1014-1651 rerun, p1: 29 earlier requests, "card verified —" never on screen).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { awaitCard } from './tuiRoles.js';

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
