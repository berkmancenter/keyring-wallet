// node --test scripts/roadmap/stale.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCard, standsFor, workingDaysBetween } from './stale.mjs';

const now = new Date('2026-11-20T12:00:00Z'); // a Friday
const card = (over) => ({
  status: 'Planned', state: 'OPEN', community: false, comments: [],
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-19T00:00:00Z',
  body: '**What this is:** A thing.\n**Where it stands:** Planned. Not a date or a promise.\n', ...over,
});
const kinds = (c, ackDays = 3) => checkCard(c, { now, ackDays }).map((f) => f.kind);

test('working days skip the weekend', () => {
  assert.equal(workingDaysBetween(new Date('2026-11-13T09:00:00Z'), new Date('2026-11-17T09:00:00Z')), 2); // Fri -> Tue
});

test('In progress or Testing idle 14 days, Under review idle 30, are reported; Planned never is', () => {
  assert.deepEqual(kinds(card({ status: 'In progress', updatedAt: '2026-11-05T00:00:00Z', body: card({}).body.replace('Planned. Not a date or a promise.', 'In progress.') })), ['idle']);
  assert.deepEqual(kinds(card({ status: 'In progress', updatedAt: '2026-11-10T00:00:00Z', body: card({}).body.replace('Planned. Not a date or a promise.', 'In progress.') })), []);
  assert.deepEqual(kinds(card({ status: 'Under review', updatedAt: '2026-10-15T00:00:00Z' })), ['idle']);
  assert.deepEqual(kinds(card({ updatedAt: '2026-01-01T00:00:00Z' })), []);
});

test('a Requested card with no maintainer reply past the target is reported; a reply clears it', () => {
  const r = { status: 'Requested', community: true, body: 'What happened?' };
  assert.deepEqual(kinds(card({ ...r, createdAt: '2026-11-13T00:00:00Z' })), ['unacknowledged']);
  assert.deepEqual(kinds(card({ ...r, createdAt: '2026-11-13T00:00:00Z', comments: [{ authorAssociation: 'MEMBER' }] })), []);
  assert.deepEqual(kinds(card({ ...r, createdAt: '2026-11-13T00:00:00Z', comments: [{ authorAssociation: 'NONE' }] })), ['unacknowledged']);
  assert.deepEqual(kinds(card({ ...r, createdAt: '2026-11-18T00:00:00Z' })), []);
  assert.deepEqual(kinds(card({ ...r, createdAt: '2026-11-13T00:00:00Z' }), null), [], 'no target set, no finding');
});

test('a card without its public layer, or whose layer disagrees with Status, is reported', () => {
  assert.deepEqual(kinds(card({ body: 'Some notes.' })), ['layer']);
  assert.deepEqual(kinds(card({ status: 'Shipped', state: 'CLOSED' })), ['layer']);
  assert.deepEqual(kinds(card({ status: 'Shipped', state: 'CLOSED', body: card({}).body.replace('Planned. Not a date or a promise.', 'Shipped.') })), []);
  assert.deepEqual(kinds(card({ status: 'Not planned', state: 'CLOSED', body: 'x' })), [], 'a declined, closed card is left alone');
});

test('"Where it stands" maps to the statuses it agrees with', () => {
  assert.deepEqual(standsFor('**Where it stands:** In progress. A fix is being tested.'), ['In progress', 'Testing']);
  assert.deepEqual(standsFor('**Where it stands:** Proposed. Its decisions are taken.'), ['Requested', 'Under review', 'Planned']);
  assert.equal(standsFor('**Where it stands:** Waiting on upstream.'), null);
  assert.equal(standsFor('no layer'), null);
});
