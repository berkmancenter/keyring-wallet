import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newestMemberSince, newestRequestSince, parseAdminOut } from './hvAdmin.js';

const out = (status, json) =>
  `[ref-20] admin did:key:z6Mk\n[ref-20] signed Trust Tasks to https://vtc.example/v1/trust-tasks, no sign-in\n[ref-20] trust-task vtc/join-requests/list/0.1 -> ${status}\n${json}\n`;

test('the payload after the status line, not the [ of [ref-20]', () => {
  assert.deepEqual(parseAdminOut(out(200, '{\n  "items": [ { "id": "r1" } ]\n}')), { status: 200, body: { items: [{ id: 'r1' }] } });
});
test('an array payload', () => {
  assert.deepEqual(parseAdminOut(out(200, '[1, 2]')).body, [1, 2]);
});
test('a refusal keeps its status and body', () => {
  assert.deepEqual(parseAdminOut(out(400, '{"code":"malformedRequest"}')), { status: 400, body: { code: 'malformedRequest' } });
});
test('no payload', () => {
  const r = parseAdminOut('nothing here');
  assert.equal(r.status, 0);
  assert.equal(r.body, undefined);
});
test('newest request and member since a moment', () => {
  const since = '2026-10-17T04:00:00Z';
  assert.equal(newestRequestSince([{ id: 'old', submittedAt: '2026-10-17T03:00:00Z' }, { id: 'a', submittedAt: '2026-10-17T04:01:00Z' }, { id: 'b', createdAt: '2026-10-17T04:02:00Z' }], since).id, 'b');
  assert.equal(newestMemberSince([{ did: 'x', joinedAt: '2026-10-17T03:59:59Z' }], since), undefined);
});
