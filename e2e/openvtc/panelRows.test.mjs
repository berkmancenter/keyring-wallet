// node --test e2e/openvtc/panelRows.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { panelRows } from './tuiRoles.js';

// Rows as openvtc b52dc28 drew My Identity → Personas at the 226 gate (P2,
// 2026-09-28 19:20:54Z), trimmed: 16 personas overflow the panel, so its right
// border carries the scrollbar thumb (█) instead of ║.
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));
const menu = (item) => `│${pad(item, 30)}│`;
const scrolled = [
  `┌Menu${'─'.repeat(26)}┐╔Content${'═'.repeat(40)}╗`,
  `${menu('* Communities')}║${pad('', 46)}█`,
  `${menu('* Inbox')}║${pad(' Personas  |  Your attributes  |  Faces', 46)}█`,
  `${menu('* My Relationships')}║${pad('', 46)}█`,
  `${menu('* My Credentials')}║${pad(' 16 personas', 46)}█`,
  `${menu('* Vetting')}║${pad('▸ ○ did:webvh:…:knock-vital', 46)}║`,
].join('\n');

test('a panel row whose right border is the scrollbar thumb reads as panel content', () => {
  const rows = panelRows(scrolled);
  assert.equal(rows[4], '16 personas');
  assert.ok(rows.some((r) => /^\d+ personas?$/.test(r)));
  assert.ok(!rows.includes('* My Credentials'));
});

test('rows bordered by ║ on both sides read as before', () => {
  assert.equal(panelRows(scrolled)[5], '▸ ○ did:webvh:…:knock-vital');
});

test('a line with no content panel still reads its menu column', () => {
  assert.equal(panelRows(menu('* Settings'))[0], '* Settings');
});
