// node --test e2e/openvtc/ticketSweep.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sweepSpentTickets, ticketRows, ticketTotal } from './ticketSweep.js';

/** A Tickets view `height` rows tall over `tickets`; d → confirm, Enter deletes, Esc keeps. */
function fakeDesk(tickets, { height = 20 } = {}) {
  return {
    t: tickets.map((x) => ({ ...x })), at: 0, top: 0, confirm: null, msg: '', presses: [],
    screen() {
      const head = `│║   Requests (3)  Tickets (${this.t.length})  Issued (3)    ←/→`;
      if (this.confirm) return `${head}\n│║Delete this ticket\n│║Ticket     ${this.confirm}\n│║Enter: delete  Esc: keep it`;
      const rows = this.t.slice(this.top, this.top + height).map((x, i) => `│║${this.top + i === this.at ? '▸ ' : '  '}${x.code}  Keyring Lab Community  ${x.spent ? 'spent or expired' : `1 left, until 2026-10-20`}`);
      return [head, ...rows, this.msg].join('\n');
    },
    async pressEach([k]) {
      this.presses.push(k);
      const n = this.t.length;
      if (this.confirm) {
        if (k === 'Enter') { const c = this.confirm; this.t = this.t.filter((x) => x.code !== c); this.msg = `Ticket ${c} deleted — anyone already holding it is now refused`; this.at = Math.min(this.at, this.t.length - 1); }
        this.confirm = null; return;
      }
      if (k === 'Down') this.at = Math.min(this.at + 1, n - 1);
      if (k === 'Up') this.at = Math.max(this.at - 1, 0);
      if (k === 'PageDown') this.top = Math.min(this.top + height, Math.max(n - height, 0));
      if (k === 'PageUp') this.top = Math.max(this.top - height, 0);
      if (k === 'd') this.confirm = this.t[this.at]?.code ?? null;
    },
  };
}
const make = (n, spentEvery) => Array.from({ length: n }, (_, i) => ({ code: `T${String(i).padStart(3, '0')}-ABCD`, spent: i % spentEvery !== 0 }));

test('ticketRows and ticketTotal read the Tickets view', () => {
  const s = '│║   Requests (26)  Tickets (29)  Issued (26)    ←/→\n│║▸ 2V3K-83EV  Keyring Lab Community  spent or expired\n│║  3CXB-P14R  Keyring Lab Community  1 left, until 2026-10-17\n│[10:57] Ticket 4CPB-TAXR for did:x — press ⏎';
  assert.equal(ticketTotal(s), 29);
  assert.deepEqual(ticketRows(s), [{ code: '2V3K-83EV', spent: true, selected: true }, { code: '3CXB-P14R', spent: false, selected: false }]);
});

test('list (the default) is read-only: no d, no Enter', async () => {
  const tui = fakeDesk(make(45, 3));
  const r = await sweepSpentTickets(tui, { pace: 0 });
  assert.equal(r.deleted, 0);
  assert.equal(r.kept, 45);
  assert.equal(r.spent, 30);
  assert.ok(!tui.presses.includes('d') && !tui.presses.includes('Enter'));
  assert.equal(tui.t.length, 45);
});

test('delete removes every spent or expired ticket, across pages, and keeps every live one', async () => {
  const tui = fakeDesk(make(45, 3));
  const r = await sweepSpentTickets(tui, { mode: 'delete', pace: 0 });
  assert.equal(r.deleted, 30);
  assert.equal(tui.t.length, 15);
  assert.ok(tui.t.every((x) => !x.spent));
});

test('a confirmation that names another ticket deletes nothing (Esc)', async () => {
  const tui = fakeDesk(make(6, 2));
  const orig = tui.pressEach.bind(tui);
  tui.pressEach = async (k) => { await orig(k); if (k[0] === 'd' && tui.confirm) tui.confirm = 'ZZZZ-ZZZZ'; };
  const r = await sweepSpentTickets(tui, { mode: 'delete', pace: 0 });
  assert.equal(r.deleted, 0);
  assert.equal(tui.t.length, 6);
  assert.ok(tui.presses.includes('Esc'));
});
