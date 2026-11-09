import assert from 'node:assert/strict';
import { test } from 'node:test';
import { membersSince, newestMemberSince, newestRequestSince, parseAdminOut, requestsSince, soleMemberSince, soleRequestSince } from './hvAdmin.js';

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

test('a vetters-list answer gives the vetter grants the seat reads (memberDid, live, revoked)', () => {
  const out = '[ref-20] vtc/vetting/vetters/grants/list/0.1 -> 200\n{"vetters":[{"memberDid":"did:webvh:x:kk","live":true,"revoked":false,"validUntil":"2026-12-01T00:00:00Z"}]}\n';
  const { status, body } = parseAdminOut(out);
  assert.equal(status, 200);
  assert.equal(body.vetters.filter((v) => v.memberDid === 'did:webvh:x:kk' && v.live && !v.revoked).length, 1);
});

test('requestsSince: every request since the step began, so a second one (another run) is seen', () => {
  const rs = [{ id: 'old', createdAt: '2026-10-21T07:00:00Z' }, { id: 'mine', createdAt: '2026-10-21T08:00:05Z' }, { id: 'theirs', submittedAt: '2026-10-21T08:00:09Z' }];
  assert.deepEqual(requestsSince(rs, '2026-10-21T08:00:00Z').map((r) => r.id), ['mine', 'theirs']);
  assert.deepEqual(requestsSince(rs.slice(0, 2), '2026-10-21T08:00:00Z').map((r) => r.id), ['mine']);
});

const S = '2026-10-21T08:00:00Z';
const mine = { id: 'mine', createdAt: '2026-10-21T08:00:05Z' };
const theirs = { id: 'theirs', createdAt: '2026-10-21T08:00:03Z' };
const reads = (...seq) => { let i = 0; return () => seq[Math.min(i++, seq.length - 1)]; };
const wait = async () => {};

test('soleRequestSince: one request on both reads is the one', async () => {
  assert.deepEqual(await soleRequestSince(reads([], [mine], [mine]), S, { wait }), { req: mine });
});

test('soleRequestSince: another run\'s lone request seen first, then both: none is taken', async () => {
  assert.deepEqual(await soleRequestSince(reads([theirs], [theirs, mine]), S, { wait }), { count: 2 });
});

test('soleRequestSince: two at once, or none at all', async () => {
  assert.deepEqual(await soleRequestSince(reads([mine, theirs]), S, { wait }), { count: 2 });
  assert.deepEqual(await soleRequestSince(reads([]), S, { wait, tries: 3 }), { count: 0 });
});

test('soleMemberSince: the one member on both reads; another run\'s member as well means none', async () => {
  const ours = { did: 'did:webvh:x:ours', joinedAt: '2026-10-21T08:00:30Z' };
  const other = { did: 'did:webvh:x:other', joinedAt: '2026-10-21T08:00:20Z' };
  const old = { did: 'did:webvh:x:old', joinedAt: '2026-10-20T00:00:00Z' };
  assert.deepEqual(await soleMemberSince(reads([old], [old, ours], [old, ours]), S, { wait }), { member: ours });
  assert.deepEqual(await soleMemberSince(reads([old, other], [old, other, ours]), S, { wait }), { count: 2 });
  assert.deepEqual(membersSince([old, ours], S).map((m) => m.did), ['did:webvh:x:ours']);
});
